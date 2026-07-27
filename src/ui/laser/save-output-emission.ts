import { emitPreparedGcode, type EmitGcodeOptions, type PreparedOutput } from '../../io/gcode';

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
