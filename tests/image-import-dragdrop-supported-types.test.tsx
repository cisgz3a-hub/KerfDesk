/**
 * S40-02-001: drag/drop image import must reject unsupported image/*
 * formats before createImageBitmap can decode them.
 *
 * Run: npx tsx tests/image-import-dragdrop-supported-types.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useImport, type UseImportDeps } from '../src/ui/hooks/useImport';
import { createScene, type Scene } from '../src/core/scene/Scene';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
(globalThis as { window?: Window }).window = win as unknown as Window;
(globalThis as { document?: Document }).document = win.document;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function makeFile(bytes: Uint8Array<ArrayBuffer>, name: string, type: string): File {
  const blob = new Blob([bytes], { type }) as File;
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}

function makeDropEvent(file: File): React.DragEvent {
  return {
    preventDefault: () => {},
    stopPropagation: () => {},
    dataTransfer: {
      files: [file],
    },
  } as unknown as React.DragEvent;
}

async function run(): Promise<void> {
  console.log('\n=== S40-02-001 drag/drop image type gate ===\n');

  const container = win.document.getElementById('root')!;
  const root: Root = createRoot(container);
  let handleDrop: ((event: React.DragEvent) => Promise<void>) | null = null;
  let commits = 0;
  const alerts: Array<{ title: string; message: string }> = [];

  const deps: UseImportDeps = {
    handleSceneCommit: () => { commits++; },
    handleNewProject: () => {},
    setIsDragOver: () => {},
    showAlert: (title, message) => {
      alerts.push({ title, message });
      return Promise.resolve();
    },
    showConfirm: () => Promise.resolve(true),
    showChoice: () => Promise.resolve('laser'),
  };

  function Harness({ scene }: { scene: Scene }): React.ReactElement {
    handleDrop = useImport(scene, deps).handleDrop;
    return React.createElement('div');
  }

  await act(async () => {
    root.render(React.createElement(Harness, { scene: createScene(400, 300, 'drop') }));
  });

  const originalCreateImageBitmap = (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  const originalImage = (globalThis as { Image?: unknown }).Image;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let bitmapCalls = 0;

  (globalThis as { createImageBitmap?: unknown }).createImageBitmap = async () => {
    bitmapCalls++;
    return {
      width: 10,
      height: 10,
      close: () => {},
    };
  };
  (globalThis as { Image?: unknown }).Image = class {
    width = 10;
    height = 10;
    naturalWidth = 10;
    naturalHeight = 10;
    onload: (() => void) | null = null;
    onerror: ((err?: unknown) => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => this.onerror?.(new Error('mock decode failure')));
    }
  };
  URL.createObjectURL = () => 'blob:laserforge-test';
  URL.revokeObjectURL = () => {};

  try {
    const oversizedEnoughToAvoidInlineFileReader = new Uint8Array(101 * 1024);
    const unsupported = makeFile(oversizedEnoughToAvoidInlineFileReader, 'unsupported.avif', 'image/avif');
    await act(async () => {
      await handleDrop?.(makeDropEvent(unsupported));
    });
  } finally {
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = originalCreateImageBitmap;
    (globalThis as { Image?: unknown }).Image = originalImage;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    await act(async () => {
      root.unmount();
    });
  }

  assert(bitmapCalls === 0, `unsupported image/avif is rejected before createImageBitmap (calls=${bitmapCalls})`);
  assert(commits === 0, `unsupported image/avif drop does not commit a scene (commits=${commits})`);
  assert(alerts.some(a => /unsupported/i.test(`${a.title} ${a.message}`)),
    `unsupported image/avif reports an unsupported-image alert (alerts=${alerts.map(a => a.title).join(', ')})`);
}

run().then(() => {
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}).catch((err: unknown) => {
  console.error('Test threw:', err);
  process.exit(1);
});
