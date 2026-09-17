import assert from "node:assert/strict";
import test from "node:test";
import { tapDom } from "../tests/helpers/tapDom";
import { isReorderedMacTap } from "./macTapCompatibility";
import { trackPointerDrag } from "./pointerDrag";

function fixture() {
  const f = tapDom();
  const received: string[] = [];
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick"]) {
    f.element.addEventListener(type, () => received.push(type));
  }
  const reversed = (detail = 1, fields: Partial<MouseEvent> = {}) => {
    f.emit("pointerup", { timeStamp: 101, buttons: 0, detail, ...fields });
    f.emit("mouseup", { timeStamp: 101, buttons: 0, detail, ...fields });
    f.emit("pointerdown", { timeStamp: 100, detail, ...fields });
    return f.emit("mousedown", { timeStamp: 100, detail, ...fields });
  };
  return { ...f, received, reversed };
}

test("a reordered tap finishes the tab drag and activates once after mousedown", () => {
  const f = fixture();
  let active = false;
  let starts = 0;
  const drops: boolean[] = [];
  f.element.addEventListener("pointerdown", (e) => trackPointerDrag(e as PointerEvent, {
    start: () => { starts++; }, move: () => {}, end: (dropped) => drops.push(dropped),
  }, { window: f.window, document: f.doc }));
  f.element.addEventListener("click", () => { active = true; });
  const down = f.reversed();
  assert.equal(isReorderedMacTap(down), true);
  assert.equal(active, false);
  f.flush();
  assert.equal(active, true);
  f.emit("pointermove", { clientX: 40, buttons: 1 });
  assert.equal(starts, 0);
  assert.deepEqual(drops, [false]);
  assert.deepEqual(f.received, ["pointerup", "mouseup", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
  f.dispose();
});

test("normal rapid double-click and physical dragging never schedule repairs", () => {
  const f = fixture();
  for (const [start, end] of [[100, 101], [101.5, 102], [200, 800]]) {
    f.emit("pointerdown", { timeStamp: start });
    const down = f.emit("mousedown", { timeStamp: start });
    f.emit("pointerup", { timeStamp: end, buttons: 0 });
    f.emit("mouseup", { timeStamp: end, buttons: 0 });
    f.emit("click", { timeStamp: end, buttons: 0 });
    assert.equal(isReorderedMacTap(down), false);
  }
  assert.equal(f.tasks.size, 0);
  f.dispose();
});

test("a recovered double tap retains click count and modifier keys", () => {
  const f = fixture();
  let click: MouseEvent | undefined;
  f.element.addEventListener("click", (e) => { click = e as MouseEvent; });
  f.reversed(2, { altKey: true, metaKey: true, shiftKey: true });
  f.flush();
  assert.equal(click?.detail, 2);
  assert.equal(click?.altKey, true);
  assert.equal(click?.metaKey, true);
  assert.equal(click?.shiftKey, true);
  assert.deepEqual(f.received.slice(-4), ["pointerup", "mouseup", "click", "dblclick"]);
  f.dispose();
});

test("late native clicks are deduplicated, but keyboard and subsequent clicks work", () => {
  const f = fixture();
  f.reversed(2);
  f.flush();
  f.emit("click", { timeStamp: 101, buttons: 0, detail: 2 });
  f.emit("dblclick", { timeStamp: 101, buttons: 0, detail: 2 });
  assert.equal(f.received.filter((e) => e === "click").length, 1);
  assert.equal(f.received.filter((e) => e === "dblclick").length, 1);
  f.emit("click", { timeStamp: 101, buttons: 0, detail: 0 });
  f.emit("pointerdown", { timeStamp: 102 });
  f.emit("mousedown", { timeStamp: 102 });
  f.emit("click", { timeStamp: 103, buttons: 0 });
  assert.equal(f.received.filter((e) => e === "click").length, 3);
  f.dispose();
});

test("native completion before the repair task is never duplicated", () => {
  const f = fixture();
  f.reversed(2);
  f.emit("pointerup", { timeStamp: 102, buttons: 0 });
  f.emit("mouseup", { timeStamp: 102, buttons: 0 });
  f.emit("click", { timeStamp: 102, buttons: 0, detail: 2 });
  f.emit("dblclick", { timeStamp: 102, buttons: 0, detail: 2 });
  const before = [...f.received];
  f.flush();
  assert.deepEqual(f.received, before);
  f.dispose();
});

for (const reason of ["blur", "pointercancel", "hidden", "dispose", "detached", "newPress"]) {
  test(`${reason} discards queued recovery`, () => {
    const f = fixture();
    f.reversed();
    if (reason === "hidden") { f.doc.hidden = true; f.doc.dispatchEvent(new Event("visibilitychange")); }
    else if (reason === "dispose") f.dispose();
    else if (reason === "detached") f.element.isConnected = false;
    else f.emit(reason === "newPress" ? "pointerdown" : reason, { timeStamp: 200 });
    f.flush();
    assert.equal(f.received.includes("click"), false);
    f.dispose();
  });
}

test("unrelated, stale, non-primary and untrusted releases cannot invent clicks", () => {
  for (const reason of ["target", "position", "stale", "right", "synthetic", "futureDown"]) {
    const f = fixture();
    f.emit("mouseup", { timeStamp: 101, buttons: 0,
      button: reason === "right" ? 2 : 0, isTrusted: reason !== "synthetic" });
    if (reason === "stale") f.advance(251);
    f.emit("mousedown", { timeStamp: reason === "futureDown" ? 102 : 100,
      clientX: reason === "position" ? 20 : 0 }, false,
      reason === "target" ? f.otherElement() : f.element);
    f.flush();
    assert.equal(f.received.includes("click"), false, reason);
    f.dispose();
  }
});
