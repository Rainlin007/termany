import type { Terminal } from "@xterm/xterm";

/** Preserve Shift+Enter, which xterm 5 otherwise encodes as a plain Enter. */
export function handleShiftEnter(event: KeyboardEvent, term: Pick<Terminal, "input">): boolean {
  if (
    event.type !== "keydown" ||
    event.key !== "Enter" ||
    !event.shiftKey ||
    event.altKey || event.ctrlKey || event.metaKey ||
    event.isComposing || event.keyCode === 229
  ) {
    return true;
  }

  // CSI-u: Enter (13) with Shift (1 + 1). Codex and other supporting TUIs
  // can distinguish this from submission. Use xterm's input pipeline so the
  // normal onData handling (including SSH and activity tracking) still runs.
  event.preventDefault();
  event.stopPropagation();
  term.input("\x1b[13;2u", true);
  return false;
}
