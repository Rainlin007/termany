import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { toggleWindowFullscreen } from "./windowFullscreen";

test("native fullscreen enters and exits the current window using permitted IPC", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  const capability = JSON.parse(readFileSync(new URL("../../desktop/src-tauri/capabilities/default.json", import.meta.url), "utf8"));
  const calls: Array<[string, unknown]> = [];
  let fullscreen = false;
  try {
    mockWindows("main-2");
    mockIPC((command, args) => {
      calls.push([command, args]);
      const permission = `core:window:allow-${command.replace("plugin:window|", "").replaceAll("_", "-")}`;
      assert.ok(capability.permissions.includes(permission), `Missing capability: ${permission}`);
      if (command === "plugin:window|is_fullscreen") return fullscreen;
      assert.equal(command, "plugin:window|set_fullscreen");
      fullscreen = (args as { value: boolean }).value;
    });
    await toggleWindowFullscreen();
    assert.equal(fullscreen, true);
    await toggleWindowFullscreen();
    assert.equal(fullscreen, false);
    assert.deepEqual(calls, [
      ["plugin:window|is_fullscreen", { label: "main-2" }],
      ["plugin:window|set_fullscreen", { label: "main-2", value: true }],
      ["plugin:window|is_fullscreen", { label: "main-2" }],
      ["plugin:window|set_fullscreen", { label: "main-2", value: false }],
    ]);
  } finally {
    clearMocks();
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("a failed native state query never guesses a fullscreen transition", async () => {
  let changed = false;
  await assert.rejects(toggleWindowFullscreen({
    isFullscreen: async () => { throw new Error("window closed"); },
    setFullscreen: async () => { changed = true; },
  }), /window closed/);
  assert.equal(changed, false);
});
