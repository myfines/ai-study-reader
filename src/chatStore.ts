import { trackWrite } from "./persistence";
import { Channel, invoke } from "@tauri-apps/api/core";
import { desktop, webGet, webPut } from "./store";
import {
  SSEDecoder,
  defaultSettings,
  validateSettings,
  type AISettings,
  type Message,
} from "./ai";
import type { SelectionContext } from "./core";
export interface Chat {
  id: string;
  threadId: string;
  bookId: string;
  page: number;
  context: SelectionContext;
  question: string;
  answer: string;
  status: "streaming" | "complete" | "error" | "cancelled";
  error?: string;
  created: number;
  model: string;
}
export async function loadSettings(): Promise<{
  settings: AISettings;
  hasKey: boolean;
}> {
  return desktop
    ? invoke("get_settings")
    : {
        settings:
          (await webGet<AISettings>("settings", "ai")) || defaultSettings,
        hasKey: false,
      };
}
export async function saveSettings(settings: AISettings, key: string) {
  const clean = validateSettings(settings);
  if (desktop)
    await invoke("save_settings", { settings: clean, key: key || null });
  else {
    if (key) throw new Error("浏览器预览不保存 API Key，请运行桌面版");
    await webPut("settings", clean, "ai");
  }
}
export async function deleteKey(settings: AISettings) {
  if (desktop) await invoke("delete_key", { baseUrl: settings.baseUrl });
}
export async function listChats(bookId: string, page: number): Promise<Chat[]> {
  if (desktop) return invoke("list_chats", { bookId, page });
  const all = (await webGet<Chat[]>("settings", `chats:${bookId}`)) || [];
  return all
    .filter((c) => c.page === page)
    .sort((a, b) => a.created - b.created);
}
const chatQueues = new Map<string, Promise<unknown>>();
export function saveChat(chat: Chat) {
  const previous = chatQueues.get(chat.bookId) || Promise.resolve();
  const job = previous
    .catch(() => {})
    .then(async () => {
      if (desktop) return invoke("save_chat", { chat });
      const all =
        (await webGet<Chat[]>("settings", `chats:${chat.bookId}`)) || [];
      await webPut(
        "settings",
        [...all.filter((c) => c.id !== chat.id), chat],
        `chats:${chat.bookId}`,
      );
    });
  chatQueues.set(chat.bookId, job);
  void job
    .finally(() => {
      if (chatQueues.get(chat.bookId) === job) chatQueues.delete(chat.bookId);
    })
    .catch(() => {});
  return trackWrite(job);
}
export function cancelChat(id: string) {
  return desktop ? invoke("cancel_chat", { id }) : Promise.resolve();
}
export async function streamChat(
  id: string,
  messages: Message[],
  onDelta: (s: string) => void,
) {
  if (!desktop)
    throw new Error(
      "真实 AI 请求与系统凭据存储需要桌面版，请运行 npm run desktop",
    );
  const decoder = new SSEDecoder();
  let done = false;
  let streamError: Error | undefined;
  const consume = (events: string[]) => {
    for (const event of events) {
      if (event === "[DONE]") {
        done = true;
        continue;
      }
      try {
        const value = JSON.parse(event);
        if (value.error) throw new Error(value.error.message || "接口返回错误");
        for (const choice of value.choices || []) {
          if (choice.delta?.content) onDelta(choice.delta.content);
          if (choice.finish_reason === "length")
            throw new Error("回答达到模型长度限制，已保留部分内容");
        }
      } catch (e) {
        streamError = e instanceof Error ? e : new Error(String(e));
      }
    }
  };
  const channel = new Channel<number[]>();
  channel.onmessage = (bytes) => consume(decoder.push(new Uint8Array(bytes)));
  await invoke("ai_chat", { id, messages, onChunk: channel });
  consume(decoder.finish());
  if (streamError) throw streamError;
  if (!done) throw new Error("连接中断，未收到流结束标记，已保留部分回答");
}
