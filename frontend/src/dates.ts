const isoPattern = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string | null): value is string {
  if (!value || !isoPattern.test(value)) return false;
  const parsed = new Date(`${value}T09:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function todayInHelsinki(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Helsinki",
    year: "numeric",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T09:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function startOfWeek(value: string): string {
  const date = new Date(`${value}T09:00:00.000Z`);
  const weekday = date.getUTCDay();
  return addDays(value, -(weekday === 0 ? 6 : weekday - 1));
}

export function formatLongDate(value: string): string {
  const formatted = new Intl.DateTimeFormat("fi-FI", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Helsinki",
    weekday: "long",
  }).format(new Date(`${value}T09:00:00.000Z`));
  return formatted.charAt(0).toLocaleUpperCase("fi-FI") + formatted.slice(1);
}

export function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("fi-FI", {
    day: "numeric",
    month: "numeric",
    timeZone: "Europe/Helsinki",
  }).format(new Date(`${value}T09:00:00.000Z`));
}

export function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat("fi-FI", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "numeric",
    timeZone: "Europe/Helsinki",
  }).format(new Date(value));
}
