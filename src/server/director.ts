import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { TikTokStatus } from "../shared/protocol";
import { FixedReply, type ReplyWriter } from "./brain";
import type { DailyBudget } from "./budget";
import { captionFor, moodFor, type LiveEvent, type Prompt } from "./events";
import type { Hub } from "./hub";
import type { SpamFilter } from "./moderation";
import type { EventQueue } from "./queue";
import { estimateSpeechMs } from "./text";
import type { SpeechAudio, Tts } from "./tts";

type DirectorDeps = {
  queue: EventQueue;
  filter: SpamFilter;
  brain: ReplyWriter;
  tts: Tts;
  hub: Hub;
  tiktokUser: string | null;
  /** Pause after each reply so the stream doesn't sound like a machine gun. */
  replyGapMs: number;
  /** Start a topic after this much silence. 0 disables. */
  idleTalkMs: number;
  /** Only make small talk while the TikTok room is live and someone is watching. */
  idleNeedsLive: boolean;
  /** At most one "welcome" for new viewers per this many ms. 0 disables greetings. */
  greetJoinsMs: number;
  budget: DailyBudget;
};

const BUDGET_PAUSE = new FixedReply([
  "Kawan-kawan, awak istirahat balas chat dulu ya.",
  "Tapi tetap di sini nemenin kelen!",
]);

const ERROR_COOLDOWN_MS = 5_000;
/** Someone who leaves and comes back within this window isn't welcomed twice. */
const REGREET_AFTER_MS = 10 * 60_000;
const MAX_PLAYBACK_WAIT_MS = 60_000;

/**
 * Runs the show: filters incoming events, picks what to answer next,
 * streams the reply through TTS to the avatar pages, and waits for playback
 * to finish before taking the next event.
 */
export class Director {
  private tiktok: TikTokStatus = "off";
  private lastActivity = Date.now();
  private pausedForBudget = false;
  private running = true;
  private viewers: number | null = null;
  private lastJoinGreeting = -Infinity;
  private readonly greeted = new Map<string, number>();

  constructor(private readonly d: DirectorDeps) {}

  ingest(event: LiveEvent): void {
    if (event.kind === "join") {
      this.ingestJoin(event);
      return;
    }
    this.lastActivity = Date.now();
    const shownName = event.nickname;
    event = { ...event, nickname: this.d.filter.safeName(event.nickname) };
    if (event.kind === "chat") {
      const verdict = this.d.filter.check(event.userId, event.text);
      this.d.hub.broadcast({
        type: "chat-log",
        nickname: shownName,
        text: event.text,
        status: verdict.ok ? "ok" : verdict.reason,
      });
      if (!verdict.ok) {
        this.publishStats();
        return;
      }
      event = { ...event, text: verdict.text };
    }
    this.d.queue.push(event);
    this.publishStats();
  }

  setTikTokStatus(status: TikTokStatus): void {
    this.tiktok = status;
    if (status !== "connected") this.viewers = null;
    this.publishStats();
  }

  setViewers(count: number): void {
    if (count === this.viewers) return;
    this.viewers = count;
    this.publishStats();
  }

  private ingestJoin(event: Extract<LiveEvent, { kind: "join" }>) {
    if (this.d.greetJoinsMs <= 0) return;
    const now = Date.now();
    const last = this.greeted.get(event.userId);
    if (last !== undefined && now - last < REGREET_AFTER_MS) return;
    this.greeted.set(event.userId, now);
    if (this.greeted.size > 5000) {
      for (const [id, at] of this.greeted) if (now - at > REGREET_AFTER_MS) this.greeted.delete(id);
    }
    // Joins don't count as conversation, so they don't hold off small talk.
    this.d.queue.push({ ...event, nickname: this.d.filter.safeName(event.nickname) });
    this.publishStats();
  }

  publishStats(): void {
    this.d.hub.broadcast(
      {
        type: "stats",
        spamBlocked: this.d.filter.spamBlocked,
        queued: this.d.queue.size,
        tiktok: this.tiktok,
        tiktokUser: this.d.tiktokUser,
        viewers: this.viewers,
        spentTodayUsd: this.d.budget.spentTodayUsd,
        dailyLimitUsd: this.d.budget.limitUsd,
      },
      { sticky: true },
    );
  }

  /** Ends the loop after the current step. */
  stop(): void {
    this.running = false;
  }

  async run(): Promise<void> {
    while (this.running) {
      const chatPaused = await this.checkBudget();
      const greetJoins = this.d.greetJoinsMs > 0 && Date.now() - this.lastJoinGreeting >= this.d.greetJoinsMs;
      const prompt = this.d.queue.next(Date.now(), { greetJoins }) ?? this.idlePrompt();
      if (!prompt) {
        await sleep(300);
        continue;
      }
      // Only chat costs money; thank-yous, greetings and small talk keep going.
      if (prompt.kind === "chat" && chatPaused) continue;
      if (prompt.kind === "join") this.lastJoinGreeting = Date.now();
      this.publishStats();
      const ok = await this.speak(prompt);
      this.lastActivity = Date.now();
      await sleep(ok ? this.d.replyGapMs : ERROR_COOLDOWN_MS);
    }
  }

  /**
   * Once today's spend reaches the limit, chat stops being answered until the
   * next day (announced once). Returns true while chat is paused.
   */
  private async checkBudget(): Promise<boolean> {
    const { budget } = this.d;
    if (!budget.exhausted) {
      if (this.pausedForBudget) console.info("[budget] hari baru, chat dijawab lagi.");
      this.pausedForBudget = false;
      return false;
    }
    if (!this.pausedForBudget) {
      this.pausedForBudget = true;
      console.warn(
        `[budget] biaya hari ini $${budget.spentTodayUsd.toFixed(2)} sudah mencapai batas $${budget.limitUsd} (MAX_DAILY_USD). ` +
          "Chat tidak dijawab sampai besok; gift, sapaan, dan basa-basi tetap jalan.",
      );
      await this.speak({ kind: "idle" }, BUDGET_PAUSE);
    }
    return true;
  }

  private idlePrompt(): Prompt | null {
    // Only fill silence when someone is actually watching the avatar page.
    if (this.d.idleTalkMs <= 0 || this.d.hub.clientCount === 0) return null;
    // Live, and someone watching. An unknown count (no report yet) doesn't block it.
    if (this.d.idleNeedsLive && (this.tiktok !== "connected" || this.viewers === 0)) return null;
    return Date.now() - this.lastActivity >= this.d.idleTalkMs ? { kind: "idle" } : null;
  }

  private async speak(prompt: Prompt, writer: ReplyWriter = this.d.brain): Promise<boolean> {
    const { tts, hub } = this.d;
    const replyId = randomUUID().slice(0, 8);
    const started = Date.now();
    const caption = captionFor(prompt);
    console.info(`[reply ${replyId}] ${caption ?? "(obrolan pembuka)"}`);
    hub.broadcast({ type: "reply-start", replyId, caption, mood: moodFor(prompt) });

    // TTS for each sentence starts as soon as the sentence exists;
    // `delivery` keeps the sentences reaching the page in order.
    let delivery = Promise.resolve();
    let previousSentence: string | undefined;
    let index = 0;
    let spokenChars = 0;
    let ok = true;

    try {
      for await (const sentence of writer.reply(prompt)) {
        const i = index++;
        spokenChars += sentence.length;
        console.info(`[reply ${replyId}] +${Date.now() - started}ms teks: ${sentence}`);
        const audio = tts.synthesize(sentence, previousSentence).catch((err: Error): SpeechAudio | null => {
          console.error(`[tts] ${err.message}`);
          return null;
        });
        previousSentence = sentence;
        delivery = delivery.then(async () => {
          const a = await audio;
          if (i === 0) console.info(`[reply ${replyId}] +${Date.now() - started}ms suara pertama siap`);
          hub.broadcast({
            type: "utterance",
            replyId,
            index: i,
            text: sentence,
            ...(a ? { audio: a.audio.toString("base64"), mime: a.mime } : {}),
          });
        });
      }
    } catch (err) {
      ok = false;
      logClaudeError(err);
    }

    await delivery;
    hub.broadcast({ type: "reply-end", replyId });
    this.publishStats();
    if (index > 0) {
      const timeout = Math.min(MAX_PLAYBACK_WAIT_MS, estimateSpeechMs(spokenChars) * 1.5);
      await hub.waitForPlayback(replyId, timeout);
    }
    return ok;
  }
}

function logClaudeError(err: unknown) {
  if (err instanceof Anthropic.AuthenticationError) {
    console.error("[claude] API key tidak valid atau belum diisi (ANTHROPIC_API_KEY di .env).");
  } else if (err instanceof Anthropic.RateLimitError) {
    console.error("[claude] kena rate limit, jeda sebentar.");
  } else if (err instanceof Anthropic.APIError) {
    console.error(`[claude] API error ${err.status}: ${err.message}`);
  } else {
    console.error("[claude]", err instanceof Error ? err.message : err);
  }
}
