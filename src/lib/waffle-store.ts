import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { SAMPLE_NAMES, nameKey, parseNamed, readNamed } from "@/lib/names";
import { clampMode, clampSpin, type DrawMode } from "@/lib/draw";
import type { DrawProof } from "@/lib/fair";

export type Entry = { id: string; name: string; number: number };

export type PastDraw = {
  id: string;
  at: number;
  winners: string[];
  poolSize: number;
  proof?: DrawProof;
};

type AddResult = "added" | "duplicate" | "empty" | "taken";

type WaffleState = {
  entries: Entry[];
  winnerCount: number;
  spinSeconds: number;
  drawMode: DrawMode;
  uniqueOnly: boolean;
  history: PastDraw[];
  placement: string[];
  colorById: Record<string, number>;
  addName: (raw: string, number?: number) => AddResult;
  addMany: (raw: string) => { added: number; skipped: number };
  shufflePlacement: () => void;
  newWaffle: () => void;
  remove: (id: string) => void;
  removeIds: (ids: string[]) => void;
  restore: (entries: Entry[]) => void;
  clearEntries: () => void;
  setWinnerCount: (count: number) => void;
  setSpinSeconds: (seconds: number) => void;
  setDrawMode: (mode: DrawMode) => void;
  setUniqueOnly: (value: boolean) => void;
  pushHistory: (draw: PastDraw) => void;
  clearHistory: () => void;
  loadSample: () => void;
};

const MAX_WINNERS = 12;

function clampCount(count: number, entryCount: number): number {
  const safe = Math.min(MAX_WINNERS, Math.max(1, Math.round(count) || 1));
  if (entryCount <= 0) return 1;
  return Math.min(safe, entryCount);
}

function nextNumber(entries: readonly Entry[]): number {
  return entries.reduce((max, entry) => Math.max(max, entry.number), 0) + 1;
}

export function byNumber(entries: readonly Entry[]): Entry[] {
  return entries.slice().sort((a, b) => a.number - b.number || a.name.localeCompare(b.name));
}

export function wheelEntries(entries: readonly Entry[], placement: readonly string[]): Entry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const used = new Set<string>();
  const ordered: Entry[] = [];
  for (const id of placement) {
    const entry = byId.get(id);
    if (!entry || used.has(id)) continue;
    used.add(id);
    ordered.push(entry);
  }
  for (const entry of byNumber(entries)) {
    if (!used.has(entry.id)) ordered.push(entry);
  }
  return ordered;
}

export function slotLabel(entry: Entry): string {
  return `No. ${entry.number} — ${entry.name}`;
}

function randomBelow(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(buf);
    value = buf[0] ?? 0;
  } while (value >= limit);
  return value % max;
}

function paint(ids: readonly string[], offset: number): Record<string, number> {
  const colors: Record<string, number> = {};
  const count = ids.length;
  const used = new Set<number>();
  ids.forEach((id, index) => {
    let hue = Math.round((offset + (index * 360) / Math.max(count, 1)) % 360);
    let guard = 0;
    while (used.has(hue) && guard < 360) {
      hue = (hue + 1) % 360;
      guard += 1;
    }
    used.add(hue);
    colors[id] = hue;
  });
  return colors;
}

function paintEntries(entries: readonly Entry[], offset = 0): Record<string, number> {
  return paint(byNumber(entries).map((entry) => entry.id), offset);
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => (data.has(key) ? (data.get(key) ?? null) : null),
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function browserStorage(): Storage {
  if (typeof window === "undefined") return memoryStorage();
  try {
    window.localStorage.removeItem("waffle-draw");
  } catch {
    // The old list lived on this browser. Drop it so the next person never sees it.
  }
  try {
    const probe = "__waffle_probe__";
    window.sessionStorage.setItem(probe, "1");
    window.sessionStorage.removeItem(probe);
    return window.sessionStorage;
  } catch {
    return memoryStorage();
  }
}

export const useWaffle = create<WaffleState>()(
  persist(
    (set, get) => ({
      entries: [],
      winnerCount: 1,
      spinSeconds: 10,
      drawMode: "wheel",
      uniqueOnly: true,
      history: [],
      placement: [],
      colorById: {},
      addName: (raw, requested) => {
        const parsed = readNamed(raw);
        const name = parsed?.name ?? "";
        if (!name) return "empty";
        const state = get();
        if (state.uniqueOnly && state.entries.some((entry) => nameKey(entry.name) === nameKey(name))) {
          return "duplicate";
        }
        const number = requested && requested >= 1 ? Math.floor(requested) : (parsed?.number ?? nextNumber(state.entries));
        if (state.entries.some((entry) => entry.number === number)) return "taken";
        const id = crypto.randomUUID();
        const entries = [...state.entries, { id, name, number }];
        set({ entries, colorById: paintEntries(entries) });
        return "added";
      },
      addMany: (raw) => {
        const parsed = parseNamed(raw);
        const state = get();
        const entries = state.entries.slice();
        const seen = new Set(state.uniqueOnly ? state.entries.map((entry) => nameKey(entry.name)) : []);
        const used = new Set(entries.map((entry) => entry.number));
        let added = 0;
        let skipped = 0;
        for (const item of parsed) {
          const key = nameKey(item.name);
          if (state.uniqueOnly && seen.has(key)) {
            skipped += 1;
            continue;
          }
          let number = item.number ?? nextNumber(entries);
          if (used.has(number)) {
            if (item.number) {
              skipped += 1;
              continue;
            }
            number = nextNumber(entries);
          }
          const id = crypto.randomUUID();
          entries.push({ id, name: item.name, number });
          used.add(number);
          if (state.uniqueOnly) seen.add(key);
          added += 1;
        }
        if (added > 0) set({ entries, colorById: paintEntries(entries) });
        return { added, skipped };
      },
      shufflePlacement: () => {
        const entries = get().entries;
        if (entries.length < 2) return;
        const step = Math.max(1, Math.round(360 / entries.length));
        set({ colorById: paintEntries(entries, step + randomBelow(360 - step)) });
      },
      newWaffle: () => set({ entries: [], winnerCount: 1, history: [], placement: [], colorById: {} }),
      remove: (id) =>
        set((state) => {
          const entries = state.entries.filter((entry) => entry.id !== id);
          return { entries, winnerCount: clampCount(state.winnerCount, entries.length), colorById: paintEntries(entries) };
        }),
      removeIds: (ids) =>
        set((state) => {
          const drop = new Set(ids);
          const entries = state.entries.filter((entry) => !drop.has(entry.id));
          return { entries, winnerCount: clampCount(state.winnerCount, entries.length), colorById: paintEntries(entries) };
        }),
      restore: (back) =>
        set((state) => {
          const entries = state.entries.slice();
          const ids = new Set(entries.map((entry) => entry.id));
          const keys = new Set(entries.map((entry) => nameKey(entry.name)));
          for (const entry of back) {
            if (ids.has(entry.id)) continue;
            if (state.uniqueOnly && keys.has(nameKey(entry.name))) continue;
            entries.push({ ...entry, number: entry.number });
            ids.add(entry.id);
            keys.add(nameKey(entry.name));
          }
          return { entries, colorById: paintEntries(entries) };
        }),
      clearEntries: () => set({ entries: [], winnerCount: 1, colorById: {} }),
      setWinnerCount: (count) =>
        set((state) => ({ winnerCount: clampCount(count, state.entries.length) })),
      setSpinSeconds: (seconds) => set({ spinSeconds: clampSpin(seconds) }),
      setDrawMode: (mode) => set({ drawMode: clampMode(mode) }),
      setUniqueOnly: (value) =>
        set((state) => {
          if (!value) return { uniqueOnly: false };
          const seen = new Set<string>();
          const entries = state.entries.filter((entry) => {
            const key = nameKey(entry.name);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          return {
            uniqueOnly: true,
            entries,
            winnerCount: clampCount(state.winnerCount, entries.length),
            colorById: paintEntries(entries),
          };
        }),
      pushHistory: (draw) => set((state) => ({ history: [draw, ...state.history].slice(0, 8) })),
      clearHistory: () => set({ history: [] }),
      loadSample: () =>
        set((state) => {
          const entries = SAMPLE_NAMES.map((name, index) => ({ id: crypto.randomUUID(), name, number: index + 1 }));
          return {
            entries,
            winnerCount: clampCount(state.winnerCount, entries.length),
            placement: [],
            colorById: paintEntries(entries),
          };
        }),
    }),
    {
      name: "waffle-session",
      skipHydration: true,
      storage: createJSONStorage(browserStorage),
      partialize: (state) => ({
        entries: state.entries,
        winnerCount: state.winnerCount,
        spinSeconds: state.spinSeconds,
        drawMode: state.drawMode,
        uniqueOnly: state.uniqueOnly,
        history: state.history,
        placement: state.placement,
        colorById: state.colorById,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (!Array.isArray(state.entries)) state.entries = [];
        state.entries = state.entries.filter(
          (entry) =>
            !!entry &&
            typeof entry.id === "string" &&
            typeof entry.name === "string" &&
            entry.name.trim().length > 0,
        );
        const used = new Set<number>();
        let auto = 1;
        state.entries = state.entries.map((entry) => {
          let number = typeof entry.number === "number" && entry.number >= 1 ? Math.floor(entry.number) : auto;
          while (used.has(number)) number += 1;
          used.add(number);
          auto = Math.max(auto, number + 1);
          return { id: entry.id, name: entry.name.trim(), number };
        });
        if (typeof state.uniqueOnly !== "boolean") state.uniqueOnly = true;
        if (!Array.isArray(state.history)) state.history = [];
        state.history = state.history
          .filter(
            (draw) =>
              !!draw &&
              typeof draw.id === "string" &&
              typeof draw.at === "number" &&
              Array.isArray(draw.winners) &&
              typeof draw.poolSize === "number",
          )
          .slice(0, 8)
          .map((draw) => {
            const proof = draw.proof;
            if (!proof) return { ...draw, proof: undefined };
            const ok =
              Array.isArray(proof.names) &&
              proof.names.every((name) => typeof name === "string") &&
              typeof proof.count === "number" &&
              typeof proof.round === "number" &&
              typeof proof.randomness === "string" &&
              typeof proof.commitment === "string";
            return ok ? draw : { ...draw, proof: undefined };
          });
        const count = typeof state.winnerCount === "number" ? state.winnerCount : 1;
        state.winnerCount = clampCount(count, state.entries.length);
        state.spinSeconds = clampSpin(typeof state.spinSeconds === "number" ? state.spinSeconds : 10);
        state.drawMode = clampMode(state.drawMode);
        const ids = new Set(state.entries.map((entry) => entry.id));
        state.placement = Array.isArray(state.placement)
          ? state.placement.filter((id) => typeof id === "string" && ids.has(id))
          : [];
        state.colorById = paintEntries(state.entries);
      },
    },
  ),
);
