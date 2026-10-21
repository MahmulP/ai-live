/**
 * Turns a TikTok nickname into something TTS can pronounce:
 * fancy Unicode letters become plain ones, emoji and symbols are dropped,
 * and digits stuck to the end of a word ("sari93") or long digit runs are removed,
 * so nobody gets greeted as "sari sembilan tiga".
 */
export function speakableName(nickname?: string, uniqueId?: string): string {
  const clean = (raw?: string) => {
    const base = (raw ?? "")
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N} ._-]/gu, "")
      .replace(/[._-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const withoutDigits = base
      .replace(/(?<=\p{L})\d+/gu, "")
      .replace(/\d{3,}/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return (withoutDigits || base).slice(0, 24).trim();
  };
  return clean(nickname) || clean(uniqueId) || "kak";
}

/** Strips what a TTS engine would read out literally: emoji, markdown, stray symbols. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\u{FE0F}\u{200D}]/gu, "")
    .replace(/[*_#`~|<>[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rough speaking time, used when no page reports that playback finished. */
export function estimateSpeechMs(chars: number): number {
  return 1500 + chars * 75;
}

const SENTENCE_END = /[.!?…]+["')\]]*\s+|\n+/g;
const MIN_SENTENCE_CHARS = 12;
/** A sentence this long is also cut at a comma, so the voice can start before the sentence ends. */
const LONG_SENTENCE_CHARS = 60;

/**
 * Collects streamed text deltas and emits complete sentences, so TTS can start
 * on the first sentence while the model is still writing the rest.
 * Fragments shorter than MIN_SENTENCE_CHARS are merged into the next sentence;
 * long sentences are split at a comma.
 */
export class SentenceSplitter {
  private buffer = "";

  push(delta: string): string[] {
    this.buffer += delta;
    return this.drain(false);
  }

  flush(): string[] {
    return this.drain(true);
  }

  private drain(final: boolean): string[] {
    const out: string[] = [];
    let consumed = 0;
    for (const match of this.buffer.matchAll(SENTENCE_END)) {
      const end = match.index + match[0].length;
      const sentence = this.buffer.slice(consumed, end).trim();
      if (sentence.length >= MIN_SENTENCE_CHARS) {
        out.push(sentence);
        consumed = end;
      }
    }
    this.buffer = this.buffer.slice(consumed);
    if (!final && this.buffer.length >= LONG_SENTENCE_CHARS) {
      // The last comma with enough text on both sides, so no tiny tail like "ya." is spoken on its own.
      let comma = -1;
      for (let i = this.buffer.indexOf(", "); i !== -1; i = this.buffer.indexOf(", ", i + 1)) {
        if (i >= MIN_SENTENCE_CHARS && this.buffer.length - i - 2 >= MIN_SENTENCE_CHARS) comma = i;
      }
      if (comma !== -1) {
        out.push(this.buffer.slice(0, comma + 1).trim());
        this.buffer = this.buffer.slice(comma + 2);
      }
    }
    if (final) {
      const rest = this.buffer.trim();
      if (rest) out.push(rest);
      this.buffer = "";
    }
    return out;
  }
}
