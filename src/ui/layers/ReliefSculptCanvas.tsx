import { useEffect, useRef } from 'react';
import type { ReliefHeightfield } from '../../core/scene/relief/relief-heightfield';
import type { ReliefSculptStroke } from '../../core/scene/relief/relief-authoring';
import type { Vec2 } from '../../core/scene/scene-object';
import { createComponentSampler } from '../../core/relief/relief-authoring-sampling';

export function ReliefSculptCanvas(props: {
  readonly field: ReliefHeightfield;
  readonly disabled: boolean;
  readonly onStroke: (points: ReadonlyArray<Vec2>) => void;
  readonly brushMode: ReliefSculptStroke['mode'];
}): JSX.Element {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const points = useRef<Vec2[] | null>(null);
  const pointer = useRef<number | null>(null);
  useEffect(() => drawReliefField(canvas.current, props.field), [props.field]);
  function point(event: React.PointerEvent<HTMLCanvasElement>): Vec2 {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * props.field.physicalWidthMm,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * props.field.physicalHeightMm,
    };
  }
  function cancel(): void {
    points.current = null;
    pointer.current = null;
  }
  return (
    <canvas
      ref={canvas}
      width={256}
      height={256}
      aria-label={`Relief sculpt surface, ${props.brushMode} brush`}
      tabIndex={0}
      style={{
        width: '100%',
        maxWidth: 500,
        aspectRatio: props.field.physicalWidthMm / props.field.physicalHeightMm,
        imageRendering: 'pixelated',
        touchAction: 'none',
        cursor: props.disabled ? 'wait' : 'crosshair',
        border: '1px solid var(--lf-border)',
      }}
      onPointerDown={(event) => {
        if (props.disabled || event.button !== 0) return;
        event.currentTarget.focus();
        points.current = [point(event)];
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (
          points.current === null ||
          pointer.current !== event.pointerId ||
          points.current.length >= 16_384
        )
          return;
        points.current.push(point(event));
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          cancel();
          event.stopPropagation();
        }
      }}
      onPointerUp={(event) => {
        if (points.current === null || pointer.current !== event.pointerId) return;
        const completed = [...points.current, point(event)];
        cancel();
        if (!props.disabled) props.onStroke(completed);
      }}
    />
  );
}

function drawReliefField(element: HTMLCanvasElement | null, field: ReliefHeightfield): void {
  const ctx = element?.getContext('2d');
  if (element === null || ctx === null || ctx === undefined) return;
  const sample = createComponentSampler({ kind: 'retained-field-v1', field: field });
  const image = new ImageData(256, 256);
  for (let y = 0; y < 256; y += 1)
    for (let x = 0; x < 256; x += 1) {
      const value = sample({
        x: ((x + 0.5) * field.physicalWidthMm) / 256,
        y: ((y + 0.5) * field.physicalHeightMm) / 256,
      });
      const i = (y * 256 + x) * 4;
      const tone = value.included
        ? Math.round((value.heightMm / field.mapping.maxDepthMm) * 255)
        : ((x >> 3) + (y >> 3)) % 2 === 0
          ? 35
          : 50;
      image.data[i] = tone;
      image.data[i + 1] = tone;
      image.data[i + 2] = tone;
      image.data[i + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
}
