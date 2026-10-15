import { useCloseGuard } from "./useCloseGuard";
import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Plus,
  Settings,
  FileText,
  ChevronLeft,
  ChevronRight,
  Library,
  WifiOff,
} from "lucide-react";
import {
  type Book,
  type SelectionContext,
  clampPage,
  mergeProgress,
} from "./core";
import { desktop, importBook, listBooks, saveProgress } from "./store";
import { Reader } from "./Reader";
import { ChatPanel } from "./ChatPanel";
import { SettingsDialog } from "./SettingsDialog";
import type { Tool } from "./annotations";
import type { AnnotationControls } from "./AnnotationLayer";
export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [book, setBook] = useState<Book | null>(null);
  const currentBook = useRef<Book | null>(null);
  currentBook.current = book;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const file = useRef<HTMLInputElement>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState("#456ad2");
  const [weight, setWeight] = useState(2);
  const [controls, setControls] = useState<AnnotationControls | null>(null);
  const [context, setContext] = useState<SelectionContext | null>(null);
  useEffect(() => {
    setContext(null);
    setControls(null);
    if (book?.kind === "txt") setTool("select");
  }, [book?.id, book?.page]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const report = (s: string) => setError(s);
  const refresh = () =>
    listBooks()
      .then(setBooks)
      .catch((e) => report(String(e)));
  useCloseGuard(report);
  useEffect(() => {
    void refresh();
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  async function add(f?: File) {
    try {
      setError("");
      const imported = await importBook(f);
      if (imported) {
        await refresh();
        setBook(imported);
      }
    } catch (e) {
      report(String(e));
    }
  }
  function change(patch: Partial<Book>) {
    if (!currentBook.current) return;
    const next = mergeProgress(currentBook.current, patch);
    currentBook.current = next;
    setBook(next);
    setBooks((prev) => prev.map((b) => (b.id === next.id ? next : b)));
    void saveProgress(next).catch((e) => report(String(e)));
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <BookOpen size={23} />
          <div>
            Study Reader<small>你的本地学习空间</small>
          </div>
        </div>
        <button
          className="import-button"
          onClick={() => (desktop ? void add() : file.current?.click())}
        >
          <Plus size={18} />
          导入文档
        </button>
        <input
          ref={file}
          type="file"
          accept=".pdf,.txt"
          hidden
          onChange={(e) => {
            void add(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <div className="section-label">
          <Library size={15} />
          我的书架 <span>{books.length}</span>
        </div>
        <nav>
          {books.map((b) => (
            <button
              key={b.id}
              className={`book-item ${book?.id === b.id ? "active" : ""}`}
              onClick={() => setBook(b)}
            >
              <FileText size={20} />
              <div>
                <strong>{b.name}</strong>
                <small>
                  {b.kind.toUpperCase()} · 第 {b.page} / {b.pages} 页
                </small>
              </div>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" />
          本地存储 · 离线可用
          <button aria-label="设置" onClick={() => setSettingsOpen(true)}>
            <Settings size={18} />
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <span className="eyebrow">阅读空间</span>
            <h1>{book?.name || "让每一次阅读，都有所得。"}</h1>
          </div>
          <span className="offline-badge">
            {online ? (
              "本地优先"
            ) : (
              <>
                <WifiOff size={14} />
                离线模式
              </>
            )}
          </span>
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
            <button onClick={() => setError("")}>关闭</button>
          </div>
        )}
        {notice && (
          <div className="notice">
            {notice}
            <button onClick={() => setNotice("")}>关闭</button>
          </div>
        )}
        {book ? (
          <>
            <div className="toolbar">
              <button
                aria-label="上一页"
                disabled={book.page <= 1}
                onClick={() => change({ page: book.page - 1 })}
              >
                <ChevronLeft size={17} />
              </button>
              <label>
                页码{" "}
                <input
                  aria-label="页码"
                  type="number"
                  min={1}
                  max={book.pages}
                  value={book.page}
                  onChange={(e) =>
                    change({
                      page: clampPage(Number(e.target.value), book.pages),
                    })
                  }
                />
              </label>
              <span>/ {book.pages}</span>
              <button
                aria-label="下一页"
                disabled={book.page >= book.pages}
                onClick={() => change({ page: book.page + 1 })}
              >
                <ChevronRight size={17} />
              </button>
              <div className="divider" />
              <button
                aria-label="缩小"
                onClick={() =>
                  change({ zoom: Math.max(0.4, +(book.zoom - 0.2).toFixed(2)) })
                }
              >
                −
              </button>
              <select
                aria-label="缩放"
                value={book.zoom}
                onChange={(e) => change({ zoom: Number(e.target.value) })}
              >
                {Array.from(
                  new Set([
                    0.4,
                    0.6,
                    0.8,
                    1,
                    1.2,
                    1.4,
                    1.6,
                    2,
                    2.5,
                    3,
                    book.zoom,
                  ]),
                )
                  .sort((a, b) => a - b)
                  .map((z) => (
                    <option value={z} key={z}>
                      {Math.round(z * 100)}%
                    </option>
                  ))}
              </select>
              <button
                aria-label="放大"
                onClick={() =>
                  change({ zoom: Math.min(3, +(book.zoom + 0.2).toFixed(2)) })
                }
              >
                ＋
              </button>
            </div>
            <div className="toolbar tool-tray">
              {(
                [
                  ["select", "文字选择"],
                  ["pen", "画笔"],
                  ["highlight", "荧光笔"],
                  ["rect", "矩形"],
                  ["eraser", "橡皮擦"],
                  ["region", "区域问 AI"],
                ] as [Tool, string][]
              ).map(([t, label]) => (
                <button
                  key={t}
                  disabled={book.kind === "txt" && t !== "select"}
                  className={tool === t ? "selected" : ""}
                  onClick={() => setTool(t)}
                >
                  {label}
                </button>
              ))}
              <input
                aria-label="批注颜色"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
              <select
                aria-label="画笔粗细"
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value))}
              >
                {[1, 2, 4, 6].map((w) => (
                  <option key={w}>{w}</option>
                ))}
              </select>
              <button
                disabled={!controls?.canUndo}
                onClick={() => controls?.undo()}
              >
                撤销
              </button>
              <button
                disabled={!controls?.canRedo}
                onClick={() => controls?.redo()}
              >
                重做
              </button>
              <span className="save-status">
                {controls?.saving
                  ? "保存中…"
                  : `本页 ${controls?.count || 0} 条批注 · 自动保存`}
              </span>
            </div>
            <div className="reading-body">
              <Reader
                key={book.id}
                book={book}
                tool={tool}
                color={color}
                weight={weight}
                onControls={setControls}
                onContext={setContext}
                onPages={(n) => change({ pages: n })}
                onError={report}
                onPosition={(scroll) => change({ scroll })}
              />
              <ChatPanel
                book={book}
                context={context}
                settingsVersion={settingsVersion}
                onSettings={() => setSettingsOpen(true)}
                onError={report}
              />
            </div>
          </>
        ) : (
          <div className="empty">
            <div className="empty-icon">
              <BookOpen size={46} />
            </div>
            <span className="eyebrow">READ · ANNOTATE · UNDERSTAND</span>
            <h2>把疑问，留在书页上。</h2>
            <p>
              导入 PDF 或 TXT，建立属于你的学习书架。
              <br />
              文档与阅读进度保存在这台电脑。
            </p>
            <button
              className="primary"
              onClick={() => (desktop ? void add() : file.current?.click())}
            >
              <Plus size={18} />
              导入第一份文档
            </button>
            <div className="feature-strip">
              <span>PDF / TXT</span>
              <span>本地保存</span>
              <span>无需账号</span>
            </div>
            {!desktop && (
              <small>
                浏览器预览使用 IndexedDB；完整 SQLite / AI
                安全存储请运行桌面版。
              </small>
            )}
          </div>
        )}
      </main>
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={() => setSettingsVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}
