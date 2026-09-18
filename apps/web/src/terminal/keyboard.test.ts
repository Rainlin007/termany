import assert from "node:assert/strict";
import test from "node:test";
import { handleShiftEnter } from "./keyboard";

function press(overrides: Partial<KeyboardEvent> = {}) {
  const inputs: Array<[string, boolean | undefined]> = [];
  let prevented = false;
  let stopped = false;
  const event = {
    type: "keydown", key: "Enter", code: "Enter", keyCode: 13,
    shiftKey: true, altKey: false, ctrlKey: false, metaKey: false,
    isComposing: false,
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
    ...overrides,
  } as KeyboardEvent;
  const useXterm = handleShiftEnter(event, {
    input(data, wasUserInput) { inputs.push([data, wasUserInput]); },
  });
  return { useXterm, inputs, prevented, stopped };
}

test("Shift+Enter sends one distinct key instead of submitting a plain Enter", () => {
  assert.deepEqual(press(), {
    useXterm: false,
    inputs: [["\x1b[13;2u", true]],
    prevented: true,
    stopped: true,
  });
  assert.deepEqual(press({ code: "NumpadEnter" }), press());
  assert.deepEqual(press({ repeat: true }), press());
});

test("leaves ordinary keys, other modifiers, and IME confirmation to xterm", () => {
  for (const overrides of [
    { shiftKey: false },
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { key: "Tab", code: "Tab", keyCode: 9 },
    { isComposing: true },
    { keyCode: 229 },
    { type: "keypress" },
    { type: "keyup" },
  ]) {
    assert.deepEqual(press(overrides), {
      useXterm: true, inputs: [], prevented: false, stopped: false,
    }, JSON.stringify(overrides));
  }
});
