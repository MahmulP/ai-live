import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "../src/shared/protocol";
import type { ReplyWriter } from "../src/server/brain";
import { DailyBudget } from "../src/server/budget";
import { Director } from "../src/server/director";
import type { Prompt } from "../src/server/events";
import type { Hub } from "../src/server/hub";
import { SpamFilter } from "../src/server/moderation";
import { EventQueue } from "../src/server/queue";

const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

function setup(budgetLimit: number, spentToday = 0, greetJoinsMs = 0) {
  const dir = mkdtempSync(path.join(tmpdir(), "director-"));
  const budget = new DailyBudget(budgetLimit, path.join(dir, "spend.json"));
  if (spentToday) budget.add(spentToday);
  const sent: ServerMessage[] = [];
  const hub = {
    clientCount: 1,
    broadcast: (msg: ServerMessage) => sent.push(msg),
    waitForPlayback: async () => {},
  } as unknown as Hub;
  const prompts: Prompt[] = [];
  const brain: ReplyWriter = {
    async *reply(prompt) {
      prompts.push(prompt);
      yield "Horas kawan!";
    },
  };
  const queue = new EventQueue();
  const director = new Director({
    queue,
    filter: new SpamFilter(),
    brain,
    tts: { mode: "browser", synthesize: async () => null },
    hub,
    tiktokUser: "ucok",
    replyGapMs: 0,
    idleTalkMs: 10,
    idleNeedsLive: true,
    greetJoinsMs,
    budget,
  });
  void director.run();
  cleanup.push(() => {
    director.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const spoken = () => sent.flatMap((m) => (m.type === "utterance" ? [m.text] : []));
  return { director, budget, queue, prompts, spoken };
}

describe("Director", () => {
  it("does not open a topic while TikTok is not live", async () => {
    const { director, prompts } = setup(0);
    await tick(400);
    expect(prompts).toEqual([]);

    director.setTikTokStatus("connected");
    await tick(400);
    expect(prompts[0]).toEqual({ kind: "idle" });
  });

  it("makes small talk only when someone is watching", async () => {
    const { director, prompts } = setup(0);
    director.setTikTokStatus("connected");
    director.setViewers(0);
    await tick(400);
    expect(prompts).toEqual([]);

    director.setViewers(3);
    await tick(400);
    expect(prompts[0]).toEqual({ kind: "idle" });
  });

  it("welcomes new viewers at most once per interval, and not twice for a rejoin", async () => {
    const { director, prompts } = setup(0, 0, 1500);
    const join = (userId: string) => director.ingest({ kind: "join", userId, nickname: userId, at: Date.now() });
    join("budi");
    join("sari");
    await tick(150);
    expect(prompts).toEqual([{ kind: "join", nicknames: ["sari", "budi"], others: 0 }]);

    join("budi"); // left and came back: ignored
    join("rizky"); // waits for the interval
    await tick(300);
    expect(prompts).toHaveLength(1);

    await tick(1400);
    expect(prompts[1]).toEqual({ kind: "join", nicknames: ["rizky"], others: 0 });
  });

  it("pauses only chat when the daily budget is used up, and says so once", async () => {
    const { director, prompts, spoken } = setup(1, 1.5);
    director.ingest({ kind: "chat", userId: "a", nickname: "budi", text: "halo Ucok", at: Date.now() });
    director.ingest({ kind: "gift", userId: "b", nickname: "sari", giftName: "Rose", count: 1, at: Date.now() });
    await tick(300);

    // The gift is still thanked (templates are free); the chat is not sent to the AI.
    expect(prompts).toEqual([{ kind: "gift", nickname: "sari", giftName: "Rose", count: 1 }]);
    expect(spoken().slice(0, 2)).toEqual(["Kawan-kawan, awak istirahat balas chat dulu ya.", "Tapi tetap di sini nemenin kelen!"]);

    director.ingest({ kind: "chat", userId: "c", nickname: "rizky", text: "Ucok masih di sana?", at: Date.now() });
    await tick(300);
    expect(prompts).toHaveLength(1);
    expect(spoken().filter((t) => t.includes("istirahat"))).toHaveLength(1);
  });
});
