const fs = require("fs");
const p = "assets/app.js";
let s = fs.readFileSync(p, "utf8");
const dup = `
              <div class="prefs-foot"><button class="btn btn-ghost" id="plugins-mcp">MCP servers</button></div>\`
          : '<p class="sheet-note">This server reports no plugins.</p>';`;
console.log("dup found:", s.includes(dup));
s = s.replace(dup, `
          : '<p class="sheet-note">This server reports no plugins.</p>';`);
s = s.replace("      });    },", "      });\n    },");
fs.writeFileSync(p, s);
console.log("buttons:", (s.match(/id="plugins-mcp"/g) || []).length);
