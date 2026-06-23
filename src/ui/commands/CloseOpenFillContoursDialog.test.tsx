import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { CloseOpenFillContoursDialog } from './CloseOpenFillContoursDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('CloseOpenFillContoursDialog', () => {
  it('previews tolerance repair counts and applies only after confirmation', async () => {
    const onApply = vi.fn();
    const { host, root } = await renderDialog({
      project: projectWithObjects([
        vectorObject('near-open', { x: 0.25, y: 0.25 }),
        vectorObject('review-open', { x: 2, y: 2 }),
        vectorObject('too-wide-open', { x: 4, y: 4 }),
      ]),
      selectedObjectId: 'near-open',
      additionalSelectedIds: new Set(['review-open', 'too-wide-open']),
      onApply,
    });
    try {
      expect(host.textContent).toContain('3 open Fill contours selected');
      expect(host.textContent).toContain('1 can use the 0.5 mm quick close');

      const tolerance = inputByLabel(host, 'Tolerance');
      await act(async () => {
        setInputValue(tolerance, '3');
        tolerance.dispatchEvent(new Event('input', { bubbles: true }));
      });

      expect(host.textContent).toContain('1 additional contour will close after review');
      expect(host.textContent).toContain('1 contour will remain open');
      expect(onApply).not.toHaveBeenCalled();

      await act(async () => {
        buttonByText(host, 'Apply Close').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(onApply).toHaveBeenCalledWith(3);
    } finally {
      await act(async () => root.unmount());
    }
  });
});

async function renderDialog(props: {
  readonly project: Project;
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly onApply?: (toleranceMm: number) => void;
  readonly onCancel?: () => void;
}): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <CloseOpenFillContoursDialog
        project={props.project}
        selectedObjectId={props.selectedObjectId}
        additionalSelectedIds={props.additionalSelectedIds}
        onCancel={props.onCancel ?? vi.fn()}
        onApply={props.onApply ?? vi.fn()}
      />,
    );
  });
  if (root === null) throw new Error('root did not mount');
  return { host, root };
}

function projectWithObjects(objects: ReadonlyArray<ImportedSvg>): Project {
  return {
    ...createProject(),
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'fill' })],
      objects,
      groups: [],
    },
  };
}

function vectorObject(id: string, lastPoint: { readonly x: number; readonly y: number }) {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, lastPoint],
          },
        ],
      },
    ],
  } satisfies ImportedSvg;
}

function inputByLabel(container: HTMLElement, labelText: string): HTMLInputElement {
  const labels = [...container.querySelectorAll('label')];
  const label = labels.find((item) => item.textContent?.includes(labelText));
  const input = label?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`${labelText} input missing`);
  return input;
}

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${label} button missing`);
  return button;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('input value setter missing');
  setter.call(input, value);
}
