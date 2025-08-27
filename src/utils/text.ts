export const countWords = (s: string) => (s.trim().match(/\S+/g) ?? []).length;

export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));