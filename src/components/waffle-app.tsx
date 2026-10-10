import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardEvent, FormEvent } from "react";
import { Minus, Plus, X } from "lucide-react";
import {
  SPIN_MAX,
  SPIN_MIN,
  SPIN_STEP,
  buildShow,
  buildWheel,
  clock,
  formatResult,
  pickWinners,
  placeBudgets,
  placeLabel,
  type DrawMode,
  type ShowCue,
  type WheelPlan,
} from "@/lib/draw";
import { useWaffle, type Entry } from "@/lib/waffle-store";

type LiveDraw = {
  id: string;
  winners: Entry[];
  pool: string[];
  poolSize: number;
  seconds: number;
  mode: DrawMode;
};

const btnBase =
  "btn-press inline-flex items-center justify-center rounded-lg px-4 text-base font-medium touch-manipulation disabled:opacity-40";
const btnPrimary = `${btnBase} h-12 bg-hot text-night enabled:hover:opacity-90`;
const btnQuiet = `${btnBase} h-11 border border-line bg-card text-ink enabled:hover:bg-paper`;
const btnGhost = `${btnBase} h-11 text-muted enabled:hover:text-ink`;

function LogoMark() {
  return (
    <span className="waffle waffle-sm" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => (
        <span key={index} className="pocket" />
      ))}
    </span>
  );
}

function Marquee({ tick, mode }: { tick: number; mode: "idle" | "live" | "win" }) {
  return (
    <div className="marquee" aria-hidden="true">
      {Array.from({ length: 14 }, (_, index) => (
        <span
          key={index}
          className={
            mode === "idle"
              ? "bulb bulb-idle"
              : mode === "win" || (tick + index) % 3 === 0
                ? "bulb is-on"
                : "bulb"
          }
          style={{ animationDelay: `${index * 90}ms` }}
        />
      ))}
    </div>
  );
}

const SLICE_COLORS = [
  "var(--color-hot)",
  "var(--color-sun)",
  "var(--color-mint)",
  "var(--color-sky)",
  "var(--color-pop)",
];
const WAFFLE_HOP = [0, 1, 2, 3, 7, 11, 10, 9, 8, 4, 5, 6];
const DRAW_MODES: { id: DrawMode; label: string }[] = [
  { id: "show", label: "Show" },
  { id: "wheel", label: "Wheel" },
  { id: "waffle", label: "Waffle" },
];

function slicePath(index: number, total: number): { d: string; x: number; y: number; rot: number } {
  const cx = 140;
  const cy = 140;
  const radius = 124;
  const start = (index / total) * Math.PI * 2 - Math.PI / 2;
  const end = ((index + 1) / total) * Math.PI * 2 - Math.PI / 2;
  const large = end - start > Math.PI ? 1 : 0;
  const x0 = cx + radius * Math.cos(start);
  const y0 = cy + radius * Math.sin(start);
  const x1 = cx + radius * Math.cos(end);
  const y1 = cy + radius * Math.sin(end);
  const mid = (start + end) / 2;
  const labelRadius = radius * 0.64;
  const x = cx + labelRadius * Math.cos(mid);
  const y = cy + labelRadius * Math.sin(mid);
  const pointingDown = Math.sin(mid) > 0.15;
  const rot = (mid * 180) / Math.PI + (pointingDown ? -90 : 90);
  return {
    d: `M ${cx} ${cy} L ${x0} ${y0} A ${radius} ${radius} 0 ${large} 1 ${x1} ${y1} Z`,
    x,
    y,
    rot,
  };
}

function shortName(name: string): string {
  return name.length > 9 ? `${name.slice(0, 8)}…` : name;
}

function WheelFace({
  slices,
  svgRef,
  idle,
  hub,
}: {
  slices: string[];
  svgRef?: { current: SVGSVGElement | null };
  idle?: boolean;
  hub: string;
}) {
  return (
    <div className="wheel-stage">
      <div className="wheel-pointer" aria-hidden="true" />
      <svg
        ref={svgRef}
        className={idle ? "wheel-svg is-idle" : "wheel-svg"}
        viewBox="0 0 280 280"
        aria-hidden="true"
      >
        {slices.map((name, index) => {
          const piece = slicePath(index, slices.length);
          return (
            <g key={`${name}-${index}`}>
              <path d={piece.d} fill={SLICE_COLORS[index % SLICE_COLORS.length]} />
              <text
                className="slice-label"
                x={piece.x}
                y={piece.y}
                textAnchor="middle"
                dominantBaseline="middle"
                transform={`rotate(${piece.rot} ${piece.x} ${piece.y})`}
              >
                {shortName(name)}
              </text>
            </g>
          );
        })}
        <circle cx="140" cy="140" r="38" fill="var(--color-night)" />
      </svg>
      <p className="wheel-hub line-clamp-2">{hub}</p>
    </div>
  );
}

function WaffleFace({ tick, live }: { tick: number; live: boolean }) {
  const active = WAFFLE_HOP[tick % WAFFLE_HOP.length] ?? 0;
  return (
    <div className="waffle waffle-lg mt-3" aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => (
        <span
          key={index}
          className={
            !live || index === active ? `pocket is-on tone-${(live ? tick : index) % 5}` : "pocket"
          }
        />
      ))}
    </div>
  );
}

function useWheelSpin(svgRef: { current: SVGSVGElement | null }, plans: WheelPlan[], place: number, budgets: number[]) {
  const angleRef = useRef(0);
  const spun = useRef(-1);

  useEffect(() => {
    const node = svgRef.current;
    if (!node || place < 0 || place >= plans.length) return;
    if (spun.current >= place) return;
    const plan = plans[place];
    if (!plan) return;
    spun.current = place;
    const slots = Math.max(1, plan.slices.length);
    const landing = -((plan.winnerIndex + 0.5) / slots) * 360;
    const from = angleRef.current;
    const base = ((landing % 360) + 360) % 360;
    let to = base;
    const turns = 3 + place;
    while (to < from + turns * 360) to += 360;
    const ms = budgets[place] ?? 0;
    const apply = (value: number) => {
      angleRef.current = value;
      node.style.transform = `rotate(${value}deg)`;
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || ms < 40) {
      apply(to);
      return;
    }
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / ms);
      const eased = 1 - (1 - t) ** 3;
      apply(from + (to - from) * eased);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [svgRef, plans, place, budgets]);
}

function ModePicker({
  value,
  disabled,
  onChange,
}: {
  value: DrawMode;
  disabled: boolean;
  onChange: (mode: DrawMode) => void;
}) {
  return (
    <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-card p-1" role="radiogroup" aria-label="Draw style">
      {DRAW_MODES.map((mode) => {
        const on = value === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(mode.id)}
            className={`btn-press h-11 rounded-lg text-sm font-medium disabled:opacity-40 ${
              on ? "bg-hot text-night" : "text-ink"
            }`}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}

function useShow(pool: string[], winners: string[], seconds: number) {
  const cuesRef = useRef<ShowCue[] | null>(null);
  if (cuesRef.current === null) cuesRef.current = buildShow(pool, winners, seconds);
  const cues = cuesRef.current;
  const [index, setIndex] = useState(0);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || cues.length === 0) {
      setIndex(Math.max(0, cues.length - 1));
      setSettled(true);
      return;
    }
    let step = 0;
    let timer = 0;
    const tick = () => {
      setIndex(step);
      if (step >= cues.length - 1) {
        setSettled(true);
        return;
      }
      const wait = cues[step]?.wait ?? 0;
      step += 1;
      timer = window.setTimeout(tick, wait);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [cues]);

  const cue = cues[Math.min(index, Math.max(0, cues.length - 1))];
  const locked = cues.slice(0, index + 1).filter((item) => item.kind === "lock");
  const remaining = settled ? 0 : cues.slice(index).reduce((sum, item) => sum + item.wait, 0);
  return { cue, locked, settled, tick: index, remaining, cues };
}

async function copyText(text: string): Promise<boolean> {
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.top = "0";
    field.style.left = "0";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.focus();
    field.select();
    field.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    field.remove();
    if (ok) return true;
  } catch {
    // Fall through to the async clipboard, then a visible selection.
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function DrawStage({
  draw,
  canUndo,
  onSettled,
  onRemove,
  onUndo,
}: {
  draw: LiveDraw;
  canUndo: boolean;
  onSettled: () => void;
  onRemove: () => void;
  onUndo: () => void;
}) {
  const names = draw.winners.map((winner) => winner.name);
  const { cue, locked, settled, tick, remaining, cues } = useShow(draw.pool, names, draw.seconds);
  const wheelSvg = useRef<SVGSVGElement | null>(null);
  const rigRef = useRef<{ plans: WheelPlan[]; budgets: number[] } | null>(null);
  if (rigRef.current === null) {
    rigRef.current = {
      plans: names.map((name, index) => buildWheel(draw.pool, name, names.slice(0, index))),
      budgets: placeBudgets(cues, names.length),
    };
  }
  const spinPlace = draw.mode === "wheel" && cue && cue.kind !== "intro" ? cue.place : -1;
  useWheelSpin(wheelSvg, rigRef.current.plans, spinPlace, rigRef.current.budgets);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState("");
  const manualRef = useRef<HTMLTextAreaElement>(null);
  const noun = draw.poolSize === 1 ? "name" : "names";
  const headline = cue?.name ?? names[0] ?? "";
  const place =
    cue?.kind === "intro" ? "Tonight's draw" : cue ? `${placeLabel(cue.place)} place` : "Winner";

  useEffect(() => {
    if (settled) onSettled();
  }, [settled, onSettled]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const announcement =
    draw.winners.length === 1
      ? `Winner: ${names[0] ?? ""}. Drawn from ${draw.poolSize} ${noun}.`
      : `Winners: ${names.join(", ")}. Drawn from ${draw.poolSize} ${noun}.`;

  return (
    <section className="scroll-mt-4" data-phase={settled ? "result" : "spin"} aria-busy={!settled}>
      <div className="show-board stage-in rounded-3xl px-4 py-4">
        <Marquee tick={tick} mode={settled ? "win" : "live"} />
        <div className="mt-4 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium tracking-wide text-ink/80">{settled ? "That's the draw" : place}</h2>
          <p className="text-sm font-medium tabular-nums text-ink/80" aria-hidden="true">
            {clock(remaining)}
          </p>
        </div>
        <p className="sr-only" aria-live="polite">
          {settled ? announcement : ""}
        </p>
        {draw.mode === "wheel" ? (
          <WheelFace
            slices={rigRef.current.plans[Math.max(0, cue?.place ?? 0)]?.slices ?? names}
            svgRef={wheelSvg}
            hub={cue?.kind === "spin" ? "Spin" : ""}
          />
        ) : null}
        {draw.mode === "waffle" ? <WaffleFace tick={tick} live={!settled} /> : null}
        {draw.mode === "wheel" && cue?.kind === "spin" ? null : (
          <p
            key={cue?.kind === "lock" ? `lock-${cue.place}` : "live"}
            className={`mt-2 font-display text-4xl font-semibold leading-tight break-words ${
              draw.mode === "wheel" ? "text-center" : ""
            } ${cue?.kind === "lock" ? "name-lock" : ""} ${draw.mode === "show" ? "min-h-20" : ""}`}
            title={headline}
          >
            {headline}
          </p>
        )}
        {names.length > 1 ? (
          <ol className="mt-4 grid gap-1">
            {names.map((name, index) => {
              const hit = locked.find((item) => item.place === index);
              return (
                <li key={`${name}-${index}`} className="flex items-baseline gap-3">
                  <span className="w-10 shrink-0 text-sm tabular-nums text-ink/70">{placeLabel(index)}</span>
                  <span className={`min-w-0 flex-1 truncate text-base ${hit ? "text-mint" : "text-ink/40"}`}>
                    {hit ? hit.name : "Spinning"}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-ink/70">
            From {draw.poolSize} {noun}
          </p>
        )}
        <div className="mt-4">
          <Marquee tick={tick + 2} mode={settled ? "win" : "live"} />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-1">
        <button
          type="button"
          className={`${btnPrimary} w-full`}
          disabled={!settled}
          onClick={() => {
            const text = formatResult(
              draw.winners.map((winner) => winner.name),
              draw.poolSize,
            );
            void copyText(text).then((ok) => {
              if (ok) {
                setCopied(true);
                setManualCopy("");
                return;
              }
              setCopied(false);
              setManualCopy(text);
              window.setTimeout(() => {
                const field = manualRef.current;
                if (!field) return;
                field.focus();
                field.select();
              }, 0);
            });
          }}
        >
          {copied ? "Copied" : "Copy result"}
        </button>
        {manualCopy ? (
          <div className="mt-2">
            <p className="text-sm text-muted">Select this text and copy it.</p>
            <textarea
              ref={manualRef}
              readOnly
              value={manualCopy}
              rows={Math.min(8, Math.max(3, manualCopy.split("\n").length))}
              aria-label="Result text"
              className="mt-2 w-full resize-none rounded-lg border border-line bg-paper px-3 py-2 text-base leading-normal text-ink"
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
        ) : null}
        {canUndo ? (
          <button type="button" className={`${btnGhost} w-full`} onClick={onUndo}>
            Undo remove
          </button>
        ) : (
          <button type="button" className={`${btnGhost} w-full`} disabled={!settled} onClick={onRemove}>
            {draw.winners.length === 1 ? "Remove from list" : "Remove winners from list"}
          </button>
        )}
      </div>
    </section>
  );
}

function IdleBoard({
  seconds,
  winners,
  mode,
  names,
}: {
  seconds: number;
  winners: number;
  mode: DrawMode;
  names: string[];
}) {
  const extra = winners > 1 ? `, and all ${winners} winners lock in as it goes` : "";
  const title = mode === "wheel" ? "Give it a spin" : mode === "waffle" ? "The waffle decides" : "Who's it gonna be?";
  const kicker = mode === "wheel" ? "The wheel" : mode === "waffle" ? "The waffle" : "Tonight's draw";
  const preview = names.slice(0, 6);
  const slices = preview.length >= 2 ? preview : ["Name", "Name", "Name", "Name", "Name", "Name"];
  return (
    <section className="show-board mb-4 rounded-3xl px-4 py-4">
      <Marquee tick={0} mode="idle" />
      <div className="mt-4 flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium tracking-wide text-ink/75">{kicker}</p>
        <p className="text-sm font-medium tabular-nums text-ink/80">{clock(seconds * 1000)}</p>
      </div>
      <h1 className="mt-1 font-display text-4xl font-semibold leading-tight">{title}</h1>
      {mode === "wheel" ? <WheelFace slices={slices} idle hub="You" /> : null}
      {mode === "waffle" ? <WaffleFace tick={2} live={false} /> : null}
      <p className="mt-2 max-w-sm text-base text-ink/75">
        Add the names. One {seconds}-second spin{extra}.
      </p>
      {mode === "show" ? (
        <div className="mt-4">
          <Marquee tick={2} mode="idle" />
        </div>
      ) : null}
    </section>
  );
}
function formatWhen(at: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

export function WaffleApp() {
  const entries = useWaffle((state) => state.entries);
  const winnerCount = useWaffle((state) => state.winnerCount);
  const spinSeconds = useWaffle((state) => state.spinSeconds);
  const drawMode = useWaffle((state) => state.drawMode);
  const uniqueOnly = useWaffle((state) => state.uniqueOnly);
  const history = useWaffle((state) => state.history);
  const addName = useWaffle((state) => state.addName);
  const addMany = useWaffle((state) => state.addMany);
  const remove = useWaffle((state) => state.remove);
  const removeIds = useWaffle((state) => state.removeIds);
  const restore = useWaffle((state) => state.restore);
  const clearEntries = useWaffle((state) => state.clearEntries);
  const setWinnerCount = useWaffle((state) => state.setWinnerCount);
  const setSpinSeconds = useWaffle((state) => state.setSpinSeconds);
  const setDrawMode = useWaffle((state) => state.setDrawMode);
  const setUniqueOnly = useWaffle((state) => state.setUniqueOnly);
  const pushHistory = useWaffle((state) => state.pushHistory);
  const clearHistory = useWaffle((state) => state.clearHistory);
  const loadSample = useWaffle((state) => state.loadSample);

  const [draft, setDraft] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [status, setStatus] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [live, setLive] = useState<LiveDraw | null>(null);
  const [settled, setSettled] = useState(false);
  const [undoEntries, setUndoEntries] = useState<Entry[] | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void useWaffle.persist.rehydrate();
  }, []);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(""), 2800);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (!live) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stageRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [live]);

  const onSettled = useCallback(() => setSettled(true), []);

  function ingest(raw: string, closePaste = false) {
    const { added, skipped } = addMany(raw);
    if (added === 0 && skipped === 0) {
      setStatus("No names found in that paste.");
      return;
    }
    if (added === 0) {
      setStatus("Those names are already in the list.");
      return;
    }
    setStatus(
      skipped > 0
        ? `Added ${added}. Skipped ${skipped} ${skipped === 1 ? "duplicate" : "duplicates"}.`
        : `Added ${added} ${added === 1 ? "name" : "names"}.`,
    );
    if (closePaste) {
      setPasteText("");
      setPasteOpen(false);
    }
  }

  function onAdd(event: FormEvent) {
    event.preventDefault();
    const result = addName(draft);
    if (result === "empty") return;
    if (result === "duplicate") {
      setStatus(`${draft.trim()} is already in the list.`);
      return;
    }
    setStatus(`Added ${draft.trim()}.`);
    setDraft("");
  }

  function onPasteInput(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (!text) return;
    const multiline = /[\r\n]/.test(text);
    const many = text.split(/[,;|]/).length > 2;
    if (!multiline && !many) return;
    event.preventDefault();
    ingest(text);
  }

  function onDraw() {
    const state = useWaffle.getState();
    if (state.entries.length === 0) return;
    const winners = pickWinners(state.entries, Math.min(state.winnerCount, state.entries.length));
    if (winners.length === 0) return;
    const id = crypto.randomUUID();
    pushHistory({
      id,
      at: Date.now(),
      winners: winners.map((winner) => winner.name),
      poolSize: state.entries.length,
    });
    setSettled(false);
    setUndoEntries(null);
    setLive({
      id,
      winners,
      pool: state.entries.map((entry) => entry.name),
      poolSize: state.entries.length,
      seconds: state.spinSeconds,
      mode: state.drawMode,
    });
  }

  const locked = live !== null && !settled;
  const canDraw = entries.length > 0 && !locked;
  const picked = new Set(!undoEntries && live ? live.winners.map((winner) => winner.id) : []);
  const maxCount = Math.min(12, Math.max(1, entries.length));

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-5 pt-8">
      <header className="mb-4 flex items-center gap-2">
        <LogoMark />
        <p className="text-sm font-medium text-muted">Waffle</p>
      </header>
      <ModePicker value={drawMode} disabled={locked} onChange={setDrawMode} />

      <div ref={stageRef}>
        {live ? (
          <div className="mb-4">
            <DrawStage
              key={live.id}
              draw={live}
              canUndo={undoEntries !== null}
              onSettled={onSettled}
              onRemove={() => {
                removeIds(live.winners.map((winner) => winner.id));
                setUndoEntries(live.winners);
              }}
              onUndo={() => {
                if (!undoEntries) return;
                restore(undoEntries);
                setUndoEntries(null);
              }}
            />
          </div>
        ) : (
          <IdleBoard
            seconds={spinSeconds}
            winners={winnerCount}
            mode={drawMode}
            names={entries.map((entry) => entry.name)}
          />
        )}
      </div>

      <section className="rounded-3xl border border-line bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Names</h2>
          <button
            type="button"
            aria-pressed={uniqueOnly}
            onClick={() => setUniqueOnly(!uniqueOnly)}
            className="btn-press inline-flex h-11 items-center gap-2 rounded-lg pr-1 text-sm font-medium text-ink"
          >
            <span
              className={`relative h-6 w-11 rounded-full ${uniqueOnly ? "bg-hot" : "bg-line"}`}
              aria-hidden="true"
            >
              <span
                className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-night transition-transform duration-150 motion-reduce:transition-none ${
                  uniqueOnly ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </span>
            One entry each
          </button>
        </div>

        <form className="mt-3 flex gap-2" onSubmit={onAdd}>
          <label className="sr-only" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={onPasteInput}
            placeholder="Type a name"
            maxLength={120}
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 text-base text-ink placeholder:text-muted"
          />
          <button type="submit" className={`${btnQuiet} shrink-0 px-4`}>
            Add
          </button>
        </form>

        <p className={`text-sm text-muted ${status ? "mt-2 mb-1 h-5" : "sr-only"}`} aria-live="polite">
          {status}
        </p>

        {pasteOpen ? (
          <div className="mb-3">
            <label htmlFor="paste" className="text-sm font-medium">
              Paste names
            </label>
            <textarea
              id="paste"
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              rows={5}
              placeholder="One name per line"
              className="mt-2 w-full resize-y rounded-lg border border-line bg-paper px-3 py-2 text-base leading-normal text-ink placeholder:text-muted"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" className={`${btnQuiet} w-full`} onClick={() => ingest(pasteText, true)}>
                Add names
              </button>
              <button
                type="button"
                className={`${btnGhost} w-full`}
                onClick={() => {
                  setPasteOpen(false);
                  setPasteText("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="mb-1 inline-flex h-11 items-center text-sm font-medium text-ink underline-offset-4 hover:underline"
            onClick={() => setPasteOpen(true)}
          >
            Paste a list
          </button>
        )}

        {entries.length === 0 ? (
          <div className="border-t border-line pt-4">
            <p className="text-base text-muted">No names yet.</p>
            <button type="button" className={`${btnQuiet} mt-3 w-full`} onClick={() => loadSample()}>
              Load sample names
            </button>
          </div>
        ) : (
          <ul className="max-h-80 overflow-y-auto overscroll-contain border-t border-line">
            {entries.map((entry, index) => (
              <li key={entry.id} className="flex items-center gap-2 border-b border-line last:border-b-0">
                <span className="w-8 shrink-0 text-right text-sm tabular-nums text-muted">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-base" title={entry.name}>
                  {entry.name}
                </span>
                {picked.has(entry.id) ? (
                  <span className="shrink-0 text-sm text-muted">Winner</span>
                ) : null}
                <button
                  type="button"
                  className="btn-press grid size-11 shrink-0 place-items-center rounded-lg text-muted enabled:hover:text-ink"
                  aria-label={`Remove ${entry.name}`}
                  onClick={() => remove(entry.id)}
                >
                  <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {entries.length > 0 ? (
          <div className="mt-3">
            {confirmClear ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted">Clear all {entries.length} names?</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-press h-11 rounded-lg px-3 text-sm font-medium text-ink"
                    onClick={() => {
                      clearEntries();
                      setConfirmClear(false);
                      setLive(null);
                      setUndoEntries(null);
                      setSettled(false);
                      setStatus("Names cleared.");
                    }}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="btn-press h-11 rounded-lg px-3 text-sm font-medium text-muted"
                    onClick={() => setConfirmClear(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="h-11 text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
                onClick={() => setConfirmClear(true)}
              >
                Clear names
              </button>
            )}
          </div>
        ) : null}
      </section>

      {history.length > 0 ? (
        <section className="mt-8">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted">Earlier draws</h2>
            <button
              type="button"
              className="h-11 text-sm font-medium text-muted underline-offset-4 hover:underline"
              onClick={() => clearHistory()}
            >
              Clear
            </button>
          </div>
          <ul className="border-t border-line">
            {history.map((draw) => (
              <li key={draw.id} className="border-b border-line py-3">
                <p className="font-medium break-words">{draw.winners.join(", ")}</p>
                <p className="text-sm text-muted">
                  {formatWhen(draw.at)} · {draw.poolSize} {draw.poolSize === 1 ? "name" : "names"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-10 max-w-sm text-sm leading-normal text-muted">
        Hosts call it a waffle when the real word gets the post removed.
      </p>
      <div className="h-64" aria-hidden="true" />

      <div className="dock fixed inset-x-0 bottom-0 z-10 border-t border-line bg-paper">
        <div className="mx-auto w-full max-w-lg px-5 pt-3">
          <div className="mb-2 flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm tabular-nums text-muted">
                {entries.length} {entries.length === 1 ? "name" : "names"}
              </p>
              <div className="flex items-center gap-1">
                <span className="mr-1 text-sm text-muted">Spin</span>
                <button
                  type="button"
                  className="btn-press grid size-11 place-items-center rounded-lg border border-line bg-card text-ink disabled:opacity-40"
                  aria-label="Shorter spin"
                  disabled={locked || spinSeconds <= SPIN_MIN}
                  onClick={() => setSpinSeconds(useWaffle.getState().spinSeconds - SPIN_STEP)}
                >
                  <Minus className="size-4" strokeWidth={1.75} aria-hidden="true" />
                </button>
                <span className="w-10 text-center text-base font-medium tabular-nums">{spinSeconds}s</span>
                <button
                  type="button"
                  className="btn-press grid size-11 place-items-center rounded-lg border border-line bg-card text-ink disabled:opacity-40"
                  aria-label="Longer spin"
                  disabled={locked || spinSeconds >= SPIN_MAX}
                  onClick={() => setSpinSeconds(useWaffle.getState().spinSeconds + SPIN_STEP)}
                >
                  <Plus className="size-4" strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-end gap-1">
              <span className="mr-1 text-sm text-muted">Winners</span>
              <button
                type="button"
                className="btn-press grid size-11 place-items-center rounded-lg border border-line bg-card text-ink disabled:opacity-40"
                aria-label="Fewer winners"
                disabled={locked || winnerCount <= 1}
                onClick={() => setWinnerCount(useWaffle.getState().winnerCount - 1)}
              >
                <Minus className="size-4" strokeWidth={1.75} aria-hidden="true" />
              </button>
              <span className="w-10 text-center text-base font-medium tabular-nums">{winnerCount}</span>
              <button
                type="button"
                className="btn-press grid size-11 place-items-center rounded-lg border border-line bg-card text-ink disabled:opacity-40"
                aria-label="More winners"
                disabled={locked || entries.length === 0 || winnerCount >= maxCount}
                onClick={() => setWinnerCount(useWaffle.getState().winnerCount + 1)}
              >
                <Plus className="size-4" strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          </div>
          <button
            type="button"
            className={`${live && settled ? btnQuiet : btnPrimary} w-full`}
            disabled={!canDraw}
            onClick={onDraw}
          >
            {locked ? "On the air" : entries.length === 0 ? "Add names to draw" : live && settled ? "Draw again" : "Draw a winner"}
          </button>
        </div>
      </div>
    </main>
  );
}
