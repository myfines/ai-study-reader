import { test, expect } from "@playwright/test";
test("preview refuses API keys and clearly reports desktop-only AI", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("设置", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "AI 设置" });
  await dialog
    .getByLabel("API Key", { exact: true })
    .fill("test-only-never-save");
  await dialog.getByRole("button", { name: "保存设置" }).click();
  await expect(dialog.getByRole("alert")).toContainText("不保存 API Key");
  await dialog.getByLabel("API Key", { exact: true }).fill("");
  await dialog.getByRole("button", { name: "DeepSeek 纯文字" }).click();
  await expect(dialog).toContainText("仅发送文字");
  await dialog.getByRole("button", { name: "保存设置" }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator("input[type=file]").setInputFiles({
    name: "selection.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("E = mc^2"),
  });
  await expect(page.locator(".txt-page")).toContainText("E = mc^2");
  await page.locator(".txt-page").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  await page.locator(".txt-page").dispatchEvent("mouseup");
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  await expect(page.locator(".chat-error").first()).toContainText("桌面版");
  await expect(page.locator(".chat-history")).toContainText("未完成");
  await page.reload();
  await page.getByRole("button", { name: /selection.txt/ }).click();
  await expect(page.locator(".chat-history")).toContainText("无回答内容");
});
