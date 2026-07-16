// A7: prepareProjectForPersistence refuses to write a project whose live
// state fails round-trip validation or would be normalized during save
// (ADR-204 — never silently rewrite machine/output semantics onto the
// canonical on-disk copy). That refusal is correct for the real file, but on
// its own it strands the session: an invalid-in-memory project can be neither
// Saved, Saved-As, nor autosaved, so all unsaved work is lost.
//
// This escape writes the RAW in-memory project to a SEPARATE recovery file —
// always a freshly picked target, never the last save target — so the
// operator keeps their work. The bytes are unvalidated and may need repair to
// reopen, hence the distinct name and the explicit warning; it deliberately
// does NOT mark the project saved or clear the autosave slot, and it never
// touches the canonical file, so ADR-204's guarantee stands.

import type { Project } from '../../core/scene';
import { serializeProject } from '../../io/project';
import type { PlatformAdapter } from '../../platform/types';
import type { ToastVariant } from '../state/toast-store';

const RECOVERY_SUFFIX = '-recovery.lf2';
const DEFAULT_RECOVERY_NAME = `untitled${RECOVERY_SUFFIX}`;

export type SalvageExportCtx = {
  readonly platform: PlatformAdapter;
  readonly project: Project;
  readonly savedName: string | null;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
};

export type SalvageExportOutcome = 'exported' | 'cancelled' | 'error';

export async function handleSalvageExportProject(
  ctx: SalvageExportCtx,
): Promise<SalvageExportOutcome> {
  let raw: string;
  try {
    raw = serializeProject(ctx.project);
  } catch (err) {
    // The project cannot even be serialized — nothing can be recovered to a
    // file. Say so honestly rather than writing empty or partial bytes.
    ctx.pushToast(`Could not export a recovery copy: ${errMsg(err)}`, 'error');
    return 'error';
  }

  let target;
  try {
    target = await ctx.platform.pickFileForSave({
      suggestedName: recoveryName(ctx.savedName),
      extensions: ['.lf2'],
    });
  } catch (err) {
    ctx.pushToast(`Could not export a recovery copy: ${errMsg(err)}`, 'error');
    return 'error';
  }
  if (target === null) return 'cancelled';

  try {
    await target.write(raw);
    ctx.pushToast(
      `Exported a raw recovery copy to ${target.displayName}. It preserves your work but may ` +
        'need repair before it reopens cleanly.',
      'warning',
    );
    return 'exported';
  } catch (err) {
    ctx.pushToast(`Could not export a recovery copy: ${errMsg(err)}`, 'error');
    return 'error';
  }
}

function recoveryName(savedName: string | null): string {
  if (savedName === null || savedName.trim() === '') return DEFAULT_RECOVERY_NAME;
  const base = savedName.replace(/\.lf2$/i, '');
  return `${base}${RECOVERY_SUFFIX}`;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
