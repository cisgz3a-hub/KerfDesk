// BedPictureOverlay — a head camera's stitched picture of the bed (ADR-449)
// on the workspace canvas. The picture is already top-down in bed
// millimetres, so it is drawn with the canvas's own fit-to-bed view (zoom and
// pan included), with no camera model in between.

import { useEffect, useMemo, useState } from 'react';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import { useStore } from '../../state';
import { useCameraStore, type BedPicture } from '../../state/camera-store';
import { useUiStore } from '../../state/ui-store';
import { computeView } from '../../workspace/view-transform';
import { useElementSize } from '../use-element-size';

export function BedPictureOverlay(props: { readonly picture: BedPicture }): JSX.Element {
  const { picture } = props;
  const bedWidthMm = useStore((s) => s.project.device.bedWidth);
  const bedHeightMm = useStore((s) => s.project.device.bedHeight);
  const opacityPercent = useCameraStore((s) => s.overlayOpacityPercent);
  const zoomFactor = useUiStore((s) => s.zoomFactor);
  const panX = useUiStore((s) => s.panX);
  const panY = useUiStore((s) => s.panY);
  const [box, boxRef] = useElementSize();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const source = useMemo(() => pictureCanvas(picture.image), [picture.image]);

  useEffect(() => {
    if (canvas === null || box === null || source === null) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);
    const context = canvas.getContext('2d');
    if (context === null) return;
    const view = computeView(box.width, box.height, bedWidthMm, bedHeightMm, {
      zoomFactor,
      panX,
      panY,
    });
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(
      ratio * view.scale,
      0,
      0,
      ratio * view.scale,
      ratio * view.offsetX,
      ratio * view.offsetY,
    );
    context.globalAlpha = opacityPercent / 100;
    context.imageSmoothingEnabled = true;
    const { region } = picture;
    context.drawImage(source, region.x, region.y, region.width, region.height);
  }, [
    canvas,
    box,
    source,
    picture,
    bedWidthMm,
    bedHeightMm,
    opacityPercent,
    zoomFactor,
    panX,
    panY,
  ]);

  return (
    <div ref={boxRef} style={boxStyle} aria-hidden>
      <canvas ref={setCanvas} style={canvasStyle} />
    </div>
  );
}

function pictureCanvas(image: RgbaImage): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  context.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  return canvas;
}

// Same place as the corrected camera overlay: over the canvas, under the
// floating panels, letting every pointer event through.
const boxStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
  zIndex: 1,
};
const canvasStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
};
