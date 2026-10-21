import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DailyBudget } from "../src/server/budget";

const dirs: string[] = [];
const tempFile = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "budget-"));
  dirs.push(dir);
  return path.join(dir, "spend.json");
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("DailyBudget", () => {
  it("stops once today's spend reaches the limit", () => {
    const b = new DailyBudget(1, tempFile());
    b.add(0.6);
    expect(b.exhausted).toBe(false);
    b.add(0.5);
    expect(b.exhausted).toBe(true);
  });

  it("never stops with a limit of 0", () => {
    const b = new DailyBudget(0, tempFile());
    b.add(1000);
    expect(b.exhausted).toBe(false);
  });

  it("keeps today's spend across a restart", () => {
    const file = tempFile();
    new DailyBudget(5, file).add(1.25);
    expect(new DailyBudget(5, file).spentTodayUsd).toBeCloseTo(1.25);
  });

  it("starts from zero on a new day", () => {
    const file = tempFile();
    let now = new Date(2026, 9, 21, 23, 59);
    const b = new DailyBudget(1, file, () => now);
    b.add(2);
    expect(b.exhausted).toBe(true);
    now = new Date(2026, 9, 22, 0, 1);
    expect(b.spentTodayUsd).toBe(0);
    expect(b.exhausted).toBe(false);
    // A restart the next day ignores yesterday's file too.
    expect(new DailyBudget(1, file, () => now).spentTodayUsd).toBe(0);
  });
});
