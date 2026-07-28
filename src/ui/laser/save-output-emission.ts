import { emitPreparedGcode, type EmitGcodeOptions, type PreparedOutput } from '../../io/gcode';

const ROTARY_RASTER_REFUSAL_CODE = 'rotary-raster-unsupported';

/**
 * Tagged Save emission result. Callers must branch on `kind`;
 * `preparation-failed` means no prepared program exists, while
 * `emission-refused` means preparation succeeded but the emitter produced no
 * writable bytes.
 */
export type SaveOutputEmission =
  | {
      readonly kind: 'preparation-failed';
      readonly gcode: '';
      readonly preflight: Extract<PreparedOutput, { readonly ok: false }>['preflight'];
    }
  | {
      readonly kind: 'emission-refused';
      readonly gcode: '';
      readonly preflight: ReturnType<typeof emitPreparedGcode>['preflight'];
    }
  | {
      readonly kind: 'emitted';
      readonly gcode: string;
      readonly preflight: ReturnType<typeof emitPreparedGcode>['preflight'];
    };

/**
 * Emits a successfully prepared output while retaining failed preparation as
 * a distinct, non-writable result.
 */
export function emitSavePreparedOutput(
  prepared: PreparedOutput,
  options: EmitGcodeOptions,
): SaveOutputEmission {
  if (!prepared.ok) {
    return {
      kind: 'preparation-failed',
      gcode: '',
      preflight: prepared.preflight,
    };
  }
  const emitted = emitPreparedGcode(prepared, options);
  const isRotaryRasterRefusal =
    emitted.gcode === '' &&
    emitted.preflight.issues.some((issue) => issue.code === ROTARY_RASTER_REFUSAL_CODE);
  if (isRotaryRasterRefusal) {
    return { kind: 'emission-refused', ...emitted, gcode: '' };
  }
  return { kind: 'emitted', ...emitted };
}
