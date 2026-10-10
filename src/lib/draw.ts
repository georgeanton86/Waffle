export const SPIN_MIN = 10;
export const SPIN_MAX = 90;
export const SPIN_STEP = 10;

export type DrawMode = "show" | "wheel" | "waffle";

export type ShowCue = {
  kind: "intro" | "spin" | "lock";
  name: string;
  place: number;
  wait: number;
};

export type WheelPlan = {
  slices: string[];
  winnerIndex: number;
};

export function clampMode(value: unknown): DrawMode {
  if (value === "wheel" || value === "waffle" || value === "show") return value;
  return "show";
}

export function placeLabel(index: number): string {
  const n = index + 1;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function formatResult(winners: string[], poolSize: number): string {
  const lines =
    winners.length === 1
      ? [`Winner — ${winners[0] ?? ""}`]
      : winners.map((name, index) => `${placeLabel(index)} — ${name}`);
  const noun = poolSize === 1 ? "name" : "names";
  return [...lines, "", `Drawn from ${poolSize} ${noun}.`].join("\n");
}

export function clampSpin(seconds: number): number {
  const snapped = Math.round((Number.isFinite(seconds) ? seconds : SPIN_MIN) / SPIN_STEP) * SPIN_STEP;
  return Math.min(SPIN_MAX, Math.max(SPIN_MIN, snapped || SPIN_MIN));
}

export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function randomInt(max: number): number {
  if (max <= 1) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(buf);
    value = buf[0] ?? 0;
  } while (value >= limit);
  return value % max;
}

export function pickWinners<T>(items: readonly T[], count: number): T[] {
  const pool = items.slice();
  const n = Math.min(Math.max(0, Math.floor(count)), pool.length);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const current = pool[i] as T;
    pool[i] = pool[j] as T;
    pool[j] = current;
  }
  return pool.slice(0, n);
}

function pace(budget: number): number[] {
  if (budget <= 80) return [Math.max(0, budget)];
  const hold = Math.min(budget, Math.min(980, Math.max(420, Math.round(budget * 0.16))));
  const spinning = budget - hold;
  const delays: number[] = [];
  let spent = 0;
  while (spent < spinning - 36) {
    const t = spinning === 0 ? 1 : spent / spinning;
    const gap = Math.round(34 + t ** 2.5 * 360);
    if (spent + gap >= spinning) break;
    delays.push(gap);
    spent += gap;
  }
  if (spinning - spent > 0) delays.push(spinning - spent);
  delays.push(hold);
  return delays;
}

function nextName(pool: readonly string[], banned: string, previous: string): string {
  if (pool.length === 0) return previous || banned;
  let name = pool[Math.floor(Math.random() * pool.length)] ?? banned;
  let guard = 0;
  while ((name === banned || name === previous) && pool.length > 1 && guard < 8) {
    name = pool[Math.floor(Math.random() * pool.length)] ?? name;
    guard += 1;
  }
  return name;
}

export function buildShow(pool: readonly string[], winners: readonly string[], seconds: number): ShowCue[] {
  const names = winners.filter((name) => name.length > 0);
  if (names.length === 0) return [];
  if (pool.length <= 1) {
    return names.map((name, place) => ({ kind: "lock", name, place, wait: 0 }));
  }

  const total = clampSpin(seconds) * 1000;
  const introBudget = Math.min(1500, Math.round(total * 0.1));
  const ready = Math.round(introBudget * 0.38);
  const set = Math.round(introBudget * 0.28);
  const cues: ShowCue[] = [
    { kind: "intro", name: "Ready", place: 0, wait: ready },
    { kind: "intro", name: "Set", place: 0, wait: set },
    { kind: "intro", name: "Spin", place: 0, wait: introBudget - ready - set },
  ];

  const spinBudget = total - introBudget;
  let spent = 0;
  names.forEach((winner, place) => {
    const budget = place === names.length - 1 ? spinBudget - spent : Math.floor(spinBudget / names.length);
    spent += budget;
    const taken = new Set(names.slice(0, place));
    taken.add(winner);
    const spinningPool = pool.filter((name) => !taken.has(name));
    const source = spinningPool.length > 0 ? spinningPool : pool.filter((name) => name !== winner);
    const delays = pace(Math.max(0, budget));
    let previous = "";
    delays.forEach((wait, index) => {
      const last = index === delays.length - 1;
      const name = last ? winner : nextName(source.length > 0 ? source : pool, winner, previous);
      previous = name;
      cues.push({ kind: last ? "lock" : "spin", name, place, wait });
    });
  });

  return cues;
}

export function showLength(cues: readonly ShowCue[]): number {
  return cues.reduce((sum, cue) => sum + cue.wait, 0);
}

export function buildWheel(pool: readonly string[], winner: string, already: readonly string[]): WheelPlan {
  const blocked = new Set(already);
  blocked.add(winner);
  const others: string[] = [];
  const seen = new Set<string>();
  for (const name of pool) {
    if (!name || blocked.has(name) || seen.has(name)) continue;
    seen.add(name);
    others.push(name);
  }
  const slots = Math.min(8, Math.max(2, others.length + 1));
  const winnerIndex = Math.floor(Math.random() * slots);
  const slices: string[] = [];
  for (let index = 0; index < slots; index += 1) {
    if (index === winnerIndex) slices.push(winner);
    else slices.push(others[index % Math.max(1, others.length)] ?? winner);
  }
  return { slices, winnerIndex };
}

export function placeBudgets(cues: readonly ShowCue[], places: number): number[] {
  const budgets = Array.from({ length: places }, () => 0);
  for (const cue of cues) {
    if (cue.kind === "intro") continue;
    const current = budgets[cue.place];
    if (current === undefined) continue;
    budgets[cue.place] = current + cue.wait;
  }
  return budgets;
}
