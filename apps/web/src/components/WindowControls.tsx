import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_MAC } from "../keybindings";
import { toggleWindowFullscreen } from "../windowFullscreen";

// Glyphs shown on hover, matching the macOS traffic lights (✕ / − / fill arrows).
const glyphs = {
  close: (
    <svg viewBox="0 0 12 12" aria-hidden>
      <path
        d="M3.4 3.4l5.2 5.2M8.6 3.4l-5.2 5.2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  ),
  min: (
    <svg viewBox="0 0 12 12" aria-hidden>
      <path d="M3 6h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  zoom: (
    <svg viewBox="0 0 12 12" aria-hidden>
      <path d="M3 3.4 L7 3.4 L3 7.4 Z M9 8.6 L5 8.6 L9 4.6 Z" fill="currentColor" />
    </svg>
  ),
};

/**
 * Custom traffic lights for borderless Windows/Linux windows. macOS uses
 * AppKit's real controls so Moom can discover and interact with the zoom button.
 * Rendered only inside the Tauri shell.
 */
export function WindowControls({ fullscreen }: { fullscreen: boolean }) {
  if (IS_MAC) return null;
  const win = getCurrentWindow();
  return (
    <div className="win-controls">
      <button className="win-dot close" aria-label="Close" onClick={() => void win.close()}>
        {glyphs.close}
      </button>
      <button className="win-dot min" aria-label="Minimize" onClick={() => void win.minimize()}>
        {glyphs.min}
      </button>
      <button
        className="win-dot zoom"
        aria-label={fullscreen ? "Exit Full Screen" : "Zoom"}
        title="Zoom"
        onClick={() => {
          if (fullscreen) void toggleWindowFullscreen(win);
          else void win.toggleMaximize();
        }}
      >
        {glyphs.zoom}
      </button>
    </div>
  );
}
