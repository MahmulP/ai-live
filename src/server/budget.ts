import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Claude spend for the current local calendar day, saved to disk so a restart
 * doesn't reset it. A limit of 0 means no limit.
 */
export class DailyBudget {
  private day = "";
  private spent = 0;

  constructor(
    readonly limitUsd: number,
    private readonly file: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.load();
  }

  get spentTodayUsd(): number {
    this.rollOver();
    return this.spent;
  }

  get exhausted(): boolean {
    return this.limitUsd > 0 && this.spentTodayUsd >= this.limitUsd;
  }

  add(usd: number): void {
    this.rollOver();
    this.spent += usd;
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ day: this.day, usd: this.spent }));
  }

  private rollOver() {
    const today = localDay(this.now());
    if (today !== this.day) {
      this.day = today;
      this.spent = 0;
    }
  }

  private load() {
    this.rollOver();
    try {
      const saved = JSON.parse(readFileSync(this.file, "utf8")) as { day?: string; usd?: number };
      if (saved.day === this.day && typeof saved.usd === "number") this.spent = saved.usd;
    } catch {
      // No file yet (first run) or unreadable: start the day at zero.
    }
  }
}

function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
