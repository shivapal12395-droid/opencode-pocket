const fs = require("fs");
const p = "test/suite-7.cjs";
let s = fs.readFileSync(p, "utf8");
const old = `    await page.click('[data-side="library"]');
    await page.waitForSelector(".instr-card", { timeout: 8000 });`;
const neu = `    // Instructions live under Customize now; the Library row lists artifacts.
    await page.click('[data-side="customize"]');
    await sleep(400);
    await page.click('[data-cust="instructions"]');
    await page.waitForSelector(".instr-card", { timeout: 8000 });`;
console.log("found:", s.includes(old));
s = s.replace(old, neu);
fs.writeFileSync(p, s);
