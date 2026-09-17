import { PageDragGesture } from "./pageDragGesture";

type Press = Pick<PointerEvent, "pointerId" | "button" | "isPrimary" | "clientX" | "clientY">;
export type PointerDragCallbacks = {
  start: () => void;
  move: (event: PointerEvent) => void;
  end: (committed: boolean) => void;
};

/** Own one press, including releases swallowed by controls or native windows. */
export function trackPointerDrag(
  press: Press,
  callbacks: PointerDragCallbacks,
  events: { window: EventTarget; document: EventTarget & { hidden: boolean } } = { window, document },
): () => void {
  if (press.button !== 0 || !press.isPrimary) return () => {};
  const gesture = new PageDragGesture<boolean>();
  gesture.start(press.pointerId, press.clientX, press.clientY, true);
  let finished = false;
  const capture = { capture: true };

  const finish = (committed: boolean) => {
    if (finished) return;
    finished = true;
    gesture.cancel();
    events.window.removeEventListener("pointermove", move, capture);
    events.window.removeEventListener("pointerup", up, capture);
    events.window.removeEventListener("pointercancel", pointerCancel, capture);
    events.window.removeEventListener("pointerdown", nextPress, capture);
    events.window.removeEventListener("blur", cancel);
    events.document.removeEventListener("visibilitychange", visibility);
    callbacks.end(committed);
  };
  const cancel = () => finish(false);
  const move = (raw: Event) => {
    const event = raw as PointerEvent;
    const action = gesture.move(event);
    if (action === "cancel") { cancel(); return; }
    if (action === "ignore") return;
    if (action === "start") callbacks.start();
    event.preventDefault();
    callbacks.move(event);
  };
  const up = (raw: Event) => {
    const event = raw as PointerEvent;
    if (event.pointerId !== press.pointerId || event.button !== 0) return;
    const committed = gesture.release(event.pointerId) === true;
    // Hit-test the release location as well: the last move may be stale.
    if (committed) callbacks.move(event);
    finish(committed);
  };
  const pointerCancel = (raw: Event) => {
    if ((raw as PointerEvent).pointerId === press.pointerId) cancel();
  };
  const nextPress = (raw: Event) => {
    if ((raw as PointerEvent).isPrimary) cancel();
  };
  const visibility = () => { if (events.document.hidden) cancel(); };

  events.window.addEventListener("pointermove", move, capture);
  events.window.addEventListener("pointerup", up, capture);
  events.window.addEventListener("pointercancel", pointerCancel, capture);
  events.window.addEventListener("pointerdown", nextPress, capture);
  events.window.addEventListener("blur", cancel);
  events.document.addEventListener("visibilitychange", visibility);
  return cancel;
}
