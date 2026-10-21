import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import type { ClientMessage, DebugEvent } from "../shared/protocol";
import { Brain, DemoBrain, HybridWriter, canTurnOffThinking } from "./brain";
import { DailyBudget } from "./budget";
import { loadConfig } from "./config";
import { estimateCostUsd } from "./cost";
import { Director } from "./director";
import type { LiveEvent } from "./events";
import { Hub } from "./hub";
import { SpamFilter } from "./moderation";
import { EventQueue } from "./queue";
import { createStaticHandler } from "./static";
import { TemplateWriter } from "./templates";
import { speakableName } from "./text";
import { connectTikTok } from "./tiktok";
import { createTts, withAudioCache } from "./tts";

const DEV_PAGE_URL = "http://localhost:5173";

const cfg = loadConfig();
const persona = readFileSync(cfg.personaFile, "utf8").replaceAll("{{AI_NAME}}", cfg.aiName);
const tts = withAudioCache(createTts(cfg.tts));
const budget = new DailyBudget(cfg.maxDailyUsd, "logs/spend.json");

const server = createServer(createStaticHandler(cfg.production ? path.resolve("dist/web") : null, DEV_PAGE_URL));
const hub = new Hub(server);
const director = new Director({
  queue: new EventQueue(),
  filter: new SpamFilter({ perUserCooldownMs: cfg.userCooldownMs, bannedWords: cfg.bannedWords }),
  // Only chat reaches the AI; gifts, follows, joins and small talk come from templates.
  brain: new HybridWriter(
    cfg.demo
      ? new DemoBrain()
      : new Brain({
          model: cfg.model,
          effort: cfg.effort,
          thinking: cfg.thinking,
          persona,
          aiName: cfg.aiName,
          memoryLines: 16,
          budget,
        }),
    new TemplateWriter(cfg.aiName),
  ),
  tts,
  hub,
  tiktokUser: cfg.tiktokUsername,
  replyGapMs: cfg.replyGapMs,
  idleTalkMs: cfg.idleTalkMs,
  // Small talk is free (templates), but talking to an empty room is pointless; demo mode skips the check for testing.
  idleNeedsLive: !cfg.demo,
  greetJoinsMs: cfg.greetJoinsMs,
  budget,
});

hub.broadcast({ type: "hello", aiName: cfg.aiName, ttsMode: tts.mode }, { sticky: true });
director.publishStats();

// The page's ?debug panel injects fake events, so everything works without being live.
hub.onMessage((msg: ClientMessage) => {
  if (msg.type !== "debug-event") return;
  const event = fromDebugEvent(msg.event);
  if (event) director.ingest(event);
});

const tiktok = cfg.tiktokUsername
  ? connectTikTok({
      username: cfg.tiktokUsername,
      signApiKey: cfg.tiktokSignApiKey,
      onEvent: (e) => director.ingest(e),
      onStatus: (s) => director.setTikTokStatus(s),
      onViewers: (n) => director.setViewers(n),
    })
  : null;

server.listen(cfg.port, cfg.host, () => {
  const page = cfg.production ? `http://localhost:${cfg.port}` : DEV_PAGE_URL;
  const thinkingOff = cfg.thinking === "off" && canTurnOffThinking(cfg.model);
  const brain = cfg.demo
    ? "mode demo (tanpa Claude)"
    : `model ${cfg.model} (effort ${cfg.effort}, thinking ${thinkingOff ? "mati" : "aktif"})`;
  console.info(`[server] ${cfg.aiName} siap: ${brain}, TTS ${cfg.tts.provider}.`);
  if (!cfg.demo && cfg.thinking === "off" && !thinkingOff) {
    console.warn(`[server] ${cfg.model} tidak bisa mematikan thinking; AI_THINKING=off hanya berlaku untuk Sonnet 5.5 dan Haiku 5.5.`);
  }
  if (!cfg.demo) {
    const limit = cfg.maxDailyUsd > 0 ? `batas $${cfg.maxDailyUsd}/hari` : "tanpa batas harian";
    console.info(`[server] Biaya Claude hari ini $${budget.spentTodayUsd.toFixed(3)}, ${limit}.`);
    if (cfg.maxDailyUsd > 0 && estimateCostUsd(cfg.model, { input_tokens: 0, output_tokens: 0 }) === null) {
      console.warn(`[server] Harga ${cfg.model} belum dikenal (src/server/cost.ts), jadi batas biaya harian tidak bisa dihitung.`);
    }
  }
  if (!cfg.demo && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("[server] ANTHROPIC_API_KEY belum diisi di .env. Isi dulu, atau set AI_MODE=demo untuk tes tanpa Claude.");
  }
  console.info(`[server] Avatar: ${page}   Panel tes: ${page}/?debug`);
  if (!tiktok) console.info("[server] TIKTOK_USERNAME kosong: hanya menerima chat dari panel tes.");
});

void director.run();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    director.stop();
    await tiktok?.stop().catch(() => {});
    hub.close();
    server.close();
    process.exit(0);
  });
}

function fromDebugEvent(e: DebugEvent): LiveEvent | null {
  if (!e || typeof e.nickname !== "string") return null;
  const nickname = speakableName(e.nickname);
  const base = { userId: `debug:${nickname}`, nickname, at: Date.now() };
  switch (e.kind) {
    case "chat":
      return typeof e.text === "string" ? { kind: "chat", ...base, text: e.text } : null;
    case "gift":
      return { kind: "gift", ...base, giftName: String(e.giftName || "Rose"), count: Math.max(1, Number(e.count) || 1) };
    case "follow":
      return { kind: "follow", ...base };
    case "join":
      return { kind: "join", ...base };
    default:
      return null;
  }
}
