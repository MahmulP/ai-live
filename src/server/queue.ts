import { isQuestion, type LiveEvent, type Prompt } from "./events";

/** Old chat is no longer worth answering; gifts deserve a thank-you for longer. */
const MAX_AGE_MS = { chat: 30_000, gift: 90_000, follow: 60_000, join: 20_000 } as const;
const MAX_NAMES_PER_GREETING = 3;

function priority(e: LiveEvent): number {
  switch (e.kind) {
    case "gift":
      return 3;
    case "chat":
      return isQuestion(e.text) ? 2 : 1;
    case "follow":
      return 0;
    case "join":
      return -1;
  }
}

/**
 * Holds events until the AI is free to speak. `next()` returns the most
 * important fresh event (gift > question > chat > follow > join, newest first
 * on ties) and folds waiting follows, or waiting joins, into a single greeting.
 */
export class EventQueue {
  private items: LiveEvent[] = [];

  constructor(private readonly maxSize = 50) {}

  get size(): number {
    return this.items.length;
  }

  push(event: LiveEvent): void {
    this.items.push(event);
    if (this.items.length > this.maxSize) {
      // Drop the least important, oldest event.
      let worst = 0;
      for (let i = 1; i < this.items.length; i++) {
        if (priority(this.items[i]!) < priority(this.items[worst]!)) worst = i;
      }
      this.items.splice(worst, 1);
    }
  }

  /** `greetJoins: false` leaves join events waiting (until they go stale) instead of greeting them now. */
  next(now = Date.now(), { greetJoins = true } = {}): Prompt | null {
    this.items = this.items.filter((e) => now - e.at <= MAX_AGE_MS[e.kind]);
    const candidates = greetJoins ? this.items : this.items.filter((e) => e.kind !== "join");
    if (candidates.length === 0) return null;

    let best = candidates[0]!;
    for (const e of candidates) {
      const diff = priority(e) - priority(best);
      if (diff > 0 || (diff === 0 && e.at >= best.at)) best = e;
    }

    if (best.kind === "follow" || best.kind === "join") {
      const kind = best.kind;
      const group = this.items.filter((e) => e.kind === kind);
      this.items = this.items.filter((e) => e.kind !== kind);
      // Newest names first: they are the ones still around to hear it.
      const names = [...new Set(group.map((e) => e.nickname).reverse())];
      return {
        kind,
        nicknames: names.slice(0, MAX_NAMES_PER_GREETING),
        others: Math.max(0, names.length - MAX_NAMES_PER_GREETING),
      };
    }

    this.items.splice(this.items.indexOf(best), 1);
    if (best.kind === "gift") {
      return { kind: "gift", nickname: best.nickname, giftName: best.giftName, count: best.count };
    }
    return { kind: "chat", nickname: best.nickname, text: best.text };
  }
}
