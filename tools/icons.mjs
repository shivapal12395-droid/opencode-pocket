/**
 * Generate Pocket's inline SVG sprite from the official `lucide` *vanilla JS*
 * package (pinned in package.json). The app has no runtime bundler, so the
 * icons are emitted as committed `<symbol>` markup in index.html: nothing is
 * fetched from a CDN, no icon JS runs in the WebView, and every glyph is the
 * same Lucide outline at the same stroke width.
 *
 * Only the icons named in ICONS are imported, so the build pulls in exactly
 * what the UI uses. `logo` and `github` are brand marks, not UI icons: their
 * hand-written symbols are preserved verbatim between the sprite markers.
 *
 *   node tools/icons.mjs             regenerate index.html
 *   node tools/icons.mjs --check     fail if the committed sprite is stale
 */
import { readFile, writeFile } from "node:fs/promises";
import {
  Archive,
  AtSign,
  Blocks,
  BookOpen,
  Brain,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Cpu,
  Diff,
  Download,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Image,
  KeyRound,
  Library,
  ListOrdered,
  Maximize2,
  MessageCircleQuestion,
  Mic,
  MoreHorizontal,
  Palette,
  Paperclip,
  PlugZap,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Square,
  SquarePen,
  Terminal,
  Trash2,
  Undo2,
  Wifi,
  Wrench,
  WrapText,
  X,
} from "lucide";

const VERSION = "1.75.0";
const START = "<!-- LUCIDE SPRITE START -->";
const END = "<!-- LUCIDE SPRITE END -->";

// Pocket sprite id -> Lucide icon node. Aliases (mic/retry/customize/...) give
// a new semantic call site its own id without duplicating path data.
const ICONS = {
  archive: Archive,
  at: AtSign,
  attach: Paperclip,
  back: ChevronLeft,
  book: BookOpen,
  brain: Brain,
  branch: GitBranch,
  check: Check,
  chevron: ChevronRight,
  code: Code2,
  copy: Copy,
  cpu: Cpu,
  customize: Palette,
  diff: Diff,
  download: Download,
  edit: SquarePen,
  expand: Maximize2,
  file: FileText,
  folder: Folder,
  image: Image,
  projects: FolderOpen,
  key: KeyRound,
  library: Library,
  mic: Mic,
  more: MoreHorizontal,
  permission: ShieldCheck,
  plug: PlugZap,
  plus: Plus,
  print: Printer,
  providers: Blocks,
  queue: ListOrdered,
  question: MessageCircleQuestion,
  refresh: RefreshCw,
  retry: RotateCcw,
  rotate: RotateCcw,
  save: Save,
  scheduled: CalendarClock,
  search: Search,
  send: Send,
  settings: Settings,
  share: Share2,
  shield: ShieldCheck,
  spark: Sparkles,
  stop: Square,
  terminal: Terminal,
  trash: Trash2,
  undo: Undo2,
  wifi: Wifi,
  wrap: WrapText,
  wrench: Wrench,
  x: X,
};

const escape = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const symbol = (id, node) => {
  const body = node
    .map(([tag, attrs]) => {
      const props = Object.entries(attrs ?? {})
        .map(([key, value]) => ` ${key}="${escape(value)}"`)
        .join("");
      return `<${tag}${props} />`;
    })
    .join("");
  return `      <symbol id="i-${id}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`;
};

const source = await readFile("index.html", "utf8");
const start = source.indexOf(START);
const end = source.indexOf(END);
if (start < 0 || end < 0) throw new Error("index.html is missing the Lucide sprite markers");

const previous = source.slice(start, end);
const brands = [...previous.matchAll(/<symbol id="i-(?:logo|github)"[\s\S]*?<\/symbol>/g)].map((m) =>
  m[0].replace(/^ {6}/gm, "      ").trim()
);
if (brands.length !== 2) throw new Error("expected the two preserved brand symbols in the sprite");

const lines = [
  START,
  "    <!-- Generated from lucide " + VERSION + " (ISC) by tools/icons.mjs. See docs/THIRD-PARTY.md. -->",
  '    <svg class="sprite" aria-hidden="true">',
  ...brands.map((b) => `      ${b}`),
  ...Object.entries(ICONS).map(([id, node]) => symbol(id, node)),
  "    </svg>",
  END,
].join("\n");

const output = source.slice(0, start) + lines + source.slice(end + END.length);
const checking = process.argv.includes("--check");
if (checking) {
  if (output !== source) {
    console.error("Lucide sprite is stale. Run: node tools/icons.mjs");
    process.exit(1);
  }
  console.log(`Lucide sprite up to date (${Object.keys(ICONS).length} icons, lucide ${VERSION})`);
} else {
  await writeFile("index.html", output);
  console.log(`Wrote ${Object.keys(ICONS).length} Lucide icons (+2 brand marks) into index.html`);
}
