import { describe, it, expect } from "vitest";
import {
  pagePoint,
  screenPoint,
  rectangle,
  bounds,
  hit,
  undo,
  redo,
  commit,
  nearby,
  transformedTextBox,
  type Stroke,
} from "../src/annotations";
describe("page coordinates", () => {
  it("maps extracted text boxes for intrinsically rotated PDF pages", () => {
    expect(
      transformedTextBox(
        "formula",
        30,
        [12, 0, 0, 12, 0, 0],
        [0, 12, 12, 0, 100, 200],
      ),
    ).toEqual({ text: "formula", x: 100, y: 200, width: 12, height: 30 });
  });
  it("roundtrips the same formula position at every zoom", () => {
    const p = { x: 135, y: 410 };
    for (const zoom of [0.4, 1, 1.4, 3])
      expect(pagePoint(screenPoint(p, zoom), zoom)).toEqual(p);
  });
  it("normalizes reverse-drag selection", () =>
    expect(rectangle({ x: 200, y: 300 }, { x: 50, y: 100 })).toEqual({
      x: 50,
      y: 100,
      width: 150,
      height: 200,
    }));
  it("erases only strokes touching the pointer, not the empty center of a circle", () => {
    const s: Stroke = {
      id: "a",
      tool: "pen",
      color: "#111",
      width: 2,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
        { x: 0, y: 0 },
      ],
    };
    expect(hit(s, { x: 50, y: 50 }, 3)).toBe(false);
    expect(hit(s, { x: 50, y: 0 }, 3)).toBe(true);
    expect(bounds(s).width).toBe(100);
  });
  it("undoes and redoes an erase, resets redo after a new stroke", () => {
    const s: Stroke = {
      id: "a",
      tool: "rect",
      color: "#111",
      width: 2,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    };
    let h = commit({ past: [], present: [], future: [] }, [s]);
    h = commit(h, []);
    h = undo(h);
    expect(h.present).toEqual([s]);
    expect(redo(h).present).toEqual([]);
    expect(commit(h, [s, s]).future).toEqual([]);
  });
  it("extracts only text near selected formula", () =>
    expect(
      nearby(
        [
          { text: "formula", x: 100, y: 100, width: 30, height: 15 },
          { text: "footer", x: 100, y: 700, width: 30, height: 15 },
        ],
        { x: 90, y: 90, width: 50, height: 50 },
      ),
    ).toBe("formula"));
});
