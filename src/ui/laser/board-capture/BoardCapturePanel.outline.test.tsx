import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import { findRegistrationBoxes, type BoardOutlineDraft } from '../../../core/scene';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { useUiStore } from '../../state/ui-store';
import { BoardCapturePanel } from './BoardCapturePanel';
import { useBoardPhotoInbox } from './board-capture-remote';

const DRAFT: BoardOutlineDraft = {
  localPointsMm: [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 90, y: 70 },
    { x: 0, y: 70 },
  ],
  anchorIndices: [0, 1, 2, 3],
  captureOrder: [3, 1],
};

vi.mock('./photo/OutlinePhotoDialog', () => ({
  OutlinePhotoDialog: (props: {
    readonly initialFile?: File;
    readonly onClose: () => void;
    readonly onUseOutline: (draft: BoardOutlineDraft) => void;
  }) => (
    <div role="dialog">
      Outline from photo {props.initialFile?.name}
      <button type="button" onClick={props.onClose}>
        Close photo
      </button>
      <button type="button" onClick={() => props.onUseOutline(DRAFT)}>
        Use test outline
      </button>
    </div>
  ),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const originalSetOriginHere = useLaserStore.getState().setOriginHere;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useBoardPhotoInbox.setState({ photo: null });
  useUiStore.setState({ boardCapturePanelOpen: false });
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    wcoCache: null,
    setOriginHere: originalSetOriginHere,
  });
  useStore.getState().newProject();
});

async function renderPanel(): Promise<HTMLDivElement> {
  useUiStore.setState({ boardCapturePanelOpen: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(<BoardCapturePanel />);
  });
  return host;
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (found === undefined) throw new Error(`Missing button: ${text}`);
  return found;
}

function idleAt(x: number, y: number): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x, y, z: 0 },
    wPos: null,
    feed: null,
    spindle: null,
    wco: null,
  };
}

function remotePhoto(name = 'remote-board.jpg'): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: 'image/jpeg' });
}

describe('BoardCapturePanel outline mode', () => {
  it('offers the photo workflow after choosing Outline', async () => {
    const container = await renderPanel();
    await act(async () => button(container, 'Outline').click());
    expect(container.textContent).toContain('Draw board from photo…');
  });

  it('puts the drawn outline on the canvas straight away, before any head capture', async () => {
    const container = await renderPanel();
    const placement = useStore.getState().jobPlacement;
    await act(async () => button(container, 'Outline').click());
    await act(async () => button(container, 'Draw board from photo…').click());
    await act(async () => button(container, 'Use test outline').click());
    const board = findRegistrationBoxes(useStore.getState().project.scene).find(
      (box) => box.provenance === 'captured-board',
    );
    expect(board?.spec).toEqual({ kind: 'polyline', points: DRAFT.localPointsMm, closed: true });
    expect(useStore.getState().jobPlacement).toEqual(placement);
    expect(container.textContent).toContain('Lay out artwork');
    expect(button(container, 'Register board').disabled).toBe(true);
  });

  it('switches an uncommitted rectangle session to Outline and opens a delivered photo', async () => {
    const container = await renderPanel();
    const photo = remotePhoto();
    await act(async () => {
      useBoardPhotoInbox.getState().deliver(photo);
      await Promise.resolve();
    });
    expect(button(container, 'Outline').getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('Outline from photo remote-board.jpg');
    expect(useBoardPhotoInbox.getState().photo).toBeNull();
    await act(async () => button(container, 'Close photo').click());
    await act(async () => button(container, 'Draw board from photo…').click());
    expect(container.textContent).not.toContain('remote-board.jpg');
  });

  it('opens a newly delivered photo when Outline was already selected', async () => {
    const container = await renderPanel();
    await act(async () => button(container, 'Outline').click());
    const photo = remotePhoto('second-board.jpg');
    await act(async () => {
      useBoardPhotoInbox.getState().deliver(photo);
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Outline from photo second-board.jpg');
  });

  it('keeps a remotely delivered photo waiting while a board is committed', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: idleAt(10, 10),
      setOriginHere: vi.fn(async () => undefined),
    });
    const container = await renderPanel();
    await act(async () => button(container, 'Capture corner').click());
    const width = container.querySelector<HTMLInputElement>(
      'input[aria-label="Board width in mm"]',
    );
    const height = container.querySelector<HTMLInputElement>(
      'input[aria-label="Board height in mm"]',
    );
    if (width === null || height === null) throw new Error('Manual board size fields missing');
    await act(async () => {
      setInput(width, '100');
      setInput(height, '80');
    });
    await act(async () => button(container, 'Draw board at this size').click());
    const photo = remotePhoto('waiting.jpg');
    await act(async () => {
      useBoardPhotoInbox.getState().deliver(photo);
      await Promise.resolve();
    });
    expect(container.textContent).toContain(
      'A photo arrived from a remote client. Start a new board capture to use it.',
    );
    expect(useBoardPhotoInbox.getState().photo).toBe(photo);
  });
});

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
