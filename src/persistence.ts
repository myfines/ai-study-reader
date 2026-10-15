const pending = new Set<Promise<unknown>>();
const closeTasks = new Set<() => Promise<unknown>>();
export function registerCloseTask(task: () => Promise<unknown>) {
  closeTasks.add(task);
  return () => {
    closeTasks.delete(task);
  };
}
let failed = false;
export function trackWrite<T>(write: Promise<T>): Promise<T> {
  pending.add(write);
  void write
    .then(
      () => {},
      () => {
        failed = true;
      },
    )
    .finally(() => pending.delete(write));
  return write;
}
export async function flushWrites() {
  await Promise.all([...closeTasks].map((task) => task()));
  while (pending.size) {
    const results = await Promise.allSettled([...pending]);
    if (results.some((r) => r.status === "rejected")) failed = true;
  }
  if (failed) {
    failed = false;
    throw new Error("本次会话曾发生保存失败，请检查错误提示和数据后再次关闭。");
  }
}
