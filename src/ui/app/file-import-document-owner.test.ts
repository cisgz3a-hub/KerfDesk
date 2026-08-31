import { describe, expect, it, vi } from 'vitest';
import { mockPlatform, toasts } from '../../__fixtures__/file-actions';
import { handleImportDxf, handleImportSvg } from './file-actions';

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

describe('direct file import document ownership', () => {
  it.each([
    {
      label: 'SVG',
      name: 'late.svg',
      source: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L1 1"/></svg>',
      run: handleImportSvg,
    },
    {
      label: 'DXF',
      name: 'late.dxf',
      source: '0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n1\n21\n1\n0\nENDSEC\n0\nEOF\n',
      run: handleImportDxf,
    },
  ])(
    'silently discards a delayed direct $label import after a same-id document replacement',
    async ({ name, source, run }) => {
      const read = deferred<string>();
      const text = vi.fn(() => read.promise);
      const importObject = vi.fn(() => ({ kind: 'added' as const }));
      const toast = toasts();
      let epoch = 5;
      const pending = run(
        mockPlatform({ open: async () => [{ name, text }] }),
        importObject,
        toast.pushToast,
        () => epoch,
      );
      await vi.waitFor(() => expect(text).toHaveBeenCalledOnce());

      epoch += 1;
      read.resolve(source);
      await pending;

      expect(importObject).not.toHaveBeenCalled();
      expect(toast.messages).toEqual([]);
    },
  );
});
