import { describe, expect, it, vi } from "vitest";
import { HybridWriter, type ReplyWriter } from "../src/server/brain";
import type { Prompt } from "../src/server/events";
import { TemplateWriter, listNames } from "../src/server/templates";
import { withAudioCache, type Tts } from "../src/server/tts";

describe("TemplateWriter", () => {
  const t = new TemplateWriter("Ucok");

  it("thanks every gift by name and gift, with the count for streaks", () => {
    for (let i = 0; i < 50; i++) {
      const line = t.line({ kind: "gift", nickname: "Sari", giftName: "Rose", count: 5 });
      expect(line).toContain("Sari");
      expect(line).toContain("5 Rose");
    }
  });

  it("uses the extra-excited lines for 10 or more", () => {
    const line = new TemplateWriter("Ucok", () => 0).line({ kind: "gift", nickname: "Sari", giftName: "Rose", count: 10 });
    expect(line).toMatch(/^Bah! 10 Rose dari Sari/);
  });

  it('says "kelen" to a group and "kau" to one person', () => {
    const pickFirstJoinWithKau = () => new TemplateWriter("Ucok", () => 0.4);
    const one = pickFirstJoinWithKau().line({ kind: "join", nicknames: ["Budi"], others: 0 });
    const many = pickFirstJoinWithKau().line({ kind: "join", nicknames: ["Budi", "Sari"], others: 0 });
    expect(one).toBe("Halo Budi! Pas kali kau datang, tulis komentar ya.");
    expect(many).toBe("Halo Budi dan Sari! Pas kali kelen datang, tulis komentar ya.");
  });

  it("never repeats small talk back to back", () => {
    let previous = "";
    for (let i = 0; i < 200; i++) {
      const line = t.line({ kind: "idle" });
      expect(line).not.toBe(previous);
      previous = line;
    }
  });

  it("leaves chat to the AI", () => {
    expect(() => t.line({ kind: "chat", nickname: "a", text: "halo" })).toThrow();
  });
});

describe("listNames", () => {
  it("joins names the way people say them", () => {
    expect(listNames(["Budi"])).toBe("Budi");
    expect(listNames(["Budi", "Sari"])).toBe("Budi dan Sari");
    expect(listNames(["Budi", "Sari", "Rizky"])).toBe("Budi, Sari, dan Rizky");
    expect(listNames(["Budi", "Sari"], 4)).toBe("Budi, Sari, dan kawan-kawan lainnya");
  });
});

describe("HybridWriter", () => {
  it("sends only chat to the AI and tells it what the templates said", async () => {
    const asked: Prompt[] = [];
    const remember = vi.fn();
    const ai: ReplyWriter & { remember: typeof remember } = {
      async *reply(p) {
        asked.push(p);
        yield "jawaban AI";
      },
      remember,
    };
    const writer = new HybridWriter(ai, new TemplateWriter("Ucok"));
    const collect = async (p: Prompt) => {
      const out: string[] = [];
      for await (const s of writer.reply(p)) out.push(s);
      return out;
    };

    expect(await collect({ kind: "chat", nickname: "a", text: "halo" })).toEqual(["jawaban AI"]);
    const thanks = await collect({ kind: "gift", nickname: "Sari", giftName: "Rose", count: 1 });
    expect(asked).toHaveLength(1);
    expect(remember).toHaveBeenCalledWith({ kind: "gift", nickname: "Sari", giftName: "Rose", count: 1 }, thanks[0]);
  });
});

describe("withAudioCache", () => {
  it("synthesizes a repeated line once, but retries after a failure", async () => {
    let calls = 0;
    let fail = true;
    const inner: Tts = {
      mode: "audio",
      synthesize: async () => {
        calls++;
        if (fail) throw new Error("429");
        return { audio: Buffer.from("x"), mime: "audio/mpeg" };
      },
    };
    const tts = withAudioCache(inner);
    await expect(tts.synthesize("Horas!")).rejects.toThrow();
    fail = false;
    await tts.synthesize("Horas!");
    await tts.synthesize("Horas!");
    expect(calls).toBe(2);
  });
});
