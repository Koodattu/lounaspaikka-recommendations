export const assessmentScoreLabels = [
  ["appeal", "Houkuttelevuus"],
  ["distinctiveness", "Omaleimaisuus"],
  ["variety", "Vaihtelu"],
  ["value", "Hinta–laatu"],
] as const;

export function formatScore(value: number): string {
  return value.toLocaleString("fi-FI", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });
}
