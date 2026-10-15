import { trackWrite } from "./persistence";
import { invoke } from "@tauri-apps/api/core";
import { desktop, webGet, webPut } from "./store";
import type { Stroke } from "./annotations";
const queues = new Map<string, Promise<unknown>>();
export async function loadAnnotations(
  bookId: string,
  page: number,
): Promise<Stroke[]> {
  const key = `${bookId}:${page}`;
  await queues.get(key);
  return desktop
    ? invoke("load_annotations", { bookId, page })
    : (await webGet<Stroke[]>("pages", key)) || [];
}
export function saveAnnotations(
  bookId: string,
  page: number,
  strokes: Stroke[],
) {
  const key = `${bookId}:${page}`;
  const previous = queues.get(key) || Promise.resolve();
  const job = previous
    .catch(() => {})
    .then(() =>
      desktop
        ? invoke("save_annotations", {
            bookId,
            page,
            data: JSON.stringify(strokes),
          })
        : webPut("pages", strokes, key),
    );
  queues.set(key, job);
  void job
    .finally(() => {
      if (queues.get(key) === job) queues.delete(key);
    })
    .catch(() => {});
  return trackWrite(job);
}
