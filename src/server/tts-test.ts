import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadConfig } from "./config";
import { createTts } from "./tts";

// npm run tts -- "teks"  →  synthesizes with the TTS settings in .env, saves the MP3 and plays it.
const DEFAULT_TEXT = "Horas kawan! Aku Ucok. Senang kali bisa ngobrol sama kelen malam ini, ayo tulis komentar ya.";
const OUTPUT = "logs/tts-test.mp3";

const text = process.argv.slice(2).join(" ").trim() || DEFAULT_TEXT;
const cfg = loadConfig();
const tts = createTts(cfg.tts);

if (tts.mode === "browser") {
  console.error("TTS_PROVIDER masih browser. Isi TTS_PROVIDER=edge (gratis), elevenlabs, atau azure di .env dulu.");
  process.exit(1);
}

const started = Date.now();
const result = await tts.synthesize(text);
const elapsed = Date.now() - started;
mkdirSync("logs", { recursive: true });
writeFileSync(OUTPUT, result!.audio);
console.info(`[tts] ${cfg.tts.provider}: ${elapsed} ms untuk ${text.length} karakter. Tersimpan di ${OUTPUT}`);
// Some providers keep a socket open, so exit explicitly once the clip has played.
if (process.platform === "darwin") execFile("afplay", [OUTPUT], () => process.exit(0));
else process.exit(0);
