import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { isTauri } from "./env";

/** Use the native window API so macOS fullscreen gets its own Space. */
export async function toggleWindowFullscreen(
  win: Pick<Window, "isFullscreen" | "setFullscreen"> = getCurrentWindow(),
) {
  await win.setFullscreen(!(await win.isFullscreen()));
}

/** Also follow fullscreen changes made through the native menu/shortcut. */
export function useWindowFullscreen() {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!isTauri) return;
    const win = getCurrentWindow();
    let disposed = false;
    let revision = 0;
    const unlisten: Array<() => void> = [];
    const sync = async () => {
      const current = ++revision;
      try {
        const value = await win.isFullscreen();
        if (!disposed && current === revision) setFullscreen(value);
      } catch (error) {
        console.warn("[termany] could not read fullscreen state", error);
      }
    };
    const subscribe = async () => {
      for (const listen of [() => win.onResized(sync), () => win.onFocusChanged(sync)]) {
        const stop = await listen();
        if (disposed) { stop(); return; }
        unlisten.push(stop);
      }
      await sync();
    };
    void subscribe().catch((error) => console.warn("[termany] fullscreen listener failed", error));
    return () => {
      disposed = true;
      unlisten.forEach((stop) => stop());
    };
  }, []);
  return fullscreen;
}
