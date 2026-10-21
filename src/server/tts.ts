import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { TtsMode } from "../shared/protocol";

export type SpeechAudio = { audio: Buffer; mime: string };

export interface Tts {
  readonly mode: TtsMode;
  /**
   * Returns MP3 audio, or null when the page should speak the text itself.
   * `previousText` is the sentence spoken just before, so the intonation carries over.
   */
  synthesize(text: string, previousText?: string): Promise<SpeechAudio | null>;
}

/** See https://elevenlabs.io/docs/api-reference/text-to-speech/convert */
export type ElevenLabsVoiceSettings = {
  /** Lower = more emotional range, higher = steadier and flatter. */
  stability: number;
  /** How closely to stick to the original voice. */
  similarity_boost: number;
  /** Exaggerates the speaker's style; above 0 adds some latency. */
  style: number;
  /** 1 = normal pace. */
  speed: number;
};

export type TtsConfig =
  | { provider: "browser" }
  | { provider: "edge"; voice: string; rate: string; pitch: string }
  | { provider: "azure"; key: string; region: string; voice: string }
  | { provider: "elevenlabs"; key: string; voiceId: string; model: string; voiceSettings: ElevenLabsVoiceSettings };

const TIMEOUT_MS = 15_000;

/**
 * Keeps the audio of recent sentences, so lines that come back often (small talk,
 * thank-yous) play without another TTS request during a 24-hour live.
 */
export function withAudioCache(tts: Tts, maxEntries = 300): Tts {
  if (tts.mode === "browser") return tts;
  const cache = new Map<string, Promise<SpeechAudio | null>>();
  return {
    mode: tts.mode,
    synthesize(text, previousText) {
      const hit = cache.get(text);
      if (hit) {
        // Refresh its place so the most used lines stay.
        cache.delete(text);
        cache.set(text, hit);
        return hit;
      }
      const audio = tts.synthesize(text, previousText);
      cache.set(text, audio);
      // A failed synthesis must not be served from cache.
      audio.catch(() => cache.delete(text));
      if (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
      return audio;
    },
  };
}

export function createTts(config: TtsConfig): Tts {
  switch (config.provider) {
    case "azure":
      return { mode: "audio", synthesize: (text) => azure(config, text) };
    case "elevenlabs":
      return { mode: "audio", synthesize: (text, previousText) => elevenLabs(config, text, previousText) };
    case "edge":
      return edgeTts(config);
    case "browser":
      return { mode: "browser", synthesize: async () => null };
  }
}

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

/**
 * Microsoft Edge "Read Aloud" neural voices: the same voices as Azure, free, no API key.
 * It is an unofficial endpoint (via msedge-tts), so it can break or be blocked without notice.
 */
function edgeTts(cfg: Extract<TtsConfig, { provider: "edge" }>): Tts {
  let client: Promise<MsEdgeTTS> | null = null;
  // One request at a time on the shared socket.
  let queue: Promise<unknown> = Promise.resolve();

  const connect = () => {
    client ??= (async () => {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(cfg.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      return tts;
    })();
    return client;
  };

  const run = async (text: string): Promise<SpeechAudio> => {
    try {
      const tts = await connect();
      const { audioStream } = tts.toStream(escapeXml(text), { rate: cfg.rate, pitch: cfg.pitch });
      const chunks: Buffer[] = [];
      const collect = (async () => {
        for await (const chunk of audioStream) chunks.push(chunk as Buffer);
      })();
      await Promise.race([
        collect,
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
      ]);
      if (chunks.length === 0) throw new Error("audio kosong");
      return { audio: Buffer.concat(chunks), mime: "audio/mpeg" };
    } catch (err) {
      // Start from a fresh connection next time.
      client = null;
      throw new Error(`Edge TTS: ${(err as Error).message}`);
    }
  };

  // The endpoint sometimes answers 429 for a moment; one retry on a fresh socket usually clears it.
  const runWithRetry = (text: string) =>
    run(text).catch(async () => {
      await new Promise((r) => setTimeout(r, 1500));
      return run(text);
    });

  return {
    mode: "audio",
    synthesize: (text) => {
      const result = queue.then(() => runWithRetry(text));
      queue = result.catch(() => {});
      return result;
    },
  };
}

/** Azure AI Speech REST API. Indonesian neural voices: id-ID-ArdiNeural (male), id-ID-GadisNeural (female). */
async function azure(cfg: Extract<TtsConfig, { provider: "azure" }>, text: string): Promise<SpeechAudio> {
  const ssml =
    `<speak version="1.0" xml:lang="id-ID">` +
    `<voice name="${escapeXml(cfg.voice)}">${escapeXml(text)}</voice></speak>`;
  const res = await fetch(`https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": cfg.key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "tiktok-ai-live",
    },
    body: ssml,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Azure TTS ${res.status}: ${await res.text()}`);
  return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg" };
}

/** ElevenLabs text-to-speech. eleven_v4_turbo is the recommended real-time model and speaks Indonesian. */
async function elevenLabs(
  cfg: Extract<TtsConfig, { provider: "elevenlabs" }>,
  text: string,
  previousText?: string,
): Promise<SpeechAudio> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(cfg.voiceId)}?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": cfg.key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: cfg.model,
      // Pins the pronunciation to Indonesian, so Batak words aren't read in another language.
      // The multilingual_v2 models don't accept it.
      ...(cfg.model.startsWith("eleven_multilingual") ? {} : { language_code: "id" }),
      ...(previousText ? { previous_text: previousText } : {}),
      voice_settings: cfg.voiceSettings,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${await res.text()}`);
  return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg" };
}
