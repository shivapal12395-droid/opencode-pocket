const fs = require("fs");
const s = fs.readFileSync("assets/app.js", "utf8");
const i = s.indexOf("Loading worktrees");
const start = s.lastIndexOf("\n", i) + 1;
const end = s.indexOf("\n", i);
const line = s.slice(start, end);
console.log("len", line.length, "codes", [...line.slice(0, 12)].map(c => c.charCodeAt(0)).join(","));
console.log("eq to plain:", line === "      root.innerHTML = '<p class=\"sheet-note\">Loading worktrees...</p>';");
const target = "      root.innerHTML = '<p class=\"sheet-note\">Loading worktrees...</p>';";
console.log("target len", target.length);
for (let k = 0; k < Math.min(line.length, target.length); k++) {
  if (line[k] !== target[k]) { console.log("diff at", k, JSON.stringify(line[k]), JSON.stringify(target[k]), line.charCodeAt(k), target.charCodeAt(k)); break; }
}
