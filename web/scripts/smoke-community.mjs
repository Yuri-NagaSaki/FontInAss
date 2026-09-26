import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

// Read-only browser checks: no credentials, submissions or comments are sent.
const baseURL = process.env.UI_BASE_URL || "http://127.0.0.1:3300";
const output = resolve(
  process.env.UI_ARTIFACT_DIR || "/tmp/fontinass-community-ui",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors = [];
const results = [];
page.on("pageerror", (error) => errors.push(error.message));
// Keep synthetic visits out of public analytics.
await page.route("https://analytics.catcat.blog/**", (route) =>
  route.fulfill({ status: 204 }),
);

async function visit(path) {
  const response = await page.goto(baseURL + path, {
    waitUntil: "domcontentloaded",
  });
  assert.equal(response.status(), 200, `HTTP ${path}`);
  await page.locator("main h1").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.match(await page.title(), /AniBT/, `title ${path}`);
}
async function checkLayout(path, width, theme, locale) {
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
    h1: document.querySelector("main h1")?.textContent,
    unresolvedCopy: /community\.[a-zA-Z]/.test(
      document.querySelector("main")?.textContent || "",
    ),
  }));
  assert.ok(
    layout.width <= layout.viewport + 1,
    `${path} at ${width}px overflows: ${layout.width}`,
  );
  assert.equal(layout.unresolvedCopy, false, `${path} has untranslated keys`);
  results.push({
    path,
    width,
    theme,
    locale,
    heading: layout.h1,
    overflow: false,
  });
}
try {
  await visit("/");
  assert.equal(
    await page
      .locator(".brand-logo img")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    true,
  );
  assert.equal(await page.locator("main .community-service").count(), 4);
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    for (const path of [
      "/",
      "/subset",
      "/sharing",
      "/upload",
      "/comments",
      "/logs",
      "/cli",
      "/about",
      "/access",
      "/fonts",
    ]) {
      await visit(path);
      await checkLayout(path, width, "light", "zh-CN");
    }
    console.log(`Checked 10 routes at ${width}px`);
  }

  // Mobile primary navigation and the complete secondary menu.
  await page.setViewportSize({ width: 390, height: 844 });
  await visit("/");
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page
    .locator("#mobile-more")
    .getByRole("link", { name: "使用指南", exact: true })
    .click();
  await page.waitForURL("**/about");
  assert.equal(await page.locator("#mobile-more").count(), 0);
  await page
    .locator(".mobile-nav")
    .getByRole("link", { name: "字幕处理", exact: true })
    .click();
  await page.waitForURL("**/subset");
  const chooserEvent = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "选择文件", exact: true })
    .press("Enter");
  const chooser = await chooserEvent;
  assert.equal(
    await chooser.element().getAttribute("accept"),
    ".ass,.ssa,.srt",
  );

  // Native settings dialog, persistence, credential management and Escape.
  await page.getByRole("button", { name: "处理设置", exact: true }).click();
  await page.getByRole("dialog", { name: "处理设置", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await page.getByRole("button", { name: "处理设置", exact: true }).click();
  await page.getByRole("button", { name: "访问密钥", exact: true }).click();
  await page.getByRole("dialog", { name: "访问密钥", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog", { name: "访问密钥", exact: true })
    .waitFor({ state: "hidden" });

  // Service links are navigable, and the popover closes with Escape.
  await page.locator(".service-switcher summary").click();
  assert.equal(await page.locator(".service-menu a").count(), 4);
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator(".service-switcher").getAttribute("open"),
    null,
  );

  // Both locales and dark mode, including mobile English navigation.
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await page.evaluate(() => {
      localStorage.setItem("theme", "dark");
      localStorage.setItem("locale", "en-US");
    });
    for (const path of [
      "/",
      "/subset",
      "/about",
      "/cli",
      "/access",
      "/sharing",
      "/upload",
      "/logs",
      "/fonts",
      "/comments",
    ]) {
      await visit(path);
      await checkLayout(path, width, "dark", "en-US");
      assert.equal(await page.locator("html").getAttribute("lang"), "en-US");
      assert.equal(
        await page
          .locator("html")
          .evaluate((el) => el.classList.contains("dark")),
        true,
      );
    }
    console.log(`Checked 10 English dark routes at ${width}px`);
  }
  await page.getByRole("button", { name: "切换至中文" }).click();
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
  await page.getByRole("button", { name: "深色模式", exact: true }).click();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("theme")),
    "system",
  );
  await visit("/about");
  await page.getByText("提示缺少字体怎么办？", { exact: true }).click();
  assert.equal(await page.locator("details.faq-item[open]").count(), 1);

  // Fresh page loads and representative screenshots, with real server data.
  await page.evaluate(() => {
    localStorage.setItem("theme", "light");
    localStorage.setItem("locale", "zh-CN");
  });
  for (const [name, path, width, theme] of [
    ["home-desktop", "/", 1440, "light"],
    ["home-mobile", "/", 390, "light"],
    ["home-dark", "/", 1440, "dark"],
    ["guide-mobile", "/about", 390, "dark"],
    ["subset-desktop", "/subset", 1440, "light"],
    ["sharing-desktop", "/sharing", 1440, "light"],
  ]) {
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await page.setViewportSize({ width, height: 950 });
    await visit(path);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  }
  await visit("/a-page-that-does-not-exist");
  assert.match(await page.locator("main h1").textContent(), /没有找到/);
  assert.deepEqual(errors, [], "Uncaught browser errors");
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        baseURL,
        layouts: results.length,
        results,
        errors,
        interactions: "passed",
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${results.length} route/layout checks and navigation, settings, locale, theme, file picker and FAQ interactions. ${output}`,
  );
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify(
      { error: String(error), url: page.url(), errors, results },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
