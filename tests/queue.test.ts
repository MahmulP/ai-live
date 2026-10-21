import { describe, expect, it } from "vitest";
import type { LiveEvent } from "../src/server/events";
import { EventQueue } from "../src/server/queue";

const chat = (nickname: string, text: string, at = 0): LiveEvent => ({ kind: "chat", userId: nickname, nickname, text, at });

describe("EventQueue", () => {
  it("answers gifts before questions before plain chat", () => {
    const q = new EventQueue();
    q.push(chat("a", "halo semua", 0));
    q.push(chat("b", "kamu dari mana?", 0));
    q.push({ kind: "gift", userId: "c", nickname: "c", giftName: "Rose", count: 3, at: 0 });

    expect(q.next(1)).toMatchObject({ kind: "gift", nickname: "c" });
    expect(q.next(1)).toMatchObject({ kind: "chat", nickname: "b" });
    expect(q.next(1)).toMatchObject({ kind: "chat", nickname: "a" });
    expect(q.next(1)).toBeNull();
  });

  it("prefers the newest chat among equals", () => {
    const q = new EventQueue();
    q.push(chat("old", "halo", 0));
    q.push(chat("new", "halo juga", 500));
    expect(q.next(1000)).toMatchObject({ nickname: "new" });
  });

  it("drops chat that has gone stale", () => {
    const q = new EventQueue();
    q.push(chat("a", "masih ada orang?", 0));
    expect(q.next(31_000)).toBeNull();
    expect(q.size).toBe(0);
  });

  it("folds waiting follows into one greeting", () => {
    const q = new EventQueue();
    for (const name of ["a", "b", "a", "c"]) q.push({ kind: "follow", userId: name, nickname: name, at: 0 });
    expect(q.next(1)).toEqual({ kind: "follow", nicknames: ["c", "a", "b"], others: 0 });
    expect(q.size).toBe(0);
  });

  it("evicts the least important event when full", () => {
    const q = new EventQueue(2);
    q.push({ kind: "follow", userId: "f", nickname: "f", at: 0 });
    q.push(chat("a", "halo", 0));
    q.push(chat("b", "siapa kamu?", 0));
    expect(q.size).toBe(2);
    expect(q.next(1)).toMatchObject({ nickname: "b" });
    expect(q.next(1)).toMatchObject({ nickname: "a" });
  });

  it("greets the newest joiners and counts the rest", () => {
    const q = new EventQueue();
    for (const [i, name] of ["a", "b", "c", "d", "e"].entries()) {
      q.push({ kind: "join", userId: name, nickname: name, at: i });
    }
    expect(q.next(10)).toEqual({ kind: "join", nicknames: ["e", "d", "c"], others: 2 });
  });

  it("can hold joins back without dropping them", () => {
    const q = new EventQueue();
    q.push({ kind: "join", userId: "a", nickname: "a", at: 0 });
    expect(q.next(1, { greetJoins: false })).toBeNull();
    expect(q.next(2)).toMatchObject({ kind: "join", nicknames: ["a"] });
  });

  it("answers chat before greeting joiners", () => {
    const q = new EventQueue();
    q.push({ kind: "join", userId: "a", nickname: "a", at: 5 });
    q.push(chat("b", "halo", 0));
    expect(q.next(10)).toMatchObject({ kind: "chat" });
  });
});
