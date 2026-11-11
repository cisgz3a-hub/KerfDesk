import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DITHER_ALGORITHMS, type DitherAlgorithm } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { DitherSwatchPicker } from './DitherSwatchPicker';
import {
  effective,
  FIRST,
  load,
  mount as mountInspector,
  openAdvanced,
  SECOND,
} from './__fixtures__/selected-operation-inspector';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const TITLE = 'Binary modes emit off/max dots. Grayscale maps luma between Min Power and Power.';

beforeEach(() => resetStore());
afterEach(() => {
  resetStore();
  document.body.replaceChildren();
});

function Harness(props: {
  readonly initial: DitherAlgorithm | null;
  readonly onChange: (algorithm: DitherAlgorithm) => void;
}): JSX.Element {
  const [value, setValue] = useState(props.initial);
  return (
    <DitherSwatchPicker
      value={value}
      ariaLabel="Dither for Layer 1"
      title={TITLE}
      onChange={(algorithm) => {
        props.onChange(algorithm);
        setValue(algorithm);
      }}
    />
  );
}

async function mountPicker(initial: DitherAlgorithm | null) {
  const onChange = vi.fn<(algorithm: DitherAlgorithm) => void>();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Harness initial={initial} onChange={onChange} />));
  return { host, onChange, unmount: async () => act(async () => root.unmount()) };
}

// The inspector also holds the Line | Fill | Image radios; stay in the Dither group.
const DITHER_GROUP = '[role="radiogroup"][aria-label^="Dither for"]';

function radios(host: HTMLElement): HTMLInputElement[] {
  return [...host.querySelectorAll<HTMLInputElement>(`${DITHER_GROUP} input[type="radio"]`)];
}

function radio(host: HTMLElement, algorithm: DitherAlgorithm): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>(
    `${DITHER_GROUP} input[type="radio"][value="${algorithm}"]`,
  );
  if (input === null) throw new Error(`${algorithm} swatch missing`);
  return input;
}

function checkedValue(host: HTMLElement): string | null {
  return radios(host).find((input) => input.checked)?.value ?? null;
}

async function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  await act(async () => target.dispatchEvent(event));
  return event;
}

describe('Dither swatch picker', () => {
  it('offers every mode as a named swatch inside the titled Dither group', async () => {
    const view = await mountPicker('jarvis');
    try {
      const group = view.host.querySelector('[role="radiogroup"]');
      expect(group?.getAttribute('aria-label')).toBe('Dither for Layer 1');
      expect(group?.getAttribute('title')).toBe(TITLE);
      expect(radios(view.host).map((input) => input.value)).toEqual([...DITHER_ALGORITHMS]);
      expect(radios(view.host).map((input) => input.getAttribute('aria-label'))).toEqual([
        'Threshold',
        'Floyd-Steinberg',
        'Jarvis',
        'Stucki',
        'Atkinson',
        'Burkes',
        'Sierra 3',
        'Sierra 2',
        'Sierra Lite',
        'Blue Noise',
        'Ordered',
        'Grayscale',
        '3D Sliced',
      ]);
      expect(radios(view.host).every((input) => input.title.length > 20)).toBe(true);
      expect(view.host.querySelectorAll('svg path')).toHaveLength(DITHER_ALGORITHMS.length - 2);
      expect(
        radio(view.host, 'grayscale').closest('label')?.querySelector('linearGradient'),
      ).not.toBeNull();
      expect(checkedValue(view.host)).toBe('jarvis');
      expect(view.host.querySelector('.lf-dither-picker__caption')?.textContent).toContain(
        'Jarvis',
      );
    } finally {
      await view.unmount();
    }
  });

  it('selects a mode when its swatch is clicked', async () => {
    const view = await mountPicker('floyd-steinberg');
    try {
      await act(async () => radio(view.host, 'ordered').click());
      expect(view.onChange).toHaveBeenCalledExactlyOnceWith('ordered');
      expect(checkedValue(view.host)).toBe('ordered');
      expect(view.host.querySelector('[data-checked="true"] input')?.getAttribute('value')).toBe(
        'ordered',
      );
    } finally {
      await view.unmount();
    }
  });

  it('shows Mixed with no swatch checked until one is chosen', async () => {
    const view = await mountPicker(null);
    try {
      expect(checkedValue(view.host)).toBeNull();
      expect(view.host.querySelector('[data-checked="true"]')).toBeNull();
      expect(view.host.querySelector('.lf-dither-picker__caption')?.textContent).toContain('Mixed');
      // One tab stop into the group even though nothing is checked.
      expect(radios(view.host).map((input) => input.tabIndex)).toEqual(
        DITHER_ALGORITHMS.map((_, index) => (index === 0 ? 0 : -1)),
      );
      await act(async () => radio(view.host, 'stucki').click());
      expect(view.onChange).toHaveBeenCalledExactlyOnceWith('stucki');
      expect(view.host.querySelector('.lf-dither-picker__caption')?.textContent).not.toContain(
        'Mixed',
      );
    } finally {
      await view.unmount();
    }
  });

  it('moves and selects with the arrow keys, wrapping at both ends', async () => {
    const view = await mountPicker('threshold');
    try {
      radio(view.host, 'threshold').focus();
      const right = await press(radio(view.host, 'threshold'), 'ArrowRight');
      expect(right.defaultPrevented).toBe(true);
      expect(checkedValue(view.host)).toBe('floyd-steinberg');
      expect(document.activeElement).toBe(radio(view.host, 'floyd-steinberg'));
      await press(radio(view.host, 'floyd-steinberg'), 'ArrowDown');
      expect(checkedValue(view.host)).toBe('jarvis');
      await press(radio(view.host, 'jarvis'), 'ArrowUp');
      await press(radio(view.host, 'floyd-steinberg'), 'ArrowLeft');
      expect(checkedValue(view.host)).toBe('threshold');
      await press(radio(view.host, 'threshold'), 'ArrowLeft');
      expect(checkedValue(view.host)).toBe('3d-sliced');
      expect(document.activeElement).toBe(radio(view.host, '3d-sliced'));
      await press(radio(view.host, '3d-sliced'), 'ArrowRight');
      expect(checkedValue(view.host)).toBe('threshold');
      expect(view.onChange.mock.calls.map(([algorithm]) => algorithm)).toEqual([
        'floyd-steinberg',
        'jarvis',
        'floyd-steinberg',
        'threshold',
        '3d-sliced',
        'threshold',
      ]);
      expect(radios(view.host).filter((input) => input.tabIndex === 0)).toEqual([
        radio(view.host, 'threshold'),
      ]);
    } finally {
      await view.unmount();
    }
  });

  it('submits the checked swatch under its form name and offers only the given modes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onChange = vi.fn<(algorithm: DitherAlgorithm) => void>();
    await act(async () =>
      root.render(
        <form>
          <DitherSwatchPicker
            name="ditherAlgorithm"
            value="stucki"
            algorithms={['jarvis', 'stucki', 'floyd-steinberg']}
            ariaLabel="Dither for photo"
            title={TITLE}
            onChange={onChange}
          />
        </form>,
      ),
    );
    try {
      const form = host.querySelector('form');
      if (form === null) throw new Error('form missing');
      expect(radios(host).map((input) => input.value)).toEqual([
        'jarvis',
        'stucki',
        'floyd-steinberg',
      ]);
      expect(new FormData(form).getAll('ditherAlgorithm')).toEqual(['stucki']);
      await press(radio(host, 'floyd-steinberg'), 'ArrowRight');
      await press(radio(host, 'jarvis'), 'End');
      expect(onChange.mock.calls.map(([algorithm]) => algorithm)).toEqual([
        'jarvis',
        'floyd-steinberg',
      ]);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('jumps with Home and End and leaves other keys and shortcuts alone', async () => {
    const view = await mountPicker('atkinson');
    try {
      await press(radio(view.host, 'atkinson'), 'End');
      expect(checkedValue(view.host)).toBe('3d-sliced');
      await press(radio(view.host, '3d-sliced'), 'Home');
      expect(checkedValue(view.host)).toBe('threshold');
      const letter = await press(radio(view.host, 'threshold'), 'a');
      const shortcut = await press(radio(view.host, 'threshold'), 'ArrowRight', { ctrlKey: true });
      expect(letter.defaultPrevented).toBe(false);
      expect(shortcut.defaultPrevented).toBe(false);
      expect(checkedValue(view.host)).toBe('threshold');
      expect(view.onChange).toHaveBeenCalledTimes(2);
    } finally {
      await view.unmount();
    }
  });
});

describe('Dither in the selected-operation inspector', () => {
  const image = { mode: 'image' as const };

  it('shows Mixed for artwork with different dithers and applies one choice to all', async () => {
    load(
      { ...FIRST, ...image, ditherAlgorithm: 'jarvis' },
      { ...SECOND, ...image, ditherAlgorithm: 'ordered' },
    );
    const view = await mountInspector();
    try {
      expect(checkedValue(view.host)).toBeNull();
      expect(view.host.textContent).toContain('Mixed');
      await act(async () => radio(view.host, 'atkinson').click());
      expect(effective().map((settings) => settings.ditherAlgorithm)).toEqual([
        'atkinson',
        'atkinson',
      ]);
      expect(checkedValue(view.host)).toBe('atkinson');
      expect(effective().map((settings) => settings.power)).toEqual([17, 83]);
    } finally {
      await view.unmount();
    }
  });

  it('keeps focus on the picker while arrow keys commit each mode', async () => {
    load(
      { ...FIRST, ...image, ditherAlgorithm: 'stucki' },
      { ...SECOND, ...image, ditherAlgorithm: 'stucki' },
    );
    const view = await mountInspector();
    try {
      radio(view.host, 'stucki').focus();
      await press(radio(view.host, 'stucki'), 'ArrowRight');
      await press(radio(view.host, 'atkinson'), 'ArrowRight');
      expect(effective().map((settings) => settings.ditherAlgorithm)).toEqual(['burkes', 'burkes']);
      expect(document.activeElement).toBe(radio(view.host, 'burkes'));
      expect(useStore.getState().dirty).toBe(true);
    } finally {
      await view.unmount();
    }
  });

  // Use original pixels burns as Grayscale whatever the stored dither.
  it.each([
    ['a binary dither under Use original pixels', 'jarvis', true, true, /burns as Grayscale/],
    ['Grayscale under Use original pixels', 'grayscale', true, true, null],
    ['a binary dither without it', 'jarvis', false, false, null],
    ['artwork that disagrees on it', 'jarvis', true, false, /Some selected artwork/],
  ] as const)(
    'says when the choice does not burn: %s',
    async (_case, ditherAlgorithm, firstPassThrough, secondPassThrough, notice) => {
      load(
        { ...FIRST, ...image, ditherAlgorithm, passThrough: firstPassThrough },
        { ...SECOND, ...image, ditherAlgorithm, passThrough: secondPassThrough },
      );
      const view = await mountInspector();
      try {
        const group = view.host.querySelector(DITHER_GROUP);
        const text = view.host.querySelector('.lf-dither-picker__notice')?.textContent ?? null;
        if (notice === null) {
          expect(text).toBeNull();
          expect(group?.hasAttribute('aria-describedby')).toBe(false);
        } else {
          expect(text).toMatch(notice);
          const describedBy = group?.getAttribute('aria-describedby') ?? '';
          expect(document.getElementById(describedBy)?.textContent).toBe(text);
        }
        expect(checkedValue(view.host)).toBe(ditherAlgorithm);
      } finally {
        await view.unmount();
      }
    },
  );

  // Compile applies Min power to every Grayscale burn, original pixels included.
  it.each([
    ['Grayscale', 'grayscale', false, false, true],
    ['a binary dither under Use original pixels', 'jarvis', true, true, true],
    ['a binary dither without it', 'jarvis', false, false, false],
    ['a binary dither on artwork that disagrees on it', 'jarvis', true, false, false],
    ['Grayscale on artwork that disagrees on it', 'grayscale', true, false, true],
  ] as const)(
    'offers Min power exactly when the image burns as Grayscale: %s',
    async (_case, ditherAlgorithm, firstPassThrough, secondPassThrough, shown) => {
      load(
        { ...FIRST, ...image, ditherAlgorithm, passThrough: firstPassThrough },
        { ...SECOND, ...image, ditherAlgorithm, passThrough: secondPassThrough },
      );
      const view = await mountInspector();
      try {
        const inline = view.host.querySelector('input[aria-label^="Minimum power for"]');
        expect(inline !== null).toBe(shown);
        if (firstPassThrough !== secondPassThrough) return;
        await openAdvanced(view.host);
        expect(document.querySelector('form input[name="minPower"]') !== null).toBe(shown);
      } finally {
        await view.unmount();
      }
    },
  );
});
