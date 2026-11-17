const fs = require("fs");
const p = "test/suite-8.cjs";
let s = fs.readFileSync(p, "utf8");
s = s.replace('await page.click(\'.session-row [data-open="ses_demo1"]\');\n    await page.waitForSelector(".msg", { timeout: 8000 });\n    await sleep(600);\n    await page.evaluate(async () => {\n      document.querySelector("#chat-sidebar")?.click();',
  'await page.click(\'.session-row [data-open="ses_demo7"]\');\n    await page.waitForSelector(".msg", { timeout: 8000 });\n    await sleep(600);\n    await page.evaluate(async () => {\n      document.querySelector("#chat-sidebar")?.click();');
fs.writeFileSync(p, s);
console.log("demo7:", s.includes("ses_demo7"));
