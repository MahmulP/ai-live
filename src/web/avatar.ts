import * as THREE from "three";
import type { Mood } from "../shared/protocol";

const PALETTE = {
  skin: "#f6c6a0",
  hair: "#2d1d1b",
  eye: "#23150f",
  brow: "#3b2621",
  blush: "#ff8aa2",
  mouth: "#5e1b28",
  tongue: "#ff7c90",
  shirt: "#5cc3be",
  shoe: "#5b3a30",
  outline: "#2a1430",
  heart: "#ff5d8f",
  // Ulos, the Batak woven cloth: deep red, black and white with gold accents.
  ulosRed: "#a8212b",
  ulosBlack: "#1d1517",
  ulosWhite: "#f3ece0",
  ulosGold: "#d8a245",
};

/** Head ellipsoid radii; face features are placed on this surface. */
const HEAD = { a: 1.1, b: 0.95, c: 1.0 };
const ROOT_Y = 1.05;
const MOOD_SECONDS: Record<Mood, number> = { neutral: 0, curious: 3, happy: 2.6, wave: 2.6 };

const OUTLINE = new THREE.MeshBasicMaterial({ color: PALETTE.outline, side: THREE.BackSide });

function toonGradient(): THREE.Texture {
  const tex = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Inverted-hull outline: a slightly larger back-face copy gives the cartoon ink line. */
function outlined<T extends THREE.Mesh>(mesh: T, thickness = 0.035): T {
  const shell = new THREE.Mesh(mesh.geometry, OUTLINE);
  shell.scale.setScalar(1 + thickness);
  mesh.add(shell);
  return mesh;
}

/** Puts `obj` on the head surface at (x, y), facing outward. */
function onFace<T extends THREE.Object3D>(obj: T, x: number, y: number, lift = 0): T {
  const z = HEAD.c * Math.sqrt(Math.max(0, 1 - (x / HEAD.a) ** 2 - (y / HEAD.b) ** 2));
  const normal = new THREE.Vector3(x / HEAD.a ** 2, y / HEAD.b ** 2, z / HEAD.c ** 2).normalize();
  obj.position.set(x, y, z).addScaledVector(normal, lift);
  obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  return obj;
}

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Ulos-inspired stripes: bands along the cloth with a gold zigzag down the middle. */
function ulosTexture(): THREE.Texture {
  const tex = canvasTexture(256, 64, (ctx) => {
    const bands: [string, number][] = [
      [PALETTE.ulosRed, 12], [PALETTE.ulosWhite, 3], [PALETTE.ulosBlack, 4], [PALETTE.ulosRed, 26],
      [PALETTE.ulosBlack, 4], [PALETTE.ulosWhite, 3], [PALETTE.ulosRed, 12],
    ];
    let y = 0;
    for (const [color, h] of bands) {
      ctx.fillStyle = color;
      ctx.fillRect(0, y, 256, h);
      y += h;
    }
    ctx.strokeStyle = PALETTE.ulosGold;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= 256; x += 16) ctx.lineTo(x, x % 32 === 0 ? 27 : 37);
    ctx.stroke();
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function heartTexture(): THREE.Texture {
  return canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = PALETTE.heart;
    ctx.beginPath();
    ctx.moveTo(64, 112);
    ctx.bezierCurveTo(8, 72, 12, 20, 40, 18);
    ctx.bezierCurveTo(54, 17, 62, 28, 64, 38);
    ctx.bezierCurveTo(66, 28, 74, 17, 88, 18);
    ctx.bezierCurveTo(116, 20, 120, 72, 64, 112);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.ellipse(42, 42, 10, 7, -0.6, 0, Math.PI * 2);
    ctx.fill();
  });
}

function shadowTexture(): THREE.Texture {
  return canvasTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
}

const ease = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

type Eye = { group: THREE.Group; ball: THREE.Mesh; shines: THREE.Mesh[]; happy: THREE.Mesh };
type Heart = { sprite: THREE.Sprite; born: number; drift: number };

/**
 * Chibi host character built from primitives with toon shading.
 * The mouth follows `setMouthOpen()` (audio level); `react()` plays a short
 * expression (happy eyes and hearts, a wave, a curious head tilt).
 */
export class Avatar {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly gradient = toonGradient();
  private readonly heartMap = heartTexture();

  private readonly root = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly eyes: Eye[] = [];
  private readonly brows: THREE.Group[] = [];
  private readonly blushes: THREE.Mesh[] = [];
  private readonly arms: THREE.Group[] = [];
  private readonly hearts: Heart[] = [];
  private smile!: THREE.Mesh;
  private openMouth!: THREE.Group;

  private mouth = 0;
  private mouthTarget = 0;
  private mood: Mood = "neutral";
  private moodStart = -Infinity;
  private tilt = 0;
  private armRaise = 0;
  private look = new THREE.Vector2();
  private lookTarget = new THREE.Vector2();
  private nextLook = 1;
  private blinkStart = -1;
  private nextBlink = 2;
  private lastRender = 0;
  private readonly maxFps: number;

  /** `maxFps` 0 renders every animation frame. Antialiasing is the costliest part when WebGL runs on the CPU. */
  constructor(canvas: HTMLCanvasElement, { maxFps = 0, antialias = true } = {}) {
    this.maxFps = maxFps;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias, alpha: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(canvas.width, canvas.height, false);
    this.renderer.setClearColor(0x000000, 0);
    this.camera = new THREE.PerspectiveCamera(30, canvas.width / canvas.height, 0.1, 100);
    this.camera.position.set(0, 0, 16);

    this.scene.add(new THREE.HemisphereLight("#fff4ea", "#6a4f9a", 2.2));
    const key = new THREE.DirectionalLight("#ffffff", 2.4);
    key.position.set(3, 4, 6);
    this.scene.add(key);

    this.root.position.y = ROOT_Y;
    this.scene.add(this.root);
    this.buildBody();
    this.buildHead();
  }

  /** Pixels drawn per stage pixel: 1 for a 1080x1920 output, about 0.67 for 720x1280. */
  setRenderScale(scale: number): void {
    this.renderer.setPixelRatio(scale);
    this.renderer.setSize(1080, 1920, false);
  }

  /** 0 = closed, 1 = wide open. */
  setMouthOpen(value: number): void {
    this.mouthTarget = Math.min(1, Math.max(0, value));
  }

  react(mood: Mood): void {
    this.mood = mood;
    this.moodStart = this.clock.elapsedTime;
    if (mood === "happy") this.spawnHearts(8);
    if (mood === "wave") this.spawnHearts(4);
  }

  start(): void {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private toon(color: string, extra: THREE.MeshToonMaterialParameters = {}) {
    return new THREE.MeshToonMaterial({ color, gradientMap: this.gradient, ...extra });
  }

  private flat(color: string, extra: THREE.MeshBasicMaterialParameters = {}) {
    return new THREE.MeshBasicMaterial({ color, ...extra });
  }

  private buildBody() {
    const body = outlined(new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 0.35, 8, 32), this.toon(PALETTE.shirt)));
    body.scale.set(1, 0.8, 0.85);
    body.position.y = -0.45;
    this.root.add(body);

    for (const side of [-1, 1]) {
      const foot = outlined(new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.toon(PALETTE.shoe)), 0.08);
      foot.scale.set(0.24, 0.14, 0.3);
      foot.position.set(side * 0.27, -1.1, 0.12);
      this.root.add(foot);

      // Arms hang from a shoulder pivot so they can wave.
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.5, -0.2, 0);
      const arm = outlined(new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.3, 6, 16), this.toon(PALETTE.shirt)), 0.08);
      arm.position.y = -0.28;
      const hand = outlined(new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), this.toon(PALETTE.skin)), 0.08);
      hand.position.y = -0.52;
      shoulder.add(arm, hand);
      shoulder.rotation.z = side * 0.35;
      this.root.add(shoulder);
      this.arms.push(shoulder);
    }

    // Ulos scarf around the neck, with one end hanging over the chest.
    const ulos = ulosTexture();
    ulos.repeat.set(6, 1);
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.15, 16, 64), this.toon("#ffffff", { map: ulos }));
    scarf.rotation.x = Math.PI / 2 + 0.3;
    scarf.position.set(0, 0.12, 0.05);
    this.root.add(outlined(scarf, 0.05));

    const tailMap = ulosTexture();
    tailMap.center.set(0.5, 0.5);
    tailMap.rotation = Math.PI / 2;
    const tail = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 0.62),
      this.toon("#ffffff", { map: tailMap, side: THREE.DoubleSide }),
    );
    tail.position.set(0.26, -0.2, 0.56);
    tail.rotation.set(-0.2, 0.15, -0.12);
    for (let i = 0; i < 6; i++) {
      const fringe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6),
        this.flat(i % 2 ? PALETTE.ulosRed : PALETTE.ulosWhite),
      );
      fringe.position.set(-0.11 + i * 0.044, -0.36, 0);
      tail.add(fringe);
    }
    this.root.add(tail);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      this.flat("#000000", { map: shadowTexture(), transparent: true, depthWrite: false }),
    );
    shadow.scale.set(1.5, 0.3, 1);
    shadow.position.set(0, -1.24, -0.3);
    this.root.add(shadow);
  }

  private buildHead() {
    this.head.position.y = 0.95;
    this.root.add(this.head);

    const skull = outlined(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), this.toon(PALETTE.skin)), 0.03);
    skull.scale.set(HEAD.a, HEAD.b, HEAD.c);
    this.head.add(skull);

    for (const side of [-1, 1]) {
      const ear = outlined(new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.toon(PALETTE.skin)), 0.08);
      ear.scale.set(0.15, 0.22, 0.13);
      ear.position.set(side * 1.08, -0.05, 0);
      this.head.add(ear);
    }

    this.buildHair();
    this.buildFace();
  }

  private buildHair() {
    const hair = this.toon(PALETTE.hair);
    // A cap tilted back so the hairline sits high on the forehead.
    const cap = outlined(
      new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.45), hair),
      0.03,
    );
    cap.scale.set(HEAD.a * 1.04, HEAD.b * 1.06, HEAD.c * 1.05);
    cap.rotation.x = -0.45;
    this.head.add(cap);

    // Fringe tufts along the hairline.
    for (const x of [-0.62, -0.32, 0, 0.32, 0.62]) {
      const tuft = outlined(new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), hair), 0.08);
      onFace(tuft, x, 0.6 - Math.abs(x) * 0.18, -0.02);
      tuft.scale.set(0.24, 0.17, 0.14);
      this.head.add(tuft);
    }

    // The ahoge: one stubborn curl on top.
    const curl = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.05, 0.9, 0.05),
      new THREE.Vector3(0.12, 1.2, 0.12),
      new THREE.Vector3(-0.05, 1.38, 0.18),
      new THREE.Vector3(-0.2, 1.3, 0.12),
    ]);
    this.head.add(outlined(new THREE.Mesh(new THREE.TubeGeometry(curl, 24, 0.045, 8, false), hair), 0.25));
  }

  private buildFace() {
    const sphere = new THREE.SphereGeometry(1, 32, 24);
    for (const side of [-1, 1]) {
      const group = onFace(new THREE.Group(), side * 0.36, 0.02, 0);
      const ball = new THREE.Mesh(sphere, this.flat(PALETTE.eye));
      ball.scale.set(0.15, 0.2, 0.05);
      const big = new THREE.Mesh(sphere, this.flat("#ffffff"));
      big.scale.setScalar(0.05);
      big.position.set(0.045, 0.075, 0.045);
      const small = new THREE.Mesh(sphere, this.flat("#ffffff"));
      small.scale.setScalar(0.024);
      small.position.set(-0.045, -0.075, 0.045);
      // ^ ^ eyes for happy moments.
      const happy = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.028, 8, 24, Math.PI), this.flat(PALETTE.eye));
      happy.position.y = -0.04;
      happy.visible = false;
      group.add(ball, big, small, happy);
      this.head.add(group);
      this.eyes.push({ group, ball, shines: [big, small], happy });

      const brow = onFace(new THREE.Group(), side * 0.36, 0.3, 0.01);
      const browBar = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.12, 4, 8), this.flat(PALETTE.brow));
      browBar.rotation.z = Math.PI / 2;
      brow.add(browBar);
      this.head.add(brow);
      this.brows.push(brow);

      const blush = onFace(
        new THREE.Mesh(
          new THREE.CircleGeometry(1, 32),
          this.flat(PALETTE.blush, { transparent: true, opacity: 0.55, depthWrite: false }),
        ),
        side * 0.62,
        -0.2,
        0.012,
      );
      blush.scale.set(0.17, 0.11, 1);
      this.head.add(blush);
      this.blushes.push(blush);
    }

    const mouth = onFace(new THREE.Group(), 0, -0.32, 0.01);
    const smileCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.11, 0.03, 0),
      new THREE.Vector3(0, -0.07, 0),
      new THREE.Vector3(0.11, 0.03, 0),
    );
    this.smile = new THREE.Mesh(new THREE.TubeGeometry(smileCurve, 20, 0.02, 8, false), this.flat(PALETTE.mouth));

    this.openMouth = new THREE.Group();
    const cavity = new THREE.Mesh(sphere, this.flat(PALETTE.mouth));
    cavity.scale.set(0.13, 0.11, 0.04);
    const tongue = new THREE.Mesh(sphere, this.flat(PALETTE.tongue));
    tongue.scale.set(0.075, 0.04, 0.03);
    tongue.position.set(0, -0.055, 0.02);
    this.openMouth.add(cavity, tongue);
    this.openMouth.visible = false;
    mouth.add(this.smile, this.openMouth);
    this.head.add(mouth);
  }

  private spawnHearts(count: number) {
    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.heartMap, transparent: true, depthWrite: false }));
      const side = i % 2 ? 1 : -1;
      sprite.position.set(side * (1.2 + Math.random() * 0.6), 0.6 + Math.random() * 1.2, 0.5);
      sprite.scale.setScalar(0.3 + Math.random() * 0.2);
      this.root.add(sprite);
      this.hearts.push({ sprite, born: this.clock.elapsedTime + i * 0.12, drift: Math.random() * Math.PI * 2 });
    }
  }

  private frame() {
    const now = performance.now();
    if (this.maxFps && now - this.lastRender < 1000 / this.maxFps - 1) return;
    this.lastRender = now;
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    const moodAge = t - this.moodStart;
    const mood: Mood = moodAge < MOOD_SECONDS[this.mood] ? this.mood : "neutral";
    const joyful = mood === "happy" || mood === "wave";

    // Mouth: open fast, close a bit slower.
    this.mouth = ease(this.mouth, this.mouthTarget, this.mouthTarget > this.mouth ? 22 : 12, dt);
    const open = this.mouth;
    this.smile.visible = open < 0.06;
    this.openMouth.visible = !this.smile.visible;
    this.openMouth.scale.set(1 - open * 0.15, 0.25 + open * 1.1, 1);

    // Breathing bounce, plus a hop when happy.
    const hop = mood === "happy" && moodAge < 1.4 ? Math.abs(Math.sin(moodAge * Math.PI * 2.2)) * 0.22 : 0;
    const breath = Math.sin(t * 2.2);
    this.root.position.y = ROOT_Y + breath * 0.025 + hop;
    this.root.scale.set(1 - breath * 0.008, 1 + breath * 0.012, 1);

    // Wander the gaze while listening; look at the viewer while talking.
    if (t > this.nextLook) {
      this.lookTarget.set((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.5);
      this.nextLook = t + 1.5 + Math.random() * 2.5;
    }
    const target = open > 0.05 || joyful ? new THREE.Vector2() : this.lookTarget;
    this.look.set(ease(this.look.x, target.x, 4, dt), ease(this.look.y, target.y, 4, dt));

    this.tilt = ease(this.tilt, mood === "curious" ? 0.17 : 0, 5, dt);
    this.head.rotation.set(
      -open * 0.06 + Math.sin(t * 0.7) * 0.03 - this.look.y * 0.12,
      Math.sin(t * 0.5) * 0.1 + this.look.x * 0.25,
      Math.sin(t * 0.8) * 0.04 + this.tilt,
    );
    this.head.position.y = 0.95 + open * 0.03;

    // Blink every few seconds.
    if (t >= this.nextBlink) {
      this.blinkStart = t;
      this.nextBlink = t + 2.5 + Math.random() * 3.5;
    }
    const p = (t - this.blinkStart) / 0.14;
    const lid = p >= 0 && p < 1 ? 1 - Math.sin(p * Math.PI) * 0.92 : 1;
    for (const eye of this.eyes) {
      eye.happy.visible = joyful;
      eye.ball.visible = !joyful;
      eye.ball.scale.y = 0.2 * lid;
      eye.ball.position.set(this.look.x * 0.035, this.look.y * 0.03, 0);
      for (const shine of eye.shines) shine.visible = !joyful && lid > 0.5;
    }

    // Right brow lifts when curious.
    this.brows[1]!.position.y = ease(this.brows[1]!.position.y, mood === "curious" ? 0.36 : 0.3, 6, dt);
    for (const blush of this.blushes) {
      (blush.material as THREE.MeshBasicMaterial).opacity = joyful ? 0.85 : 0.55;
    }

    // Right arm waves on a follow, both arms swing a little otherwise.
    this.armRaise = ease(this.armRaise, mood === "wave" ? 1 : 0, 6, dt);
    const swing = Math.sin(t * 2.2) * 0.04;
    this.arms[0]!.rotation.z = -0.35 - swing;
    // Raised out to the side and a bit forward, so the hand stays clear of the big head.
    this.arms[1]!.rotation.z = 0.35 + swing + this.armRaise * (1.45 + Math.sin(t * 12) * 0.35);
    this.arms[1]!.rotation.x = -this.armRaise * 0.4;

    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const heart = this.hearts[i]!;
      const age = t - heart.born;
      heart.sprite.visible = age >= 0;
      if (age < 0) continue;
      heart.sprite.position.y += dt * 0.7;
      heart.sprite.position.x += Math.sin(t * 3 + heart.drift) * dt * 0.2;
      heart.sprite.material.opacity = Math.max(0, 1 - age / 1.8);
      if (age > 1.8) {
        this.root.remove(heart.sprite);
        heart.sprite.material.dispose();
        this.hearts.splice(i, 1);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
