import { installMacTapCompatibility } from "../../src/macTapCompatibility";

/** Minimal capture -> target -> bubble DOM, with deterministic task flushing. */
export function tapDom(compatible = true) {
  let now = 1000;
  let nextTimer = 1;
  const tasks = new Map<number, () => void>();
  const swallowed = new WeakSet<Event>();
  class Mouse extends Event {
    constructor(type: string, init: MouseEventInit = {}) {
      const { bubbles = true, cancelable = true, composed = true, ...fields } = init;
      super(type, { bubbles, cancelable, composed });
      Object.assign(this, { button: 0, buttons: 0, detail: 1, clientX: 0, clientY: 0,
        screenX: 0, screenY: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
        ...fields });
    }
  }
  class Pointer extends Mouse {}
  const win = Object.assign(new EventTarget(), {
    performance: { now: () => now },
    setTimeout(fn: () => void) { const id = nextTimer++; tasks.set(id, fn); return id; },
    clearTimeout(id: number) { tasks.delete(id); },
    MouseEvent: Mouse, PointerEvent: Pointer,
  });
  const doc = Object.assign(new EventTarget(), { defaultView: win, hidden: false });
  class Element extends EventTarget {
    isConnected = true;
    ownerDocument = doc;
    contains(target: unknown) { return target === this; }
    getBoundingClientRect() { return { left: 0, top: 0 }; }
    override dispatchEvent(event: Event) {
      Object.defineProperty(event, "target", { value: this, configurable: true });
      let stopped = false;
      const stop = event.stopImmediatePropagation.bind(event);
      event.stopImmediatePropagation = () => { stopped = true; stop(); };
      win.dispatchEvent(event);
      if (!stopped) super.dispatchEvent(event);
      if (!stopped && !swallowed.has(event)) doc.dispatchEvent(event);
      return !event.defaultPrevented;
    }
  }
  const window = Object.assign(win, { Element, document: doc }) as unknown as Window & typeof globalThis;
  const element = new Element();
  const dispose = compatible ? installMacTapCompatibility(window) : () => {};
  const emit = (type: string, fields: Partial<MouseEvent & PointerEvent> = {}, swallow = false, target = element) => {
    const { timeStamp = now, isTrusted = true, ...init } = fields;
    const event = new Pointer(type, { buttons: 1, ...init });
    Object.assign(event, { pointerId: 1, pointerType: "mouse", isPrimary: true, ...init });
    Object.defineProperties(event, { timeStamp: { value: timeStamp }, isTrusted: { value: isTrusted } });
    if (swallow) swallowed.add(event);
    target.dispatchEvent(event);
    return event;
  };
  const flush = () => {
    for (const [id, fn] of [...tasks]) { tasks.delete(id); fn(); }
  };
  return { window, doc, element, emit, flush, dispose, tasks,
    advance: (ms: number) => { now += ms; }, otherElement: () => new Element() };
}
