import Anthropic from "@anthropic-ai/sdk";
import type { DailyBudget } from "./budget";
import { estimateCostUsd } from "./cost";
import type { Prompt } from "./events";
import type { TemplateWriter } from "./templates";
import { SentenceSplitter, cleanForSpeech } from "./text";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type ThinkingMode = "on" | "off";

/** Models that accept server-side refusal fallbacks (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

/**
 * How each model turns thinking off. Sonnet 5.5 rejects "disabled" and uses
 * "between_tools"; both need effort high or below. Opus 5.5 can't turn it off.
 */
const THINKING_OFF: Record<string, Anthropic.Beta.BetaThinkingConfigParam> = {
  "claude-sonnet-5-5": { type: "between_tools" },
  "claude-haiku-5-5": { type: "disabled" },
};

export function canTurnOffThinking(model: string): boolean {
  return model in THINKING_OFF;
}

type BrainOptions = {
  model: string;
  effort: Effort;
  /** "off" only takes effect on models listed in THINKING_OFF. */
  thinking: ThinkingMode;
  persona: string;
  aiName: string;
  /** How many recent transcript lines to include as context. */
  memoryLines: number;
  budget: DailyBudget;
};

export interface ReplyWriter {
  /** Streams the reply sentence by sentence, already cleaned for TTS. */
  reply(prompt: Prompt): AsyncGenerator<string>;
}

type ChatPrompt = Extract<Prompt, { kind: "chat" }>;

/**
 * Answers chat with Claude. Gifts, follows, joins and small talk use templates
 * (see HybridWriter), so Claude is only paid for actual conversation.
 *
 * Every request is a single user turn: the persona sits in a cached system
 * prompt and the recent live transcript is embedded in the user message.
 * That keeps requests small and avoids replaying an ever-growing history.
 */
export class Brain implements ReplyWriter {
  private readonly client = new Anthropic();
  private transcript: string[] = [];

  constructor(private readonly opts: BrainOptions) {}

  async *reply(prompt: Prompt): AsyncGenerator<string> {
    if (prompt.kind !== "chat") throw new Error(`Brain hanya menjawab chat, bukan ${prompt.kind}`);
    const stream = this.client.beta.messages.stream({
      model: this.opts.model,
      max_tokens: 8000,
      system: [{ type: "text", text: this.opts.persona, cache_control: { type: "ephemeral" } }],
      output_config: { effort: this.opts.effort },
      ...(this.opts.thinking === "off" && THINKING_OFF[this.opts.model] ? { thinking: THINKING_OFF[this.opts.model] } : {}),
      messages: [{ role: "user", content: this.buildTurn(prompt) }],
      // On a safety decline the API retries on Anthropic's recommended fallback model.
      ...(FALLBACK_MODELS.has(this.opts.model)
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    });

    const splitter = new SentenceSplitter();
    const spoken: string[] = [];
    const emit = function* (sentences: string[]) {
      for (const raw of sentences) {
        const sentence = cleanForSpeech(raw);
        if (!sentence) continue;
        spoken.push(sentence);
        yield sentence;
      }
    };

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield* emit(splitter.push(event.delta.text));
      }
    }

    const message = await stream.finalMessage();
    this.logUsage(message.usage);
    if (message.stop_reason === "refusal") {
      // Whatever is still buffered is a partial answer; drop it.
      console.warn(`[claude] menolak menjawab (kategori: ${message.stop_details?.category ?? "-"})`);
    } else {
      yield* emit(splitter.flush());
    }
    this.remember(prompt, spoken.join(" "));
  }

  private logUsage(usage: Anthropic.Beta.BetaUsage) {
    const { budget } = this.opts;
    const cost = estimateCostUsd(this.opts.model, usage);
    if (cost !== null) budget.add(cost);
    const cached = usage.cache_read_input_tokens ?? 0;
    const written = usage.cache_creation_input_tokens ?? 0;
    const limit = budget.limitUsd > 0 ? ` dari batas $${budget.limitUsd}` : "";
    const price = cost === null ? "" : `, ~$${cost.toFixed(4)} (hari ini $${budget.spentTodayUsd.toFixed(3)}${limit})`;
    console.info(
      `[claude] token masuk ${usage.input_tokens + cached + written} (dari cache ${cached}, ditulis ke cache ${written}), ` +
        `keluar ${usage.output_tokens}${price}`,
    );
  }

  private buildTurn(prompt: ChatPrompt): string {
    const history = this.transcript.length
      ? `Obrolan terakhir di live (lama ke baru):\n${this.transcript.join("\n")}\n\n`
      : "";
    return history + taskFor(prompt);
  }

  /** Adds an exchange to the transcript Claude sees, including lines spoken from templates. */
  remember(prompt: Prompt, reply: string) {
    const line = transcriptLine(prompt);
    if (line) this.transcript.push(line);
    if (reply) this.transcript.push(`${this.opts.aiName}: ${reply}`);
    this.transcript = this.transcript.slice(-this.opts.memoryLines);
  }
}

/** Speaks fixed lines, e.g. the goodbye when the daily budget runs out. */
export class FixedReply implements ReplyWriter {
  constructor(private readonly lines: string[]) {}

  async *reply(): AsyncGenerator<string> {
    yield* this.lines;
  }
}

/**
 * Chat goes to the AI; everything else is spoken from templates for free.
 * Template lines are still added to the AI's transcript, so a viewer can answer
 * a small-talk question and the AI knows what was asked.
 */
export class HybridWriter implements ReplyWriter {
  constructor(
    private readonly chat: ReplyWriter & { remember?: (prompt: Prompt, reply: string) => void },
    private readonly templates: TemplateWriter,
  ) {}

  async *reply(prompt: Prompt): AsyncGenerator<string> {
    if (prompt.kind === "chat") {
      yield* this.chat.reply(prompt);
      return;
    }
    const line = this.templates.line(prompt);
    yield line;
    this.chat.remember?.(prompt, line);
  }
}

/** AI_MODE=demo: canned chat replies, for testing TTS, the avatar and OBS without calling Claude. */
export class DemoBrain implements ReplyWriter {
  private lastPick = -1;

  async *reply(prompt: Prompt): AsyncGenerator<string> {
    const n = prompt.kind === "chat" ? prompt.nickname : "kawan";
    const variants = [
      [`Halo ${n}, makasih udah mampir ya.`, "Awak masih mode demo, jadi belum bisa jawab betul-betul."],
      [`Wah, ${n} datang juga!`, "Sabar sikit ya, otak awak belum disambungkan."],
      [`Horas ${n}!`, "Ini masih latihan, nanti kalau udah nyambung baru kita cakap panjang."],
      [`Pertanyaan bagus itu, ${n}.`, "Tapi awak lagi mode demo, simpan dulu ya."],
      [`Bah, rajin kali ${n} komentar.`, "Nanti awak jawab kalau sudah siap."],
    ];
    // Never the same reply twice in a row, so testing doesn't sound like a broken record.
    let pick = Math.floor(Math.random() * variants.length);
    if (pick === this.lastPick) pick = (pick + 1) % variants.length;
    this.lastPick = pick;
    for (const line of variants[pick]!) {
      await new Promise((r) => setTimeout(r, 300));
      yield line;
    }
  }
}

const stripTags = (s: string) => s.replace(/[<>]/g, "");

function taskFor(prompt: ChatPrompt): string {
  return `Balas komentar ini:\n<komentar dari="${prompt.nickname}">${stripTags(prompt.text)}</komentar>`;
}

function transcriptLine(prompt: Prompt): string | null {
  switch (prompt.kind) {
    case "chat":
      return `${prompt.nickname}: ${stripTags(prompt.text)}`;
    case "gift":
      return `[gift] ${prompt.nickname} mengirim ${stripTags(prompt.giftName)}`;
    case "follow":
      return `[follow] ${prompt.nicknames.join(", ")}`;
    case "join":
      return `[masuk] ${prompt.nicknames.join(", ")}`;
    case "idle":
      return null;
  }
}
