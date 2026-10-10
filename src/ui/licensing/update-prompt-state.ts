import type { CommercialUpdateStatus } from '../../platform/types';
import type { CommercialUpdateControls } from '../state/commercial-update-store';

/** What the canvas update prompt shows (ADR-561 Amendment 5). */
export type UpdatePromptView =
  | { readonly kind: 'hidden' }
  | {
      readonly kind: 'offer';
      readonly key: string;
      readonly version: string;
      readonly notes: readonly string[];
    }
  | { readonly kind: 'downloading'; readonly key: string; readonly version: string }
  | {
      readonly kind: 'ready';
      readonly key: string;
      readonly version: string;
      readonly manual: boolean;
      readonly armed: boolean;
    }
  | { readonly kind: 'failed'; readonly key: string };

export type UpdatePromptInput = {
  readonly status: CommercialUpdateStatus | null;
  readonly controls: CommercialUpdateControls | null;
  /** Machine work or a modal dialog owns the window; the prompt waits. */
  readonly blocked: boolean;
  /** Prompt keys the user cleared this session. */
  readonly dismissed: ReadonlySet<string>;
  /** The user acted in the prompt, so it follows the download and any failure. */
  readonly engaged: boolean;
};

const HIDDEN: UpdatePromptView = { kind: 'hidden' };
const MAX_NOTES = 3;
const MAX_NOTE_LENGTH = 160;

export function updatePromptView(input: UpdatePromptInput): UpdatePromptView {
  const { status, controls } = input;
  if (status === null || controls === null || controls.panelOpen || input.blocked) return HIDDEN;
  const view = viewFor(status, controls, input.engaged);
  return view.kind !== 'hidden' && input.dismissed.has(view.key) ? HIDDEN : view;
}

function viewFor(
  status: CommercialUpdateStatus,
  controls: CommercialUpdateControls,
  engaged: boolean,
): UpdatePromptView {
  if (status.state === 'failed') return engaged ? { kind: 'failed', key: 'failed' } : HIDDEN;
  const version = status.version;
  if (version === null) return HIDDEN;
  // Only a manual package can be fetched from the app; others download themselves.
  if (status.state === 'available')
    return status.mode === 'manual' && controls.download !== undefined
      ? { kind: 'offer', key: `offer:${version}`, version, notes: releaseNotes(status) }
      : HIDDEN;
  if (status.state === 'downloading')
    return engaged ? { kind: 'downloading', key: `downloading:${version}`, version } : HIDDEN;
  if (status.state !== 'ready') return HIDDEN;
  return {
    kind: 'ready',
    key: `ready:${version}`,
    version,
    manual: status.mode === 'manual',
    armed: status.installOnQuit === true,
  };
}

function releaseNotes(status: CommercialUpdateStatus): readonly string[] {
  if (status.releaseNotesState !== 'available') return [];
  return (status.releaseNotes ?? [])
    .slice(0, MAX_NOTES)
    .map((note) => Array.from(note).slice(0, MAX_NOTE_LENGTH).join(''));
}
