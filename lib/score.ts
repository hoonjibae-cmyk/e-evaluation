export const SCALE_OPTIONS = [
  { label: "매우 만족", score: 100 },
  { label: "만족", score: 75 },
  { label: "보통", score: 50 },
  { label: "불만족", score: 25 },
  { label: "매우 불만족", score: 0 }
];

export function formatScore(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(2);
}

export function maskTeacherName(name: string, isMe: boolean) {
  return isMe ? `${name} 선생님` : "***선생님";
}

export function monthLabel(yearMonth?: string) {
  if (!yearMonth) return "";
  const [year, month] = yearMonth.split("-");
  return `${Number(month)}월`;
}
