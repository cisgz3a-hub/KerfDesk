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
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import type { ToastVariant } from '../state/toast-store';

const RECOVERY_SUFFIX = '-recovery.lf2';
const DEFAULT_RECOVERY_NAME = `untitled${RECOVERY_SUFFIX}`;

export type SalvageExportCtx = {
  readonly platform: PlatformAdapter;
  readonly project: Project;
  readonly savedName: string | null;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
  readonly isCurrent?: () => boolean;
  readonly writeTarget?: (target: SaveTarget, contents: string | Blob) => Promise<void>;
  /** Objects past the coordinate limit the copy leaves out (ADR-307 Amendment 5). */
  readonly leftOut?: ReadonlyArray<string>;
};

export type SalvageExportOutcome = 'exported' | 'cancelled' | 'stale' | 'error';

type PreparedRecovery =
  | { readonly kind: 'ready'; readonly raw: string }
  | { readonly kind: 'finished'; readonly outcome: SalvageExportOutcome };

type PickedRecoveryTarget =
  | { readonly kind: 'selected'; readonly target: SaveTarget }
  | { readonly kind: 'finished'; readonly outcome: SalvageExportOutcome };

export async function handleSalvageExportProject(
  ctx: SalvageExportCtx,
  // A large project's copy is a Blob prepared off the canvas thread (J10-P3-3).
  prebuilt?: {
    readonly project: Project;
    readonly raw: string | Blob;
    readonly target: SaveTarget;
  },
): Promise<SalvageExportOutcome> {
  if (prebuilt !== undefined) {
    if (prebuilt.project !== ctx.project)
      return recoveryError(
        ctx,
        new Error('The prepared recovery copy belongs to another project.'),
      );
    return writeRecoveryTarget(ctx, prebuilt.target, prebuilt.raw);
  }
  const prepared = prepareRecovery(ctx);
  if (prepared.kind === 'finished') return prepared.outcome;
  const picked = await pickRecoveryTarget(ctx);
  if (picked.kind === 'finished') return picked.outcome;
  return writeRecoveryTarget(ctx, picked.target, prepared.raw);
}

function prepareRecovery(ctx: SalvageExportCtx): PreparedRecovery {
  try {
    // Compact like Save (ADR-204 Amendment 2); only small projects come here.
    return { kind: 'ready', raw: serializeProject(ctx.project, { compact: true }) };
  } catch (err) {
    // The project cannot even be serialized — nothing can be recovered to a
    // file. Say so honestly rather than writing empty or partial bytes.
    return { kind: 'finished', outcome: recoveryError(ctx, err) };
  }
}

async function pickRecoveryTarget(ctx: SalvageExportCtx): Promise<PickedRecoveryTarget> {
  try {
    const target = await ctx.platform.pickFileForSave({
      suggestedName: recoveryName(ctx.savedName),
      extensions: ['.lf2'],
    });
    if (target !== null) return { kind: 'selected', target };
    return {
      kind: 'finished',
      outcome: ctx.isCurrent?.() === false ? 'stale' : 'cancelled',
    };
  } catch (err) {
    return { kind: 'finished', outcome: recoveryError(ctx, err) };
  }
}

async function writeRecoveryTarget(
  ctx: SalvageExportCtx,
  target: SaveTarget,
  raw: string | Blob,
): Promise<SalvageExportOutcome> {
  try {
    await (ctx.writeTarget === undefined ? target.write(raw) : ctx.writeTarget(target, raw));
    if (ctx.isCurrent?.() === false) return 'stale';
    ctx.pushToast(exportedMessage(ctx, target), 'warning');
    return 'exported';
  } catch (err) {
    return recoveryError(ctx, err);
  }
}

function exportedMessage(ctx: SalvageExportCtx, target: SaveTarget): string {
  const leftOut = ctx.leftOut ?? [];
  if (leftOut.length > 0) {
    return (
      `Exported a recovery copy to ${target.displayName} without ` +
      `${recoveryLeftOutText(leftOut)}, which a project file cannot hold. ` +
      'It opens as a normal project.'
    );
  }
  return (
    `Exported a raw recovery copy to ${target.displayName}. It preserves your work but may ` +
    'need repair before it reopens cleanly.'
  );
}

function recoveryError(ctx: SalvageExportCtx, err: unknown): SalvageExportOutcome {
  if (ctx.isCurrent?.() === false) return 'stale';
  ctx.pushToast(`Could not export a recovery copy: ${errMsg(err)}`, 'error');
  return 'error';
}

/** Names the left-out objects, at most three by label. */
export function recoveryLeftOutText(leftOut: ReadonlyArray<string>): string {
  return leftOut.length <= 3
    ? leftOut.join(', ')
    : `${leftOut.slice(0, 3).join(', ')} and ${leftOut.length - 3} more`;
}

export function recoveryName(savedName: string | null): string {
  if (savedName === null || savedName.trim() === '') return DEFAULT_RECOVERY_NAME;
  const base = savedName.replace(/\.lf2$/i, '');
  return `${base}${RECOVERY_SUFFIX}`;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
