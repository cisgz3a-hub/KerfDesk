import type { CSSProperties } from 'react';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  type TextObject,
  type Transform,
} from '../../core/scene';
import { findFontEntry } from '../../core/text';
import type { ViewTransform } from '../workspace/view-transform';
import type { CanvasTextSession } from './canvas-text-store';
import { cssFamilyForFont } from './font-loader';
import type { DialogValues } from './use-text-dialog-fields';

export function canvasTextInputStyle(
  session: CanvasTextSession,
  values: DialogValues,
  object: TextObject | null,
  view: ViewTransform,
): { readonly style: CSSProperties; readonly companion: boolean } {
  const font = findFontEntry(values.fontKey);
  const companion =
    values.pathText !== undefined || values.bendDeg !== 0 || font?.geometry === 'single-line';
  const transform = object?.transform ??
    session.original?.transform ?? {
      ...IDENTITY_TRANSFORM,
      ...session.position,
    };
  const family = font?.geometry === 'single-line' ? 'monospace' : cssFamilyForFont(values.fontKey);
  if (companion)
    return { companion, style: companionInputStyle(values, object, transform, view, family) };
  return { companion, style: straightInputStyle(values, object, transform, view, family) };
}

function straightInputStyle(
  values: DialogValues,
  object: TextObject | null,
  transform: Transform,
  view: ViewTransform,
  family: string,
): CSSProperties {
  const metrics = inputMetrics(values, family);
  const origin = applyTransform({ x: metrics.x, y: metrics.y }, transform);
  const radians = (transform.rotationDeg * Math.PI) / 180;
  const sx = transform.scaleX * (transform.mirrorX ? -1 : 1) * view.scale;
  const sy = transform.scaleY * (transform.mirrorY ? -1 : 1) * view.scale;
  return {
    left: view.offsetX + origin.x * view.scale,
    top: view.offsetY + origin.y * view.scale,
    transform: `matrix(${Math.cos(radians) * sx},${Math.sin(radians) * sx},${-Math.sin(radians) * sy},${Math.cos(radians) * sy},0,0)`,
    width: metrics.width,
    height: metrics.height,
    fontSize: values.sizeMm,
    lineHeight: values.lineHeight,
    letterSpacing: `${values.letterSpacing * values.sizeMm}px`,
    textAlign: values.alignment,
    fontFamily: `"${family}", sans-serif`,
    color: object === null ? values.color : 'transparent',
  };
}

function companionInputStyle(
  values: DialogValues,
  object: TextObject | null,
  transform: Transform,
  view: ViewTransform,
  family: string,
): CSSProperties {
  const bottom = applyTransform({ x: 0, y: object?.bounds.maxY ?? values.sizeMm }, transform);
  return {
    left: view.offsetX + bottom.x * view.scale,
    top: view.offsetY + bottom.y * view.scale + 20,
    width: Math.max(180, Math.min(480, values.content.length * 9 + 24)),
    height: Math.max(48, (values.content.split('\n').length + 1) * 22),
    fontSize: 16,
    lineHeight: 1.4,
    fontFamily: `"${family}", sans-serif`,
    color: 'var(--lf-text)',
    background: 'var(--lf-bg-1)',
    padding: 8,
  };
}

function inputMetrics(values: DialogValues, family: string) {
  const size = values.sizeMm;
  const lineHeight = size * values.lineHeight;
  const lines = values.content.split('\n');
  const ctx = document.createElement('canvas').getContext('2d');
  if (ctx !== null) ctx.font = `${size}px "${family}"`;
  const measured = lines.map((line) => ctx?.measureText(line));
  const widths = lines.map(
    (line, index) =>
      (measured[index]?.width ?? line.length * size * 0.6) +
      Math.max(0, Array.from(line).length - 1) * values.letterSpacing * size,
  );
  const maxWidth = Math.max(size * 0.5, ...widths);
  const padding = size * 0.3;
  const width = maxWidth + padding;
  const factor = values.alignment === 'left' ? 0 : values.alignment === 'center' ? 0.5 : 1;
  const ink = measured
    .map((metrics, index) => ({ metrics, index }))
    .filter(({ index }) => (lines[index] ?? '').trim() !== '');
  const minX =
    ink.length === 0
      ? 0
      : Math.min(
          ...ink.map(
            ({ metrics: m, index: i }) =>
              (maxWidth - (widths[i] ?? 0)) * factor - (m?.actualBoundingBoxLeft ?? 0),
          ),
        );
  const minY =
    ink.length === 0
      ? -size * 0.75
      : Math.min(
          ...ink.map(
            ({ metrics: m, index: i }) =>
              i * lineHeight - (m?.actualBoundingBoxAscent ?? size * 0.75),
          ),
        );
  const sample = ctx?.measureText('Mg');
  const ascent = sample?.fontBoundingBoxAscent ?? size * 0.93;
  const descent = sample?.fontBoundingBoxDescent ?? size * 0.24;
  const baseline = (lineHeight - ascent - descent) / 2 + ascent;
  return {
    x: -minX - padding * factor,
    y: -minY - baseline,
    width: values.content === '' ? Math.max(size * 6, width) : width,
    height: Math.max(lineHeight, lines.length * lineHeight + size * 0.3),
  };
}
