// Starts the exact application extracted from the NSIS payload, without installing shortcuts/registry entries.
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const probe = createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const binary = path.resolve(
  process.argv[2] || ".tools/installer-extracted/ai-study-reader.exe",
);
const child = spawn(binary, [], {
  cwd: path.dirname(binary),
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
  windowsHide: true,
  stdio: "ignore",
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      if (child.exitCode !== null)
        throw new Error(`Release process exited ${child.exitCode}`);
      await delay(200);
    }
  }
  if (!browser) throw new Error("Release WebView2 did not start");
  const page = browser.contexts().flatMap((c) => c.pages())[0];
  await page.waitForSelector(".app", { timeout: 20000 });
  await expect(
    page.getByRole("button", { name: "导入文档", exact: true }),
  ).toBeVisible();
  await page.getByLabel("设置", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "AI 设置" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByLabel("关闭设置").click();
  await page.screenshot({ path: "artifacts/release-window.png" });
  const exited = new Promise((r) => child.once("exit", r));
  await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }),
  );
  await Promise.race([
    exited,
    delay(10000).then(() => {
      throw new Error("Release did not close");
    }),
  ]);
  console.log(
    "PASS exact NSIS payload: launch, bundled frontend/assets, system settings IPC, graceful close",
  );
} finally {
  try {
    await browser?.close();
  } catch {}
  if (child.exitCode === null) child.kill();
}
