const fs = require("fs");
const p = "assets/app.js";
let s = fs.readFileSync(p, "utf8");
const call = "const res = await state.api.schedules(state.session?.id);";
const i = s.indexOf(call);
console.log("call at", i);
if (i < 0) process.exit(1);
// walk back to the "body: async (root) => {" line of this sheet
const bodyMark = "body: async (root) => {";
const b = s.lastIndexOf(bodyMark, i);
console.log("body at", b);
const insertAt = b + bodyMark.length;
const guard = `
      if (!state.session) {
        root.innerHTML = '<p class="sheet-note">Scheduled tasks run inside a session. Open one first, then schedule a prompt against it.</p>';
        return;
      }`;
s = s.slice(0, insertAt) + guard + s.slice(insertAt);
s = s.replace(call, "const res = await state.api.schedules(state.session.id);");
fs.writeFileSync(p, s);
console.log("guard:", s.includes("Scheduled tasks run inside a session"));
