import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:3000";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--window-size=1300,900"],
});

async function session(username) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1300, height: 900 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.type('input[autocomplete="username"]', username);
  await page.type('input[type="password"]', "password");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2" }),
    page.click('button[type="submit"], button.btn-primary'),
  ]);
  return page;
}

const alice = await session("alice");
const bob = await session("bob");

// alice opens the seeded conversation
await alice.waitForSelector("button", { timeout: 10000 });
await alice.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /Bob Martins/.test(b.textContent));
  btn?.click();
});
await new Promise((r) => setTimeout(r, 1500));

// alice types (bob should see typing), then sends
await alice.type("textarea", "Hey Bob, does the typing indicator show on your side?");
await new Promise((r) => setTimeout(r, 1200));

await bob.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /Alice Nguyen/.test(b.textContent));
  btn?.click();
});
await new Promise((r) => setTimeout(r, 800));
await bob.screenshot({ path: ".shot-typing.png" });

await alice.keyboard.press("Enter");
await new Promise((r) => setTimeout(r, 1000));
await bob.type("textarea", "Yep — showed up instantly. Read receipts working too ✓✓");
await bob.keyboard.press("Enter");
await new Promise((r) => setTimeout(r, 1200));

await alice.screenshot({ path: ".shot-chat-alice.png" });
await bob.screenshot({ path: ".shot-chat-bob.png" });

// profanity rejection in the UI
await alice.type("textarea", "this is fu*cking great");
await alice.keyboard.press("Enter");
await new Promise((r) => setTimeout(r, 800));
await alice.screenshot({ path: ".shot-profanity.png" });

const errors = [];
alice.on("pageerror", (e) => errors.push(String(e)));
bob.on("pageerror", (e) => errors.push(String(e)));
await new Promise((r) => setTimeout(r, 500));

console.log(errors.length ? "PAGE ERRORS:\n" + errors.join("\n") : "no page errors");
await browser.close();
