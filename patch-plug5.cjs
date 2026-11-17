const fs = require("fs");
const p = "assets/app.js";
let s = fs.readFileSync(p, "utf8");
const old = '+ `</div>\n          : \'<p class="sheet-note">This server reports no plugins.</p>\';';
const neu = '+ `</div>`\n          : \'<p class="sheet-note">This server reports no plugins.</p>\';';
console.log("found:", s.includes(old));
s = s.replace(old, neu);
fs.writeFileSync(p, s);
