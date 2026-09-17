import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { buildSync } from 'esbuild';
import { TerminalSelectionGuard } from './selectionGuard.ts';
import { tapDom } from '../../tests/helpers/tapDom.ts';

// Exercise the installed xterm's real selection service, buffer and word/line
// selection code. Only the DOM event route and pixel measurements are faked.
const require = createRequire(import.meta.url);
const src = path.join(path.dirname(require.resolve('@xterm/xterm/package.json')), 'src');
const bundle = buildSync({
  stdin: { contents: `
    export { SelectionService } from 'browser/services/SelectionService';
    export { BufferService } from 'common/services/BufferService';
    export { OptionsService } from 'common/services/OptionsService';
  ` },
  alias: { browser: path.join(src, 'browser'), common: path.join(src, 'common') },
  bundle: true, write: false, format: 'cjs', platform: 'node',
  tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
}).outputFiles[0].text;
const module = { exports: {} };
new Function('module', 'exports', 'require', 'navigator', bundle)(module, module.exports, require,
  { platform: 'MacIntel', userAgent: 'Version/17.2 Safari/605.1.15' });
const { SelectionService, BufferService, OptionsService } = module.exports;

function fixture(guarded = true, compatible = false) {
  const dom = tapDom(compatible);
  const timers = new Set();
  let nextTimer = 1;
  const win = Object.assign(dom.window, {
    setInterval() { const id = nextTimer++; timers.add(id); return id; },
    clearInterval(id) { timers.delete(id); },
    requestAnimationFrame() { return nextTimer++; },
    cancelAnimationFrame() {},
    getComputedStyle: () => ({ getPropertyValue: () => '0' }),
  });
  const { doc, element } = dom;
  const options = new OptionsService({ cols: 80, rows: 24 });
  const buffer = new BufferService(options);
  for (let row = 0; row < 24; row++) {
    for (const [column, char] of [...'hello world'].entries()) {
      buffer.buffer.lines.get(row).set(column, [0, char, 1, char.charCodeAt(0)]);
    }
  }
  const sent = [];
  const copied = [];
  const service = new SelectionService(element, element, { currentLink: undefined }, buffer,
    { onUserInput: () => ({ dispose() {} }), triggerDataEvent: (data) => sent.push(data), decPrivateModes: {} },
    { getCoords: (e) => [e.clientX + 1, e.clientY + 1] }, options,
    { dimensions: { css: { canvas: { height: 24 }, cell: { height: 1 } } } }, { window: win });
  const term = { element, _core: { _selectionService: service }, getSelection: () => service.selectionText };
  const guard = new TerminalSelectionGuard((text) => copied.push(text));
  if (guarded) guard.activate(term);
  element.addEventListener('mousedown', (event) => service.handleMouseDown(event));
  return { ...dom, service, guard, term, copied, sent, timers, doc };
}

test('reproduces xterm 5.5 selecting on hover after a lost trackpad release', () => {
  const f = fixture(false);
  f.emit('mousedown');
  f.emit('mousemove', { clientX: 5, buttons: 0 });
  assert.equal(f.term.getSelection(), 'hello');
  assert.equal(f.timers.size, 1);
  f.service.dispose();
});

test('a tap followed by unpressed movement creates no terminal selection', () => {
  const f = fixture();
  f.emit('mousedown');
  f.emit('mousemove', { clientX: 5, buttons: 0 });
  f.emit('mousemove', { clientX: 10, clientY: 10, buttons: 0 });
  assert.equal(f.term.getSelection(), '');
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.copied, []);
  f.guard.dispose();
});

for (const release of ['pointerup', 'mouseup']) {
  test(`${release} preserves a real drag and copies once even when bubbling is swallowed`, () => {
    const f = fixture();
    f.emit('mousedown');
    f.emit('mousemove', { clientX: 5 });
    f.emit(release, { clientX: 5, buttons: 0 }, true);
    f.emit('mouseup', { clientX: 5, buttons: 0 }, true);
    f.emit('mousemove', { clientX: 10, clientY: 10, buttons: 0 });
    assert.equal(f.term.getSelection(), 'hello');
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.copied, ['hello']);
    f.guard.dispose();
  });
}

for (const clicks of [2, 3]) {
  test(`${clicks} clicks still select and copy a word or line`, () => {
    const f = fixture();
    f.emit('mousedown', { detail: clicks, clientX: 1 });
    f.emit('pointerup', { buttons: 0, clientX: 1 });
    f.emit('mousemove', { buttons: 0, clientX: 25, clientY: 10 });
    const expected = clicks === 2 ? 'hello' : 'hello world';
    assert.equal(f.term.getSelection(), expected);
    assert.deepEqual(f.copied, [expected]);
    f.guard.dispose();
  });
}

for (const reason of ['blur', 'pointercancel', 'hidden', 'detach', 'dispose']) {
  test(`${reason} cancels tracking and autoscroll without copying or sending shell input`, () => {
    const f = fixture();
    f.emit('mousedown', { altKey: true });
    if (reason === 'hidden') {
      f.doc.hidden = true;
      f.doc.dispatchEvent(new Event('visibilitychange'));
    } else if (reason === 'detach') f.guard.cancel();
    else if (reason === 'dispose') f.guard.dispose();
    else f.emit(reason);
    f.emit('mousemove', { clientX: 30, clientY: 20, buttons: 0 });
    assert.equal(f.term.getSelection(), '');
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.copied, []);
    assert.deepEqual(f.sent, []);
    f.guard.dispose();
  });
}

test('lost release freezes an existing selection instead of clearing it', () => {
  const f = fixture();
  f.emit('mousedown');
  f.emit('mousemove', { clientX: 5 });
  f.emit('mousemove', { clientX: 10, clientY: 15, buttons: 0 });
  assert.equal(f.term.getSelection(), 'hello');
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.copied, []);
  f.guard.dispose();
});

test('TUI mouse-reporting mode does not create or copy terminal selections', () => {
  const f = fixture();
  f.service.disable();
  f.emit('mousedown');
  f.emit('mousemove', { clientX: 5 });
  f.emit('pointerup', { buttons: 0 });
  assert.equal(f.term.getSelection(), '');
  assert.deepEqual(f.copied, []);
  f.guard.dispose();
});

test('pointer hover cancels selection even if the later compatibility mouse event says pressed', () => {
  const f = fixture();
  f.emit('mousedown');
  f.emit('pointermove', { clientX: 5, buttons: 0 });
  f.emit('mousemove', { clientX: 20, buttons: 1 });
  assert.equal(f.term.getSelection(), '');
  assert.equal(f.timers.size, 0);
  f.guard.dispose();
});

test('Option-drag preserves rectangular selection and its copied line breaks', () => {
  const f = fixture();
  f.emit('mousedown', { altKey: true });
  f.emit('mousemove', { clientX: 5, clientY: 1, altKey: true });
  f.emit('pointerup', { clientX: 5, clientY: 1, buttons: 0, altKey: true });
  f.emit('mousemove', { clientX: 20, clientY: 20, buttons: 0 });
  assert.equal(f.term.getSelection(), 'hello\nhello');
  assert.deepEqual(f.copied, ['hello\nhello']);
  assert.deepEqual(f.sent, []);
  f.guard.dispose();
});

test('an intentional Option-click still moves the shell cursor exactly once', () => {
  const f = fixture();
  f.emit('mousedown', { clientX: 3, altKey: true });
  f.emit('pointerup', { clientX: 3, buttons: 0, altKey: true });
  f.emit('mouseup', { clientX: 3, buttons: 0, altKey: true });
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.copied, []);
  f.guard.dispose();
});

for (const clicks of [1, 2, 3]) {
  test(`WebKit IME reversed ${clicks}-tap sequence ends xterm selection without waiting for movement`, () => {
    const f = fixture(true, true);
    f.emit('pointerup', { timeStamp: 101, buttons: 0, detail: clicks, clientX: 1 });
    f.emit('mouseup', { timeStamp: 101, buttons: 0, detail: clicks, clientX: 1 });
    f.emit('pointerdown', { timeStamp: 100, detail: clicks, clientX: 1 });
    f.emit('mousedown', { timeStamp: 100, detail: clicks, clientX: 1 });
    assert.equal(f.timers.size, 1);
    f.flush();
    assert.equal(f.timers.size, 0);
    const expected = clicks === 1 ? '' : clicks === 2 ? 'hello' : 'hello world';
    assert.equal(f.term.getSelection(), expected);
    assert.deepEqual(f.copied, clicks === 1 ? [] : [expected]);
    f.emit('mousemove', { buttons: 1, clientX: 40, clientY: 10 });
    assert.equal(f.term.getSelection(), expected);
    assert.deepEqual(f.sent, []);
    f.guard.dispose();
    f.dispose();
  });
}
