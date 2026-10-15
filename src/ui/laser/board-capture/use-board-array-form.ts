import { useMemo, useState } from 'react';
import { transformedBBox, type TileLayout } from '../../../core/scene';
import { planBoardArray } from '../../../core/scene/board-array-plan';
import { useBoardPlacement } from './use-board-placement';

export function useBoardArrayForm() {
  const [autoFit, setAutoFit] = useState(true);
  const [rows, setRows] = useState('3');
  const [cols, setCols] = useState('3');
  const [spacing, setSpacing] = useState('2');
  const [spacingY, setSpacingY] = useState('2');
  const [linkedSpacing, setLinkedSpacing] = useState(true);
  const [margin, setMargin] = useState('0');
  const [circlePacking, setCirclePacking] = useState<'rows' | 'square'>('rows');
  const { arrayBoard, arrayDesign } = useBoardPlacement();
  const isCircle = arrayBoard?.spec.kind === 'ellipse';
  const gap = nonNegative(spacing);
  const gapY = linkedSpacing ? gap : nonNegative(spacingY);
  const marginMm = nonNegative(margin);
  const valid = [gap, gapY, marginMm].every(Number.isFinite);
  const layout = useMemo((): TileLayout => {
    const options = {
      gapXMm: gap,
      gapYMm: gapY,
      ...(marginMm > 0 ? { marginMm } : {}),
      ...(isCircle ? { circlePacking } : {}),
    };
    return autoFit
      ? { kind: 'fill', ...options }
      : { kind: 'grid', rows: countOr(rows), cols: countOr(cols), ...options };
  }, [autoFit, rows, cols, gap, gapY, marginMm, isCircle, circlePacking]);
  const cell = useMemo(
    () => (arrayDesign === undefined ? null : transformedBBox(arrayDesign)),
    [arrayDesign],
  );
  const plan = useMemo(
    () =>
      arrayBoard !== undefined && cell !== null && valid
        ? planBoardArray(cell, arrayBoard, layout)
        : null,
    [arrayBoard, cell, layout, valid],
  );
  return {
    autoFit,
    setAutoFit,
    rows,
    setRows,
    cols,
    setCols,
    spacing,
    setSpacing,
    spacingY,
    setSpacingY,
    linkedSpacing,
    setLinkedSpacing,
    margin,
    setMargin,
    circlePacking,
    setCirclePacking,
    isCircle,
    valid,
    layout,
    cell,
    plan,
  };
}

function nonNegative(raw: string): number {
  const value = Number(raw);
  return raw.trim() !== '' && Number.isFinite(value) && value >= 0 ? value : NaN;
}

function countOr(raw: string): number {
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value >= 1 ? value : 1;
}
