import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, IDENTITY_TRANSFORM, type TextObject } from '../../../core/scene';
import { JigTextControls } from './JigTextControls';

vi.mock('../../text/font-loader', async (importOriginal) => {
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync('src/ui/text/fonts/Pacifico-Regular.ttf');
  const pacifico = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return {
    ...(await importOriginal<object>()),
    ensureFontCss: vi.fn(async () => undefined),
    loadFont: vi.fn(async () => pacifico),
  };
});

// The check runs after typing settles, so these tests wait for the DOM
// instead of wrapping each update in act().
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = false;

const WAIT = { timeout: 5000, interval: 50 };

// Rolling audit v8 N4-P1-3 (ADR-591 Amendment 2): the jig text editor shows the main text
// dialog's hint, so "Café 李" in Pacifico names 李 before it is added.
describe('the jig text editor names characters its font lacks', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    root.unmount();
    host.remove();
  });

  it('shows the main dialog’s hint for the text being edited', async () => {
    renderControls('Café 李');

    await vi.waitFor(
      () =>
        expect(host.querySelector('[role="status"]')?.textContent).toBe(
          'This font has no 李; each engraves as a box, or not at all.',
        ),
      WAIT,
    );
  });

  it('stays silent when the font covers the text', async () => {
    renderControls('Café');

    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  function renderControls(content: string): void {
    const text: TextObject = {
      kind: 'text',
      id: 'jig-text',
      content,
      fontKey: 'pacifico-regular',
      sizeMm: 10,
      alignment: 'center',
      lineHeight: 1.2,
      letterSpacing: 0,
      color: '#000000',
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
      paths: [],
      transform: IDENTITY_TRANSFORM,
    };
    const project = createProject();
    root.render(
      <JigTextControls
        project={{ ...project, scene: { ...project.scene, objects: [text] } }}
        selectedIds={new Set([text.id])}
        onUpsert={() => undefined}
        onBusyChange={() => undefined}
      />,
    );
  }
});
