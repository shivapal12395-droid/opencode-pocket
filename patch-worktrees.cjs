const fs = require("fs");
const p = "assets/app.js";
let s = fs.readFileSync(p, "utf8");
const i = s.indexOf("Loading worktrees");
if (i < 0) { console.log("no anchor"); process.exit(1); }
const start = s.lastIndexOf("\n", i) + 1;
const block = `      // Worktrees are per project. The open session names one; otherwise use the
      // most recently active project instead of sending \`projectID=undefined\`.
      let projectID = state.session?.projectID ?? null;
      let projectDir = state.session?.location?.directory ?? "";
      if (!projectID) {
        try {
          const projects = [...(await ensureProjects())].sort((a, b) => (b.time?.active ?? 0) - (a.time?.active ?? 0));
          projectID = projects[0]?.id ?? null;
          projectDir = projects[0]?.canonical ?? projectDir;
        } catch (_) {
          /* the empty state below is the honest answer */
        }
      }
      if (!projectID) {
        root.innerHTML = '<p class="sheet-note">No project yet. Worktrees belong to a project, so start a session in a workspace first.</p>';
        return;
      }
`;
s = s.slice(0, start) + block + s.slice(start);
const before = "const res = await state.api.worktrees(state.session?.projectID);\n        const list = res?.data ?? res ?? [];";
console.log("api-call found:", s.includes(before));
s = s.replace(before, "const list = await state.api.worktrees(projectID);");
fs.writeFileSync(p, s);
console.log("inserted:", s.includes("let projectID = state.session?.projectID"));
