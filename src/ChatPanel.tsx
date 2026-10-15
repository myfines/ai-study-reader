import { useEffect, useRef, useState } from "react";
import { registerCloseTask } from "./persistence";
import { Sparkles, Send, Square } from "lucide-react";
import type { Book, SelectionContext } from "./core";
import {
  defaultSettings,
  buildMessages,
  supportsImages,
  type AISettings,
  type Message,
} from "./ai";
import {
  cancelChat,
  listChats,
  loadSettings,
  saveChat,
  streamChat,
  type Chat,
} from "./chatStore";
export function ChatPanel({
  book,
  context,
  settingsVersion,
  onSettings,
  onError,
}: {
  book: Book;
  context: SelectionContext | null;
  settingsVersion: number;
  onSettings: () => void;
  onError: (s: string) => void;
}) {
  const [s, setS] = useState<AISettings>(defaultSettings);
  const [chats, setChats] = useState<Chat[]>([]);
  const [question, setQuestion] = useState(
    "请解释这个公式的含义、各符号和推导过程。",
  );
  const [includeImage, setIncludeImage] = useState(true);
  const [active, setActive] = useState<Chat | null>(null);
  const [follow, setFollow] = useState<Chat | null>(null);
  const [localError, setLocalError] = useState("");
  const running = useRef<Chat | null>(null);
  useEffect(
    () =>
      registerCloseTask(async () => {
        const chat = running.current;
        if (chat) {
          chat.status = "cancelled";
          await saveChat({ ...chat });
          await cancelChat(chat.id);
        }
      }),
    [],
  );
  const pageKey = useRef("");
  const key = `${book.id}:${book.page}`;
  pageKey.current = key;
  useEffect(() => {
    void loadSettings()
      .then((v) => setS(v.settings))
      .catch((e) => onError(String(e)));
  }, [settingsVersion]);
  useEffect(() => {
    let gone = false;
    setChats([]);
    setFollow(null);
    setLocalError("");
    void listChats(book.id, book.page)
      .then((v) => {
        if (!gone) setChats(v);
      })
      .catch((e) => onError(String(e)));
    return () => {
      gone = true;
    };
  }, [key]);
  useEffect(() => {
    setFollow(null);
  }, [context]);
  useEffect(
    () => () => {
      if (running.current) void cancelChat(running.current.id);
    },
    [],
  );
  const selected = follow?.context || context;
  async function send() {
    if (!selected || !question.trim() || running.current) return;
    setLocalError("");
    let messages: Message[];
    try {
      const history: Message[] = follow
        ? chats
            .filter(
              (c) =>
                c.threadId === follow.threadId &&
                c.status === "complete" &&
                c.created <= follow.created,
            )
            .flatMap((c) => [
              { role: "user" as const, content: c.question },
              { role: "assistant" as const, content: c.answer },
            ])
        : [];
      messages = buildMessages(
        s,
        selected,
        question.trim(),
        history,
        includeImage && supportsImages(s),
      );
    } catch (e) {
      setLocalError(String(e));
      return;
    }
    const id = crypto.randomUUID();
    const chat: Chat = {
      id,
      threadId: follow?.threadId || id,
      bookId: selected.bookId,
      page: selected.page,
      context: selected,
      question: question.trim(),
      answer: "",
      status: "streaming",
      created: Date.now(),
      model: s.model,
    };
    running.current = chat;
    setActive({ ...chat });
    const captured = `${chat.bookId}:${chat.page}`;
    let lastSave = 0;
    try {
      await saveChat(chat);
      await streamChat(id, messages, (delta) => {
        chat.answer += delta;
        setActive({ ...chat });
        if (Date.now() - lastSave > 800) {
          lastSave = Date.now();
          void saveChat({ ...chat }).catch((e) =>
            onError(`回答保存失败：${e}`),
          );
        }
      });
      if (!chat.answer.trim()) throw new Error("接口没有返回回答正文");
      if (chat.status !== "cancelled") chat.status = "complete";
    } catch (e) {
      chat.status = chat.status === "cancelled" ? "cancelled" : "error";
      chat.error = String(e);
      if (pageKey.current === captured) setLocalError(String(e));
    } finally {
      try {
        await saveChat({ ...chat });
        if (pageKey.current === captured) {
          setChats(await listChats(chat.bookId, chat.page));
          setFollow(chat);
        }
      } catch (e) {
        onError(`回答保存失败：${e}`);
      }
      running.current = null;
      setActive(null);
    }
  }
  return (
    <aside className="context-panel">
      <div className="panel-heading">
        <span className="eyebrow">
          <Sparkles size={13} />
          学习助手
        </span>
        <button onClick={onSettings}>设置</button>
      </div>
      <h2>把问题读明白。</h2>
      {selected ? (
        <>
          <small>
            第 {selected.page} 页 · {selected.annotationIds.length} 条相关批注
          </small>
          {selected.image && <img src={selected.image} alt="所选区域截图" />}
          <blockquote>
            {selected.text || "此区域无文本层，请启用视觉模型。"}
          </blockquote>
          {selected.image && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={includeImage}
                disabled={!supportsImages(s)}
                onChange={(e) => setIncludeImage(e.target.checked)}
              />
              发送区域截图
            </label>
          )}
          {selected.image && !supportsImages(s) && (
            <p className="vision-warning">
              当前模型不支持图片。将仅发送文字；公式图片解释请切换至视觉模型。
            </p>
          )}
          <textarea
            aria-label="你的问题"
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <div className="send-row">
            <small>{s.model}</small>
            <button
              className="primary"
              disabled={!!active || !question.trim()}
              onClick={() => void send()}
            >
              <Send size={14} />问 AI
            </button>
          </div>
          <small className="privacy-note">
            发送所选文字
            {includeImage && supportsImages(s) && selected.image
              ? "、截图"
              : ""}
            及附近内容至配置的接口。
          </small>
          {follow && (
            <button className="new-question" onClick={() => setFollow(null)}>
              开始新问题
            </button>
          )}
        </>
      ) : (
        <p>选择文字，或用“区域问 AI”框选公式。已有解释会保存在对应书页。</p>
      )}
      {localError && (
        <div role="alert" className="chat-error">
          {localError}
        </div>
      )}
      {active && (
        <div className="chat-card">
          <small>
            {active.page === book.page ? "正在回答" : "其他页面正在回答"} · 第{" "}
            {active.page} 页
          </small>
          <strong>{active.question}</strong>
          <div className="answer">{active.answer || "等待接口响应…"}</div>
          <button
            onClick={() => {
              if (running.current) {
                running.current.status = "cancelled";
                void cancelChat(active.id).catch((e) => onError(String(e)));
              }
            }}
          >
            <Square size={12} />
            停止生成
          </button>
        </div>
      )}
      <div className="chat-history">
        <div className="history-label">本页解释 · {chats.length}</div>
        {chats.map((c) => (
          <article
            key={c.id}
            className={`chat-card ${follow?.id === c.id ? "chosen" : ""}`}
          >
            <small>
              {new Date(c.created).toLocaleString("zh-CN")} · {c.model} ·{" "}
              {c.status === "complete"
                ? "已保存"
                : c.status === "streaming"
                  ? "上次生成未结束"
                  : c.status === "cancelled"
                    ? "已停止"
                    : "未完成"}
            </small>
            <strong>{c.question}</strong>
            <div className="answer">{c.answer || "无回答内容"}</div>
            {c.error && <small className="chat-error">{c.error}</small>}
            <button
              onClick={() => {
                setFollow(c);
                setQuestion("请进一步解释。");
              }}
            >
              查看关联 / 继续提问
            </button>
          </article>
        ))}
      </div>
    </aside>
  );
}
