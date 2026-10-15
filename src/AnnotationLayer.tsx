import { useEffect, useRef, useState } from "react";
import {
  bounds,
  commit,
  draw,
  hit,
  intersects,
  pagePoint,
  rectangle,
  undo,
  redo,
  type History,
  type Point,
  type Rect,
  type Stroke,
  type Tool,
} from "./annotations";
import { loadAnnotations, saveAnnotations } from "./annotationStore";
export interface AnnotationControls {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  count: number;
  saving: boolean;
}
export function AnnotationLayer({
  bookId,
  page,
  zoom,
  width,
  height,
  tool,
  color,
  weight,
  onRegion,
  onControls,
  onError,
}: {
  bookId: string;
  page: number;
  zoom: number;
  width: number;
  height: number;
  tool: Tool;
  color: string;
  weight: number;
  onRegion: (r: Rect, strokes: Stroke[]) => void;
  onControls: (c: AnnotationControls) => void;
  onError: (s: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const history = useRef<History>({ past: [], present: [], future: [] });
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [region, setRegion] = useState<Rect | null>(null);
  const drag = useRef<{
    start: Point;
    points: Point[];
    before: Stroke[];
  } | null>(null);
  const identity = useRef("");
  const key = `${bookId}:${page}`;
  identity.current = key;
  useEffect(() => {
    let gone = false;
    setReady(false);
    setRegion(null);
    drag.current = null;
    void loadAnnotations(bookId, page)
      .then((strokes) => {
        if (!gone) {
          history.current = { past: [], present: strokes, future: [] };
          setVersion((v) => v + 1);
          setReady(true);
        }
      })
      .catch((e) => {
        if (!gone) onError(`无法恢复批注：${e}`);
      });
    return () => {
      gone = true;
    };
  }, [key]);
  function repaint(preview?: Stroke) {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    const dpr = c.width / width;
    ctx.save();
    ctx.scale(dpr, dpr);
    draw(
      ctx,
      preview ? [...history.current.present, preview] : history.current.present,
      zoom,
    );
    if (region) {
      ctx.strokeStyle = "#50765a";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(
        region.x * zoom,
        region.y * zoom,
        region.width * zoom,
        region.height * zoom,
      );
    }
    ctx.restore();
  }
  useEffect(() => {
    const c = canvas.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.ceil(width * dpr);
    c.height = Math.ceil(height * dpr);
    repaint();
  }, [width, height, zoom, version, region]);
  function persist(h: History) {
    history.current = h;
    setVersion((v) => v + 1);
    setSaving(true);
    const captured = key;
    void saveAnnotations(bookId, page, h.present)
      .catch((e) => onError(`批注保存失败，请勿关闭应用：${e}`))
      .finally(() => {
        if (identity.current === captured) setSaving(false);
      });
  }
  useEffect(() => {
    onControls({
      undo: () => persist(undo(history.current)),
      redo: () => persist(redo(history.current)),
      canUndo: history.current.past.length > 0,
      canRedo: history.current.future.length > 0,
      count: history.current.present.length,
      saving,
    });
  }, [version, ready, saving, key]);
  function point(e: React.PointerEvent): Point {
    const r = canvas.current!.getBoundingClientRect();
    const p = pagePoint({ x: e.clientX - r.left, y: e.clientY - r.top }, zoom);
    return {
      x: Math.max(0, Math.min(width / zoom, p.x)),
      y: Math.max(0, Math.min(height / zoom, p.y)),
    };
  }
  function stroke(points: Point[]): Stroke {
    return {
      id: crypto.randomUUID(),
      tool:
        tool === "highlight" ? "highlight" : tool === "rect" ? "rect" : "pen",
      color,
      width: tool === "highlight" ? weight * 6 : weight,
      points,
    };
  }
  return (
    <canvas
      data-testid="annotation-canvas"
      ref={canvas}
      className="annotation-layer"
      style={{
        width,
        height,
        pointerEvents: tool === "select" || !ready ? "none" : "auto",
        cursor:
          tool === "eraser"
            ? "crosshair"
            : tool === "pen"
              ? "crosshair"
              : "cell",
      }}
      onPointerDown={(e) => {
        if (e.button !== 0 || !ready) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = point(e);
        drag.current = {
          start: p,
          points: [p],
          before: history.current.present,
        };
        if (tool === "eraser") {
          history.current = {
            ...history.current,
            present: history.current.present.filter(
              (s) => !hit(s, p, 6 / zoom),
            ),
          };
          repaint();
        }
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const p = point(e);
        if (tool === "eraser") {
          history.current = {
            ...history.current,
            present: history.current.present.filter(
              (s) => !hit(s, p, 6 / zoom),
            ),
          };
          repaint();
          return;
        }
        if (tool === "region") {
          setRegion(rectangle(d.start, p));
          return;
        }
        if (tool === "rect") d.points = [d.start, p];
        else d.points.push(p);
        repaint(stroke(d.points));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
        if (tool === "region") {
          const r = rectangle(d.start, point(e));
          if (r.width > 3 && r.height > 3) {
            setRegion(r);
            onRegion(
              r,
              history.current.present.filter((s) => intersects(bounds(s), r)),
            );
          }
          return;
        }
        if (tool === "eraser") {
          const next = history.current.present;
          history.current.present = d.before;
          if (next.length !== d.before.length)
            persist(commit(history.current, next));
          return;
        }
        const s = stroke(d.points);
        persist(commit(history.current, [...history.current.present, s]));
      }}
      onPointerCancel={() => {
        if (drag.current) {
          history.current.present = drag.current.before;
          drag.current = null;
          repaint();
        }
      }}
    />
  );
}
