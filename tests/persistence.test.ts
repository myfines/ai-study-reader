import { it, expect } from "vitest";
import { trackWrite, flushWrites } from "../src/persistence";
it("waits for pending local writes before closing and reports failures", async () => {
  let finish: () => void = () => {};
  let persisted = false;
  trackWrite(
    new Promise<void>((r) => {
      finish = () => {
        persisted = true;
        r();
      };
    }),
  );
  let closed = false;
  const closing = flushWrites().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  finish();
  await closing;
  expect(persisted).toBe(true);
  trackWrite(Promise.reject(new Error("disk full"))).catch(() => {});
  await expect(flushWrites()).rejects.toThrow(/保存失败/);
  await expect(flushWrites()).resolves.toBeUndefined();
});
