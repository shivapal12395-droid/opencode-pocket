const fs = require("fs");
const p = "assets/app.js";
let s = fs.readFileSync(p, "utf8");
const old = `        const list = await state.api.worktrees(projectID);
        root.innerHTML = list.length
          ? '<div class="sheet-list">' + list.map((w) => \`<div class="sheet-item">
              <span class="si-icon">\${icon("branch")}</span>
              <span class="si-text"><span class="si-title">\${escapeHtml(w.name || w.branch || "worktree")}</span>
              <span class="si-sub">\${escapeHtml(w.branch || "")}\${w.dirty ? " · changes" : ""}</span></span>
            </div>\`).join("") + "</div>"
          : '<p class="sheet-note">No worktrees for this project.</p>';`;
console.log("found:", s.includes(old));
const neu = `        const list = await state.api.worktrees(projectID);
        root.innerHTML = list.length
          ? \`<p class="sheet-note">\${escapeHtml(projectDir || "project")}</p><div class="sheet-list">\` +
            list
              .map((w) => {
                const dir = w.path ?? w.directory ?? "";
                const name = w.name || basename(dir) || w.branch || "worktree";
                return \`<button class="sheet-item" data-wt-open="\${escapeHtml(dir)}"\${dir ? "" : " disabled"}>
                <span class="si-icon">\${icon("branch")}</span>
                <span class="si-text"><span class="si-title">\${escapeHtml(name)}</span>
                <span class="si-sub">\${escapeHtml(w.branch || dir || "")}\${w.dirty ? " · uncommitted changes" : ""}</span></span>
              </button>\`;
              })
              .join("") +
            "</div>"
          : \`<p class="sheet-note">No worktrees for \${escapeHtml(basename(projectDir) || "this project")} yet.</p>\`;
        root.addEventListener("click", (e) => {
          const b = e.target.closest("[data-wt-open]");
          if (!b || !b.dataset.wtOpen) return;
          // A worktree is a workspace: open the new-session sheet pointed at it.
          store.set("lastDir", b.dataset.wtOpen);
          closeSheet();
          setTimeout(() => openNewSession(), 220);
        });`;
s = s.replace(old, neu);
fs.writeFileSync(p, s);
console.log("patched:", s.includes("data-wt-open"));
