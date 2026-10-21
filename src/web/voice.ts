type Utterance = { replyId: string; text: string; audio?: string; mime?: string };

export type VoiceSample = { level: number; bands: number[]; speaking: boolean };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const estimateMs = (text: string) => 1200 + text.length * 70;

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Plays the AI's sentences in order and exposes the live audio level for
 * lip-sync and the waveform. Server MP3s go through Web Audio (so OBS can
 * capture them and the analyser can read them); sentences without audio
 * fall back to the browser's speech synthesis with a simulated level.
 */
export class Voice {
  readonly ctx = new AudioContext();
  onSentenceStart?: (replyId: string, text: string) => void;
  onIdle?: (replyId: string) => void;

  private readonly analyser = this.ctx.createAnalyser();
  private readonly output = this.ctx.createGain();
  private readonly timeData: Float32Array<ArrayBuffer>;
  private readonly freqData: Uint8Array<ArrayBuffer>;
  private chain: Promise<void> = Promise.resolve();
  private playHead = 0;
  private pending = 0;
  private endedReply: string | null = null;
  private browserSpeaking = false;
  private pulse = 0;
  /** Silent until the server says this page is the one that talks. */
  private speaker = false;

  constructor() {
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.55;
    // Analyser before the gain, so a muted page still gets real levels for lip-sync.
    this.analyser.connect(this.output);
    this.output.connect(this.ctx.destination);
    this.output.gain.value = 0;
    this.timeData = new Float32Array(this.analyser.fftSize);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    window.speechSynthesis?.getVoices();
  }

  get locked(): boolean {
    return this.ctx.state !== "running";
  }

  get isSpeaker(): boolean {
    return this.speaker;
  }

  /** Only one open page plays sound; the others animate in silence. */
  setSpeaker(on: boolean): void {
    this.speaker = on;
    this.output.gain.value = on ? 1 : 0;
    if (!on) window.speechSynthesis?.cancel();
  }

  async unlock(): Promise<void> {
    await this.ctx.resume();
    // Chrome only allows speech synthesis after a user gesture; prime it now.
    window.speechSynthesis?.speak(new SpeechSynthesisUtterance(""));
  }

  enqueue(u: Utterance): void {
    this.pending++;
    this.chain = this.chain
      .then(() => (u.audio ? this.playAudio(u) : this.speakWithBrowser(u)))
      .catch((err) => {
        console.error("[voice]", err);
        this.finishOne();
      });
  }

  /** The server finished sending this reply; report idle once it has all played. */
  endReply(replyId: string): void {
    this.endedReply = replyId;
    this.checkIdle();
  }

  sample(t: number, bandCount: number): VoiceSample {
    if (this.browserSpeaking) {
      this.pulse *= 0.9;
      const level = clamp01(0.25 + 0.4 * Math.abs(Math.sin(t * 14)) * (0.6 + 0.4 * Math.sin(t * 3.3)) + this.pulse * 0.3);
      const bands = Array.from({ length: bandCount }, (_, i) =>
        clamp01(level * (0.45 + 0.55 * Math.abs(Math.sin(t * 7 + i * 1.7)))),
      );
      return { level, bands, speaking: true };
    }

    this.analyser.getFloatTimeDomainData(this.timeData);
    let sum = 0;
    for (const v of this.timeData) sum += v * v;
    const rms = Math.sqrt(sum / this.timeData.length);
    const level = clamp01((rms - 0.015) * 7);

    // Speech energy sits roughly between 80 Hz and 4 kHz; spread the bars log-scale across it.
    this.analyser.getByteFrequencyData(this.freqData);
    const binHz = this.ctx.sampleRate / 2 / this.freqData.length;
    const lo = 80;
    const hi = 4000;
    const bands = Array.from({ length: bandCount }, (_, i) => {
      const from = Math.floor((lo * (hi / lo) ** (i / bandCount)) / binHz);
      const to = Math.max(from + 1, Math.ceil((lo * (hi / lo) ** ((i + 1) / bandCount)) / binHz));
      let total = 0;
      for (let b = from; b < to; b++) total += this.freqData[b] ?? 0;
      return clamp01(total / (to - from) / 255);
    });
    return { level, bands, speaking: this.ctx.currentTime < this.playHead };
  }

  private async playAudio(u: Utterance) {
    let buffer: AudioBuffer;
    try {
      buffer = await this.ctx.decodeAudioData(base64ToArrayBuffer(u.audio!));
    } catch (err) {
      console.warn("[voice] audio tidak bisa diputar, pakai suara browser", err);
      return this.speakWithBrowser(u);
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    const startAt = Math.max(this.ctx.currentTime + 0.05, this.playHead);
    source.start(startAt);
    this.playHead = startAt + buffer.duration;
    setTimeout(() => this.onSentenceStart?.(u.replyId, u.text), (startAt - this.ctx.currentTime) * 1000);
    source.onended = () => this.finishOne();
  }

  private async speakWithBrowser(u: Utterance) {
    const wait = (this.playHead - this.ctx.currentTime) * 1000;
    if (wait > 0) await sleep(wait);
    this.onSentenceStart?.(u.replyId, u.text);
    this.browserSpeaking = true;
    try {
      if (this.speaker) await speak(u.text, () => (this.pulse = 1));
      else await sleep(estimateMs(u.text));
    } finally {
      this.browserSpeaking = false;
      this.finishOne();
    }
  }

  private finishOne() {
    this.pending = Math.max(0, this.pending - 1);
    this.checkIdle();
  }

  private checkIdle() {
    if (this.endedReply && this.pending === 0) {
      const replyId = this.endedReply;
      this.endedReply = null;
      this.onIdle?.(replyId);
    }
  }
}

function speak(text: string, onBoundary: () => void): Promise<void> {
  const synth = window.speechSynthesis;
  // OBS's browser source has no speech voices; just hold the mouth animation for a while.
  if (!synth || synth.getVoices().length === 0) return sleep(estimateMs(text));
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "id-ID";
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith("id"));
    if (voice) utterance.voice = voice;
    utterance.rate = 1.05;
    utterance.onboundary = onBoundary;
    // Some engines never fire `end`; don't let one stuck sentence block the queue.
    const guard = setTimeout(done, estimateMs(text) + 4000);
    function done() {
      clearTimeout(guard);
      resolve();
    }
    utterance.onend = done;
    utterance.onerror = done;
    synth.speak(utterance);
  });
}
