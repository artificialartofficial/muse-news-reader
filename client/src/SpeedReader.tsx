import {
useCallback,
useEffect,
useLayoutEffect,
useMemo,
useRef,
useState,
type CSSProperties,
} from "react";

// Speed reader built into News, ported from the standalone Speed Reader
// app (whose rendering fixes are preserved here): glyphs are NEVER
// transformed — no per-word scaling and no horizontal condensing. One
// fitted size is measured once per article and used for every word, in
// the font's natural proportions; only the sideways shift that puts the
// pivot letter on the centre guide changes from flash to flash.

export type SpeedPrefs = {
  wpm: number;
  wordsPerFlash: number;
  fontSize: number;
  smartPacing: boolean;
};

const DEFAULT_PREFS: SpeedPrefs = {
  wpm: 350,
  wordsPerFlash: 1,
  fontSize: 56,
  smartPacing: true,
};

const PREFS_KEY = "news-speed-reader-prefs-v1";
const posKey = (id: number) => `news-speed-reader-pos-${id}`;

export function loadSpeedPrefs(): SpeedPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<SpeedPrefs>;
    return {
      wpm: typeof parsed.wpm === "number" ? Math.min(1000, Math.max(100, parsed.wpm)) : DEFAULT_PREFS.wpm,
      wordsPerFlash: parsed.wordsPerFlash === 2 || parsed.wordsPerFlash === 3 ? parsed.wordsPerFlash : 1,
      fontSize: typeof parsed.fontSize === "number" ? Math.min(84, Math.max(36, parsed.fontSize)) : DEFAULT_PREFS.fontSize,
      smartPacing: typeof parsed.smartPacing === "boolean" ? parsed.smartPacing : true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function saveSpeedPrefs(p: SpeedPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

/** Convert the article reader's sanitized HTML body to plain text with
 * paragraph breaks preserved, for tokenizing. */
export function htmlToPlainText(html: string | null, fallback: string | null): string {
  if (!html) return fallback ?? "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const blocks = doc.body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, div");
    const parts: string[] = [];
    blocks.forEach((el) => {
      // Only leaf-ish blocks: skip containers whose children are also blocks.
      if (el.querySelector("p, div, ul, ol, blockquote")) return;
      const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t) parts.push(t);
    });
    const text = parts.length ? parts.join("\n\n") : (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
    return text || (fallback ?? "");
  } catch {
    return fallback ?? "";
  }
}

// ---------- Tokenizing & RSVP math ----------

type Token = { text: string; paraBreakBefore: boolean };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const paras = text.split(/\n\s*\n/);
  paras.forEach((para, pi) => {
    const words = para.trim().split(/\s+/).filter(Boolean);
    words.forEach((w, wi) => {
      tokens.push({ text: w, paraBreakBefore: pi > 0 && wi === 0 });
    });
  });
  return tokens;
}

function orpIndex(word: string): number {
  const lead = word.match(/^[^A-Za-z0-9À-ÿ]*/)?.[0].length ?? 0;
  const len = Math.max(1, word.length - lead);
  let base: number;
  if (len <= 1) base = 0;
  else if (len <= 5) base = 1;
  else if (len <= 9) base = 2;
  else if (len <= 13) base = 3;
  else base = 4;
  return Math.min(lead + base, word.length - 1);
}

function paceMultiplier(tok: Token, next: Token | undefined): number {
  let m = 1;
  const w = tok.text;
  if (/[.!?…]["'”’)\]]?$/.test(w)) m = 2;
  else if (/[,;:]["'”’)\]]?$/.test(w)) m = 1.5;
  else if (/—$/.test(w)) m = 1.4;
  if (w.replace(/[^A-Za-z0-9À-ÿ]/g, "").length >= 9) m *= 1.2;
  if (next?.paraBreakBefore) m *= 1.8;
  return m;
}

function fmtTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const s = Math.round(totalSeconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  return `${m}:${String(r).padStart(2, "0")}`;
}

// ---------- One fitted size per article ----------

const FIT_REFERENCE = 100;
const SINGLE_LS = 0.045;
const MULTI_LS = 0.035;
const PIVOT_ACCENT = "#e4572e";
const STAGE_BG = "#101012";
const STAGE_TEXT = "#f5f2ea";
const STAGE_DIM = "#8a877f";

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer(): CanvasRenderingContext2D | null {
  if (measureCtx) return measureCtx;
  if (typeof document === "undefined") return null;
  const ctx = document.createElement("canvas").getContext("2d");
  if (ctx) {
    ctx.font = `500 ${FIT_REFERENCE}px "Literata", Georgia, serif`;
    measureCtx = ctx;
  }
  return ctx;
}

function wordWidthAtRef(word: string, lsEm: number): number {
  const ctx = measurer();
  if (!ctx) return word.length * FIT_REFERENCE * 0.5;
  return ctx.measureText(word).width + lsEm * FIT_REFERENCE * word.length;
}

function pivotCenterAtRef(word: string, lsEm: number): number {
  const ctx = measurer();
  const pivot = orpIndex(word);
  if (!ctx) {
    return ((pivot + 0.5) / Math.max(1, word.length)) * wordWidthAtRef(word, lsEm);
  }
  const left = ctx.measureText(word.slice(0, pivot)).width + lsEm * FIT_REFERENCE * pivot;
  const glyph = ctx.measureText(word.slice(pivot, pivot + 1)).width;
  return left + glyph / 2;
}

function fittedFontSize(tokens: Token[], chunkSize: number, userSize: number, stageWidth: number): number {
  if (stageWidth <= 0 || tokens.length === 0) return userSize;
  let fitted: number;
  if (chunkSize === 1) {
    const ls = SINGLE_LS;
    const sides: number[] = [];
    for (const t of tokens) {
      const w = wordWidthAtRef(t.text, ls);
      const c = pivotCenterAtRef(t.text, ls);
      sides.push(Math.max(c, w - c));
    }
    sides.sort((a, b) => a - b);
    const idx = Math.min(sides.length - 1, Math.floor(sides.length * 0.975));
    const sideEm = (sides[idx] ?? 0) / FIT_REFERENCE;
    if (sideEm <= 0) return userSize;
    fitted = (stageWidth / 2) * 0.98 / sideEm;
  } else {
    const ls = MULTI_LS;
    let maxChunkEm = 0;
    for (let i = 0; i < tokens.length; i += chunkSize) {
      const group = tokens.slice(i, i + chunkSize);
      const w = group.reduce((sum, t) => sum + wordWidthAtRef(t.text, ls), 0) + 40 * Math.max(0, group.length - 1);
      maxChunkEm = Math.max(maxChunkEm, w / FIT_REFERENCE);
    }
    if (maxChunkEm <= 0) return userSize;
    fitted = stageWidth * 0.94 / maxChunkEm;
  }
  return Math.max(18, Math.min(userSize, Math.floor(fitted)));
}

// ---------- The flashing word ----------

function SingleWord({ word, fontSize }: { word: string; fontSize: number }) {
  const pivot = orpIndex(word);
  const left = word.slice(0, pivot);
  const mid = word.slice(pivot, pivot + 1);
  const right = word.slice(pivot + 1);
  const wordRef = useRef<HTMLDivElement>(null);
  const pivotRef = useRef<HTMLSpanElement>(null);
  const [offsetPct, setOffsetPct] = useState(() => ((pivot + 0.5) / Math.max(1, word.length)) * 100);

  useLayoutEffect(() => {
    const measure = () => {
      const wEl = wordRef.current;
      const pEl = pivotRef.current;
      if (!wEl || !pEl) return;
      const wRect = wEl.getBoundingClientRect();
      const pRect = pEl.getBoundingClientRect();
      if (wRect.width <= 0) return;
      const pct = ((pRect.left - wRect.left + pRect.width / 2) / wRect.width) * 100;
      setOffsetPct((prev) => (Math.abs(prev - pct) > 0.05 ? pct : prev));
    };
    measure();
    window.addEventListener("resize", measure);
    let cancelled = false;
    document.fonts?.ready.then(() => { if (!cancelled) measure(); }).catch(() => undefined);
    return () => { cancelled = true; window.removeEventListener("resize", measure); };
  }, [word, fontSize]);

  return (
    <div className="relative w-full" style={{ fontFamily: "'Literata', Georgia, serif", fontSize, height: "1.45em", lineHeight: 1.3 }} aria-label={word}>
      <div ref={wordRef} className="absolute whitespace-nowrap" style={{ left: "50%", top: "50%", fontWeight: 500, letterSpacing: "0.045em", transform: `translate(calc(-1 * ${offsetPct}%), -50%)` }}>
        <span>{left}</span>
        <span ref={pivotRef} style={{ color: PIVOT_ACCENT }}>{mid}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

function WordDisplay({ tokens, fontSize }: { tokens: Token[]; fontSize: number }) {
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return <SingleWord word={tokens[0]?.text ?? ""} fontSize={fontSize} />;
  const first = tokens[0]?.text ?? "";
  const pivot = orpIndex(first);
  return (
    <div className="flex w-full flex-wrap items-baseline justify-center gap-x-[0.4em] px-3 text-center" style={{ fontFamily: "'Literata', Georgia, serif", fontSize, fontWeight: 500, letterSpacing: "0.035em", lineHeight: 1.35 }} aria-label={tokens.map((t) => t.text).join(" ")}>
      <span className="whitespace-nowrap">
        {first.slice(0, pivot)}
        <span style={{ color: PIVOT_ACCENT }}>{first.slice(pivot, pivot + 1)}</span>
        {first.slice(pivot + 1)}
      </span>
      {tokens.slice(1).map((t, i) => (
        <span key={i} className="whitespace-nowrap">{t.text}</span>
      ))}
    </div>
  );
}

// ---------- Speed reader overlay ----------

export function SpeedReader({ articleId, title, subtitle, text, onBack }: { articleId: number; title: string; subtitle?: string; text: string; onBack: () => void }) {
  const tokens = useMemo(() => tokenize(text), [text]);
  const total = tokens.length;
  const initialPrefs = useMemo(loadSpeedPrefs, []);
  const [index, setIndex] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(posKey(articleId)) ?? "0");
      return Number.isFinite(saved) ? Math.min(Math.max(0, saved), Math.max(0, total - 1)) : 0;
    } catch { return 0; }
  });
  const [playing, setPlaying] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [wpm, setWpm] = useState(initialPrefs.wpm);
  const [chunk, setChunk] = useState(initialPrefs.wordsPerFlash);
  const [fontSize, setFontSize] = useState(initialPrefs.fontSize);
  const [smartPacing, setSmartPacing] = useState(initialPrefs.smartPacing);

  // Persist position (debounced) and prefs.
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(posKey(articleId), String(done ? 0 : index)); } catch { /* ignore */ }
    }, 600);
    return () => clearTimeout(t);
  }, [index, done, articleId]);
  useEffect(() => {
    const t = setTimeout(() => saveSpeedPrefs({ wpm, wordsPerFlash: chunk, fontSize, smartPacing }), 400);
    return () => clearTimeout(t);
  }, [wpm, chunk, fontSize, smartPacing]);

  const finish = useCallback(() => {
    setPlaying(false);
    setDone(true);
    setIndex(Math.max(0, total - 1));
  }, [total]);

  useEffect(() => {
    if (!playing || countdown !== null) return;
    const current = tokens[Math.min(index + chunk - 1, total - 1)];
    if (!current) return;
    const next = tokens[index + chunk];
    const mult = smartPacing ? paceMultiplier(current, next) : 1;
    const delay = ((60_000 * chunk) / Math.max(50, wpm)) * mult;
    const t = setTimeout(() => {
      setIndex((i) => {
        const n = i + chunk;
        if (n >= total) { finish(); return i; }
        return n;
      });
    }, delay);
    return () => clearTimeout(t);
  }, [playing, countdown, index, chunk, wpm, smartPacing, tokens, total, finish]);

  useEffect(() => {
    if (countdown === null) return;
    const t = setTimeout(() => {
      setCountdown((c) => {
        if (c === null) return null;
        if (c <= 1) { setPlaying(true); return null; }
        return c - 1;
      });
    }, 550);
    return () => clearTimeout(t);
  }, [countdown]);

  const startPlay = useCallback(() => {
    if (done) { setDone(false); setIndex(0); setCountdown(3); return; }
    if (index <= 0) setCountdown(3); else setPlaying(true);
  }, [done, index]);

  const togglePlay = useCallback(() => {
    if (countdown !== null) { setCountdown(null); return; }
    if (playing) setPlaying(false); else startPlay();
  }, [playing, countdown, startPlay]);

  const seek = useCallback((n: number) => {
    const clamped = Math.max(0, Math.min(total - 1, n));
    setIndex(clamped);
    if (done && clamped < total - 1) setDone(false);
  }, [total, done]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); seek(index + 10); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); seek(index - 10); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setWpm((w) => Math.min(1000, w + 25)); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setWpm((w) => Math.max(100, w - 25)); }
      else if (e.key === "Escape") { e.preventDefault(); onBack(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seek, index, onBack]);

  const wordAreaRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    const el = wordAreaRef.current;
    if (!el) return;
    const update = () => setStageWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => { if (live) setFontsReady(true); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const fittedSize = useMemo(() => {
    void fontsReady;
    return fittedFontSize(tokens, chunk, fontSize, stageWidth);
  }, [tokens, chunk, fontSize, stageWidth, fontsReady]);

  const chunkTokens = tokens.slice(index, index + chunk);
  const progress = total > 0 ? (done ? 100 : Math.round((index / total) * 100)) : 0;
  const wordsLeft = done ? 0 : total - index;
  const secondsLeft = (wordsLeft / Math.max(50, wpm)) * 60;
  const totalSeconds = (total / Math.max(50, wpm)) * 60;
  const contextBefore = tokens.slice(Math.max(0, index - 7), index);
  const contextAfter = tokens.slice(index + chunk, index + chunk + 7);
  const stageStyle: CSSProperties = { backgroundColor: STAGE_BG, color: STAGE_TEXT };

  if (total === 0) {
    return (
      <div className="speed-reader-overlay" role="dialog" aria-modal="true" aria-label="Speed reader">
        <div className="speed-reader-inner">
          <header className="speed-reader-head">
            <button type="button" onClick={onBack} aria-label="Back to article" className="speed-circle-btn">←</button>
            <div className="min-w-0"><h2 className="truncate">{title}</h2></div>
          </header>
          <div className="speed-empty">
            <p>This article has no readable text to speed read.</p>
            <p>Open the original at the source, or read it in the normal reader.</p>
            <button type="button" onClick={onBack} className="speed-primary-btn">Back to article</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="speed-reader-overlay" role="dialog" aria-modal="true" aria-label={`Speed reader: ${title}`}>
      <div className="speed-reader-inner">
        <header className="speed-reader-head">
          <button type="button" onClick={onBack} aria-label="Back to article" className="speed-circle-btn">←</button>
          <div className="min-w-0">
            <h2 className="truncate">{title}</h2>
            <p>{subtitle ? `${subtitle} · ` : ""}{total.toLocaleString()} words · about {fmtTime(totalSeconds)} at {wpm} WPM</p>
          </div>
        </header>

        <div className="speed-stage" style={stageStyle} onClick={togglePlay} role="button" aria-label={playing ? "Pause speed reading" : "Start speed reading"}>
          <div aria-hidden className="speed-guide-line" />
          <div aria-hidden className="speed-guide-tick top" style={{ backgroundColor: PIVOT_ACCENT }} />
          <div aria-hidden className="speed-guide-tick bottom" style={{ backgroundColor: PIVOT_ACCENT }} />
          <div ref={wordAreaRef} className="speed-word-area">
            {countdown !== null ? (
              <span className="speed-countdown" style={{ color: PIVOT_ACCENT }} aria-label={`Starting in ${countdown}`}>{countdown}</span>
            ) : done ? (
              <div className="speed-done">
                <p>Finished</p>
                <span style={{ color: STAGE_DIM }}>{total.toLocaleString()} words at {wpm} WPM</span>
              </div>
            ) : (
              <WordDisplay tokens={chunkTokens} fontSize={fittedSize} />
            )}
          </div>
          {!done && countdown === null && (
            <div className="speed-paused-row" aria-hidden={playing}>
              {!playing && <span className="speed-paused-pill">{index > 0 ? "Paused — tap to resume" : "Tap to start"}</span>}
            </div>
          )}
          {!done && countdown === null && (
            <p className="speed-context" style={{ color: STAGE_DIM }} aria-hidden>
              {contextBefore.map((t) => t.text).join(" ")}{" "}
              <span style={{ color: STAGE_TEXT }}>{chunkTokens.map((t) => t.text).join(" ")}</span>{" "}
              {contextAfter.map((t) => t.text).join(" ")}
            </p>
          )}
        </div>

        <div className="speed-progress">
          <input type="range" aria-label="Speed reading position" min={0} max={Math.max(0, total - 1)} value={index} onChange={(e) => seek(Number(e.target.value))} style={{ accentColor: PIVOT_ACCENT }} />
          <div>
            <span>Word {(done ? total : Math.min(index + 1, total)).toLocaleString()} of {total.toLocaleString()}</span>
            <span>{progress}%</span>
            <span>{done ? "Done" : `${fmtTime(secondsLeft)} left`}</span>
          </div>
        </div>

        <div className="speed-transport">
          <button type="button" aria-label="Restart speed reading from beginning" onClick={() => { setPlaying(false); setCountdown(null); setDone(false); setIndex(0); }} className="speed-circle-btn">⏮</button>
          <button type="button" aria-label="Back 10 words" onClick={() => seek(index - 10)} className="speed-circle-btn text-sm font-semibold">−10</button>
          <button type="button" aria-label={playing || countdown !== null ? "Pause speed reading" : "Play speed reading"} onClick={togglePlay} className="speed-play-btn" style={{ backgroundColor: PIVOT_ACCENT }}>{playing || countdown !== null ? "⏸" : "▶"}</button>
          <button type="button" aria-label="Forward 10 words" onClick={() => seek(index + 10)} className="speed-circle-btn text-sm font-semibold">+10</button>
          <button type="button" aria-label="Toggle speed reader settings" aria-expanded={showSettings} onClick={() => setShowSettings((s) => !s)} className="speed-circle-btn">⚙</button>
        </div>

        <div className="speed-wpm-row">
          <button type="button" aria-label="Decrease speed by 25 words per minute" onClick={() => setWpm((w) => Math.max(100, w - 25))} className="speed-circle-btn small">−</button>
          <input type="range" aria-label="Words per minute" min={100} max={1000} step={25} value={wpm} onChange={(e) => setWpm(Number(e.target.value))} style={{ accentColor: PIVOT_ACCENT }} />
          <button type="button" aria-label="Increase speed by 25 words per minute" onClick={() => setWpm((w) => Math.min(1000, w + 25))} className="speed-circle-btn small">+</button>
          <span className="speed-wpm-label">{wpm} WPM</span>
        </div>

        <div className="speed-presets">
          {[250, 350, 450, 600, 800].map((p) => (
            <button key={p} type="button" aria-label={`Set speed to ${p} words per minute`} aria-pressed={wpm === p} onClick={() => setWpm(p)} className={wpm === p ? "speed-preset active" : "speed-preset"} style={wpm === p ? { backgroundColor: PIVOT_ACCENT, color: "#fff", borderColor: PIVOT_ACCENT } : undefined}>{p}</button>
          ))}
        </div>

        {showSettings && (
          <div className="speed-settings">
            <div>
              <p>Words per flash</p>
              <div className="speed-settings-row" role="group" aria-label="Words per flash">
                {[1, 2, 3].map((n) => (
                  <button key={n} type="button" aria-label={`${n} word${n > 1 ? "s" : ""} per flash`} aria-pressed={chunk === n} onClick={() => setChunk(n)} className={chunk === n ? "active" : ""} style={chunk === n ? { backgroundColor: PIVOT_ACCENT, color: "#fff", borderColor: PIVOT_ACCENT } : undefined}>{n}</button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="speed-font-size">Word size · {fontSize}px</label>
              <input id="speed-font-size" type="range" min={36} max={84} step={4} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} style={{ accentColor: PIVOT_ACCENT }} />
              <p className="speed-settings-note">Word size is a maximum: an article with very long words uses one slightly smaller size for the whole article, so every word stays the same size.</p>
            </div>
            <label className="speed-pacing">
              <span>Smart pacing <small>Longer pauses at sentences, commas, and paragraph breaks</small></span>
              <input type="checkbox" aria-label="Smart pacing" checked={smartPacing} onChange={(e) => setSmartPacing(e.target.checked)} style={{ accentColor: PIVOT_ACCENT }} />
            </label>
            <p className="speed-settings-note">Keys: space plays or pauses, arrow keys skip 10 words or change speed, Esc returns to the article.</p>
          </div>
        )}

        {done && <button type="button" onClick={onBack} className="speed-primary-btn" style={{ backgroundColor: PIVOT_ACCENT }}>Back to article</button>}
      </div>
    </div>
  );
}
