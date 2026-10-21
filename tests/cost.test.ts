import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "../src/server/cost";

describe("estimateCostUsd", () => {
  it("prices input, cache and output separately", () => {
    // Opus 5.5: 1M fresh input $4 + 1M cache read $0.20 + 1M output $20.
    const cost = estimateCostUsd("claude-opus-5-5", {
      input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(24.2);
  });

  it("returns null for a model it has no price for", () => {
    expect(estimateCostUsd("claude-unknown", { input_tokens: 1, output_tokens: 1 })).toBeNull();
  });
});
