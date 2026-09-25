import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultBarcodeSpec, type BarcodeShape } from '../../core/barcode';
import {
  createProject,
  DEFAULT_PROJECT_VARIABLE_DATA,
  IDENTITY_TRANSFORM,
  type Project,
  type ShapeObject,
} from '../../core/scene';
import { BarcodeDialog, type BarcodeSubmit } from './BarcodeDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date('2026-09-24T10:00:00.000Z');
const PROJECT: Project = {
  ...createProject(),
  variables: { ...DEFAULT_PROJECT_VARIABLE_DATA, serialValue: 41 },
};
const SUBJECT: ShapeObject = {
  kind: 'shape',
  id: 'stand-in',
  spec: defaultBarcodeSpec('qr'),
  color: '#000000',
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  transform: IDENTITY_TRANSFORM,
  paths: [],
};

type View = { readonly host: HTMLDivElement; readonly root: Root };

async function renderDialog(
  onSubmit: BarcodeSubmit,
  initial: BarcodeShape = defaultBarcodeSpec('qr'),
): Promise<View> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <BarcodeDialog
        mode="insert"
        initial={initial}
        project={PROJECT}
        subject={SUBJECT}
        clock={() => NOW}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
  });
  return { host, root };
}

afterEach(() => {
  document.body.innerHTML = '';
});

function control<T extends Element = HTMLElement>(host: HTMLElement, selector: string): T {
  const element = host.querySelector<T>(selector);
  if (element === null) throw new Error(`${selector} missing`);
  return element;
}

async function change(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  element.value = value;
  await act(async () => {
    Simulate.change(element);
  });
}

function insertButton(host: HTMLElement): HTMLButtonElement {
  return control<HTMLButtonElement>(host, 'button[type="submit"]');
}

function previewLabel(host: HTMLElement): string | null {
  return host.querySelector('svg[role="img"]')?.getAttribute('aria-label') ?? null;
}

async function unmount(view: View): Promise<void> {
  await act(async () => view.root.unmount());
}

describe('BarcodeDialog', () => {
  it('previews the code live and inserts the encoded spec and value', async () => {
    const onSubmit = vi.fn<BarcodeSubmit>(async () => null);
    const view = await renderDialog(onSubmit);
    try {
      await change(control(view.host, 'textarea[aria-label="Barcode data"]'), 'HELLO WORLD');
      expect(previewLabel(view.host)).toBe(
        'Barcode preview: QR Code version 1 (21 × 21 modules), error correction M',
      );
      expect(view.host.textContent).toContain('17.4 × 17.4 mm · module 0.6 mm');
      await act(async () => insertButton(view.host).click());
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'barcode', symbology: 'qr', data: 'HELLO WORLD' }),
        'HELLO WORLD',
      );
    } finally {
      await unmount(view);
    }
  });

  it('explains data a type cannot carry, keeps the last code dimmed and disables Insert', async () => {
    const onSubmit = vi.fn<BarcodeSubmit>(async () => null);
    const view = await renderDialog(onSubmit);
    try {
      await change(control(view.host, 'select[aria-label="Barcode type"]'), 'ean13');
      expect(previewLabel(view.host)).toContain('EAN-13 5901234123457');
      await change(control(view.host, 'textarea[aria-label="Barcode data"]'), '12345');
      expect(control(view.host, '[role="alert"]').textContent).toBe(
        'EAN-13 needs 12 digits, or 13 with the check digit.',
      );
      expect(previewLabel(view.host)).toContain('EAN-13 5901234123457');
      expect(control<SVGElement>(view.host, 'svg[role="img"]').style.opacity).toBe('0.35');
      expect(insertButton(view.host).disabled).toBe(true);
      await act(async () => insertButton(view.host).click());
      expect(onSubmit).not.toHaveBeenCalled();
    } finally {
      await unmount(view);
    }
  });

  it('shows only the settings the chosen type uses', async () => {
    const view = await renderDialog(vi.fn<BarcodeSubmit>(async () => null));
    const labels = (): string[] =>
      [...view.host.querySelectorAll('[aria-label]')].map(
        (node) => node.getAttribute('aria-label') ?? '',
      );
    try {
      expect(labels()).toContain('Error correction');
      expect(labels()).not.toContain('Bar height');
      expect(view.host.textContent).not.toContain('Show text');
      await change(control(view.host, 'select[aria-label="Barcode type"]'), 'code128');
      expect(labels()).toContain('Bar height');
      expect(labels()).not.toContain('Error correction');
      expect(view.host.textContent).toContain('Show text');
      await change(control(view.host, 'select[aria-label="Size by"]'), 'width');
      expect(labels()).toContain('Overall width');
      expect(labels()).not.toContain('Module size');
    } finally {
      await unmount(view);
    }
  });

  it('keeps the dialog open with the reason when inserting fails', async () => {
    const view = await renderDialog(vi.fn<BarcodeSubmit>(async () => 'The font could not load.'));
    try {
      await act(async () => insertButton(view.host).click());
      expect(control(view.host, '[role="alert"]').textContent).toBe('The font could not load.');
      expect(insertButton(view.host).disabled).toBe(false);
    } finally {
      await unmount(view);
    }
  });

  it('previews variable data with the value the next output encodes', async () => {
    const onSubmit = vi.fn<BarcodeSubmit>(async () => null);
    const view = await renderDialog(onSubmit);
    try {
      await change(control(view.host, 'textarea[aria-label="Barcode data"]'), 'SN-{{serial:6}}');
      const toggle = control<HTMLInputElement>(
        view.host,
        'section[aria-label="Variable data"] input[type="checkbox"]',
      );
      await act(async () => toggle.click());
      expect(view.host.textContent).toContain('Previewing "SN-000041"');
      await act(async () => insertButton(view.host).click());
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ data: 'SN-{{serial:6}}', variableTemplate: expect.anything() }),
        'SN-000041',
      );
    } finally {
      await unmount(view);
    }
  });
});
