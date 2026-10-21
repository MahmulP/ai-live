/**
 * Rule-based chat filter that runs before anything reaches the AI.
 * "Spam" reasons (links, phone numbers, banned words, flooding, copy-paste)
 * count toward the on-screen SPAM BLOCK counter; "skip" reasons
 * (empty, too long, cooldown, short repeats) are dropped silently.
 */

export const SPAM_REASONS = ["link", "phone", "banned-word", "flood", "duplicate"] as const;
export const SKIP_REASONS = ["empty", "too-long", "cooldown", "repeat"] as const;
export type BlockReason = (typeof SPAM_REASONS)[number] | (typeof SKIP_REASONS)[number];

export type Verdict = { ok: true; text: string } | { ok: false; reason: BlockReason };

/** Profanity, slurs, and the gambling spam that floods Indonesian lives. Extend with EXTRA_BANNED_WORDS. */
export const DEFAULT_BANNED_WORDS = [
  "anjing", "bangsat", "bajingan", "brengsek", "kontol", "memek", "ngentot", "entot",
  "jancok", "jancuk", "asu", "babi", "goblok", "goblog", "tolol", "idiot", "kampret",
  "keparat", "tai", "taik", "pepek", "pantek", "puki", "lonte", "pelacur", "perek",
  "bencong", "jembut", "coli", "sange", "bokep", "porno",
  // Medan and Batak slang.
  "pukimak", "pukimai", "kimak", "cibai", "lancau", "bodat",
  "slot", "gacor", "togel", "maxwin", "judol", "scatter",
];

const LINK = /(https?:\/\/|www\.|wa\.me|t\.me|bit\.ly|\b[a-z0-9-]{2,}\.(com|net|org|id|co|xyz|me|io|ly|gg|link|site|shop|vip|top)\b)/i;
const LONG_DUPLICATE_CHARS = 15;
/** Banned words this long are also caught inside other words ("kontolkuda"); shorter ones only as whole words. */
const CHAT_SUBSTRING_CHARS = 6;
const NAME_SUBSTRING_CHARS = 5;
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

export type SpamFilterOptions = {
  perUserCooldownMs: number;
  duplicateWindowMs: number;
  maxLength: number;
  bannedWords: string[];
};

const DEFAULTS: SpamFilterOptions = {
  perUserCooldownMs: 15_000,
  duplicateWindowMs: 60_000,
  maxLength: 150,
  bannedWords: DEFAULT_BANNED_WORDS,
};

const collapseRepeats = (s: string) => s.replace(/(\p{L})\1+/gu, "$1");

export class SpamFilter {
  spamBlocked = 0;
  private readonly opts: SpamFilterOptions;
  private readonly banned: Set<string>;
  private readonly lastAcceptedByUser = new Map<string, number>();
  private readonly recentTexts = new Map<string, number>();

  constructor(opts: Partial<SpamFilterOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.banned = new Set(this.opts.bannedWords.map((w) => collapseRepeats(w.toLowerCase())));
  }

  check(userId: string, raw: string, now = Date.now()): Verdict {
    const verdict = this.evaluate(userId, raw, now);
    if (!verdict.ok && (SPAM_REASONS as readonly string[]).includes(verdict.reason)) this.spamBlocked++;
    return verdict;
  }

  private evaluate(userId: string, raw: string, now: number): Verdict {
    const text = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
    const fingerprint = text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

    if (fingerprint.length < 2) return { ok: false, reason: "empty" };
    if (text.length > this.opts.maxLength) return { ok: false, reason: "too-long" };
    if (LINK.test(text)) return { ok: false, reason: "link" };
    if (text.replace(/\D/g, "").length >= 8) return { ok: false, reason: "phone" };
    if (this.hasBannedWord(text, CHAT_SUBSTRING_CHARS)) return { ok: false, reason: "banned-word" };
    // "mantaaaap" is enthusiasm; ten of the same character in a row is flooding.
    if (/(.)\1{9,}/u.test(text)) return { ok: false, reason: "flood" };

    const seenAt = this.recentTexts.get(fingerprint);
    if (seenAt !== undefined && now - seenAt < this.opts.duplicateWindowMs) {
      // Many viewers typing "halo kak" is normal; a long copy-pasted line is a spam wave.
      return { ok: false, reason: fingerprint.length >= LONG_DUPLICATE_CHARS ? "duplicate" : "repeat" };
    }
    // Remember the text even if the user is on cooldown, so copy-paste floods are caught.
    this.recentTexts.set(fingerprint, now);

    const last = this.lastAcceptedByUser.get(userId);
    if (last !== undefined && now - last < this.opts.perUserCooldownMs) {
      return { ok: false, reason: "cooldown" };
    }

    this.lastAcceptedByUser.set(userId, now);
    this.prune(now);
    return { ok: true, text };
  }

  /** Nicknames are read aloud too; an offensive one is replaced with a neutral address. */
  safeName(nickname: string): string {
    return this.hasBannedWord(nickname, NAME_SUBSTRING_CHARS) ? "kawan" : nickname;
  }

  private hasBannedWord(text: string, minSubstringLength: number): boolean {
    const tokens = text
      .toLowerCase()
      .replace(/[0-9@$]/g, (c) => LEET[c] ?? c)
      .split(/[^\p{L}]+/u)
      .filter(Boolean)
      .map(collapseRepeats);
    return tokens.some(
      (token) =>
        this.banned.has(token) ||
        [...this.banned].some((word) => word.length >= minSubstringLength && token.includes(word)),
    );
  }

  private prune(now: number) {
    if (this.recentTexts.size > 5000) {
      for (const [key, at] of this.recentTexts) {
        if (now - at > this.opts.duplicateWindowMs) this.recentTexts.delete(key);
      }
    }
    if (this.lastAcceptedByUser.size > 5000) {
      for (const [key, at] of this.lastAcceptedByUser) {
        if (now - at > this.opts.perUserCooldownMs) this.lastAcceptedByUser.delete(key);
      }
    }
  }
}
