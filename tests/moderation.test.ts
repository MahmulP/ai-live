import { describe, expect, it } from "vitest";
import { SpamFilter } from "../src/server/moderation";

const reasonOf = (filter: SpamFilter, text: string, user = "u1", now = 0) => {
  const v = filter.check(user, text, now);
  return v.ok ? "ok" : v.reason;
};

describe("SpamFilter", () => {
  it("accepts normal chat", () => {
    expect(reasonOf(new SpamFilter(), "Halo kak, lagi bahas apa?")).toBe("ok");
  });

  it("blocks links, phone numbers and gambling spam", () => {
    const f = new SpamFilter();
    expect(reasonOf(f, "cek www.promo-murah.com", "a")).toBe("link");
    expect(reasonOf(f, "join wa.me/628123", "b")).toBe("link");
    expect(reasonOf(f, "wa 0812 3456 7890", "c")).toBe("phone");
    expect(reasonOf(f, "slot gacor hari ini", "d")).toBe("banned-word");
  });

  it("catches profanity hidden with leetspeak or stretched letters", () => {
    const f = new SpamFilter();
    expect(reasonOf(f, "dasar g0bl0k", "a")).toBe("banned-word");
    expect(reasonOf(f, "anjiiiing", "b")).toBe("banned-word");
  });

  it("does not block words that merely contain a short banned word", () => {
    const f = new SpamFilter();
    expect(reasonOf(f, "aku suka nasi tahu", "a")).toBe("ok");
    expect(reasonOf(f, "perekonomian lagi naik", "b")).toBe("ok");
  });

  it("blocks Medan and Batak swear words", () => {
    const f = new SpamFilter();
    expect(reasonOf(f, "ah pukimak lah kau", "a")).toBe("banned-word");
    expect(reasonOf(f, "kimak kali", "b")).toBe("banned-word");
    expect(f.safeName("bodat_medan")).toBe("kawan");
  });

  it("catches long profanity glued to another word", () => {
    expect(reasonOf(new SpamFilter(), "dasar kontolkuda")).toBe("banned-word");
  });

  it("replaces offensive nicknames with a neutral address", () => {
    const f = new SpamFilter();
    expect(f.safeName("kontolkuda")).toBe("kawan");
    expect(f.safeName("b4ngs4t99")).toBe("kawan");
    expect(f.safeName("Budi")).toBe("Budi");
  });

  it("skips emoji-only messages and overlong text", () => {
    const f = new SpamFilter({ maxLength: 20 });
    expect(reasonOf(f, "🔥🔥🔥", "a")).toBe("empty");
    expect(reasonOf(f, "ini komentar yang terlalu panjang sekali", "b")).toBe("too-long");
  });

  it("treats long copy-paste waves as spam but short repeats as skips", () => {
    const f = new SpamFilter();
    const wave = "Ayo follow akun kami sekarang juga";
    expect(reasonOf(f, wave, "a", 0)).toBe("ok");
    expect(reasonOf(f, wave, "b", 1000)).toBe("duplicate");
    expect(reasonOf(f, "halo kak", "c", 0)).toBe("ok");
    expect(reasonOf(f, "halo kak", "d", 1000)).toBe("repeat");
  });

  it("rate limits one viewer", () => {
    const f = new SpamFilter({ perUserCooldownMs: 10_000 });
    expect(reasonOf(f, "pertanyaan pertama", "a", 0)).toBe("ok");
    expect(reasonOf(f, "pertanyaan kedua", "a", 5_000)).toBe("cooldown");
    expect(reasonOf(f, "pertanyaan ketiga", "a", 11_000)).toBe("ok");
  });

  it("allows stretched words but blocks character floods", () => {
    const f = new SpamFilter();
    expect(reasonOf(f, "mantaaaaap kak", "a")).toBe("ok");
    expect(reasonOf(f, "aaaaaaaaaaaaaaa", "b")).toBe("flood");
  });

  it("counts only spam toward the on-screen counter", () => {
    const f = new SpamFilter();
    f.check("a", "www.judi.com", 0);
    f.check("b", "🔥", 0);
    f.check("c", "!!!!!!!!!!", 0);
    f.check("d", "halo zzzzzzzzzzzz", 0);
    expect(f.spamBlocked).toBe(2);
  });
});
