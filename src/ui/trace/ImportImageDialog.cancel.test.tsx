import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./image-loader', () => ({
  dataUrlToFile: vi.fn(async () => new File(['fixture'], 'fixture.png')),
}));
vi.mock('./use-trace-preview', () => ({ useTracePreview: () => ({ kind: 'tracing' }) }));
vi.mock('./trace-commit-result', () => ({ resolveTraceCommitResult: vi.fn() }));
vi.mock('../raster/vector-to-bitmap', () => ({ buildBitmapFromVectors: vi.fn() }));

import { resolveTraceCommitResult } from './trace-commit-result';
import { buildBitmapFromVectors } from '../raster/vector-to-bitmap';
import { useUiStore } from '../state/ui-store';
import {
  mountSettlementDialog,
  settlementResult,
  settlementSnapshot,
  settlementSource,
} from './trace-settlement.test-support';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('Trace Cancel while successful work is pending', () => {
  it.each(['ordinary-vector', 'camera-raster'] as const)(
    'closes %s before its successful reply and preserves document state',
    async (mode) => {
      let release!: () => void;
      if (mode === 'ordinary-vector') {
        vi.mocked(resolveTraceCommitResult).mockImplementation(
          () =>
            new Promise((resolve) => {
              release = () => resolve(settlementResult);
            }),
        );
      } else {
        vi.mocked(resolveTraceCommitResult).mockResolvedValue(settlementResult);
        vi.mocked(buildBitmapFromVectors).mockImplementation(
          () =>
            new Promise((resolve) => {
              release = () => resolve({ ...settlementSource, id: 'converted' });
            }),
        );
      }
      const opener = document.createElement('button');
      document.body.append(opener);
      opener.focus();
      const dialog = await mountSettlementDialog(mode === 'camera-raster');
      const before = settlementSnapshot();
      try {
        if (mode === 'camera-raster') {
          const output = dialog.host.querySelector<HTMLSelectElement>(
            '[aria-label="Trace output"]',
          );
          if (output === null) throw new Error('Missing output');
          await act(async () => {
            output.value = 'raster';
            output.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }
        const submit = dialog.host.querySelector<HTMLButtonElement>('button[type="submit"]');
        const cancel = [...dialog.host.querySelectorAll('button')].find(
          (button) => button.textContent === 'Cancel',
        );
        if (submit === null || cancel === undefined) throw new Error('Missing Trace actions');
        await act(async () => {
          submit.focus();
          submit.click();
        });
        expect(submit.disabled).toBe(true);
        expect(cancel.disabled).toBe(false);
        await act(async () => cancel.click());
        expect(useUiStore.getState().imageDialog).toBeNull();
        expect(document.activeElement).toBe(opener);
        await act(async () => release());
        expect(settlementSnapshot()).toEqual(before);
      } finally {
        await dialog.close();
        await act(async () => release?.());
      }
    },
  );
});
