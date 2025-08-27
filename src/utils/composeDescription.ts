// src/utils/composeDescription.ts
export function composeDescription(base: string, beatsActive?: boolean, beats?: string[]) {
  const cleanBase = (base || '').trim();
  if (!beatsActive || !beats?.length) return cleanBase;
  const list = beats.map(s => (s || '').trim()).filter(Boolean);
  if (!list.length) return cleanBase;
  const bullets = list.map(s => `- ${s}`).join('\n');
  return `[USER BRIEF]\n${cleanBase}\n\n[BEATS]\n${bullets}`;
}
