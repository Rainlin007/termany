// WebKit #219670: an IME can defer a tap's down until AFTER its up. DOM
// timeStamp retains the native event time, so this can be distinguished from
// the next press of a double-click without guessing from delivery intervals.
// https://bugs.webkit.org/show_bug.cgi?id=219670
const TAP_WINDOW_MS = 250;
const reorderedDowns = new WeakSet<Event>();

export const isReorderedMacTap = (event: Event) => reorderedDowns.has(event);

function matches(up: MouseEvent | null, down: MouseEvent, age: number): up is MouseEvent {
  return !!up && age <= TAP_WINDOW_MS && down.button === 0 && up.button === 0 &&
    up.buttons === 0 && down.target === up.target && down.timeStamp > 0 &&
    down.timeStamp <= up.timeStamp && up.timeStamp - down.timeStamp <= TAP_WINDOW_MS &&
    Math.hypot(down.clientX - up.clientX, down.clientY - up.clientY) <= 4;
}

/** Install before React/xterm. Normal input is never delayed or intercepted. */
export function installMacTapCompatibility(win: Window & typeof globalThis) {
  let mouseUp: MouseEvent | null = null;
  let pointerUp: PointerEvent | null = null;
  let mouseUpAt = 0;
  let pointerUpAt = 0;
  let pointerDown: PointerEvent | null = null;
  let timer: number | undefined;
  type Tap = {
    down: MouseEvent; up: MouseEvent; pointer: PointerEvent | null;
    sawMouseUp: boolean; sawPointerUp: boolean; sawClick: boolean; sawDoubleClick: boolean;
    repairedAt?: number; clicks: Set<string>;
  };
  let pending: Tap | null = null;
  let repaired: Tap | null = null;

  const clearPending = () => {
    if (timer !== undefined) win.clearTimeout(timer);
    timer = undefined;
    pending = null;
  };
  const reset = () => {
    clearPending();
    mouseUp = pointerUp = pointerDown = null;
    repaired = null;
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!event.isTrusted || event.pointerType !== "mouse" || !event.isPrimary || event.button !== 0) return;
    clearPending();
    repaired = null;
    pointerDown = event;
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!event.isTrusted || event.pointerType !== "mouse" || !event.isPrimary || event.button !== 0) return;
    pointerUp = event;
    pointerUpAt = win.performance.now();
    if (pending) pending.sawPointerUp = true;
  };
  const onMouseUp = (event: MouseEvent) => {
    if (!event.isTrusted || event.button !== 0) return;
    mouseUp = event;
    mouseUpAt = win.performance.now();
    if (pending) pending.sawMouseUp = true;
  };
  const onClick = (event: MouseEvent) => {
    if (!event.isTrusted || event.button !== 0) return;
    if (pending && event.target === pending.down.target) {
      if (event.type === "click") pending.sawClick = true;
      else pending.sawDoubleClick = true;
    }
    // A delayed native click must not activate a tab/control twice. A fresh
    // press clears this record; keyboard activation (detail=0) never matches.
    if (repaired && event.target === repaired.down.target && event.detail > 0 &&
      event.timeStamp >= repaired.down.timeStamp && event.timeStamp <= repaired.up.timeStamp &&
      win.performance.now() - repaired.repairedAt! <= TAP_WINDOW_MS &&
      repaired.clicks.has(event.type)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const onMouseDown = (event: MouseEvent) => {
    if (!event.isTrusted || event.button !== 0) return;
    clearPending();
    repaired = null;
    const now = win.performance.now();
    const up = mouseUp;
    mouseUp = null;
    if (!matches(up, event, now - mouseUpAt)) return;
    const pointer = pointerDown && pointerUp &&
      pointerDown.pointerId === pointerUp.pointerId &&
      matches(pointerUp, pointerDown, now - pointerUpAt) ? pointerUp : null;
    pointerUp = pointerDown = null;
    reorderedDowns.add(event);
    const tap: Tap = { down: event, up, pointer,
      sawMouseUp: false, sawPointerUp: false, sawClick: false, sawDoubleClick: false, clicks: new Set() };
    pending = tap;
    // A task (not a capture-listener microtask) lets the original mousedown
    // finish all target/bubble listeners and native focus/default actions.
    timer = win.setTimeout(() => {
      timer = undefined;
      if (pending !== tap) return;
      pending = null;
      const target = event.target;
      if (!(target instanceof win.Element) || !target.isConnected || win.document.hidden) return;
      const init: MouseEventInit = {
        bubbles: true, cancelable: true, composed: true, view: win,
        button: 0, buttons: 0, detail: event.detail,
        clientX: up.clientX, clientY: up.clientY, screenX: up.screenX, screenY: up.screenY,
        altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey,
      };
      if (pointer && !tap.sawPointerUp) {
        target.dispatchEvent(new win.PointerEvent("pointerup", {
          ...init, pointerId: pointer.pointerId, pointerType: "mouse", isPrimary: true,
        }));
      }
      if (!tap.sawMouseUp) target.dispatchEvent(new win.MouseEvent("mouseup", init));
      if (!target.isConnected) return;
      tap.repairedAt = win.performance.now();
      repaired = tap;
      if (!tap.sawClick) {
        tap.clicks.add("click");
        target.dispatchEvent(new win.MouseEvent("click", init));
      }
      if (event.detail === 2 && !tap.sawDoubleClick && target.isConnected) {
        tap.clicks.add("dblclick");
        target.dispatchEvent(new win.MouseEvent("dblclick", init));
      }
    }, 0);
  };
  const visibility = () => { if (win.document.hidden) reset(); };
  win.addEventListener("pointerdown", onPointerDown, true);
  win.addEventListener("pointerup", onPointerUp, true);
  win.addEventListener("mousedown", onMouseDown, true);
  win.addEventListener("mouseup", onMouseUp, true);
  win.addEventListener("click", onClick, true);
  win.addEventListener("dblclick", onClick, true);
  win.addEventListener("pointercancel", reset, true);
  win.addEventListener("blur", reset);
  win.document.addEventListener("visibilitychange", visibility);
  return () => {
    reset();
    win.removeEventListener("pointerdown", onPointerDown, true);
    win.removeEventListener("pointerup", onPointerUp, true);
    win.removeEventListener("mousedown", onMouseDown, true);
    win.removeEventListener("mouseup", onMouseUp, true);
    win.removeEventListener("click", onClick, true);
    win.removeEventListener("dblclick", onClick, true);
    win.removeEventListener("pointercancel", reset, true);
    win.removeEventListener("blur", reset);
    win.document.removeEventListener("visibilitychange", visibility);
  };
}
