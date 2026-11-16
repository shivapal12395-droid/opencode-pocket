#!/usr/bin/env node
/**
 * Tiny zero-dependency static server for OpenCode Pocket.
 * Usage: node server.mjs [--port 8099] [--host 127.0.0.1]
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const port = Number(arg("--port", process.env.PORT || 8099));
const host = arg("--host", process.env.HOST || "127.0.0.1");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const joined = path.join(ROOT, decoded === "/" ? "index.html" : decoded);
  const resolved = path.resolve(joined);
  if (!resolved.startsWith(ROOT)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  let file = safePath(req.url || "/");
  if (!file) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const headers = {
    "content-type": MIME[ext] || "application/octet-stream",
    "cache-control": ext === ".html" ? "no-cache" : "no-cache",
    "x-content-type-options": "nosniff",
  };
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
});

server.listen(port, host, () => {
  const shown = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  console.log(`\n  OpenCode Pocket\n  → http://${shown}:${port}\n`);
  if (host === "0.0.0.0") {
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
      for (const a of addrs || []) {
        if (a.family === "IPv4" && !a.internal) console.log(`  → http://${a.address}:${port}  (${name})`);
      }
    }
    console.log("");
  }
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
