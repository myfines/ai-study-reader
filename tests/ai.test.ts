import { describe, it, expect } from "vitest";
import {
  supportsImages,
  buildMessages,
  SSEDecoder,
  validateSettings,
  defaultSettings,
} from "../src/ai";
import type { SelectionContext } from "../src/core";
const context: SelectionContext = {
  bookId: "b",
  page: 2,
  text: "E = mc^2",
  pageText: "Energy",
  image: "data:image/png;base64,AA==",
  annotationIds: ["circle"],
  annotations: [],
};
describe("AI routing and streaming", () => {
  it("never sends images to text-only DeepSeek models", () => {
    const s = { ...defaultSettings, model: "deepseek-chat", vision: true };
    expect(supportsImages(s)).toBe(false);
    expect(
      JSON.stringify(buildMessages(s, context, "解释", [], false)),
    ).not.toContain("image_url");
    expect(() => buildMessages(s, context, "解释", [], true)).toThrow(/视觉/);
  });
  it("sends structured image input to supported vision model", () => {
    expect(supportsImages(defaultSettings)).toBe(true);
    expect(
      JSON.stringify(buildMessages(defaultSettings, context, "解释", [], true)),
    ).toContain("image_url");
  });
  it("rejects insecure endpoints and invalid model names", () => {
    expect(() =>
      validateSettings({ ...defaultSettings, baseUrl: "http://evil.test" }),
    ).toThrow();
    expect(() =>
      validateSettings({
        ...defaultSettings,
        baseUrl: "http://127.0.0.1:11434/v1",
      }),
    ).not.toThrow();
    expect(() => validateSettings({ ...defaultSettings, model: "" })).toThrow();
  });
  it("preserves UTF8 chunks and multi-line SSE events", () => {
    const decoder = new SSEDecoder();
    const data = new TextEncoder().encode(
      'data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: [DONE]\n\n',
    );
    const out: string[] = [];
    for (const b of data) out.push(...decoder.push(new Uint8Array([b])));
    out.push(...decoder.finish());
    expect(out).toEqual([
      '{"choices":[{"delta":{"content":"你好"}}]}',
      "[DONE]",
    ]);
  });
  it("uses an explicit untrusted-document boundary and excludes failed history", () => {
    const messages = buildMessages(
      defaultSettings,
      context,
      "解释",
      [
        { role: "user", content: "previous" },
        { role: "assistant", content: "answer" },
      ],
      false,
    );
    expect(messages[0].content).toContain("不可信");
    expect(messages.at(-1)?.content).toContain("E = mc^2");
    expect(messages.length).toBe(4);
  });
});
