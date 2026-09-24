import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { artwork, operation } from '../../core/cut-order.test-support';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { JobReviewWarnings } from '../laser/job-review/JobReviewWarnings';
import { isCutOrderWarning } from '../laser/cut-order-warnings';
import { detectJobIntentWarnings } from '../laser/job-intent-warnings';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { ArtworkRunOrderToolbar } from './ArtworkRunOrderToolbar';
import { button, click, mount } from './control-audit-test-support';

function arrangeCutBeforeEngraving(): void {
  const { project } = useStore.getState();
  useStore.setState({
    project: {
      ...project,
      scene: {
        ...project.scene,
        layers: [operation('cut'), operation('engrave', 'fill')],
        objects: [
          artwork('outline', [{ operationId: 'cut', rect: [0, 0, 50, 50] }]),
          artwork('logo', [{ operationId: 'engrave', rect: [10, 10, 10, 10] }]),
        ],
        artworkOrder: ['outline', 'logo'],
      },
    },
  });
}

const layerIds = (): ReadonlyArray<string> =>
  useStore.getState().project.scene.layers.map((layer) => layer.id);
const lastToast = () => useToastStore.getState().toasts.at(-1);

function RunOrderToolbar(): JSX.Element {
  const noop = (): void => undefined;
  return (
    <ArtworkRunOrderToolbar
      search=""
      total={2}
      jumpPosition=""
      numbering={{ kind: 'idle' }}
      onSearch={noop}
      onJumpPosition={noop}
      onJump={noop}
      onStartNumbering={noop}
      onUndoNumbering={noop}
      onDoneNumbering={noop}
      onCancelNumbering={noop}
    />
  );
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  arrangeCutBeforeEngraving();
});

afterEach(() => {
  for (const toast of useToastStore.getState().toasts)
    useToastStore.getState().dismissToast(toast.id);
});

describe('Sort cuts last in Run order', () => {
  it('runs the cut after the engraving and says so, then reports nothing left to move', async () => {
    const host = await mount(<RunOrderToolbar />);

    await click(button(host, 'Sort cuts last'));
    expect(layerIds()).toEqual(['engrave', 'cut']);
    expect(useStore.getState().project.scene.artworkOrder).toEqual(['logo', 'outline']);
    expect(lastToast()).toMatchObject({
      variant: 'success',
      message: 'Cuts now run last: the cut operation runs after the work it surrounds.',
    });

    await click(button(host, 'Sort cuts last'));
    expect(lastToast()).toMatchObject({
      variant: 'info',
      message: 'Every cut already runs after the work it surrounds.',
    });
  });

  it('is not offered for a CNC job', async () => {
    const { project } = useStore.getState();
    useStore.setState({ project: { ...project, machine: DEFAULT_CNC_MACHINE_CONFIG } });
    const host = await mount(<RunOrderToolbar />);

    expect(host.textContent).not.toContain('Sort cuts last');
  });
});

describe('Sort cuts last in Job Review', () => {
  it('opens the warnings, offers the fix beside the cut-order warning, and hides it once fixed', async () => {
    const warnings = detectJobIntentWarnings(useStore.getState().project);
    expect(warnings.some(isCutOrderWarning)).toBe(true);
    const host = await mount(<JobReviewWarnings warnings={warnings} />);

    expect(host.querySelector('details')?.open).toBe(true);
    const item = [...host.querySelectorAll('li')].find((li) =>
      isCutOrderWarning(li.textContent ?? ''),
    );
    if (item === undefined) throw new Error('cut-order warning missing');
    await click(button(item, 'Sort cuts last'));

    expect(layerIds()).toEqual(['engrave', 'cut']);
    // The review rebuilds its warnings after an edit; until then the fix is gone.
    expect(host.querySelector('button')).toBeNull();
  });

  it('says that sorting at Start needs a new Frame, and offers no fix for a second pass', async () => {
    const warnings = detectJobIntentWarnings(useStore.getState().project);
    const start = await mount(<JobReviewWarnings warnings={warnings} purpose="start" />);
    const secondPass = await mount(
      <JobReviewWarnings warnings={warnings} purpose="laser-second-pass" />,
    );

    expect(button(start, 'Sort cuts last').title).toContain('Frame it again');
    expect(secondPass.querySelector('button')).toBeNull();
  });

  it('adds no fix and stays closed for other warnings', async () => {
    const host = await mount(<JobReviewWarnings warnings={['Fill overscan is 0.']} />);

    expect(host.querySelector('details')?.open).toBe(false);
    expect(host.querySelector('button')).toBeNull();
  });
});
