import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { SAMPLE_NAMES, cleanName, nameKey, parseNames } from "@/lib/names";
import { clampMode, clampSpin, type DrawMode } from "@/lib/draw";

export type Entry = { id: string; name: string };

export type PastDraw = {
  id: string;
  at: number;
  winners: string[];
  poolSize: number;
};

type AddResult = "added" | "duplicate" | "empty";

type WaffleState = {
  entries: Entry[];
  winnerCount: number;
  spinSeconds: number;
  drawMode: DrawMode;
  uniqueOnly: boolean;
  history: PastDraw[];
  addName: (raw: string) => AddResult;
  addMany: (raw: string) => { added: number; skipped: number };
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
    const probe = "__waffle_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
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
      drawMode: "show",
      uniqueOnly: true,
      history: [],
      addName: (raw) => {
        const name = cleanName(raw);
        if (!name || name.length > 120) return "empty";
        const state = get();
        if (state.uniqueOnly && state.entries.some((entry) => nameKey(entry.name) === nameKey(name))) {
          return "duplicate";
        }
        set({ entries: [...state.entries, { id: crypto.randomUUID(), name }] });
        return "added";
      },
      addMany: (raw) => {
        const parsed = parseNames(raw);
        const state = get();
        const entries = state.entries.slice();
        const seen = new Set(state.uniqueOnly ? state.entries.map((entry) => nameKey(entry.name)) : []);
        let added = 0;
        let skipped = 0;
        for (const name of parsed) {
          const key = nameKey(name);
          if (state.uniqueOnly && seen.has(key)) {
            skipped += 1;
            continue;
          }
          entries.push({ id: crypto.randomUUID(), name });
          if (state.uniqueOnly) seen.add(key);
          added += 1;
        }
        if (added > 0) set({ entries });
        return { added, skipped };
      },
      remove: (id) =>
        set((state) => {
          const entries = state.entries.filter((entry) => entry.id !== id);
          return { entries, winnerCount: clampCount(state.winnerCount, entries.length) };
        }),
      removeIds: (ids) =>
        set((state) => {
          const drop = new Set(ids);
          const entries = state.entries.filter((entry) => !drop.has(entry.id));
          return { entries, winnerCount: clampCount(state.winnerCount, entries.length) };
        }),
      restore: (back) =>
        set((state) => {
          const entries = state.entries.slice();
          const ids = new Set(entries.map((entry) => entry.id));
          const keys = new Set(entries.map((entry) => nameKey(entry.name)));
          for (const entry of back) {
            if (ids.has(entry.id)) continue;
            if (state.uniqueOnly && keys.has(nameKey(entry.name))) continue;
            entries.push(entry);
            ids.add(entry.id);
            keys.add(nameKey(entry.name));
          }
          return { entries };
        }),
      clearEntries: () => set({ entries: [], winnerCount: 1 }),
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
          };
        }),
      pushHistory: (draw) => set((state) => ({ history: [draw, ...state.history].slice(0, 8) })),
      clearHistory: () => set({ history: [] }),
      loadSample: () =>
        set((state) => {
          const entries = SAMPLE_NAMES.map((name) => ({ id: crypto.randomUUID(), name }));
          return { entries, winnerCount: clampCount(state.winnerCount, entries.length) };
        }),
    }),
    {
      name: "waffle-draw",
      skipHydration: true,
      storage: createJSONStorage(browserStorage),
      partialize: (state) => ({
        entries: state.entries,
        winnerCount: state.winnerCount,
        spinSeconds: state.spinSeconds,
        drawMode: state.drawMode,
        uniqueOnly: state.uniqueOnly,
        history: state.history,
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
          .slice(0, 8);
        const count = typeof state.winnerCount === "number" ? state.winnerCount : 1;
        state.winnerCount = clampCount(count, state.entries.length);
        state.spinSeconds = clampSpin(typeof state.spinSeconds === "number" ? state.spinSeconds : 10);
        state.drawMode = clampMode(state.drawMode);
      },
    },
  ),
);
