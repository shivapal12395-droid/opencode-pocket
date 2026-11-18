/**
 * Build the browser-side rendering libraries into assets/vendor/.
 *
 * The app ships plain files and no bundler at runtime, so these two bundles are
 * generated once and committed: the chat's markdown engine (~840 KB with
 * highlight.js for the languages a model actually writes) and Mermaid (~5 MB),
 * which is a separate file precisely so it is only fetched when a reply
 * contains a diagram.
 *
 *   npm run vendor
 *
 * Mermaid is the one heavy dependency on a phone: keep it lazy, never import it
 * from the main bundle.
 */
import { build } from "esbuild";
import { mkdir, copyFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const OUT = "assets/vendor";

const md = await build({
  entryPoints: ["tools/render/engine.js"],
  outfile: join(OUT, "pocket-md.mjs"),
  bundle: true,
  format: "esm",
  target: ["chrome110"], // Android WebView on arm64 phones
  minify: true,
  legalComments: "none",
  banner: { js: "/* Markdown engine: markdown-it + plugins + KaTeX + highlight.js + DOMPurify. MIT/BSD/MPL; see docs/THIRD-PARTY.md */" },
  metafile: true,
  logLevel: "info",
});

const mermaid = await build({
  entryPoints: ["tools/render/mermaid-entry.js"],
  outfile: join(OUT, "pocket-mermaid.mjs"),
  bundle: true,
  format: "esm",
  target: ["chrome110"],
  minify: true,
  legalComments: "none",
  metafile: true,
  logLevel: "info",
});

/* KaTeX's stylesheet and fonts, next to the bundle so the url()s resolve. */
await mkdir(join(OUT, "fonts"), { recursive: true });
await copyFile("node_modules/katex/dist/katex.min.css", join(OUT, "katex.css"));
const fonts = await readdir("node_modules/katex/dist/fonts");
let copied = 0;
for (const f of fonts) {
  if (!f.endsWith(".woff2")) continue; // woff2 only: the other formats are for old browsers
  await copyFile(join("node_modules/katex/dist/fonts", f), join(OUT, "fonts", f));
  copied += 1;
}

const size = async (p) => Math.round((await stat(p)).size / 1024);
console.log("---");
console.log(`assets/vendor/pocket-md.mjs      ${await size(join(OUT, "pocket-md.mjs"))} KB`);
console.log(`assets/vendor/pocket-mermaid.mjs ${await size(join(OUT, "pocket-mermaid.mjs"))} KB`);
console.log(`assets/vendor/katex.css          ${await size(join(OUT, "katex.css"))} KB + ${copied} woff2 fonts`);
console.log("markdown inputs:", Object.keys(md.metafile?.inputs ?? {}).length, "| mermaid inputs:", Object.keys(mermaid.metafile?.inputs ?? {}).length);
