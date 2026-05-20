/**
 * F45-07-002: a font-load failure must not look like a ready preview.
 *
 * Run: npx tsx tests/add-text-dialog-font-load-failure.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AddTextDialog } from '../src/ui/components/AddTextDialog';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
Object.defineProperty(win.HTMLElement.prototype, 'attachEvent', {
  value: () => undefined,
  configurable: true,
});
Object.defineProperty(win.HTMLElement.prototype, 'detachEvent', {
  value: () => undefined,
  configurable: true,
});

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const noop = () => undefined;

async function renderDialog(
  textPreviewFontStatus: 'ready' | 'loading' | 'failed',
): Promise<{ container: HTMLElement; root: Root; submitCount: () => number }> {
  const container = win.document.getElementById('root') as HTMLElement;
  container.innerHTML = '';
  const root = createRoot(container);
  let submits = 0;

  await act(async () => {
    root.render(React.createElement(AddTextDialog, {
      showTextDialog: true,
      editingTextId: null,
      textInput: 'CUT ME',
      textFont: 'Missing Font',
      textSize: 20,
      textBold: false,
      textItalic: false,
      textOperationMode: 'engrave',
      textPreviewFontStatus,
      setTextInput: noop,
      setTextFont: noop,
      setTextSize: noop,
      setTextBold: noop,
      setTextItalic: noop,
      setTextOperationMode: noop,
      onClose: noop,
      onSubmit: () => { submits += 1; },
      onShowFontCredits: noop,
    }));
  });

  return { container, root, submitCount: () => submits };
}

async function cleanup(root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
}

async function run(): Promise<void> {
  console.log('\n=== F45-07-002 AddTextDialog font-load failure ===\n');

  const { container, root, submitCount } = await renderDialog('failed');
  const warning = container.querySelector('[data-testid="text-font-load-warning"]');
  const submit = container.querySelector('[data-testid="text-dialog-submit"]') as HTMLButtonElement | null;

  assert(warning != null, 'failed font load renders a visible warning');
  assert(warning?.textContent?.includes('Missing Font') === true, 'warning names the selected font');
  assert(container.textContent?.includes('Preview unavailable') === true, 'preview area does not show normal text as ready');
  assert(submit?.disabled === true, 'submit is disabled while selected font preview failed');

  await act(async () => {
    submit?.click();
  });
  assert(submitCount() === 0, 'failed font preview cannot be committed silently');
  await cleanup(root);

  {
    const { container, root } = await renderDialog('ready');
    const warning = container.querySelector('[data-testid="text-font-load-warning"]');
    const submit = container.querySelector('[data-testid="text-dialog-submit"]') as HTMLButtonElement | null;

    assert(warning == null, 'ready font preview does not render a warning');
    assert(container.textContent?.includes('CUT ME') === true, 'ready preview shows the text sample');
    assert(submit?.disabled === false, 'submit remains enabled when text is present and font preview is ready');
    await cleanup(root);
  }

  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed.`);
    process.exit(1);
  }

  console.log(`\nAll ${passed} assertions passed.`);
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
