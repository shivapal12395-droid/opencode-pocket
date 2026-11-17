const fs = require("fs");
const p = "assets/app.js";
let s = fs.readFileSync(p, "utf8");
const old = `    body: async (root) => {
      root.innerHTML = '<p class="sheet-note">Loading schedules...</p>';
      let list = [];
      try {
        const res = await state.api.schedules(state.session?.id);`;
const neu = `    body: async (root) => {
      if (!state.session) {
        root.innerHTML = '<p class="sheet-note">Scheduled tasks run inside a session. Open one first, then schedule a prompt against it.</p>';
        return;
      }
      root.innerHTML = '<p class="sheet-note">Loading schedules...</p>';
      let list = [];
      try {
        const res = await state.api.schedules(state.session.id);`;
console.log("found:", s.includes(old));
s = s.replace(old, neu);
fs.writeFileSync(p, s);
console.log("ok:", s.includes("Scheduled tasks run inside a session"));
