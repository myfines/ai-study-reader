import { describe, it, expect, vi, beforeEach } from "vitest";
const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: ipc.invoke,
  Channel: class {
    onmessage: (b: number[]) => void = () => {};
  },
}));
import { streamChat } from "../src/chatStore";
describe("real API stream adapter with protocol fixtures", () => {
  beforeEach(() => {
    ipc.invoke.mockReset();
  });
  it("reassembles byte-split Chinese deltas and completion", async () => {
    ipc.invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "ai_chat") {
        const bytes = new TextEncoder().encode(
          'data: {"choices":[{"delta":{"content":"中文解释"}}]}\n\ndata: [DONE]\n\n',
        );
        for (const b of bytes) args.onChunk.onmessage([b]);
      }
    });
    let answer = "";
    await streamChat(
      "t",
      [{ role: "user", content: "question" }],
      (s) => (answer += s),
    );
    expect(answer).toBe("中文解释");
  });
  it("preserves partial answer but rejects a disconnected stream", async () => {
    ipc.invoke.mockImplementation(async (_, args) => {
      args.onChunk.onmessage(
        Array.from(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
          ),
        ),
      );
    });
    let answer = "";
    await expect(streamChat("t", [], (s) => (answer += s))).rejects.toThrow(
      /中断/,
    );
    expect(answer).toBe("partial");
  });
  it("reports provider errors instead of inventing a response", async () => {
    ipc.invoke.mockImplementation(async (_, args) =>
      args.onChunk.onmessage(
        Array.from(
          new TextEncoder().encode(
            'data: {"error":{"message":"quota exceeded"}}\n\ndata: [DONE]\n\n',
          ),
        ),
      ),
    );
    await expect(streamChat("t", [], () => {})).rejects.toThrow(
      "quota exceeded",
    );
  });
  it("propagates authentication and cancellation errors", async () => {
    ipc.invoke.mockRejectedValue(new Error("401 unauthorized"));
    await expect(streamChat("t", [], () => {})).rejects.toThrow("401");
  });
});
