import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectVariableData, VariableSequenceSettings } from '../../core/scene';
import { VariableSequenceControls } from './VariableSequenceControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('VariableSequenceControls', () => {
  it('edits ranges, removes serial wrapping, and exposes transport actions', async () => {
    const previous = vi.fn();
    const next = vi.fn();
    const reset = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<Harness previous={previous} next={next} reset={reset} />));

    await changeNumber('Variable record start', 2);
    await changeNumber('Variable record end', 3);
    await changeNumber('Variable advance by', 2);
    expect(sequence()).toMatchObject({
      recordStartIndex: 1,
      recordEndIndex: 2,
      advanceBy: 2,
      serialEndValue: 20,
    });

    const wrap = requireInput('Wrap serial');
    wrap.checked = false;
    await act(async () => Simulate.change(wrap));
    expect(sequence()).not.toHaveProperty('serialEndValue');

    await click('Previous');
    await click('Reset');
    await click('Next');
    expect(previous).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
  });
});

function Harness(props: {
  readonly previous: () => void;
  readonly next: () => void;
  readonly reset: () => void;
}): JSX.Element {
  const [variables, setVariables] = useState<ProjectVariableData>({
    recordIndex: 0,
    serialValue: 10,
    advancement: 'manual',
    csv: {
      sourceName: 'parts.csv',
      headers: ['name'],
      records: [['A'], ['B'], ['C']],
    },
    sequence: {
      recordStartIndex: 0,
      recordEndIndex: 2,
      serialStartValue: 10,
      serialEndValue: 20,
      advanceBy: 1,
    },
  });
  return (
    <VariableSequenceControls
      variables={variables}
      setSettings={(settings) =>
        setVariables((current) => ({
          ...current,
          ...settings,
          ...(settings.sequence === undefined ? {} : { sequence: settings.sequence }),
        }))
      }
      previous={props.previous}
      next={props.next}
      reset={props.reset}
    />
  );
}

async function changeNumber(label: string, value: number): Promise<void> {
  const input = requireInput(label);
  input.value = String(value);
  await act(async () => Simulate.change(input));
}

async function click(label: string): Promise<void> {
  const button = Array.from(host?.querySelectorAll('button') ?? []).find(
    (candidate) => candidate.textContent === label,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${label} button missing`);
  await act(async () => Simulate.click(button));
}

function requireInput(label: string): HTMLInputElement {
  const input = document.querySelector(`input[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`${label} input missing`);
  return input;
}

function sequence(): VariableSequenceSettings {
  const controls = host?.querySelector('fieldset');
  if (!(controls instanceof HTMLFieldSetElement)) throw new Error('Sequence controls missing');
  const values = Array.from(controls.querySelectorAll('input[type="number"]')).map((input) =>
    Number((input as HTMLInputElement).value),
  );
  const wrap = requireInput('Wrap serial').checked;
  return {
    recordStartIndex: (values[0] ?? 1) - 1,
    recordEndIndex: (values[1] ?? 1) - 1,
    serialStartValue: values[2] ?? 1,
    ...(wrap ? { serialEndValue: values[3] ?? 1 } : {}),
    advanceBy: values[wrap ? 4 : 3] ?? 1,
  };
}
