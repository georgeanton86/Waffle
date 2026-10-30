export const CHAIN = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";

const BEACONS = [
  `https://drand.cloudflare.com/${CHAIN}`,
  `https://api.drand.sh/${CHAIN}`,
];

export type Pulse = {
  round: number;
  randomness: string;
};

export type DrawProof = {
  names: string[];
  count: number;
  round: number;
  randomness: string;
  commitment: string;
};

const HEX = /^[0-9a-f]+$/;

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function canonical(names: readonly string[], count: number, round: number): string {
  return ["waffle-v1", String(Math.floor(count)), String(Math.floor(round)), ...names].join("\n");
}

export async function commitment(names: readonly string[], count: number, round: number): Promise<string> {
  return sha256Hex(canonical(names, count, round));
}

export function sealCode(commitmentHex: string): string {
  return commitmentHex.slice(0, 8).toUpperCase();
}

async function u32(seed: string, n: number): Promise<number> {
  const hex = await sha256Hex(`${seed}:${n}`);
  return Number.parseInt(hex.slice(0, 8), 16);
}

export async function shuffledIndexes(length: number, seed: string): Promise<number[]> {
  const pool = Array.from({ length }, (_, index) => index);
  let cursor = 0;
  const cap = length * 12 + 64;
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const span = i + 1;
    const limit = Math.floor(0x100000000 / span) * span;
    let value = 0;
    do {
      value = await u32(seed, cursor);
      cursor += 1;
      if (cursor > cap) throw new Error("seed stream stalled");
    } while (value >= limit);
    const j = value % span;
    const current = pool[i] as number;
    pool[i] = pool[j] as number;
    pool[j] = current;
  }
  return pool;
}

export async function winningNames(names: readonly string[], count: number, seed: string): Promise<string[]> {
  const n = Math.min(Math.max(0, Math.floor(count)), names.length);
  if (n === 0) return [];
  const order = await shuffledIndexes(names.length, seed.toLowerCase());
  return order.slice(0, n).map((index) => names[index] ?? "");
}

export async function audit(
  names: readonly string[],
  count: number,
  round: number,
  randomness: string,
  claimedWinners: readonly string[],
  claimedCommitment: string,
): Promise<"match" | "mismatch"> {
  const seed = randomness.trim().toLowerCase();
  if (!HEX.test(seed) || seed.length < 32) return "mismatch";
  const seal = await commitment(names, count, round);
  if (seal !== claimedCommitment.trim().toLowerCase()) return "mismatch";
  const winners = await winningNames(names, count, seed);
  if (winners.length !== claimedWinners.length) return "mismatch";
  for (let index = 0; index < winners.length; index += 1) {
    if (winners[index] !== claimedWinners[index]) return "mismatch";
  }
  return "match";
}

export function formatProof(proof: DrawProof, winners: readonly string[]): string {
  return [
    "--- waffle proof ---",
    `pulse ${proof.round}`,
    `seal ${proof.commitment}`,
    ...winners.map((name) => `winner ${name}`),
    ...proof.names.map((name) => `name ${name}`),
    "--- end ---",
  ].join("\n");
}

export function parseProof(text: string): { proof: DrawProof; winners: string[] } | null {
  const start = text.indexOf("--- waffle proof ---");
  const end = text.indexOf("--- end ---");
  if (start < 0 || end < start) return null;
  const body = text.slice(start, end).split(/\r?\n/).slice(1);
  let round = 0;
  let commitmentHex = "";
  const winners: string[] = [];
  const names: string[] = [];
  for (const line of body) {
    if (line.startsWith("pulse ")) round = Number(line.slice(6));
    else if (line.startsWith("seal ")) commitmentHex = line.slice(5).trim().toLowerCase();
    else if (line.startsWith("winner ")) winners.push(line.slice(7));
    else if (line.startsWith("name ")) names.push(line.slice(5));
  }
  if (!Number.isInteger(round) || round <= 0) return null;
  if (!HEX.test(commitmentHex) || commitmentHex.length !== 64) return null;
  if (names.length === 0 || winners.length === 0) return null;
  return {
    winners,
    proof: { names, count: winners.length, round, randomness: "", commitment: commitmentHex },
  };
}

async function readPulse(url: string): Promise<Pulse> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  const body = (await response.json()) as { round?: unknown; randomness?: unknown };
  if (typeof body.round !== "number" || typeof body.randomness !== "string") throw new Error("bad pulse");
  return { round: body.round, randomness: body.randomness.toLowerCase() };
}

async function fromBeacons(path: string): Promise<Pulse> {
  let last: unknown;
  for (const base of BEACONS) {
    try {
      return await readPulse(`${base}${path}`);
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("The public pulse did not answer.");
}

export function fetchLatest(): Promise<Pulse> {
  return fromBeacons("/public/latest");
}

export function fetchRound(round: number): Promise<Pulse> {
  return fromBeacons(`/public/${Math.floor(round)}`);
}

export async function waitForRound(round: number, signal?: AbortSignal): Promise<Pulse> {
  const started = Date.now();
  while (Date.now() - started < 25000) {
    if (signal?.aborted) throw new Error("cancelled");
    try {
      const pulse = await fetchRound(round);
      if (pulse.round === round && HEX.test(pulse.randomness)) return pulse;
    } catch {
      // The round is published a few seconds after it is numbered.
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (signal?.aborted) throw new Error("cancelled");
  }
  throw new Error("The public pulse did not arrive. Nothing was drawn.");
}
