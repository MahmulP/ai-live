import type { ReplyWriter } from "./brain";
import type { Prompt } from "./events";

/**
 * Fixed lines for everything except chat: thanking gifts and follows, welcoming
 * viewers, and small talk when chat is quiet. They cost nothing, need no
 * network call, and play instantly.
 *
 * Placeholders: {name} {names} {gift} {ai}, and {kau} which becomes "kelen"
 * when more than one person is addressed. No time-of-day words: the live runs 24 hours.
 */
const GIFT = [
  "Mauliate godang {name}, {gift}-nya mantap kali!",
  "Wah, makasih {name} udah kirim {gift}, senang kali awak!",
  "{name}, terima kasih banyak untuk {gift}-nya, baik kali kau!",
  "Horas {name}! Makasih {gift}-nya, bikin semangat awak naik.",
  "Makasih kali {name} untuk {gift}-nya, kau memang kawan terbaik.",
  "Terima kasih {name}, {gift} dari kau awak simpan baik-baik ya.",
];

/** For 10 or more of a gift. */
const BIG_GIFT = [
  "Bah! {gift} dari {name}, banyak kali! Mauliate godang ya!",
  "Waduh {name}, {gift}! Awak sampai terharu, makasih banyak kawan!",
  "{name} luar biasa kali, {gift}! Mauliate godang, semoga rezeki kau lancar terus.",
];

const FOLLOW = [
  "Horas {names}, mauliate udah follow ya!",
  "Asik, {names} udah follow. Senang kali awak!",
  "Terima kasih follow-nya {names}, jangan lupa sering-sering mampir.",
  "Makasih {names} udah follow, sekarang {kau} keluarga {ai} juga!",
];

const JOIN = [
  "Horas {names}, selamat datang!",
  "Eh, ada {names} masuk. Sini, sini, duduk dulu kita.",
  "Halo {names}! Pas kali {kau} datang, tulis komentar ya.",
  "Selamat datang {names}, jangan malu-malu, ayo ngobrol.",
  "Horas {names}, apa kabar? Sini cerita sama {ai}.",
  "Wah, {names} datang. Ayo kawan, ramaikan komentarnya!",
];

const IDLE = [
  "Ayo kawan, tanya apa aja sama awak, pasti awak jawab.",
  "Kelen nonton dari kota mana? Tulis di komentar ya.",
  "Kalau ke Medan, kelen paling mau makan apa?",
  "Sepi juga ya, ayo ramaikan kolom komentar.",
  "Awak penasaran, kelen lagi sibuk apa sekarang?",
  "Jangan lupa follow ya kawan, biar kita sering ketemu.",
  "Ada yang mau cerita? Awak siap dengar.",
  "Tim kopi atau tim teh? Tulis jawabannya di komentar.",
  "Lagu Batak kesukaan kelen apa? Kasih tahu awak dong.",
  "Kalau bisa jalan-jalan ke mana aja, kelen mau pigi ke mana?",
  "Siapa yang pernah ke Danau Toba? Cerita sikit lah.",
  "Awak di sini terus nemenin kelen, jadi jangan sungkan komentar ya.",
  "Kelen lebih suka durian atau mangga? Awak sih dua-duanya.",
  "Bah, hening kali. Siapa yang mau mulai ngobrol?",
  "Ada yang lagi kerja sambil nonton? Semangat ya kawan!",
  "Menurut kelen, makanan paling enak sedunia apa?",
  "Kalau kelen punya satu permintaan, mau minta apa?",
  "Siapa di sini yang paling jago masak? Ngaku lah.",
  "Ayo kawan, kasih awak satu pertanyaan yang susah.",
  "Kelen hobinya apa? Siapa tahu kita sama.",
];

/** Avoids repeating any of the last few lines of a pool. */
class Picker {
  private readonly recent = new Map<readonly string[], number[]>();

  constructor(private readonly random: () => number = Math.random) {}

  pick(pool: readonly string[]): string {
    const recent = this.recent.get(pool) ?? [];
    const memory = Math.min(recent.length, Math.floor(pool.length / 2));
    const blocked = new Set(recent.slice(-memory));
    const choices = pool.map((_, i) => i).filter((i) => !blocked.has(i));
    const index = choices[Math.floor(this.random() * choices.length)]!;
    this.recent.set(pool, [...recent, index].slice(-pool.length));
    return pool[index]!;
  }
}

/** "Budi", "Budi dan Sari", "Budi, Sari, dan Rizky", "Budi, Sari, dan kawan-kawan lainnya". */
export function listNames(names: string[], others = 0): string {
  const all = others > 0 ? [...names, "kawan-kawan lainnya"] : names;
  if (all.length <= 1) return all[0] ?? "kawan";
  if (all.length === 2) return `${all[0]} dan ${all[1]}`;
  return `${all.slice(0, -1).join(", ")}, dan ${all[all.length - 1]}`;
}

export class TemplateWriter implements ReplyWriter {
  private readonly picker: Picker;

  constructor(
    private readonly aiName: string,
    random?: () => number,
  ) {
    this.picker = new Picker(random);
  }

  async *reply(prompt: Prompt): AsyncGenerator<string> {
    yield this.line(prompt);
  }

  line(prompt: Prompt): string {
    switch (prompt.kind) {
      case "gift": {
        const gift = prompt.count > 1 ? `${prompt.count} ${prompt.giftName}` : prompt.giftName;
        const pool = prompt.count >= 10 ? BIG_GIFT : GIFT;
        return this.fill(this.picker.pick(pool), { name: prompt.nickname, gift, plural: false });
      }
      case "follow":
      case "join": {
        const people = prompt.nicknames.length + prompt.others;
        const pool = prompt.kind === "follow" ? FOLLOW : JOIN;
        return this.fill(this.picker.pick(pool), {
          names: listNames(prompt.nicknames, prompt.others),
          plural: people > 1,
        });
      }
      case "idle":
        return this.fill(this.picker.pick(IDLE), { plural: true });
      case "chat":
        throw new Error("Chat dijawab oleh AI, bukan template.");
    }
  }

  private fill(template: string, v: { name?: string; names?: string; gift?: string; plural: boolean }): string {
    const text = template
      .replaceAll("{name}", v.name ?? "kawan")
      .replaceAll("{names}", v.names ?? "kawan")
      .replaceAll("{gift}", v.gift ?? "gift")
      .replaceAll("{ai}", this.aiName)
      .replaceAll("{kau}", v.plural ? "kelen" : "kau");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
}
