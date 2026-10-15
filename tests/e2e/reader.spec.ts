import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
async function pdfBytes() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage([600, 800]);
    page.drawText(`Study formula page ${i + 1}`, {
      x: 60,
      y: 730,
      font,
      size: 18,
    });
    page.drawText("E = mc^2", { x: 130, y: 550, font, size: 24 });
  }
  return Buffer.from(await doc.save());
}
test("PDF annotations survive zoom, page navigation, reload and offline reading", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "formula.pdf",
    mimeType: "application/pdf",
    buffer: await pdfBytes(),
  });
  await expect(page.locator(".textLayer")).toContainText("E = mc^2");
  await expect(page.locator(".loading")).toHaveCount(0);
  await page.getByRole("button", { name: "画笔", exact: true }).click();
  const canvas = page.getByTestId("annotation-canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 120, box.y + 220);
  await page.mouse.down();
  for (const [x, y] of [
    [210, 220],
    [230, 250],
    [210, 270],
    [120, 270],
    [110, 250],
    [120, 220],
  ])
    await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.up();
  await expect(page.locator(".save-status")).toContainText("本页 1 条批注");
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect(page.locator(".loading")).toHaveCount(0);
  await expect(page.locator(".save-status")).toContainText("本页 1 条批注");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("本页 0 条批注");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("本页 1 条批注");
  await page.getByRole("button", { name: "缩小", exact: true }).click();
  await page.getByRole("button", { name: "缩小", exact: true }).click();
  await expect(page.getByLabel("缩放")).toHaveValue("0.8");
  await expect(page.locator(".loading")).toHaveCount(0);
  await expect(page.locator(".save-status")).toContainText("本页 1 条批注");
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect(page.getByLabel("缩放")).toHaveValue("1.2");
  await expect(page.locator(".loading")).toHaveCount(0);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".textLayer")).toContainText("page 2");
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("本页 1 条批注");
  await page.reload();
  await page.getByRole("button", { name: /formula.pdf/ }).click();
  await expect(page.locator(".save-status")).toContainText("本页 1 条批注");
  await expect(page.getByLabel("缩放")).toHaveValue("1.2");
  await expect(page.locator(".loading")).toHaveCount(0);
  const restoredPixel = await canvas.evaluate((element) => {
    const c = element as HTMLCanvasElement;
    const dpr = c.width / c.getBoundingClientRect().width;
    const pixels = c
      .getContext("2d")!
      .getImageData(
        Math.round(120 * 1.2 * dpr) - 2,
        Math.round(220 * 1.2 * dpr) - 2,
        5,
        5,
      ).data;
    return Array.from(
      { length: 25 },
      (_, i) => pixels[i * 4 + 3] > 0 && pixels[i * 4 + 2] > pixels[i * 4],
    ).some(Boolean);
  });
  expect(restoredPixel).toBe(true);
  await page.getByRole("button", { name: "区域问 AI", exact: true }).click();
  const next = (await canvas.boundingBox())!;
  await page.mouse.move(next.x + 100 * 1.2, next.y + 215 * 1.2);
  await page.mouse.down();
  await page.mouse.move(next.x + 240 * 1.2, next.y + 280 * 1.2);
  await page.mouse.up();
  await expect(page.locator(".context-panel")).toContainText("E = mc^2");
  await expect(page.getByAltText("所选区域截图")).toBeVisible();
  await page.screenshot({ path: "artifacts/reader-preview.png" });
  await context.setOffline(true);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".textLayer")).toContainText("page 2");
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("本页 1 条批注");
  expect(errors).toEqual([]);
});
test("highlight, rectangle, erase and undo persist as independent objects", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "tools.pdf",
    mimeType: "application/pdf",
    buffer: await pdfBytes(),
  });
  await expect(page.locator(".loading")).toHaveCount(0);
  await expect(page.locator(".textLayer")).toContainText("E = mc^2");
  const canvas = page.getByTestId("annotation-canvas");
  const box = (await canvas.boundingBox())!;
  for (const [tool, x, y, endX, endY] of [
    ["画笔", 100, 100, 180, 100],
    ["荧光笔", 100, 140, 180, 140],
    ["矩形", 200, 100, 280, 150],
  ] as const) {
    await page.getByRole("button", { name: tool, exact: true }).click();
    await page.mouse.move(box.x + x, box.y + y);
    await page.mouse.down();
    await page.mouse.move(box.x + endX, box.y + endY);
    await page.mouse.up();
  }
  await expect(page.locator(".save-status")).toContainText("本页 3 条批注");
  await page.getByRole("button", { name: "橡皮擦", exact: true }).click();
  await page.mouse.click(box.x + 240, box.y + 100);
  await expect(page.locator(".save-status")).toContainText("本页 2 条批注");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("本页 3 条批注");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("本页 2 条批注");
  await page.reload();
  await page.getByRole("button", { name: /tools.pdf/ }).click();
  await expect(page.locator(".save-status")).toContainText("本页 2 条批注");
});
test("TXT import, selection and progress persist", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Hello study reader.\nEnergy equals mass times light speed squared.",
    ),
  });
  await expect(page.locator(".txt-page")).toContainText("Hello study reader");
  await page.locator(".txt-page").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(range);
  });
  await page.locator(".txt-page").dispatchEvent("mouseup");
  await expect(page.locator(".context-panel")).toContainText("Energy equals");
  await page.reload();
  await page.getByRole("button", { name: /notes.txt/ }).click();
  await expect(page.locator(".txt-page")).toContainText("Hello study reader");
});
test("TXT scroll progress restores after reopening", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "long-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      Array.from(
        { length: 150 },
        (_, i) => `Study line ${i + 1}: learning with annotations.`,
      ).join("\n"),
    ),
  });
  await expect(page.locator(".loading")).toHaveCount(0);
  await expect(page.locator(".txt-page")).toContainText("Study line 150");
  await page.locator(".reader-scroll").evaluate((el) => {
    el.scrollTop = 1200;
  });
  await expect
    .poll(() => page.locator(".reader-scroll").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(1000);
  await page.waitForTimeout(350);
  await page.reload();
  await page.getByRole("button", { name: /long-notes.txt/ }).click();
  await expect(page.locator(".loading")).toHaveCount(0);
  await expect
    .poll(() => page.locator(".reader-scroll").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(1000);
});
