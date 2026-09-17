import type { ITerminalAddon, Terminal } from "@xterm/xterm";

/** xterm 5.5 has no public API to end a drag while preserving its selection. */
interface SelectionService {
  _dragScrollIntervalTimer: number | undefined;
  _removeMouseDownListeners(): void;
  _handleMouseUp(event: MouseEvent): void;
}

/**
 * xterm 5.5's document mousemove listener assumes mouseup is always delivered
 * and never checks event.buttons. A lost trackpad release can therefore make
 * hovering select cells indefinitely. Capture releases before other handlers
 * can swallow them, and stop stale listeners/timers before a hover reaches
 * xterm. Never synthesize a mouseup: cancellation must not send Alt-click
 * cursor movement to the shell or overwrite the clipboard.
 */
export class TerminalSelectionGuard implements ITerminalAddon {
  private cleanup: (() => void) | undefined;
  private cancelGesture: (() => void) | undefined;

  constructor(private readonly copy: (text: string) => void) {}

  activate(term: Terminal) {
    const element = term.element;
    const doc = element?.ownerDocument;
    const win = doc?.defaultView;
    const selection = (term as unknown as { _core?: { _selectionService?: SelectionService } })
      ._core?._selectionService;
    if (!element || !doc || !win ||
      typeof selection?._removeMouseDownListeners !== "function" ||
      typeof selection?._handleMouseUp !== "function") {
      throw new Error("Terminal selection guard requires an opened xterm 5.5 terminal");
    }

    let gesture: { x: number; y: number; clicks: number; dragged: boolean } | null = null;
    const active = () => selection._dragScrollIntervalTimer !== undefined;
    const cancel = () => {
      gesture = null;
      if (active()) selection._removeMouseDownListeners();
    };
    const down = (event: MouseEvent) => {
      cancel();
      if (event.button !== 0 || !element.contains(event.target as Node)) return;
      gesture = { x: event.clientX, y: event.clientY, clicks: event.detail, dragged: false };
    };
    const move = (event: MouseEvent) => {
      if (!(event.buttons & 1)) { cancel(); return; }
      if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= 4) {
        gesture.dragged = true;
      }
    };
    const up = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const completed = gesture;
      gesture = null;
      if (!active()) return;
      // Run xterm's real release exactly once, retaining word/line/column
      // selections and deliberate Alt-click behavior. The compatibility
      // mouseup after pointerup is harmless because this removes its listener.
      selection._handleMouseUp(event);
      if (!completed || (!completed.dragged && completed.clicks < 2)) return;
      const text = term.getSelection();
      if (text.trim()) this.copy(text);
    };
    const pointerUp = (event: PointerEvent) => {
      if (event.isPrimary && event.pointerType === "mouse") up(event);
    };
    const pointerMove = (event: PointerEvent) => {
      if (event.isPrimary && event.pointerType === "mouse") move(event);
    };
    const pointerCancel = (event: PointerEvent) => {
      if (event.isPrimary && event.pointerType === "mouse") cancel();
    };
    const visibility = () => { if (doc.hidden) cancel(); };

    win.addEventListener("mousedown", down, true);
    win.addEventListener("mousemove", move, true);
    win.addEventListener("mouseup", up, true);
    win.addEventListener("pointerup", pointerUp, true);
    win.addEventListener("pointermove", pointerMove, true);
    win.addEventListener("pointercancel", pointerCancel, true);
    win.addEventListener("blur", cancel);
    doc.addEventListener("visibilitychange", visibility);
    this.cancelGesture = cancel;
    this.cleanup = () => {
      cancel();
      win.removeEventListener("mousedown", down, true);
      win.removeEventListener("mousemove", move, true);
      win.removeEventListener("mouseup", up, true);
      win.removeEventListener("pointerup", pointerUp, true);
      win.removeEventListener("pointermove", pointerMove, true);
      win.removeEventListener("pointercancel", pointerCancel, true);
      win.removeEventListener("blur", cancel);
      doc.removeEventListener("visibilitychange", visibility);
    };
  }

  cancel() { this.cancelGesture?.(); }

  dispose() {
    this.cleanup?.();
    this.cleanup = undefined;
    this.cancelGesture = undefined;
  }
}
