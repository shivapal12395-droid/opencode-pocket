const fs = require("fs");
const p = "assets/app.js";
let s = fs.readFileSync(p, "utf8");
s = s.replace('title: "GUI plugins",', 'title: "Plugins",');
const anchor = "Could not load plugins";
const i = s.indexOf(anchor);
if (i < 0) { console.log("no anchor"); process.exit(1); }
// the catch block closes with "\n      }\n" right after the template line
const close = s.indexOf("\n      }\n", i);
console.log("catch close at", close);
const insert = `
      root.insertAdjacentHTML("beforeend", '<div class="prefs-foot"><button class="btn btn-ghost" id="plugins-mcp">MCP servers</button></div>');
      root.addEventListener("click", (e) => {
        if (!e.target.closest("#plugins-mcp")) return;
        closeSheet();
        setTimeout(() => openMcpSheet(), 200);
      });`;
s = s.slice(0, close + "\n      }\n".length) + insert + s.slice(close + "\n      }\n".length);
fs.writeFileSync(p, s);
console.log("title:", s.includes('title: "Plugins",'), "handler:", s.includes("plugins-mcp"));
