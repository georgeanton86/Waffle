export const SAMPLE_NAMES = [
  "Amina Rahman",
  "Chris Dalton",
  "Elena Vasquez",
  "Jordan Blake",
  "Priya Shah",
  "Mateo Cruz",
  "Noah Kim",
  "Harper Quinn",
  "Luis Ortega",
  "Samira Haddad",
  "Eden Brooks",
  "Riley Chen",
];

export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function cleanName(raw: string): string {
  let name = raw.trim().replace(/\s+/g, " ");
  name = name.replace(/^[-*•]\s+/, "");
  name = name.replace(/^\d+[\.\)\-:]\s+/, "");
  name = name.replace(/^["'`“”]+|["'`“”]+$/g, "").trim();
  return name;
}

export function parseNames(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const chunks = /[\r\n]/.test(trimmed) ? trimmed.split(/\r?\n/) : trimmed.split(/[,;|]+/);
  const names: string[] = [];
  for (const chunk of chunks) {
    const name = cleanName(chunk);
    if (name.length === 0 || name.length > 120) continue;
    names.push(name);
  }
  return names;
}
