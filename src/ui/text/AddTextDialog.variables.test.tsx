import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreText from '../../core/text';
import type { VariableTemplate } from '../../core/scene';
import { evaluateVariableTemplate } from '../../core/variables';

const textMocks = vi.hoisted(() => ({
  textToPolylines: vi.fn(async (input: { readonly color: string }) => ({
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    paths: [{ color: input.color, polylines: [] }],
  })),
}));

vi.mock('./font-loader', () => ({
  cssFamilyForFont: (key: string) => `lf2-${key}`,
  ensureFontCss: vi.fn(async () => undefined),
  loadFont: vi.fn(async () => new ArrayBuffer(8)),
}));
vi.mock('../../core/text', async (importOriginal) => ({
  ...(await importOriginal<typeof CoreText>()),
  textToPolylines: textMocks.textToPolylines,
}));

import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { AddTextDialog } from './AddTextDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  textMocks.textToPolylines.mockClear();
  useStore.getState().newProject();
  useUiStore.setState({ textDialog: null });
  clearToasts();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useStore.getState().newProject();
  useUiStore.setState({ textDialog: null });
  clearToasts();
});

describe('AddTextDialog variable template integrity', () => {
  it('preserves literal field syntax through editing, saving, and evaluation', async () => {
    const template: VariableTemplate = {
      tokens: [
        { kind: 'literal', value: 'Literal {{speed}}: ' },
        { kind: 'serial', prefix: '', width: 4 },
      ],
    };
    useUiStore.setState({
      textDialog: {
        mode: 'edit',
        id: 'text-1',
        content: 'fallback',
        fontKey: 'dancing-script-regular',
        sizeMm: 12,
        alignment: 'left',
        lineHeight: 1.2,
        letterSpacing: 0,
        color: '#000000',
        variableTemplate: template,
      },
    });
    await act(async () => root.render(<AddTextDialog />));
    await submit();

    const project = useStore.getState().project;
    const saved = project.scene.objects.find((object) => object.id === 'text-1');
    if (saved?.kind !== 'text' || saved.variableTemplate === undefined) {
      throw new Error('variable text was not saved');
    }
    expect(saved.variableTemplate).toEqual(template);
    expect(
      evaluateVariableTemplate(saved.variableTemplate, saved, project, {
        now: new globalThis.Date(0),
        serialValue: 7,
      }),
    ).toEqual({ ok: true, value: 'Literal {{speed}}: 0007' });
    expect(useUiStore.getState().textDialog).toBeNull();
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'rejects typed inherited field %s before saving or rendering text',
    async (tag) => {
      useUiStore.setState({ textDialog: { mode: 'add' } });
      await act(async () => root.render(<AddTextDialog />));
      await act(async () => {
        const content = host.querySelector('textarea');
        const enabled = host.querySelector('section[aria-label="Variable text"] input');
        if (!(content instanceof HTMLTextAreaElement) || !(enabled instanceof HTMLInputElement)) {
          throw new Error('variable text controls missing');
        }
        content.value = `{{${tag}}}`;
        Simulate.change(content);
        enabled.checked = true;
        Simulate.change(enabled);
      });
      await submit();

      expect(useStore.getState().project.scene.objects).toHaveLength(0);
      expect(textMocks.textToPolylines).not.toHaveBeenCalled();
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({ message: `Unknown variable field "${tag}".` }),
      ]);
      expect(useUiStore.getState().textDialog).not.toBeNull();
    },
  );
});

async function submit(): Promise<void> {
  const form = host.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('text form missing');
  await act(async () => {
    Simulate.submit(form);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function clearToasts(): void {
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
}
