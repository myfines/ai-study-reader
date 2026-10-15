export type Kind = "pdf" | "txt";
export interface Book {
  id: string;
  name: string;
  kind: Kind;
  page: number;
  pages: number;
  zoom: number;
  added: number;
  scroll?: number;
}
export interface SelectionContext {
  bookId: string;
  page: number;
  text: string;
  pageText: string;
  image?: string;
  rect?: import("./annotations").Rect;
  annotationIds: string[];
  annotations: import("./annotations").Stroke[];
}
export function mergeProgress(book: Book, patch: Partial<Book>): Book {
  const next = { ...book, ...patch };
  next.page = clampPage(next.page, next.pages);
  if (next.page !== book.page) next.scroll = 0;
  return next;
}
export function fileKind(name: string): Kind {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext !== "pdf" && ext !== "txt") throw new Error("仅支持 PDF / TXT 文件");
  return ext;
}
export function clampPage(page: number, total: number) {
  return Math.max(
    1,
    Math.min(Math.max(1, total), Number.isFinite(page) ? Math.trunc(page) : 1),
  );
}
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 255 && bytes[1] === 254)
    return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 254 && bytes[1] === 255)
    return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}
