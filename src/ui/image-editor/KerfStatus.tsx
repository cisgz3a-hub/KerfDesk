import type { RgbaBuffer } from '../../core/image-edit';
import { applyThicken } from './editor-kerf-check';
import { useKerfCheck } from './use-kerf-check';

/** Render the output-facing dot-width advisory and its optional safe repair. */
export function KerfStatus(props: {
  readonly composite: RgbaBuffer | undefined;
}): JSX.Element | null {
  const check = useKerfCheck(props.composite);
  if (check === null || check.removedPixels === 0) return null;
  const correction = correctionLabel(check.minCorrectionMm, check.maxCorrectionMm);
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <span
        title={`These compiled Image-mode output pixels are in exact-power runs that the current ${correction} dot-width correction would remove`}
      >
        ⚠ {check.removedPixels} output px removed by {correction} dot correction
      </span>
      {check.removedMask === null ? null : (
        <button
          type="button"
          className="lf-btn"
          style={{ padding: '0 8px', fontSize: 11 }}
          onClick={() => applyThicken(check)}
          title="Thicken the reversibly mapped active-layer runs (one undo step)"
        >
          Thicken
        </button>
      )}
    </span>
  );
}

function correctionLabel(minCorrectionMm: number, maxCorrectionMm: number): string {
  return minCorrectionMm === maxCorrectionMm
    ? `${minCorrectionMm} mm`
    : `${minCorrectionMm}–${maxCorrectionMm} mm`;
}
