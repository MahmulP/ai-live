import { describe, expect, it } from "vitest";
import { SentenceSplitter, cleanForSpeech, speakableName } from "../src/server/text";

describe("SentenceSplitter", () => {
  it("emits sentences as soon as they are complete", () => {
    const s = new SentenceSplitter();
    expect(s.push("Halo Budi, apa kab")).toEqual([]);
    expect(s.push("ar hari ini? Aku baik")).toEqual(["Halo Budi, apa kabar hari ini?"]);
    expect(s.flush()).toEqual(["Aku baik"]);
  });

  it("merges very short fragments into the next sentence", () => {
    const s = new SentenceSplitter();
    expect(s.push("Wah! Pertanyaan yang bagus sekali. ")).toEqual(["Wah! Pertanyaan yang bagus sekali."]);
  });

  it("cuts a long sentence at a comma so speech can start early", () => {
    const s = new SentenceSplitter();
    expect(s.push("Gampang itu kawan, sarapan dulu biar perut kenyang, terus kasih hadiah ")).toEqual([
      "Gampang itu kawan, sarapan dulu biar perut kenyang,",
    ]);
    expect(s.push("kecil tiap kerjaan selesai. ")).toEqual(["terus kasih hadiah kecil tiap kerjaan selesai."]);
  });

  it("does not cut at a comma that only a short tail follows", () => {
    const s = new SentenceSplitter();
    expect(s.push("Besok awak belum pasti bisa live, tapi kau pantau terus akun ini, ")).toEqual([
      "Besok awak belum pasti bisa live,",
    ]);
    expect(s.push("ya.")).toEqual([]);
    expect(s.flush()).toEqual(["tapi kau pantau terus akun ini, ya."]);
  });

  it("does not split decimals", () => {
    const s = new SentenceSplitter();
    expect(s.push("Harganya 3.5 juta rupiah. ")).toEqual(["Harganya 3.5 juta rupiah."]);
  });
});

describe("cleanForSpeech", () => {
  it("removes emoji and markdown", () => {
    expect(cleanForSpeech("**Halo** kak 😄🔥 semangat ya!")).toBe("Halo kak semangat ya!");
  });
});

describe("speakableName", () => {
  it("turns fancy unicode and digits into a pronounceable name", () => {
    expect(speakableName("𝓑𝓾𝓭𝓲 ✨", "budi_8237462")).toBe("Budi");
    expect(speakableName("", "sari_8237462")).toBe("sari");
    expect(speakableName("andi10")).toBe("andi");
    expect(speakableName("Rizky 2")).toBe("Rizky 2");
  });

  it("falls back when nothing is pronounceable", () => {
    expect(speakableName("🔥🔥", "")).toBe("kak");
  });
});
