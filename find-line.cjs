const fs = require("fs");
const s = fs.readFileSync("assets/app.js", "utf8");
let idx = -1, n = 0;
while ((idx = s.indexOf("Loading worktrees", idx + 1)) >= 0) {
  n++;
  const start = s.lastIndexOf("\n", idx) + 1;
  const end = s.indexOf("\n", idx);
  const line = s.slice(start, end);
  console.log(n, JSON.stringify(line));
}
console.log("count", n);
