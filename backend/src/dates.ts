const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseIsoDate(value: string): Date | null {
  if (!isoDatePattern.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: string, amount: number): string {
  const date = parseIsoDate(value);
  if (!date) throw new Error("Invalid ISO date");
  date.setUTCDate(date.getUTCDate() + amount);
  return formatIsoDate(date);
}

export function isMonday(value: string): boolean {
  return parseIsoDate(value)?.getUTCDay() === 1;
}
