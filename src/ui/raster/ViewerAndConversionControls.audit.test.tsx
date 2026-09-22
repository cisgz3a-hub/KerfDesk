import { expect, it, vi } from 'vitest';
import { createLayer, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { clickControl, control, mountControl } from '../image-editor/control-audit-test-support';
import { Viewer3DToolbar } from '../cnc-viewer3d/Viewer3DToolbar';
import { Viewer3DDialogShell } from '../relief-viewer/Viewer3DDialogShell';
import { ConvertToBitmapDialog } from './ConvertToBitmapDialog';
import { AdjustImageDialog } from './AdjustImageDialog';

it('every CNC display mode selects its semantic mode and PNG requests export', async () => {
  const select = vi.fn();
  const save = vi.fn();
  const host = await mountControl(
    <Viewer3DToolbar
      mode={{ kind: 'shaded' }}
      onModeChange={select}
      sectionFraction={1}
      onSectionChange={() => undefined}
      onSavePng={save}
    />,
  );
  for (const [label, kind] of [
    ['Result', 'shaded'],
    ['Result + path', 'shaded-toolpath'],
    ['Path', 'toolpath'],
    ['X-ray', 'xray'],
  ]) {
    await clickControl(host, label!);
    expect(select).toHaveBeenLastCalledWith({ kind });
  }
  await clickControl(host, 'Save PNG');
  expect(save).toHaveBeenCalledTimes(1);
});

it('keeps Close working while the 3D viewer is still building', async () => {
  const close = vi.fn();
  const host = await mountControl(
    <Viewer3DDialogShell
      ariaLabel="Audit viewer"
      canvasAriaLabel="Audit surface"
      title="Audit"
      buildScene={null}
      onClose={close}
    />,
  );
  await clickControl(host, 'Close');
  expect(close).toHaveBeenCalledTimes(1);
});

it('bitmap Cancel remains usable while busy and does not invoke conversion', async () => {
  const cancel = vi.fn();
  const convert = vi.fn();
  const host = await mountControl(
    <ConvertToBitmapDialog
      sourceName="audit"
      target={{ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, transform: IDENTITY_TRANSFORM }}
      busy
      onCancel={cancel}
      onConvert={convert}
    />,
  );
  expect(control(host, 'Converting…').disabled).toBe(true);
  await clickControl(host, 'Cancel');
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(convert).not.toHaveBeenCalled();
});

it('Adjust Image native OK submits the actual dialog form exactly once', async () => {
  const onApply = vi.fn();
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'audit',
    source: 'audit.png',
    dataUrl: 'data:image/png;base64,audit',
    pixelWidth: 2,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
    lumaBase64: 'AP8=',
    brightness: 25,
    contrast: 0,
    gamma: 1,
  };
  const layer = createLayer({ id: '#808080', color: '#808080', mode: 'image' });
  const host = await mountControl(
    <AdjustImageDialog image={image} layer={layer} onCancel={vi.fn()} onApply={onApply} />,
  );
  await clickControl(host, 'OK');
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(onApply).toHaveBeenCalledWith(
    expect.objectContaining({ imagePatch: { brightness: 25, contrast: 0, gamma: 1 } }),
  );
});
