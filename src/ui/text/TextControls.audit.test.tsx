import { act, useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { FONT_REGISTRY } from '../../core/text';
import {
  clickControl,
  clickElement,
  control,
  mountControl,
} from '../image-editor/control-audit-test-support';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { FontPicker } from './FontPicker';
import { FontImportButton } from './FontImportButton';
import { CanvasTextSymbols } from './CanvasTextSymbols';
import { TextFormattingFields } from './TextFormattingFields';
import { CanvasTextPanel } from './CanvasTextPanel';
import { AddTextDialog } from './AddTextDialog';
import { useTextDialogFields, type DialogFields } from './use-text-dialog-fields';
import { useCanvasTextVariables } from './use-canvas-text-variables';

vi.mock('./font-loader', () => ({
  cssFamilyForFont: (key: string) => `lf2-${key}`,
  ensureFontCss: async () => undefined,
  loadFont: async () => new ArrayBuffer(0),
}));
beforeEach(() => {
  resetStore();
  useUiStore.setState({ textDialog: null });
});

it.each(FONT_REGISTRY)('font picker chooses $displayName and closes', async (font) => {
  const change = vi.fn();
  const host = await mountControl(<FontPicker value="roboto-regular" onChange={change} />);
  await clickControl(host, 'Open the font picker and choose the text typeface.');
  await clickControl(host, `Use ${font.displayName} for this text object.`);
  expect(change).toHaveBeenCalledExactlyOnceWith(font.key);
  expect(host.querySelector('[role="listbox"]')).toBeNull();
});

it('font picker chooses an embedded font and closes', async () => {
  const change = vi.fn();
  const host = await mountControl(
    <FontPicker
      value="roboto-regular"
      onChange={change}
      embeddedFonts={[{ key: 'embedded-audit', fileName: 'Audit.ttf', dataBase64: '' }]}
    />,
  );
  await clickControl(host, 'Open the font picker and choose the text typeface.');
  await clickControl(host, 'Use embedded font Audit.ttf.');
  expect(change).toHaveBeenLastCalledWith('embedded-audit');
  expect(host.querySelector('[role="listbox"]')).toBeNull();
});

it('the same font picker reopens between built-in and embedded selections', async () => {
  const change = vi.fn();
  const first = FONT_REGISTRY[0]!;
  const second = FONT_REGISTRY[1]!;
  function Harness() {
    const [value, setValue] = useState('roboto-regular');
    return (
      <FontPicker
        value={value}
        onChange={(key) => {
          change(key);
          setValue(key);
        }}
        embeddedFonts={[{ key: 'embedded-audit', fileName: 'Audit.ttf', dataBase64: '' }]}
      />
    );
  }
  const host = await mountControl(<Harness />);
  const selections = [
    [`Use ${first.displayName} for this text object.`, first.key],
    ['Use embedded font Audit.ttf.', 'embedded-audit'],
    [`Use ${second.displayName} for this text object.`, second.key],
  ] as const;
  for (const [index, [title, key]] of selections.entries()) {
    await clickControl(host, 'Open the font picker and choose the text typeface.');
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();
    await clickControl(host, title);
    expect(change).toHaveBeenCalledTimes(index + 1);
    expect(change).toHaveBeenNthCalledWith(index + 1, key);
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  }
});

it('font Import opens the native picker boundary and sends the selected file to the import callback', async () => {
  const imported = vi.fn(async () => undefined);
  const host = await mountControl(<FontImportButton importFont={imported} />);
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  const open = vi.spyOn(input, 'click').mockImplementation(() => undefined);
  await clickControl(host, 'Import');
  expect(open).toHaveBeenCalledTimes(1);
  const file = new File(['audit'], 'audit.ttf');
  Object.defineProperty(input, 'files', { value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(imported).toHaveBeenCalledWith(file);
});

it('symbol disclosure expands and each accent button inserts its own character', async () => {
  const insert = vi.fn();
  const host = await mountControl(<CanvasTextSymbols onInsert={insert} />);
  await clickElement(host.querySelector('summary'));
  expect(host.querySelector('details')?.open).toBe(true);
  for (const char of ['é', 'è', 'ê', 'ë', 'á', 'à', 'â', 'ä', 'í', 'ó', 'ú', 'ñ', 'ç', 'ü', '´']) {
    await clickControl(host, `Insert ${char}`);
    expect(insert).toHaveBeenLastCalledWith(char);
  }
});

it('formatting radio, weld, path enable/reverse and variable toggles update the actual text draft', async () => {
  const project = useStore.getState().project;
  const guide = svgObj('audit-guide', ['#000000']);
  let latest: DialogFields;
  function Harness() {
    const fields = useTextDialogFields(
      { mode: 'add' },
      { ...project, scene: { ...project.scene, objects: [guide] } },
      guide.id,
    );
    latest = fields;
    return <TextFormattingFields fields={fields} />;
  }
  const host = await mountControl(<Harness />);
  for (const alignment of ['center', 'right', 'left']) {
    await clickElement(
      host.querySelector<HTMLInputElement>(`input[title="Align text ${alignment}."]`),
    );
    expect(latest!.values.alignment).toBe(alignment);
  }
  const previousWeld = latest!.values.weldOverlaps ?? false;
  await clickElement(
    host.querySelector<HTMLInputElement>('[aria-label="Weld overlapping letters"]'),
  );
  expect(latest!.values, 'weld checkbox updates draft').toMatchObject({
    weldOverlaps: !previousWeld,
  });
  await clickElement(
    host.querySelector<HTMLInputElement>('[title="Place text along a selected vector path."]'),
  );
  expect(latest!, 'path checkbox enables draft guide').toMatchObject({ pathEnabled: true });
  await clickElement(
    host.querySelector<HTMLInputElement>('[title="Place text along a selected vector path."]'),
  );
  expect(latest!, 'path checkbox disables draft guide').toMatchObject({ pathEnabled: false });
  await clickElement(
    host.querySelector<HTMLInputElement>('[title="Place text along a selected vector path."]'),
  );
  await clickElement(
    host.querySelector<HTMLInputElement>('[title="Reverse text direction along the guide."]'),
  );
  expect(latest!.values.pathText, 'reverse changes enabled path').toMatchObject({ reverse: true });
  await clickElement(
    host.querySelector<HTMLInputElement>(
      '[title="Evaluate typed fields when previewing, framing, exporting, or starting this job."]',
    ),
  );
  expect(latest!.variableEnabled).toBe(true);
  const single = FONT_REGISTRY.find((font) => font.geometry === 'single-line')!;
  await clickControl(host, 'Open the font picker and choose the text typeface.');
  await clickControl(host, `Use ${single.displayName} for this text object.`);
  expect(
    host.querySelector<HTMLInputElement>('[aria-label="Weld overlapping letters"]')?.disabled,
  ).toBe(true);
});

it('canvas text Done and Cancel invoke separate owners and variable field inserts retain exact template tokens', async () => {
  const project = useStore.getState().project;
  const save = vi.fn(async () => undefined);
  const cancel = vi.fn();
  const insert = vi.fn();
  let latest: DialogFields;
  function Harness() {
    const fields = useTextDialogFields({ mode: 'add' }, project, null);
    latest = fields;
    const variables = useCanvasTextVariables(project);
    return (
      <CanvasTextPanel
        fields={fields}
        variables={variables}
        insert={insert}
        actions={{ saving: false, error: null, save, cancel, clearError: () => undefined }}
        pending={false}
        error={null}
        companion={false}
        inputStyle={{}}
        canvasSize={{ width: 800, height: 600 }}
      />
    );
  }
  const host = await mountControl(<Harness />);
  expect(
    host.querySelector<HTMLInputElement>('[title="Place text along a selected vector path."]')
      ?.disabled,
  ).toBe(true);
  await clickElement(
    host.querySelector<HTMLInputElement>(
      '[title="Evaluate typed fields when previewing, framing, exporting, or starting this job."]',
    ),
  );
  expect(latest!.variableEnabled).toBe(true);
  for (const [label, token] of [
    ['Date', '{{date}}'],
    ['Time', '{{time}}'],
    ['Serial', '{{serial:4}}'],
    ['Power', '{{power}}'],
    ['Speed', '{{speed}}'],
    ['Passes', '{{passes}}'],
  ]) {
    await clickControl(host, label!);
    expect(insert).toHaveBeenLastCalledWith(token);
  }
  await clickControl(host, 'Done');
  expect(save).toHaveBeenCalledTimes(1);
  expect(cancel).not.toHaveBeenCalled();
  await clickControl(host, 'Cancel');
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(useStore.getState().project).toBe(project);
  expect(control(host, 'Done').disabled).toBe(false);
});

it('Add Text Cancel closes without editing the project', async () => {
  useUiStore.setState({ textDialog: { mode: 'add' } });
  const project = useStore.getState().project;
  const host = await mountControl(<AddTextDialog />);
  await clickControl(host, 'Cancel');
  expect(useUiStore.getState().textDialog).toBeNull();
  expect(useStore.getState().project).toBe(project);
});
