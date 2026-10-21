import { existsSync } from "node:fs";
import type { Effort, ThinkingMode } from "./brain";
import { DEFAULT_BANNED_WORDS } from "./moderation";
import type { TtsConfig } from "./tts";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const env = process.env;

  const num = (name: string, fallback: number) => {
    const raw = env[name];
    const value = raw === undefined || raw === "" ? fallback : Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${name} harus berupa angka, sekarang "${raw}"`);
    return value;
  };

  // AI_* rather than CLAUDE_*: Claude Code exports CLAUDE_EFFORT, and an inherited
  // shell variable silently wins over the value in .env.
  const effort = (env.AI_EFFORT || "low") as Effort;
  if (!EFFORTS.includes(effort)) throw new Error(`AI_EFFORT harus salah satu dari ${EFFORTS.join(", ")}`);

  const thinking = (env.AI_THINKING || "on") as ThinkingMode;
  if (thinking !== "on" && thinking !== "off") throw new Error(`AI_THINKING harus "on" atau "off", sekarang "${thinking}"`);
  if (thinking === "off" && (effort === "xhigh" || effort === "max")) {
    throw new Error("AI_THINKING=off hanya bisa dengan AI_EFFORT low, medium, atau high");
  }

  const maxDailyUsd = num("MAX_DAILY_USD", 5);
  if (maxDailyUsd < 0) throw new Error("MAX_DAILY_USD tidak boleh negatif (0 = tanpa batas)");

  const extraBanned = (env.EXTRA_BANNED_WORDS ?? "")
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);

  return {
    production: env.NODE_ENV === "production",
    demo: env.AI_MODE === "demo",
    port: num("SERVER_PORT", 8787),
    // 127.0.0.1 keeps the ?debug panel off the network; Docker sets 0.0.0.0 so the streamer container can reach it.
    host: env.SERVER_HOST || "127.0.0.1",
    aiName: env.AI_NAME || "Ucok",
    personaFile: env.PERSONA_FILE || "persona.md",
    tiktokUsername: (env.TIKTOK_USERNAME ?? "").replace(/^@/, "").trim() || null,
    tiktokSignApiKey: env.TIKTOK_SIGN_API_KEY || undefined,
    model: env.AI_MODEL || "claude-opus-5-5",
    effort,
    thinking,
    maxDailyUsd,
    replyGapMs: num("REPLY_GAP_SECONDS", 3) * 1000,
    idleTalkMs: num("IDLE_TALK_SECONDS", 60) * 1000,
    greetJoinsMs: num("GREET_JOINS_SECONDS", 60) * 1000,
    userCooldownMs: num("USER_COOLDOWN_SECONDS", 15) * 1000,
    bannedWords: [...DEFAULT_BANNED_WORDS, ...extraBanned],
    tts: ttsConfig(env),
  };
}

function ttsConfig(env: NodeJS.ProcessEnv): TtsConfig {
  const setting = (name: string, fallback: number, max: number) => {
    const raw = env[name];
    const value = raw === undefined || raw === "" ? fallback : Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > max) {
      throw new Error(`${name} harus angka antara 0 dan ${max}, sekarang "${raw}"`);
    }
    return value;
  };
  const provider = env.TTS_PROVIDER || "browser";
  if (provider === "edge") {
    return {
      provider,
      voice: env.EDGE_VOICE || "id-ID-ArdiNeural",
      rate: env.EDGE_RATE || "+5%",
      pitch: env.EDGE_PITCH || "+0Hz",
    };
  }
  if (provider === "azure") {
    if (env.AZURE_SPEECH_KEY) {
      return {
        provider,
        key: env.AZURE_SPEECH_KEY,
        region: env.AZURE_SPEECH_REGION || "southeastasia",
        voice: env.AZURE_VOICE || "id-ID-ArdiNeural",
      };
    }
    console.warn("[config] TTS_PROVIDER=azure tapi AZURE_SPEECH_KEY kosong, pakai suara browser.");
  } else if (provider === "elevenlabs") {
    if (env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID) {
      return {
        provider,
        key: env.ELEVENLABS_API_KEY,
        voiceId: env.ELEVENLABS_VOICE_ID,
        model: env.ELEVENLABS_MODEL || "eleven_v4_turbo",
        voiceSettings: {
          stability: setting("ELEVENLABS_STABILITY", 0.45, 1),
          similarity_boost: setting("ELEVENLABS_SIMILARITY", 0.75, 1),
          style: setting("ELEVENLABS_STYLE", 0, 1),
          speed: setting("ELEVENLABS_SPEED", 1, 2),
        },
      };
    }
    console.warn("[config] TTS_PROVIDER=elevenlabs butuh ELEVENLABS_API_KEY dan ELEVENLABS_VOICE_ID, pakai suara browser.");
  } else if (provider !== "browser") {
    console.warn(`[config] TTS_PROVIDER "${provider}" tidak dikenal, pakai suara browser.`);
  }
  return { provider: "browser" };
}
