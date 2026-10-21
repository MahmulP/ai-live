import type { ClientMessage, DebugEvent, Mood, ServerMessage } from "../shared/protocol";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/nunito/900.css";
import { Avatar } from "./avatar";
import { Voice } from "./voice";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const BAND_COUNT = 36;
const CAPTION_HOLD_MS = 4000;
const RANDOM_NAMES = ["budi", "sari", "rizky", "dewi", "andi", "putri", "agus", "nina", "fajar", "lia"];

const params = new URLSearchParams(location.search);
const debug = params.has("debug");
/** ?fps=30 caps rendering; the headless streamer uses it so the CPU isn't drawing frames nobody records. */
const maxFps = Number(params.get("fps")) || 0;
/** ?lite: for a server without a GPU. No antialiasing, no twinkling sparkles, 3D drawn smaller and scaled up. */
const lite = params.has("lite");
const liteRenderScale = Number(params.get("render")) || 0.6;
document.documentElement.classList.toggle("lite", lite);

const voice = new Voice();
const avatar = new Avatar($<HTMLCanvasElement>("avatar"), { maxFps, antialias: !lite });

// Fit the 1080x1920 stage into whatever window or browser source shows it.
// clientWidth/Height is the layout viewport the stage is centered in; innerWidth can differ on mobile.
const fit = () => {
  const { clientWidth, clientHeight } = document.documentElement;
  const scale = Math.min(clientWidth / 1080, clientHeight / 1920);
  document.documentElement.style.setProperty("--scale", String(scale));
  // Render 3D only at the size actually shown: a 720x1280 stream draws ~56% fewer pixels.
  avatar.setRenderScale(Math.min(1, scale * devicePixelRatio) * (lite ? liteRenderScale : 1));
};
addEventListener("resize", fit);
fit();

const waveCanvas = $<HTMLCanvasElement>("wave");
const wave = waveCanvas.getContext("2d")!;
const voiceBox = document.querySelector<HTMLElement>(".voice")!;
const voiceLabel = $("voice-label");
const caption = $("caption");
const captionPrompt = $("caption-prompt");
const captionReply = $("caption-reply");

// --- server link -----------------------------------------------------------

let socket: WebSocket | null = null;
const status: Record<string, string> = { "Server": "menyambung...", "TikTok": "-", "Penonton": "-", "Suara": "-", "Antrian": "0" };
let ttsLabel = "-";

function connect() {
  socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  socket.onopen = () => {
    setStatus("Server", "tersambung");
    send({ type: "join", role: debug ? "debug" : "broadcast" });
  };
  socket.onclose = () => {
    setStatus("Server", "terputus, mencoba lagi...");
    setTimeout(connect, 1500);
  };
  socket.onmessage = (e) => handle(JSON.parse(e.data) as ServerMessage);
}

function send(msg: ClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

// Caption and expression follow playback, not network arrival, so they stay in sync with the voice.
const pendingReplies = new Map<string, { caption: string | null; mood: Mood }>();
let shownReply: string | null = null;
let hideTimer: number | undefined;

function handle(msg: ServerMessage) {
  switch (msg.type) {
    case "hello":
      document.title = `${msg.aiName} · AI Live`;
      ttsLabel = msg.ttsMode === "audio" ? "TTS server" : "suara browser";
      showVoiceStatus();
      break;
    case "voice":
      voice.setSpeaker(msg.speaker);
      showVoiceStatus();
      refreshGate();
      break;
    case "stats":
      $("spam-count").textContent = String(msg.spamBlocked);
      setStatus("TikTok", msg.tiktokUser ? `@${msg.tiktokUser}: ${msg.tiktok}` : "tidak dipakai");
      setStatus("Penonton", msg.viewers === null ? "-" : String(msg.viewers));
      setStatus("Antrian", String(msg.queued));
      setStatus(
        "Biaya hari ini",
        `$${msg.spentTodayUsd.toFixed(3)}${msg.dailyLimitUsd > 0 ? ` dari batas $${msg.dailyLimitUsd}` : " (tanpa batas)"}`,
      );
      break;
    case "chat-log":
      logChat(msg.nickname, msg.text, msg.status);
      break;
    case "reply-start":
      pendingReplies.set(msg.replyId, { caption: msg.caption, mood: msg.mood });
      break;
    case "utterance":
      voice.enqueue(msg);
      break;
    case "reply-end":
      voice.endReply(msg.replyId);
      break;
  }
}

voice.onSentenceStart = (replyId, text) => {
  clearTimeout(hideTimer);
  if (replyId !== shownReply) {
    shownReply = replyId;
    const reply = pendingReplies.get(replyId);
    pendingReplies.delete(replyId);
    captionPrompt.textContent = reply?.caption ?? "";
    captionReply.textContent = text;
    if (reply) avatar.react(reply.mood);
  } else {
    captionReply.textContent = `${captionReply.textContent} ${text}`;
  }
  caption.hidden = false;
  caption.classList.remove("fading");
};

voice.onIdle = (replyId) => {
  send({ type: "playback-idle", replyId });
  hideTimer = window.setTimeout(() => caption.classList.add("fading"), CAPTION_HOLD_MS);
};

// --- animation loop ----------------------------------------------------------

function drawWave(bands: number[], speaking: boolean, t: number) {
  const { width, height } = waveCanvas;
  wave.clearRect(0, 0, width, height);
  const gap = 6;
  const barWidth = (width - gap * (bands.length - 1)) / bands.length;
  wave.fillStyle = speaking ? "#ffb38a" : "#6d5a9e";
  bands.forEach((band, i) => {
    const idle = 0.06 + 0.04 * Math.sin(t * 2 + i * 0.6);
    const h = Math.max(4, (speaking ? band : idle) * height);
    wave.beginPath();
    wave.roundRect(i * (barWidth + gap), (height - h) / 2, barWidth, h, 2);
    wave.fill();
  });
}

let lastTick = 0;

function tick(now: number) {
  requestAnimationFrame(tick);
  if (maxFps && now - lastTick < 1000 / maxFps - 1) return;
  lastTick = now;
  const t = now / 1000;
  const s = voice.sample(t, BAND_COUNT);
  avatar.setMouthOpen(s.speaking ? s.level : 0);
  voiceBox.classList.toggle("speaking", s.speaking);
  voiceLabel.textContent = s.speaking ? "SPEAKING" : "LISTENING";
  drawWave(s.bands, s.speaking, t);
}

// --- audio unlock --------------------------------------------------------------

// Browsers keep audio muted until a click. OBS allows autoplay, so the gate never shows there.
const gate = $("audio-gate");
const refreshGate = () => (gate.hidden = !(voice.locked && voice.isSpeaker));
gate.querySelector("button")!.addEventListener("click", async () => {
  await voice.unlock();
  refreshGate();
});
voice.ctx.addEventListener("statechange", refreshGate);

// --- debug panel (?debug) ---------------------------------------------------------

function showVoiceStatus() {
  setStatus("Suara", `${ttsLabel}, ${voice.isSpeaker ? "halaman ini yang bicara" : "diam (halaman lain yang bicara)"}`);
}

function setStatus(key: string, value: string) {
  status[key] = value;
  if (!debug) return;
  const dl = $("debug-status");
  dl.replaceChildren(
    ...Object.entries(status).flatMap(([k, v]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      return [dt, dd];
    }),
  );
}

function logChat(nickname: string, text: string, verdict: string) {
  if (!debug) return;
  const li = document.createElement("li");
  li.className = verdict === "ok" ? "ok" : "blocked";
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = verdict === "ok" ? "masuk antrian" : verdict;
  li.append(tag, `${nickname}: ${text}`);
  const list = $("dbg-log");
  list.prepend(li);
  while (list.children.length > 12) list.lastElementChild!.remove();
}

function setupDebug() {
  $("debug").hidden = false;
  const nameInput = $<HTMLInputElement>("dbg-name");
  const textInput = $<HTMLInputElement>("dbg-text");
  const randomName = $<HTMLInputElement>("dbg-random");
  const name = () =>
    randomName.checked
      ? `${RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]}${Math.floor(Math.random() * 90 + 10)}`
      : nameInput.value.trim() || "penonton";
  const emit = (event: DebugEvent) => send({ type: "debug-event", event });

  $<HTMLFormElement>("debug-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    if (!text) return;
    emit({ kind: "chat", nickname: name(), text });
    textInput.value = "";
  });
  $("dbg-gift").addEventListener("click", () => emit({ kind: "gift", nickname: name(), giftName: "Rose", count: 5 }));
  $("dbg-follow").addEventListener("click", () => emit({ kind: "follow", nickname: name() }));
  $("dbg-join").addEventListener("click", () => emit({ kind: "join", nickname: name() }));
  setStatus("Server", status["Server"]!);
}

// --- start --------------------------------------------------------------------------

async function main() {
  if (debug) setupDebug();
  refreshGate();
  connect();
  requestAnimationFrame(tick);
  avatar.start();
}

main().catch((err) => console.error(err));
