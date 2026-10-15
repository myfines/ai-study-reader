import { describe, it, expect } from "vitest";
import {
  fileKind,
  decodeText,
  clampPage,
  mergeProgress,
  type Book,
} from "../src/core";
describe("library and reading", () => {
  it("keeps current page when a late document load reports the page count", () => {
    const book: Book = {
      id: "b",
      name: "a.pdf",
      kind: "pdf",
      page: 2,
      pages: 2,
      zoom: 1.2,
      added: 0,
      scroll: 0.3,
    };
    expect(mergeProgress(book, { pages: 2 })).toEqual(book);
    expect(mergeProgress(book, { page: 1 }).scroll).toBe(0);
    expect(mergeProgress(book, { zoom: 1.4 }).scroll).toBe(0.3);
  });
  it("accepts PDF and TXT case insensitively and rejects other formats", () => {
    expect(fileKind("Formula.PDF")).toBe("pdf");
    expect(fileKind("notes.txt")).toBe("txt");
    expect(() => fileKind("bad.exe")).toThrow();
  });
  it("decodes UTF8 BOM and UTF16 Windows text", () => {
    expect(decodeText(new Uint8Array([239, 187, 191, 65]))).toBe("A");
    expect(decodeText(new Uint8Array([255, 254, 65, 0]))).toBe("A");
  });
  it("clamps page navigation to available pages", () => {
    expect(clampPage(99, 5)).toBe(5);
    expect(clampPage(-2, 5)).toBe(1);
    expect(clampPage(NaN, 5)).toBe(1);
  });
});
