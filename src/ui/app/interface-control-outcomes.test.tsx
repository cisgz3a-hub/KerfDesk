import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import { createProject } from '../../core/scene';
import { createStreamer, step } from '../../core/controllers/grbl';
import { ArrayDialog } from '../commands/ArrayDialog';
import { CloseOpenFillContoursDialog } from '../commands/CloseOpenFillContoursDialog';
import { ProjectNotesDialog } from '../commands/ProjectNotesDialog';
import { QuickNestDialog } from '../commands/QuickNestDialog';
import { UndoHistoryDialog } from '../commands/UndoHistoryDialog';
import { CollapsedRail, RailPanelHeading } from '../common/CollapsibleRail';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { ShortcutsDialog } from '../common/ShortcutsDialog';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { useTutorialStore } from '../tutorials/tutorial-store';
import { DesktopCloseNotice } from './DesktopCloseNotice';
import { desktopCloseController } from './desktop-close-runtime';
import { ExternalGcodePreviewBanner } from './ExternalGcodePreviewBanner';
import { GcodeSaveDialog } from './GcodeSaveDialog';
import { PlatformProvider } from './platform-context';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  resetStore();
  useLaserStore.setState(initialLaserState());
  useUiStore.setState({ modalDepth: 0 });
  useTutorialStore.setState({ isOpen: false, tutorialId: null });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  desktopCloseController.keepOpen();
  resetStore();
  useLaserStore.setState(initialLaserState());
  useTutorialStore.setState({ isOpen: false, tutorialId: null });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(node: ReactNode): Promise<void> {
  await act(async () => root.render(node));
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
  );
  if (found === undefined) throw new Error(`Missing button ${label}`);
  return found;
}

async function click(label: string): Promise<void> {
  await act(async () => button(label).click());
}

describe('individual shell control outcomes', () => {
  it('Show project toolpath removes only the imported display slot', async () => {
    useStore.getState().openExternalGcodePreview('audit.nc', { steps: [], totalLength: 0 });
    const before = useStore.getState();
    await mount(<ExternalGcodePreviewBanner />);
    await click('Show project toolpath');
    const after = useStore.getState();
    expect(after.externalGcodePreview).toBeNull();
    expect(after.project).toBe(before.project);
    expect(after.previewMode).toBe(true);
    expect(after.undoStack).toBe(before.undoStack);
    expect(host.textContent).toBe('');
  });

  it('Retry Abort retries a failed close request and resolves only after the mocked stop succeeds', async () => {
    const stop = vi
      .fn(async () => {
        useLaserStore.setState({ streamer: null });
      })
      .mockRejectedValueOnce(new Error('fixture write failed'));
    useLaserStore.setState({ streamer: step(createStreamer('G1 X1')).state, stopJob: stop });
    const pending = desktopCloseController.prepare(971);
    await mount(<DesktopCloseNotice />);
    expect(host.textContent).toContain('fixture write failed');
    await click('Retry Abort');
    expect(stop).toHaveBeenCalledTimes(2);
    expect(await pending).toMatchObject({ status: 'ready' });
    expect(host.textContent).toBe('');
  });

  it('G-code Cancel closes without choosing or writing a destination', async () => {
    useStore.setState({ project: projectWithLine() });
    const pick = vi.fn(async () => null);
    function Export(): JSX.Element {
      const [open, setOpen] = useState(true);
      return (
        <PlatformProvider
          adapter={{
            id: 'web',
            pickFilesForOpen: async () => [],
            pickFileForSave: pick,
            serial: { isSupported: () => false, requestPort: async () => null },
          }}
        >
          {open ? <GcodeSaveDialog onClose={() => setOpen(false)} /> : <span>Export closed</span>}
        </PlatformProvider>
      );
    }
    await mount(<Export />);
    await click('Cancel');
    expect(pick).not.toHaveBeenCalled();
    expect(host.textContent).toBe('Export closed');
  });

  it('rail collapse and expand change the visible surface', async () => {
    function Rail(): JSX.Element {
      const [collapsed, setCollapsed] = useState(false);
      return collapsed ? (
        <CollapsedRail
          title="Artwork"
          ariaLabel="Collapsed artwork"
          onExpand={() => setCollapsed(false)}
        />
      ) : (
        <RailPanelHeading title="Artwork" onCollapse={() => setCollapsed(true)} />
      );
    }
    await mount(<Rail />);
    await click('Collapse Artwork panel');
    expect(host.querySelector('h2')).toBeNull();
    await click('Expand Artwork panel');
    expect(host.querySelector('h2')?.textContent).toBe('Artwork');
  });

  it('a disabled rail collapse remains inert and explains why', async () => {
    const collapse = vi.fn();
    await mount(
      <RailPanelHeading
        title="Artwork"
        onCollapse={collapse}
        collapseDisabled
        collapseDisabledReason="Required during this fixture operation"
      />,
    );
    expect(button('Collapse Artwork panel').disabled).toBe(true);
    expect(button('Collapse Artwork panel').title).toContain('Required');
    await click('Collapse Artwork panel');
    expect(collapse).not.toHaveBeenCalled();
  });

  it('Try again remounts recovered content and Copy diagnostic writes the local error payload', async () => {
    let broken = true;
    function Content(): JSX.Element {
      if (broken) throw new Error('audit failure');
      return <span>Recovered artwork view</span>;
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    vi.stubGlobal('navigator', { userAgent: 'control-audit', clipboard: { writeText } });
    await mount(
      <ErrorBoundary>
        <Content />
      </ErrorBoundary>,
    );
    await click('Copy diagnostic');
    expect(writeText).toHaveBeenCalledOnce();
    expect(JSON.parse(writeText.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
      error: { message: 'audit failure' },
    });
    expect(button('Copied')).toBeDefined();
    broken = false;
    await click('Try again');
    expect(host.textContent).toBe('Recovered artwork view');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('Keyboard Shortcuts Close removes its dialog and releases modal ownership', async () => {
    function Reference(): JSX.Element {
      const [open, setOpen] = useState(true);
      return open ? (
        <ShortcutsDialog machineKind="laser" onClose={() => setOpen(false)} />
      ) : (
        <span>Closed</span>
      );
    }
    await mount(<Reference />);
    expect(useUiStore.getState().modalDepth).toBe(1);
    await click('Close');
    expect(host.textContent).toBe('Closed');
    expect(useUiStore.getState().modalDepth).toBe(0);
  });
});

describe('individual editing dialog actions', () => {
  it('Grid and Circular array modes submit their own settings, including rotation', async () => {
    const apply = vi.fn();
    await mount(
      <ArrayDialog
        selectionBounds={{ minX: 10, minY: 20, maxX: 30, maxY: 40 }}
        onCancel={vi.fn()}
        onApply={apply}
      />,
    );
    await click('Circular');
    expect(button('Circular').getAttribute('aria-selected')).toBe('true');
    const rotate = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (rotate === null) throw new Error('Missing rotate copies');
    await act(async () => rotate.click());
    await click('Create array');
    expect(apply).toHaveBeenLastCalledWith({
      kind: 'circular',
      count: 6,
      centerX: 20,
      centerY: 30,
      radius: 25,
      startAngleDeg: 0,
      rotateCopies: true,
    });
    await click('Grid');
    expect(button('Grid').getAttribute('aria-selected')).toBe('true');
    await click('Create array');
    expect(apply).toHaveBeenLastCalledWith({
      kind: 'grid',
      rows: 2,
      columns: 2,
      spacingX: 2,
      spacingY: 2,
    });
  });

  it('Quick Nest Outline and rotation controls submit the chosen method without side effects on Cancel', async () => {
    const apply = vi.fn();
    const cancel = vi.fn();
    await mount(<QuickNestDialog boardAvailable onCancel={cancel} onApply={apply} />);
    await click('Fast');
    await click('Outline');
    const rotation = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (rotation === null) throw new Error('Missing nesting rotation');
    await act(async () => rotation.click());
    await click('Nest selection');
    expect(apply).toHaveBeenCalledExactlyOnceWith({
      bin: 'workspace',
      padding: 2,
      allowRotation: false,
      method: 'outline',
    });
    await click('Cancel');
    expect(cancel).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
  });

  it('Project Notes Cancel discards the draft and never applies it', async () => {
    const apply = vi.fn();
    const cancel = vi.fn();
    await mount(<ProjectNotesDialog notes="Existing note" onCancel={cancel} onApply={apply} />);
    const textarea = host.querySelector('textarea');
    if (textarea === null) throw new Error('Missing notes');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        textarea,
        'Discard me',
      );
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('Cancel');
    expect(cancel).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
  });

  it('contour repair Cancel leaves the project intact and an ineligible Apply stays inert', async () => {
    const project = createProject();
    const apply = vi.fn();
    const cancel = vi.fn();
    await mount(
      <CloseOpenFillContoursDialog
        project={project}
        selectedObjectId={null}
        additionalSelectedIds={new Set()}
        onCancel={cancel}
        onApply={apply}
      />,
    );
    expect(button('Apply Close').disabled).toBe(true);
    await click('Apply Close');
    await click('Cancel');
    expect(apply).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(project.scene.objects).toHaveLength(0);
  });

  it('Undo History Close dispatches once and empty Undo/Redo cannot dispatch', async () => {
    const undo = vi.fn();
    const redo = vi.fn();
    const close = vi.fn();
    await mount(
      <UndoHistoryDialog
        current={createProject()}
        undoStack={[]}
        redoStack={[]}
        onUndo={undo}
        onRedo={redo}
        onClose={close}
      />,
    );
    expect(button('Undo').disabled).toBe(true);
    expect(button('Redo').disabled).toBe(true);
    await click('Undo');
    await click('Redo');
    await click('Close');
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
