import assert from "node:assert/strict";
import test from "node:test";
import { trackPointerDrag } from "./pointerDrag";

function fixture(overrides: Partial<PointerEvent> = {}) {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { hidden: false });
  let starts = 0;
  const positions: number[] = [];
  const ends: boolean[] = [];
  const press = { pointerId: 1, button: 0, isPrimary: true, clientX: 0, clientY: 0, ...overrides };
  const cancel = trackPointerDrag(press, {
    start: () => { starts++; },
    move: (event) => { positions.push(event.clientX); },
    end: (committed) => { ends.push(committed); },
  }, { window, document });
  const pointer = (type: string, fields: Partial<PointerEvent> = {}) => {
    const event = Object.assign(new Event(type, { cancelable: true }), { ...press, buttons: 1, ...fields });
    window.dispatchEvent(event);
    return event;
  };
  return { window, document, pointer, cancel, positions, ends, starts: () => starts };
}

test("a press and small click jitter never start a drag or prevent the click", () => {
  const f = fixture();
  assert.equal(f.starts(), 0);
  const move = f.pointer("pointermove", { clientX: 6 });
  f.pointer("pointerup", { clientX: 6, buttons: 0 });
  assert.equal(move.defaultPrevented, false);
  assert.equal(f.starts(), 0);
  assert.deepEqual(f.positions, []);
  assert.deepEqual(f.ends, [false]);
});

test("hovering after a missed release cannot start or continue a drag", () => {
  for (const active of [false, true]) {
    const f = fixture();
    if (active) f.pointer("pointermove", { clientX: 10 });
    f.pointer("pointermove", { clientX: 20, buttons: 0 });
    f.pointer("pointermove", { clientX: 30 });
    f.pointer("pointerup", { buttons: 0 });
    assert.equal(f.starts(), active ? 1 : 0);
    assert.deepEqual(f.positions, active ? [10] : []);
    assert.deepEqual(f.ends, [false]);
  }
});

test("cancellation, blur, hidden documents and disposal never commit a drop", () => {
  for (const reason of ["pointercancel", "blur", "hidden", "dispose", "newPress"]) {
    const f = fixture();
    f.pointer("pointermove", { clientX: 10 });
    if (reason === "hidden") {
      f.document.hidden = true;
      f.document.dispatchEvent(new Event("visibilitychange"));
    } else if (reason === "dispose") f.cancel();
    else f.pointer(reason === "newPress" ? "pointerdown" : reason);
    f.pointer("pointerup", { clientX: 40, buttons: 0 });
    f.cancel();
    assert.deepEqual(f.ends, [false], reason);
    assert.deepEqual(f.positions, [10], reason);
  }
});

test("a real drag uses the release position and commits exactly once", () => {
  const f = fixture();
  const move = f.pointer("pointermove", { clientX: 8 });
  f.pointer("pointerup", { clientX: 40, buttons: 0 });
  f.pointer("pointerup", { clientX: 60, buttons: 0 });
  f.pointer("pointermove", { clientX: 80 });
  f.cancel();
  assert.equal(move.defaultPrevented, true);
  assert.equal(f.starts(), 1);
  assert.deepEqual(f.positions, [8, 40]);
  assert.deepEqual(f.ends, [true]);
});

test("unrelated pointers cannot move or finish the active drag", () => {
  const f = fixture();
  f.pointer("pointermove", { clientX: 20, pointerId: 2 });
  f.pointer("pointercancel", { pointerId: 2 });
  f.pointer("pointerup", { pointerId: 2 });
  assert.equal(f.starts(), 0);
  assert.deepEqual(f.ends, []);
  f.pointer("pointermove", { clientX: 20 });
  f.pointer("pointerup", { button: 2 });
  assert.deepEqual(f.ends, []);
  f.pointer("pointerup", { buttons: 0 });
  assert.deepEqual(f.ends, [true]);
});

test("secondary-button and non-primary presses never arm a drag", () => {
  for (const press of [{ button: 2 }, { isPrimary: false }]) {
    const f = fixture(press);
    f.pointer("pointermove", { clientX: 20 });
    f.pointer("pointerup", { buttons: 0 });
    f.cancel();
    assert.equal(f.starts(), 0);
    assert.deepEqual(f.ends, []);
  }
});
