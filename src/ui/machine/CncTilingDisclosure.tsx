import type { CSSProperties } from 'react';
import { effectiveCncTiling } from '../../core/cnc/tiling';
import type { CncTiling } from '../../core/scene';
import { formatDisplayMillimetres } from '../format-display-millimetres';

const DISCLOSURE_FONT_SIZE_PX = 11;
const DISCLOSURE_LINE_HEIGHT = 1.35;
const DISCLOSURE_MARGIN = '4px 0 2px';

/** Format effective CNC tiled-export geometry without mutating persisted settings. */
export function cncTilingDisclosure(tiling: CncTiling): {
  readonly isAdjusted: boolean;
  readonly message: string;
} {
  const effective = effectiveCncTiling(tiling);
  const isAdjusted = effective.overlapMm !== tiling.overlapMm;
  const step =
    `tile step X ${formatDisplayMillimetres(effective.stepXMm)} mm / Y ` +
    `${formatDisplayMillimetres(effective.stepYMm)} mm`;
  return isAdjusted
    ? {
        isAdjusted,
        message:
          `Requested overlap ${formatDisplayMillimetres(tiling.overlapMm)} mm · effective ` +
          `overlap ${formatDisplayMillimetres(effective.overlapMm)} mm · ${step}. Export uses ` +
          'the effective overlap; ' +
          'the saved request is unchanged.',
      }
    : {
        isAdjusted,
        message: `Overlap ${formatDisplayMillimetres(effective.overlapMm)} mm · ${step}.`,
      };
}

/** Persist effective overlap after numeric edits while leaving other legacy changes untouched. */
export function cncTilingAfterEdit(current: CncTiling, patch: Partial<CncTiling>): CncTiling {
  const next = { ...current, ...patch };
  const hasNumericEdit =
    patch.tileWidthMm !== undefined ||
    patch.tileHeightMm !== undefined ||
    patch.overlapMm !== undefined;
  return hasNumericEdit ? { ...next, overlapMm: effectiveCncTiling(next).overlapMm } : next;
}

/** Show the requested and effective CNC tiled-export geometry. */
export function CncTilingDisclosure(props: { readonly tiling: CncTiling }): JSX.Element {
  const disclosure = cncTilingDisclosure(props.tiling);
  return (
    <p aria-live="polite" style={disclosure.isAdjusted ? adjustedDisclosureStyle : disclosureStyle}>
      {disclosure.message}
    </p>
  );
}

const disclosureStyle: CSSProperties = {
  color: 'var(--lf-text-faint)',
  fontSize: DISCLOSURE_FONT_SIZE_PX,
  lineHeight: DISCLOSURE_LINE_HEIGHT,
  margin: DISCLOSURE_MARGIN,
};
const adjustedDisclosureStyle: CSSProperties = {
  ...disclosureStyle,
  color: 'var(--lf-warning-fg)',
};
