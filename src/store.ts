import { trackWrite } from "./persistence";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { fileKind, type Book } from "./core";
export const desktop = isTauri();
let dbPromise: Promise<IDBDatabase> | undefined;
function browserDB() {
  return (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("ai-study-reader-preview", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("books", { keyPath: "id" });
      req.result.createObjectStore("data");
      req.result.createObjectStore("pages");
      req.result.createObjectStore("chats", { keyPath: "id" });
      req.result.createObjectStore("settings");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
async function transaction<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await browserDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export const webGet = <T>(store: string, key: string) =>
  transaction<T>(store, "readonly", (s) => s.get(key));
export const webPut = (store: string, value: unknown, key?: string) =>
  transaction(store, "readwrite", (s) =>
    key === undefined ? s.put(value) : s.put(value, key),
  );
export async function listBooks(): Promise<Book[]> {
  const books = desktop
    ? await invoke<Book[]>("list_books")
    : await transaction<Book[]>("books", "readonly", (s) => s.getAll());
  return books.sort((a, b) => b.added - a.added);
}
export async function importBook(file?: File): Promise<Book | null> {
  if (desktop) {
    const path = await open({
      multiple: false,
      filters: [{ name: "文档", extensions: ["pdf", "txt"] }],
    });
    return typeof path === "string"
      ? invoke<Book>("import_document", { path })
      : null;
  }
  if (!file) return null;
  const kind = fileKind(file.name);
  if (file.size > 200 * 1024 * 1024) throw new Error("文件上限为 200 MB");
  const data = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", data);
  const id = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const old = await webGet<Book | undefined>("books", id);
  if (old) return old;
  const book: Book = {
    id,
    name: file.name,
    kind,
    page: 1,
    pages: 1,
    zoom: 1,
    added: Date.now(),
  };
  await webPut("data", data, id);
  await webPut("books", book);
  return book;
}
export async function readBook(id: string): Promise<Uint8Array> {
  if (desktop)
    return new Uint8Array(await invoke<ArrayBuffer>("read_document", { id }));
  const data = await webGet<ArrayBuffer>("data", id);
  if (!data) throw new Error("本地文档不存在");
  return new Uint8Array(data);
}
const progressQueues = new Map<string, Promise<unknown>>();
export function saveProgress(book: Book) {
  const previous = progressQueues.get(book.id) || Promise.resolve();
  const copy = { ...book };
  const job = previous
    .catch(() => {})
    .then(() =>
      desktop ? invoke("save_progress", { book: copy }) : webPut("books", copy),
    );
  progressQueues.set(book.id, job);
  void job
    .finally(() => {
      if (progressQueues.get(book.id) === job) progressQueues.delete(book.id);
    })
    .catch(() => {});
  return trackWrite(job);
}
