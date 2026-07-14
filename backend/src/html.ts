const namedEntities: Record<string, string> = {
  auml: "ä",
  amp: "&",
  apos: "'",
  aring: "å",
  euro: "€",
  gt: ">",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  ouml: "ö",
  quot: '"',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    }
    return namedEntities[code.toLowerCase()] ?? entity;
  });
}

export function htmlToText(html: string): string {
  const withLines = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(div|p|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*\/\s*td\s*>\s*<\s*td\b[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");

  return decodeEntities(withLines)
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/[ \t]+/g, " ")
        .replace(/\s*\|\s*/g, " | ")
        .replace(/(?:\s*\|\s*){2,}/g, " | ")
        .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

export function normalizeLunchHours(value: string | null): string | null {
  if (!value) return null;
  return value.trim().replace(/(?<=\d)\s*-\s*(?=\d)/g, "–");
}
