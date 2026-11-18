/**
 * Mermaid, kept in its own bundle.
 *
 * The chat imports this file only when a reply actually contains a diagram
 * (`pre.mermaid`), so a normal answer never pays for ~2 MB of diagram engine.
 * Drawing is themed from the app's own CSS variables, so a diagram looks like
 * part of the transcript instead of a screenshot from somewhere else.
 */
import mermaid from "mermaid";

/** Resolve any CSS colour expression (including var() and color-mix) to rgb(). */
function readColor(expr, fallback) {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;left:-9999px;top:0;color:${expr}`;
  document.body.appendChild(probe);
  let out = getComputedStyle(probe).color;
  probe.remove();
  const m = out.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
  if (m) {
    const [r, g, b] = [1, 2, 3].map((i) => Math.round(+m[i] * 255));
    out = m[4] != null ? `rgba(${r}, ${g}, ${b}, ${m[4]})` : `rgb(${r}, ${g}, ${b})`;
  }
  return out || fallback;
}

let configured = "";

/** Theme mermaid from the live palette. Cheap, and re-run when the theme flips. */
export function configureMermaid() {
  const dark = document.documentElement.dataset.theme !== "light";
  const key = `${document.documentElement.dataset.theme}:${getComputedStyle(document.documentElement).getPropertyValue("--accent")}`;
  if (key === configured) return;
  configured = key;

  const fg = readColor("var(--text)", "#e5e7eb");
  const bg = readColor("var(--elev)", "#0b0b0f");
  const muted = readColor("var(--muted)", "#94a3b8");
  const fill = readColor("color-mix(in srgb, var(--accent) 18%, var(--elev))", "#1e293b");
  const fill2 = readColor("color-mix(in srgb, var(--accent) 9%, var(--elev))", "#111827");
  const border = readColor("color-mix(in srgb, var(--accent) 55%, var(--elev))", "#475569");

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict", // no click handlers, no script from a diagram source
    theme: "base",
    fontFamily: getComputedStyle(document.body).fontFamily,
    flowchart: { curve: "basis", htmlLabels: true, padding: 12 },
    themeVariables: {
      darkMode: dark,
      background: bg,
      primaryColor: fill,
      mainBkg: fill,
      primaryBorderColor: border,
      nodeBorder: border,
      primaryTextColor: fg,
      textColor: fg,
      secondaryColor: fill2,
      tertiaryColor: fill2,
      secondaryBorderColor: border,
      tertiaryBorderColor: border,
      lineColor: muted,
      edgeLabelBackground: bg,
      clusterBkg: fill2,
      clusterBorder: border,
      noteBkgColor: fill2,
      noteBorderColor: border,
      noteTextColor: fg,
      actorBkg: fill,
      actorBorder: border,
      actorTextColor: fg,
      signalColor: muted,
      signalTextColor: fg,
      labelBoxBkgColor: fill,
      labelBoxBorderColor: border,
      labelTextColor: fg,
      activationBkgColor: fill2,
    },
  });
}

/**
 * Draw one diagram and return its SVG. The caller decides when (on scroll, and
 * never mid-turn) and keeps a cache; this function only owns the drawing.
 */
export async function drawOne(node, source) {
  const src = String(source ?? "").trim();
  if (!src) throw new Error("this diagram is empty");
  configureMermaid();
  const id = `pocket-mermaid-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const { svg } = await mermaid.render(id, src);
    node.__mermaidSource = src;
    node.innerHTML = svg;
    node.classList.add("drawn");
    return svg;
  } finally {
    // Mermaid measures in a temporary element with a `d`-prefixed id. Remove
    // that, and never the rendered SVG itself (its id is `id`).
    document.getElementById("d" + id)?.remove();
  }
}

export { mermaid };
