import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { desktop } from "./store";
import { flushWrites } from "./persistence";
export function useCloseGuard(onError: (s: string) => void) {
  useEffect(() => {
    if (!desktop) return;
    let cleanup: (() => void) | undefined;
    let gone = false;
    let closing = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing) return;
        closing = true;
        try {
          await flushWrites();
          await getCurrentWindow().destroy();
        } catch (e) {
          closing = false;
          onError(String(e));
        }
      })
      .then((fn) => {
        if (gone) fn();
        else cleanup = fn;
      })
      .catch((e) => onError(String(e)));
    return () => {
      gone = true;
      cleanup?.();
    };
  }, []);
}
