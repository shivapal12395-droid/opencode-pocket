/**
 * Pocket preferences — local to this app, deliberately separate from the
 * server's opencode.jsonc. Nothing here changes what the agent may do; it only
 * changes how the client presents it.
 */

const KEY = "ocp.prefs";

export const ACCENTS = {
  blue: { accent: "#4f8dfd", soft: "rgba(79,141,253,0.14)", line: "rgba(79,141,253,0.34)" },
  violet: { accent: "#a78bfa", soft: "rgba(167,139,250,0.15)", line: "rgba(167,139,250,0.36)" },
  teal: { accent: "#2dd4bf", soft: "rgba(45,212,191,0.14)", line: "rgba(45,212,191,0.34)" },
  amber: { accent: "#f5b544", soft: "rgba(245,181,68,0.14)", line: "rgba(245,181,68,0.34)" },
  rose: { accent: "#fb7185", soft: "rgba(251,113,133,0.14)", line: "rgba(251,113,133,0.34)" },
  green: { accent: "#4ade80", soft: "rgba(74,222,128,0.14)", line: "rgba(74,222,128,0.34)" },
};

export const DEFAULTS = {
  theme: "system", // system | dark | light | amoled
  accent: "blue",
  fontScale: 1, // 0.92 … 1.2
  codeScale: 1, // 0.9 … 1.25
  density: "comfortable", // comfortable | compact | focus
  timestamps: false,
  toolOpen: false, // start tool cards expanded
  verbosity: "medium", // low | medium | high
  autoScroll: true,
  reducedMotion: false,
  codeWrap: false,
  codeLineNumbers: true,
  keepDraft: true,
  showFollowUps: true,
};

const listeners = new Set();

export function getPrefs() {
  try {
    const raw = localStorage.getItem(KEY);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {}
  applyPrefs(prefs);
  for (const fn of listeners) fn(prefs);
}

export function setPref(name, value) {
  const prefs = getPrefs();
  prefs[name] = value;
  savePrefs(prefs);
  return prefs;
}

export function onPrefs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Push the preferences into the document: CSS variables and data attributes. */
export function applyPrefs(prefs = getPrefs()) {
  const root = document.documentElement;
  root.dataset.density = prefs.density;
  root.dataset.motion = prefs.reducedMotion ? "off" : "on";
  root.dataset.timestamps = prefs.timestamps ? "on" : "off";

  const accent = ACCENTS[prefs.accent] ?? ACCENTS.blue;
  root.style.setProperty("--accent", accent.accent);
  root.style.setProperty("--accent-soft", accent.soft);
  root.style.setProperty("--accent-line", accent.line);

  root.style.setProperty("--font-scale", String(prefs.fontScale));
  root.style.setProperty("--code-scale", String(prefs.codeScale));
  return prefs;
}

export const scaleLabel = (n) => `${Math.round(n * 100)}%`;
export const densityLabel = { comfortable: "Comfortable", compact: "Compact", focus: "Focus" };
export const verbosityLabel = { low: "Low", medium: "Medium", high: "High" };
export const verbosityHint = {
  low: "One row per step, detail on tap",
  medium: "Tool calls grouped, results collapsed",
  high: "Every call and its output inline",
};