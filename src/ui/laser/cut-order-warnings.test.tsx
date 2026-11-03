import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { isCutBeforeEngravingWarning } from './cut-order-warnings';
import { detectJobIntentWarnings } from './job-intent-warnings';
import { JobReviewWarnings } from './job-review/JobReviewWarnings';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CUT_COLOR = '#0000ff';
const ENGRAVE_COLOR = '#ff0000';

function square(id: string, color: string, minX: number, size: number): SceneObject {
  const max = minX + size;
  return {
    kind: 'traced-image',
    id,
    source: `${id}.png`,
    bounds: { minX, minY: minX, maxX: max, maxY: max },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            points: [
              { x: minX, y: minX },
              { x: max, y: minX },
              { x: max, y: max },
              { x: minX, y: max },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
}

const outlineCut: Layer = {
  ...createLayer({ id: 'cut', color: CUT_COLOR }),
  name: 'Ellipse',
  mode: 'line',
  power: 100,
  speed: 300,
};
const nameFill: Layer = {
  ...createLayer({ id: 'fill', color: ENGRAVE_COLOR }),
  name: 'Hi',
  mode: 'fill',
};

// U3's coaster: the outline drawn first, then the name inside it.
function coaster(order: 'cut-first' | 'engrave-first' = 'cut-first'): Project {
  const outline = square('outline', CUT_COLOR, 10, 80);
  const name = square('name', ENGRAVE_COLOR, 40, 20);
  const cutFirst = order === 'cut-first';
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: cutFirst ? [outline, name] : [name, outline],
      layers: cutFirst ? [outlineCut, nameFill] : [nameFill, outlineCut],
    },
  };
}

const cutWarnings = (project: Project): ReadonlyArray<string> =>
  detectJobIntentWarnings(project).filter(isCutBeforeEngravingWarning);

const mounted: Array<{ readonly host: HTMLElement; readonly root: ReturnType<typeof createRoot> }> =
  [];

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
  for (const { host, root } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
  useToastStore.setState({ toasts: [] });
});

describe('cut before engraving warning', () => {
  it('names the cut and the engraving inside it', () => {
    expect(cutWarnings(coaster())).toEqual([
      'Cut runs before the engraving inside it: "Ellipse" runs before "Hi". Once a part is cut free it can drop or shift, and the engraving lands in the wrong place. Engrave first and cut last: use Cut last, or change the run numbers in Run order.',
    ]);
  });

  it('says nothing when the engraving already runs first', () => {
    expect(cutWarnings(coaster('engrave-first'))).toEqual([]);
  });

  it('leaves CNC to its own rule: profiles always run after pockets', () => {
    expect(cutWarnings({ ...coaster(), machine: DEFAULT_CNC_MACHINE_CONFIG })).toEqual([]);
  });

  it('never changes the G-code by itself', () => {
    const project = coaster();
    const before = emitGcode(project).gcode;

    detectJobIntentWarnings(project);

    expect(emitGcode(project).gcode).toBe(before);
  });

  it('offers Cut last in Job Review, which reorders the job and clears the warning', async () => {
    useStore.setState({ project: coaster() });
    const before = emitGcode(useStore.getState().project).gcode;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ host, root });
    await act(async () => {
      root.render(<JobReviewWarnings warnings={cutWarnings(useStore.getState().project)} />);
    });
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Cut last');
    expect(host.querySelector('details')?.open).toBe(true);

    await act(async () => button?.click());

    const project = useStore.getState().project;
    expect(cutWarnings(project)).toEqual([]);
    const after = emitGcode(project).gcode;
    expect(after).not.toBe(before);
    expect(after.indexOf('fill layer')).toBeLessThan(after.indexOf('speed 300'));
    useStore.getState().undo();
    expect(emitGcode(useStore.getState().project).gcode).toBe(before);
  });
});
