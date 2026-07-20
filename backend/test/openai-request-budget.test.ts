import { describe, expect, it } from "vitest";

import {
  OpenAiRequestBudget,
  OpenAiRequestBudgetExceededError,
  parseOpenAiRequestBudget,
} from "../src/openai-request-budget.js";

describe("OpenAI request budget", () => {
  it("allows exactly the configured number of requests", () => {
    const budget = new OpenAiRequestBudget(2);

    budget.consume();
    budget.consume();

    expect(budget.used).toBe(2);
    expect(budget.remaining).toBe(0);
    expect(() => budget.consume()).toThrow(OpenAiRequestBudgetExceededError);
    expect(budget.used).toBe(2);
  });

  it("parses non-negative environment limits and rejects invalid values", () => {
    expect(parseOpenAiRequestBudget("LIMIT", undefined, 10)).toBe(10);
    expect(parseOpenAiRequestBudget("LIMIT", "0", 10)).toBe(0);
    expect(parseOpenAiRequestBudget("LIMIT", "25", 10)).toBe(25);
    expect(() => parseOpenAiRequestBudget("LIMIT", "-1", 10)).toThrow(
      "non-negative integer",
    );
    expect(() => parseOpenAiRequestBudget("LIMIT", "1.5", 10)).toThrow(
      "non-negative integer",
    );
  });
});
