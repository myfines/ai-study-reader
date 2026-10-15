import { useEffect, useRef, useState } from "react";
import { pdfjs } from "./pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { decodeText, type Book, type SelectionContext } from "./core";
import { readBook } from "./store";
import { AnnotationLayer, type AnnotationControls } from "./AnnotationLayer";
import {
  nearby,
  transformedTextBox,
  type Rect,
  type Stroke,
  type TextBox,
  type Tool,
} from "./annotations";
export function Reader({
  book,
  onPages,
  onError,
  tool,
  color,
  weight,
  onControls,
  onContext,
  onPosition,
}: {
  book: Book;
  onPages: (n: number) => void;
  onError: (s: string) => void;
  tool: Tool;
  color: string;
  weight: number;
  onControls: (c: AnnotationControls) => void;
  onContext: (c: SelectionContext) => void;
  onPosition: (fraction: number) => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [text, setText] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 600, height: 800 });
  const [loading, setLoading] = useState(true);
  const textItems = useRef<TextBox[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const restoring = useRef(true);
  const onPositionRef = useRef(onPosition);
  onPositionRef.current = onPosition;
  useEffect(() => {
    restoring.current = true;
    if (loading) return;
    const el = scroller.current!;
    el.scrollTop =
      (book.scroll || 0) * Math.max(0, el.scrollHeight - el.clientHeight);
    restoring.current = false;
  }, [loading, book.id, book.page]);
  async function captureRegion(r: Rect, strokes: Stroke[]) {
    try {
      const c = canvas.current!;
      const ratio = c.width / (size.width / book.zoom);
      const source = {
        x: r.x * ratio,
        y: r.y * ratio,
        width: r.width * ratio,
        height: r.height * ratio,
      };
      const target = document.createElement("canvas");
      const factor = Math.min(1, 1600 / Math.max(source.width, source.height));
      target.width = Math.max(1, Math.round(source.width * factor));
      target.height = Math.max(1, Math.round(source.height * factor));
      target
        .getContext("2d")!
        .drawImage(
          c,
          source.x,
          source.y,
          source.width,
          source.height,
          0,
          0,
          target.width,
          target.height,
        );
      onContext({
        bookId: book.id,
        page: book.page,
        text: nearby(textItems.current, r),
        pageText: textItems.current
          .map((t) => t.text)
          .join(" ")
          .slice(0, 12000),
        image: target.toDataURL("image/png"),
        rect: r,
        annotationIds: strokes.map((s) => s.id),
        annotations: strokes,
      });
    } catch (e) {
      onError(`截取区域失败：${e}`);
    }
  }
  useEffect(() => {
    let disposed = false;
    let task: ReturnType<typeof pdfjs.getDocument> | undefined;
    setPdf(null);
    setText("");
    setLoading(true);
    void readBook(book.id)
      .then((data) => {
        if (disposed) return;
        if (book.kind === "txt") {
          setText(decodeText(data));
          onPages(1);
          setLoading(false);
          return;
        }
        task = pdfjs.getDocument({
          data,
          cMapUrl: "/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/standard_fonts/",
          wasmUrl: "/wasm/",
        });
        return task.promise.then((doc) => {
          if (!disposed) {
            setPdf(doc);
            onPages(doc.numPages);
          }
        });
      })
      .catch((e) => {
        if (!disposed) {
          setLoading(false);
          onError(String(e));
        }
      });
    return () => {
      disposed = true;
      void task?.destroy();
    };
  }, [book.id]);
  useEffect(() => {
    if (!pdf || !canvas.current || !layer.current) return;
    let disposed = false;
    let render:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    let textLayer: InstanceType<typeof pdfjs.TextLayer> | undefined;
    setLoading(true);
    void pdf
      .getPage(book.page)
      .then(async (page) => {
        if (disposed) return;
        const viewport = page.getViewport({ scale: book.zoom });
        setSize({ width: viewport.width, height: viewport.height });
        const c = canvas.current!;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        c.width = Math.ceil(viewport.width * dpr);
        c.height = Math.ceil(viewport.height * dpr);
        const ctx = c.getContext("2d")!;
        render = page.render({
          canvasContext: ctx,
          canvas: c,
          viewport,
          transform: [dpr, 0, 0, dpr, 0, 0],
        });
        await render.promise;
        if (disposed) return;
        layer.current!.replaceChildren();
        layer.current!.style.setProperty("--scale-factor", String(book.zoom));
        const content = await page.getTextContent();
        if (disposed) return;
        const canonical = page.getViewport({ scale: 1 });
        textItems.current = content.items
          .filter((i) => "str" in i)
          .map((i) => {
            if (!("str" in i)) throw new Error("无效文本");
            const t = pdfjs.Util.transform(canonical.transform, i.transform);
            return transformedTextBox(i.str, i.width, i.transform, t);
          });
        textLayer = new pdfjs.TextLayer({
          textContentSource: content,
          container: layer.current!,
          viewport,
        });
        await textLayer.render();
        if (!disposed) setLoading(false);
      })
      .catch((e) => {
        if (!disposed) {
          setLoading(false);
          onError(String(e));
        }
      });
    return () => {
      disposed = true;
      render?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, book.page, book.zoom]);
  return (
    <div
      ref={scroller}
      className="reader-scroll"
      data-testid="reader-scroll"
      onScroll={(event) => {
        if (restoring.current || loading) return;
        const el = event.currentTarget;
        onPositionRef.current(
          el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight),
        );
      }}
      onMouseUp={() => {
        if (tool !== "select") return;
        const selection = window.getSelection();
        const selected = selection?.toString().trim();
        if (!selected || !selection?.anchorNode) return;
        const root =
          book.kind === "txt"
            ? document.querySelector(".txt-page")
            : layer.current;
        if (!root?.contains(selection.anchorNode)) return;
        onContext({
          bookId: book.id,
          page: book.page,
          text: selected.slice(0, 12000),
          pageText:
            book.kind === "txt"
              ? text.slice(
                  Math.max(0, text.indexOf(selected) - 500),
                  text.indexOf(selected) + selected.length + 500,
                )
              : textItems.current
                  .map((t) => t.text)
                  .join(" ")
                  .slice(0, 12000),
          annotationIds: [],
          annotations: [],
        });
      }}
    >
      {loading && <div className="loading">正在打开本地文档…</div>}
      {book.kind === "txt" ? (
        <article className="txt-page" style={{ fontSize: 18 * book.zoom }}>
          {text}
        </article>
      ) : (
        <div
          className="pdf-page"
          style={{ width: size.width, height: size.height }}
        >
          <canvas ref={canvas} style={size} />
          <div ref={layer} className="textLayer" />
          <div style={{ visibility: loading ? "hidden" : "visible" }}>
            <AnnotationLayer
              bookId={book.id}
              page={book.page}
              zoom={book.zoom}
              width={size.width}
              height={size.height}
              tool={tool}
              color={color}
              weight={weight}
              onRegion={captureRegion}
              onControls={onControls}
              onError={onError}
            />
          </div>
        </div>
      )}
    </div>
  );
}
