// Windows native acceptance test. Local SSE fixture tests transport only, not AI quality.
import { chromium, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createServer } from "node:http";
import { mkdtemp, writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
const root = process.cwd();
const temp = await mkdtemp(path.join(tmpdir(), "ai-study-native-"));
await mkdir("artifacts", { recursive: true });
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < 2; i++) {
  const p = pdf.addPage([600, 800]);
  p.drawText(`Native formula page ${i + 1}`, { x: 50, y: 740, font, size: 18 });
  p.drawText("E = mc^2", { x: 130, y: 550, font, size: 24 });
}
const fixturePath = path.join(temp, "native-formula.pdf");
await writeFile(fixturePath, await pdf.save());
let received;
const server = createServer(async (req, res) => {
  if (req.headers.authorization !== "Bearer TEST-ONLY-FIXTURE-KEY") {
    res.writeHead(401);
    res.end();
    return;
  }
  let body = "";
  for await (const bytes of req) body += bytes;
  received = JSON.parse(body);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  const bytes = Buffer.from(
    "data: " +
      JSON.stringify({
        choices: [
          {
            delta: {
              content: "[TEST FIXTURE] 中文流协议验证；不是模型生成的解释。",
            },
          },
        ],
      }) +
      "\n\n",
  );
  for (let i = 0; i < bytes.length; i += 7) {
    res.write(bytes.subarray(i, i + 7));
    await delay(2);
  }
  res.end("data: [DONE]\n\n");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
const probe = createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const cdpPort = probe.address().port;
await new Promise((r) => probe.close(r));
let child, browser, page;
function launch() {
  const target =
    process.env.CARGO_TARGET_DIR || path.join(root, "src-tauri", "target");
  child = spawn(path.join(target, "debug", "ai-study-reader.exe"), [], {
    cwd: root,
    env: {
      ...process.env,
      AI_STUDY_READER_TEST_DATA: path.join(temp, "data"),
      WEBVIEW2_USER_DATA_FOLDER: path.join(temp, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
    },
    windowsHide: true,
    stdio: "ignore",
  });
}
async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
      const pages = browser.contexts().flatMap((c) => c.pages());
      if (pages.length) {
        page = pages[0];
        await page.waitForSelector(".app", { timeout: 15000 });
        return;
      }
    } catch {}
    await delay(250);
  }
  throw new Error("Native WebView2 did not expose the expected app");
}
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
async function close() {
  const exited = new Promise((r) => child.once("exit", r));
  await invoke("plugin:window|close", { label: "main" });
  await Promise.race([
    exited,
    delay(10000).then(() => {
      throw new Error("Native close guard did not finish");
    }),
  ]);
}
try {
  launch();
  await connect();
  const book = await invoke("import_document", { path: fixturePath });
  await page.reload();
  await page.getByRole("button", { name: /native-formula.pdf/ }).click();
  await expect(page.locator(".loading")).toHaveCount(0);
  await expect(page.locator(".textLayer")).toContainText("E = mc^2");
  await page.getByRole("button", { name: "画笔", exact: true }).click();
  let box = await page.getByTestId("annotation-canvas").boundingBox();
  await page.mouse.move(box.x + 120, box.y + 220);
  await page.mouse.down();
  for (const [x, y] of [
    [220, 220],
    [230, 260],
    [120, 270],
    [110, 240],
    [120, 220],
  ])
    await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.up();
  await expect(page.locator(".save-status")).toContainText("本页 1 条批注");
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect(page.locator(".loading")).toHaveCount(0);
  await expect(page.getByLabel("缩放")).toHaveValue("1.2");
  const before = await invoke("load_annotations", { bookId: book.id, page: 1 });
  await close();
  try {
    await browser.close();
  } catch {}
  launch();
  await connect();
  await page.getByRole("button", { name: /native-formula.pdf/ }).click();
  await expect(page.locator(".loading")).toHaveCount(0);
  await expect(page.locator(".save-status")).toContainText("本页 1 条批注");
  expect(
    await invoke("load_annotations", { bookId: book.id, page: 1 }),
  ).toEqual(before);
  await expect(page.getByLabel("缩放")).toHaveValue("1.2");
  await invoke("save_settings", {
    settings: {
      baseUrl: endpoint,
      model: "contract-fixture-vision",
      vision: true,
    },
    key: "TEST-ONLY-FIXTURE-KEY",
  });
  await page.reload();
  await page.getByRole("button", { name: /native-formula.pdf/ }).click();
  await expect(page.locator(".loading")).toHaveCount(0);
  await page.getByRole("button", { name: "区域问 AI", exact: true }).click();
  box = await page.getByTestId("annotation-canvas").boundingBox();
  await page.mouse.move(box.x + 100 * 1.2, box.y + 210 * 1.2);
  await page.mouse.down();
  await page.mouse.move(box.x + 245 * 1.2, box.y + 285 * 1.2);
  await page.mouse.up();
  await expect(page.getByAltText("所选区域截图")).toBeVisible();
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  await expect(page.locator(".chat-history")).toContainText("[TEST FIXTURE]", {
    timeout: 20000,
  });
  await expect(page.locator(".chat-history")).toContainText("已保存");
  expect(
    received.messages.at(-1).content.some((p) => p.type === "image_url"),
  ).toBe(true);
  expect(received.messages.at(-1).content[0].text).toContain("E = mc^2");
  const chats = await invoke("list_chats", { bookId: book.id, page: 1 });
  expect(chats[0].context.annotationIds).toEqual([before[0].id]);
  expect(chats[0].status).toBe("complete");
  await invoke("delete_key", { baseUrl: endpoint });
  for (const name of await readdir(path.join(temp, "data"))) {
    if (name.startsWith("reader.sqlite"))
      expect(
        (await readFile(path.join(temp, "data", name))).includes(
          Buffer.from("TEST-ONLY-FIXTURE-KEY"),
        ),
      ).toBe(false);
  }
  await page.reload();
  await page.getByRole("button", { name: /native-formula.pdf/ }).click();
  await expect(page.locator(".chat-history")).toContainText("[TEST FIXTURE]");
  await browser.contexts()[0].setOffline(true);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".textLayer")).toContainText("page 2");
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(page.locator(".chat-history")).toContainText("[TEST FIXTURE]");
  await expect(page.locator(".save-status")).toContainText("本页 1 条批注");
  await page.screenshot({ path: "artifacts/native-contract-test.png" });
  await browser.contexts()[0].setOffline(false);
  await close();
  console.log(
    "PASS native SQLite + OS credentials + coordinate recovery + real Rust HTTP/SSE transport fixture + saved links + offline reading + graceful close",
  );
  console.log(`Isolated test data: ${temp}`);
} finally {
  try {
    if (page && !page.isClosed())
      await invoke("delete_key", { baseUrl: endpoint });
  } catch {}
  try {
    await browser?.close();
  } catch {}
  if (child && !child.killed) child.kill();
  server.close();
}
