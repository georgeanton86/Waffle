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
  name = name.replace(/^\d+[.):-]\s+/, "");
  name = name.replace(/^["'`“”]+|["'`“”]+$/g, "").trim();
  return name;
}

export function readNamed(raw: string): { name: string; number?: number } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(?:#\s*)?(\d{1,6})(?:[.)\-:]|\s)\s*(.+)$/);
  if (match) {
    const number = Number(match[1]);
    const name = cleanName(match[2] ?? "");
    if (!name || name.length > 120) return null;
    if (!Number.isInteger(number) || number < 1) return { name };
    return { name, number };
  }
  const name = cleanName(trimmed);
  if (!name || name.length > 120) return null;
  return { name };
}

export function parseNamed(raw: string): { name: string; number?: number }[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const chunks = /[\r\n]/.test(trimmed) ? trimmed.split(/\r?\n/) : trimmed.split(/[,;|]+/);
  const items: { name: string; number?: number }[] = [];
  for (const chunk of chunks) {
    const item = readNamed(chunk);
    if (item) items.push(item);
  }
  return items;
}

export function parseNames(raw: string): string[] {
  return parseNamed(raw).map((item) => item.name);
}
