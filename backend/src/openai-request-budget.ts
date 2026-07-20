export class OpenAiRequestBudgetExceededError extends Error {
  constructor(readonly limit: number) {
    super(`OpenAI request budget of ${limit} has been exhausted`);
    this.name = "OpenAiRequestBudgetExceededError";
  }
}

export class OpenAiRequestBudget {
  private requestCount = 0;

  constructor(readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new Error("OpenAI request budget must be a non-negative integer");
    }
  }

  consume(): void {
    if (this.requestCount >= this.limit) {
      throw new OpenAiRequestBudgetExceededError(this.limit);
    }
    this.requestCount += 1;
  }

  get remaining(): number {
    return this.limit - this.requestCount;
  }

  get used(): number {
    return this.requestCount;
  }
}

export function parseOpenAiRequestBudget(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}
