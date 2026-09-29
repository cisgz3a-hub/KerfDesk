import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_PROJECT_VARIABLE_DATA } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { FontUsageHint } from './FontUsageHint';

vi.mock('./font-loader', async (importOriginal) => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const bytes = readFileSync(resolve(__dirname, 'fonts/Roboto-Regular.ttf'));
  const roboto = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return { ...(await importOriginal<object>()), loadFont: vi.fn(async () => roboto) };
});

// The check runs after typing settles, so these tests wait for the DOM
// instead of wrapping each update in act().
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = false;

const WAIT = { timeout: 5000, interval: 50 };

describe('FontUsageHint characters the font cannot draw', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    root.unmount();
    host.remove();
  });

  it('lists the characters an outline font has no glyph for', async () => {
    root.render(<Hint content={'A\u2713B'} />);

    await vi.waitFor(
      () =>
        expect(host.textContent).toBe(
          'This font has no \u2713; each engraves as a box, or not at all.',
        ),
      WAIT,
    );
  });

  it('checks the CSV values a variable text engraves rather than its field syntax', async () => {
    useStore.setState({
      project: {
        ...createProject(),
        variables: {
          ...DEFAULT_PROJECT_VARIABLE_DATA,
          csv: {
            sourceName: 'names.csv',
            headers: ['name', 'note'],
            records: [
              ['Anna', '\u2605'],
              ['Zo\u00eb \u2713', 'x'],
            ],
          },
        },
      },
    });

    root.render(<Hint content="Hi {{csv:name}}" variable />);

    // The star sits in a column this text does not use.
    await vi.waitFor(
      () =>
        expect(host.textContent).toBe(
          'This font has no \u2713 (in this text or the CSV values it uses); ' +
            'each engraves as a box, or not at all.',
        ),
      WAIT,
    );
  });

  it('says a single-line font engraves ? for its missing characters', async () => {
    root.render(<Hint fontKey="relief-single-line" content={'A\u2713'} />);

    await vi.waitFor(
      () => expect(host.textContent).toContain('This font has no \u2713; each engraves as ?.'),
      WAIT,
    );
  });

  it('stays silent when the font covers the text', async () => {
    root.render(<Hint content={'J\u00f6rg\tZo\u00eb'} />);

    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(host.textContent).toBe('');
  });
});

function Hint(props: {
  readonly content: string;
  readonly fontKey?: string;
  readonly variable?: boolean;
}): JSX.Element {
  return (
    <FontUsageHint
      fontKey={props.fontKey ?? 'roboto-regular'}
      embeddedFonts={[]}
      content={props.content}
      variable={props.variable ?? false}
      fontAvailable
    />
  );
}
