import type { PlatformAdapter } from '../../platform/types';
import type { MachineDiagnosticBundle } from '../state/machine-diagnostic-bundle';

export type ExportMachineDiagnosticBundleResult =
  | { readonly ok: true; readonly displayName: string }
  | {
      readonly ok: false;
      readonly reason: 'cancelled' | 'write-failed';
      readonly message: string;
    };

export type ExportMachineDiagnosticBundleOptions = {
  readonly platform: PlatformAdapter;
  readonly bundle: MachineDiagnosticBundle;
};

export async function exportMachineDiagnosticBundle(
  options: ExportMachineDiagnosticBundleOptions,
): Promise<ExportMachineDiagnosticBundleResult> {
  const target = await options.platform.pickFileForSave({
    suggestedName: suggestedDiagnosticName(options.bundle.createdAt),
    extensions: ['.lf-machine-diagnostic.json'],
  });
  if (target === null) {
    return {
      ok: false,
      reason: 'cancelled',
      message: 'Machine diagnostic export cancelled.',
    };
  }

  try {
    await target.write(`${JSON.stringify(options.bundle, null, 2)}\n`);
    return { ok: true, displayName: target.displayName };
  } catch (err) {
    return {
      ok: false,
      reason: 'write-failed',
      message: `Could not export machine diagnostic: ${errMsg(err)}`,
    };
  }
}

function suggestedDiagnosticName(createdAt: string): string {
  const date = createdAt.slice(0, 10);
  return `laserforge-machine-diagnostic-${date}.lf-machine-diagnostic.json`;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
