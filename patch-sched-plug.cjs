const fs = require("fs");
const p = "assets/app.js";
let s = fs.readFileSync(p, "utf8");

// Schedules: the endpoint needs a sessionID; without one it answers 400.
const schOld = `      root.innerHTML = '<p class="sheet-note">Loading schedules...';
      let list = [];
      try {
        const res = await state.api.schedules(state.session?.id);`;
const schNew = `      if (!state.session) {
        root.innerHTML = '<p class="sheet-note">Scheduled tasks run inside a session. Open one first, then schedule a prompt against it.</p>';
        return;
      }
      root.innerHTML = '<p class="sheet-note">Loading schedules...';
      let list = [];
      try {
        const res = await state.api.schedules(state.session.id);`;
console.log("schedules anchor:", s.includes(schOld));
s = s.replace(schOld, schNew);

// Plugins: /api/plugin/gui is per plugin (it demands ?id=), /api/plugin is the list.
const plugOld = `        const res = await state.api.guiPlugins();
        const list = res?.data ?? res ?? [];
        root.innerHTML = list.length
          ? '<div class="sheet-list">' + list.map((p) => \`<div class="sheet-item"><span class="si-text">
              <span class="si-title">\${escapeHtml(p.name || p.id)}</span>
              <span class="si-sub">\${p.enabled === false ? "disabled" : "enabled"} · \${escapeHtml(p.id)}</span></span></div>\`).join("") + "</div>"
          : '<p class="sheet-note">This server exposes no GUI plugins.</p>';`;
const plugNew = `        const res = await state.api.plugins();
        const list = res?.data ?? res ?? [];
        root.innerHTML = list.length
          ? \`<div class="sheet-list">\` + list.map((p) => \`<div class="sheet-item"><span class="si-icon">\${icon("plug")}</span><span class="si-text">
              <span class="si-title">\${escapeHtml(p.id)}</span>
              <span class="si-sub">\${escapeHtml(p.source?.type ?? "plugin")}\${p.state?.status ? " · " + escapeHtml(String(p.state.status)) : ""}</span></span></div>\`).join("") + \`</div>
              <div class="prefs-foot"><button class="btn btn-ghost" id="plugins-mcp">MCP servers</button></div>\`
          : '<p class="sheet-note">This server reports no plugins.</p>';`;
console.log("plugins anchor:", s.includes(plugOld));
s = s.replace(plugOld, plugNew);
fs.writeFileSync(p, s);
