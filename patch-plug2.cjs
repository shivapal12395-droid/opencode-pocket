const fs = require("fs");
const p = "assets/app.js";
let s = fs.readFileSync(p, "utf8");
const old = `async function openPluginsSheet() {
  openSheet({
    kind: "plugins",
    title: "GUI plugins",
    body: async (root) => {
      root.innerHTML = '<p class="sheet-note">Loading plugins...</p>';
      try {
        const res = await state.api.plugins();
        const list = res?.data ?? res ?? [];
        root.innerHTML = list.length
          ? \`<div class="sheet-list">\` + list.map((p) => \`<div class="sheet-item"><span class="si-icon">\${icon("plug")}</span><span class="si-text">
              <span class="si-title">\${escapeHtml(p.id)}</span>
              <span class="si-sub">\${escapeHtml(p.source?.type ?? "plugin")}\${p.state?.status ? " · " + escapeHtml(String(p.state.status)) : ""}</span></span></div>\`).join("") + \`</div>
              <div class="prefs-foot"><button class="btn btn-ghost" id="plugins-mcp">MCP servers</button></div>\`
          : '<p class="sheet-note">This server reports no plugins.</p>';
      } catch (err) {
        root.innerHTML = \`<p class="sheet-note">\${escapeHtml(err.message || "Could not load plugins")}</p>\`;
      }
    },
  });
}`;
const neu = `async function openPluginsSheet() {
  openSheet({
    kind: "plugins",
    title: "Plugins",
    body: async (root) => {
      root.innerHTML = '<p class="sheet-note">Loading plugins...</p>';
      try {
        const res = await state.api.plugins();
        const list = res?.data ?? res ?? [];
        root.innerHTML =
          (list.length
            ? \`<div class="sheet-list">\` +
              list
                .map(
                  (p) => \`<div class="sheet-item"><span class="si-icon">\${icon("plug")}</span><span class="si-text">
                <span class="si-title">\${escapeHtml(p.id)}</span>
                <span class="si-sub">\${escapeHtml(p.source?.type ?? "plugin")}\${p.state?.status ? " · " + escapeHtml(String(p.state.status)) : ""}</span></span></div>\`
                )
                .join("") +
              "</div>"
            : '<p class="sheet-note">This server reports no plugins.</p>') +
          \`<div class="prefs-foot"><button class="btn btn-ghost" id="plugins-mcp">MCP servers</button></div>\`;
        root.addEventListener("click", (e) => {
          if (!e.target.closest("#plugins-mcp")) return;
          closeSheet();
          setTimeout(() => openMcpSheet(), 200);
        });
      } catch (err) {
        root.innerHTML = \`<p class="sheet-note">\${escapeHtml(err.message || "Could not load plugins")}</p>\`;
      }
    },
  });
}`;
console.log("found:", s.includes(old));
s = s.replace(old, neu);
fs.writeFileSync(p, s);
