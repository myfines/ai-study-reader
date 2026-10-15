export interface Point {
  x: number;
  y: number;
}
export interface Rect extends Point {
  width: number;
  height: number;
}
export type Tool =
  "select" | "pen" | "highlight" | "rect" | "eraser" | "region";
export interface Stroke {
  id: string;
  tool: "pen" | "highlight" | "rect";
  color: string;
  width: number;
  points: Point[];
}
export interface History {
  past: Stroke[][];
  present: Stroke[];
  future: Stroke[][];
}
export function pagePoint(p: Point, zoom: number): Point {
  return { x: p.x / zoom, y: p.y / zoom };
}
export function screenPoint(p: Point, zoom: number): Point {
  return { x: p.x * zoom, y: p.y * zoom };
}
export function rectangle(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}
export function bounds(s: Stroke): Rect {
  const xs = s.points.map((p) => p.x),
    ys = s.points.map((p) => p.y);
  return rectangle(
    { x: Math.min(...xs), y: Math.min(...ys) },
    { x: Math.max(...xs), y: Math.max(...ys) },
  );
}
export function intersects(a: Rect, b: Rect) {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}
function distance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function hit(s: Stroke, p: Point, tolerance: number): boolean {
  let points = s.points;
  if (s.tool === "rect") {
    const r = bounds(s);
    points = [
      r,
      { x: r.x + r.width, y: r.y },
      { x: r.x + r.width, y: r.y + r.height },
      { x: r.x, y: r.y + r.height },
      r,
    ];
  }
  if (points.length === 1)
    return (
      Math.hypot(p.x - points[0].x, p.y - points[0].y) <=
      tolerance + s.width / 2
    );
  return points
    .slice(1)
    .some((b, i) => distance(p, points[i], b) <= tolerance + s.width / 2);
}
export function commit(h: History, next: Stroke[]): History {
  return { past: [...h.past.slice(-49), h.present], present: next, future: [] };
}
export function undo(h: History): History {
  if (!h.past.length) return h;
  return {
    past: h.past.slice(0, -1),
    present: h.past.at(-1)!,
    future: [h.present, ...h.future],
  };
}
export function redo(h: History): History {
  if (!h.future.length) return h;
  return {
    past: [...h.past, h.present],
    present: h.future[0],
    future: h.future.slice(1),
  };
}
export interface TextBox extends Rect {
  text: string;
}
export function transformedTextBox(
  text: string,
  width: number,
  source: number[],
  transform: number[],
): TextBox {
  const base = { x: transform[4], y: transform[5] };
  const sourceLength = Math.hypot(source[0], source[1]) || 1;
  const delta = {
    x: (transform[0] * width) / sourceLength,
    y: (transform[1] * width) / sourceLength,
  };
  const corners = [
    base,
    { x: base.x + delta.x, y: base.y + delta.y },
    { x: base.x + transform[2], y: base.y + transform[3] },
    { x: base.x + delta.x + transform[2], y: base.y + delta.y + transform[3] },
  ];
  const xs = corners.map((p) => p.x),
    ys = corners.map((p) => p.y);
  return {
    text,
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}
export function nearby(items: TextBox[], r: Rect) {
  const expanded = {
    x: r.x - 24,
    y: r.y - 24,
    width: r.width + 48,
    height: r.height + 48,
  };
  return items
    .filter((t) => intersects(t, expanded))
    .map((t) => t.text)
    .join(" ")
    .slice(0, 12000);
}
export function draw(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  zoom: number,
) {
  ctx.save();
  ctx.scale(zoom, zoom);
  for (const s of strokes) {
    if (!s.points.length) continue;
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = s.tool === "highlight" ? 0.28 : 1;
    ctx.beginPath();
    if (s.tool === "rect") {
      const r = bounds(s);
      ctx.strokeRect(r.x, r.y, r.width, r.height);
    } else {
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
      if (s.points.length === 1) {
        ctx.arc(s.points[0].x, s.points[0].y, s.width / 2, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}
