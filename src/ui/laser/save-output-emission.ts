import { emitPreparedGcode, type EmitGcodeOptions, type PreparedOutput } from '../../io/gcode';

/**
 * Tagged Save emission result. Callers must branch on `kind`; a
 * `preparation-failed` result contains no program and must not be written.
 */
export type SaveOutputEmission =
  | {
      readonly kind: 'preparation-failed';
      readonly gcode: '';
      readonly preflight: Extract<PreparedOutput, { readonly ok: false }>['preflight'];
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
  return { kind: 'emitted', ...emitPreparedGcode(prepared, options) };
}
