import type { Mood } from "../shared/protocol";

/** A TikTok event after normalization, before it reaches the queue. */
export type LiveEvent =
  | { kind: "chat"; userId: string; nickname: string; text: string; at: number }
  | { kind: "gift"; userId: string; nickname: string; giftName: string; count: number; at: number }
  | { kind: "follow"; userId: string; nickname: string; at: number }
  | { kind: "join"; userId: string; nickname: string; at: number };

/** What the AI is asked to talk about next. */
export type Prompt =
  | { kind: "chat"; nickname: string; text: string }
  | { kind: "gift"; nickname: string; giftName: string; count: number }
  | { kind: "follow"; nicknames: string[]; others: number }
  /** Viewers who just entered the room; `others` counts the names left out. */
  | { kind: "join"; nicknames: string[]; others: number }
  | { kind: "idle" };

/** Small line shown above the subtitle so viewers see what is being answered. */
export function captionFor(prompt: Prompt): string | null {
  switch (prompt.kind) {
    case "chat":
      return `@${prompt.nickname}: ${prompt.text}`;
    case "gift":
      return `@${prompt.nickname} kirim ${prompt.giftName}${prompt.count > 1 ? ` x${prompt.count}` : ""}`;
    case "follow":
      return `Follow baru: ${prompt.nicknames.join(", ")}`;
    case "join":
      return `Baru masuk: ${prompt.nicknames.join(", ")}${prompt.others ? ` +${prompt.others}` : ""}`;
    case "idle":
      return null;
  }
}

const QUESTION = /\?|\b(apa|apakah|siapa|kenapa|mengapa|gimana|bagaimana|kapan|dimana|di mana|berapa|bisa|boleh|kok|cemana|kek mana|macam mana)\b/i;

export function isQuestion(text: string): boolean {
  return QUESTION.test(text);
}

export function moodFor(prompt: Prompt): Mood {
  switch (prompt.kind) {
    case "gift":
      return "happy";
    case "follow":
    case "join":
      return "wave";
    case "chat":
      return isQuestion(prompt.text) ? "curious" : "neutral";
    case "idle":
      return "curious";
  }
}
