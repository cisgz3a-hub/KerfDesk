import { useState } from 'react';
import type { DeviceProfile } from '../../core/devices';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  deserializeMachineProfileDocument,
  serializeMachineProfileDocument,
  type MachineProfileDocument,
} from '../../io/machine-profile';
import { importLightBurnDeviceProfile, type LightBurnDeviceImportReview } from '../../io/lightburn';
import { usePlatform } from '../app/platform-context';
import { Button } from '../kit';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { ReplaceSettingsConfirm } from './device-setup/ReplaceSettingsConfirm';
import {
  buttonRowStyle,
  cardStyle,
  errorStyle,
  mutedStyle,
  notesStyle,
  sectionHeadingStyle,
  smallHeadingStyle,
  stackStyle,
} from './MachineSetupStyles';

type ImportReview =
  | { readonly kind: 'machine'; readonly document: MachineProfileDocument }
  | { readonly kind: 'lightburn'; readonly review: LightBurnDeviceImportReview }
  | { readonly kind: 'error'; readonly message: string };

type ImportExportPanelProps = {
  readonly profile?: DeviceProfile;
  readonly onApply?: (profile: DeviceProfile) => void;
  /** The draft's own settings applying `profile` would replace; when any,
   *  Apply asks first, as a list choice does (ADR-637 Amendment 3). */
  readonly replaces?: (profile: DeviceProfile) => ReadonlyArray<string>;
};

export function ImportExportPanel(props: ImportExportPanelProps = {}): JSX.Element {
  const platform = usePlatform();
  const activeDevice = useStore((s) => s.project.device);
  const device = props.profile ?? activeDevice;
  const pushToast = useToastStore((s) => s.pushToast);
  const { review, showReview, askOrApply, replaceQuestion } = useImportReview(props);

  const exportActive = (): void => {
    void platform
      .pickFileForSave({
        suggestedName: `${slugify(device.name)}.lfmachine.json`,
        extensions: ['.lfmachine.json'],
      })
      .then(async (target) => {
        if (target === null) return;
        await target.write(serializeMachineProfileDocument(activeProfileDocument(device)));
        pushToast('Machine profile exported.', 'success');
      })
      .catch((error: unknown) => pushToast(errorMessage(error), 'error'));
  };

  const importKerfDesk = (): void => {
    void platform
      .pickFilesForOpen({ accept: ['.lfmachine.json'], multiple: false })
      .then(async ([file]) => {
        if (file === undefined) return;
        const result = deserializeMachineProfileDocument(await file.text());
        if (result.kind === 'ok') showReview({ kind: 'machine', document: result.document });
        else showReview({ kind: 'error', message: importError(result) });
      })
      .catch((error: unknown) => showReview({ kind: 'error', message: errorMessage(error) }));
  };

  const importLightBurn = (): void => {
    void platform
      .pickFilesForOpen({ accept: ['.lbdev', '.lbzip'], multiple: false })
      .then(async ([file]) => {
        if (file === undefined) return;
        const result = importLightBurnDeviceProfile(await file.text(), { fileName: file.name });
        if (result.kind === 'review') showReview({ kind: 'lightburn', review: result });
        else showReview({ kind: 'error', message: result.reason });
      })
      .catch((error: unknown) => showReview({ kind: 'error', message: errorMessage(error) }));
  };

  return (
    <div style={stackStyle}>
      <div style={buttonRowStyle}>
        <Button onClick={exportActive}>Export active profile</Button>
        <Button onClick={importKerfDesk}>Import KerfDesk profile</Button>
        <Button onClick={importLightBurn}>Import LightBurn .lbdev</Button>
      </div>
      {review === null ? null : <ImportReviewCard review={review} onApply={askOrApply} />}
      {replaceQuestion}
    </div>
  );
}

// The review card's Apply, and the question it asks before replacing tuned
// values. A new file read closes both.
function useImportReview(props: ImportExportPanelProps): {
  readonly review: ImportReview | null;
  readonly showReview: (next: ImportReview) => void;
  readonly askOrApply: (profile: DeviceProfile) => void;
  readonly replaceQuestion: JSX.Element | null;
} {
  const replaceDeviceProfile = useStore((s) => s.replaceDeviceProfile);
  const pushToast = useToastStore((s) => s.pushToast);
  const [review, setReview] = useState<ImportReview | null>(null);
  const [pending, setPending] = useState<{
    readonly profile: DeviceProfile;
    readonly replaces: ReadonlyArray<string>;
  } | null>(null);
  const apply = (profile: DeviceProfile): void => {
    if (props.onApply === undefined) replaceDeviceProfile(profile);
    else props.onApply(profile);
    setPending(null);
    setReview(null);
    pushToast('Machine profile applied.', 'success');
  };
  return {
    review,
    showReview: (next) => {
      setPending(null);
      setReview(next);
    },
    askOrApply: (profile) => {
      const replaces = props.replaces?.(profile) ?? [];
      if (replaces.length > 0) setPending({ profile, replaces });
      else apply(profile);
    },
    replaceQuestion:
      pending === null ? null : (
        <ReplaceSettingsConfirm
          subject={`Importing ${pending.profile.name}`}
          replaces={pending.replaces}
          onReplace={() => apply(pending.profile)}
          onKeep={() => setPending(null)}
        />
      ),
  };
}

function ImportReviewCard(props: {
  readonly review: ImportReview;
  readonly onApply: (profile: DeviceProfile) => void;
}): JSX.Element {
  const review = props.review;
  if (review.kind === 'error')
    return (
      <p role="alert" style={errorStyle}>
        {review.message}
      </p>
    );
  if (review.kind === 'machine') {
    return <MachineProfileReview review={review} onApply={props.onApply} />;
  }
  return <LightBurnReview review={review.review} onApply={props.onApply} />;
}

function MachineProfileReview(props: {
  readonly review: Extract<ImportReview, { readonly kind: 'machine' }>;
  readonly onApply: (profile: DeviceProfile) => void;
}): JSX.Element {
  return (
    <article style={cardStyle}>
      <h3 style={sectionHeadingStyle}>KerfDesk profile review</h3>
      <p style={mutedStyle}>{props.review.document.profile.name}</p>
      <ul style={notesStyle}>
        {props.review.document.reviewNotes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <Button variant="primary" onClick={() => props.onApply(props.review.document.profile)}>
        Apply imported profile
      </Button>
    </article>
  );
}

function LightBurnReview(props: {
  readonly review: LightBurnDeviceImportReview;
  readonly onApply: (profile: DeviceProfile) => void;
}): JSX.Element {
  return (
    <article style={cardStyle}>
      <h3 style={sectionHeadingStyle}>Imported device review</h3>
      <p style={mutedStyle}>{props.review.profile.name}</p>
      <ReviewList title="Applied" items={props.review.applied} />
      <ReviewList title="Needs Review" items={props.review.needsReview} />
      <ReviewList title="Ignored" items={props.review.ignored} />
      <Button
        variant="primary"
        disabled={!props.review.canCreateProfile}
        onClick={() => props.onApply(props.review.profile)}
      >
        Apply imported profile
      </Button>
    </article>
  );
}

function ReviewList(props: {
  readonly title: string;
  readonly items: ReadonlyArray<{ readonly label: string; readonly value: string }>;
}): JSX.Element | null {
  if (props.items.length === 0) return null;
  return (
    <>
      <h4 style={smallHeadingStyle}>{props.title}</h4>
      <ul style={notesStyle}>
        {props.items.map((item) => (
          <li key={`${item.label}:${item.value}`}>
            <strong>{item.label}:</strong> {item.value}
          </li>
        ))}
      </ul>
    </>
  );
}

function activeProfileDocument(profile: DeviceProfile): MachineProfileDocument {
  return {
    format: MACHINE_PROFILE_FORMAT,
    schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
    profile,
    source: {
      kind: profile.profileSource ?? 'custom',
      label: profile.name,
      ...(profile.catalogVersion !== undefined ? { catalogVersion: profile.catalogVersion } : {}),
    },
    reviewNotes: profile.evidence?.map((item) => item.note) ?? [],
  };
}

function importError(
  result: Exclude<ReturnType<typeof deserializeMachineProfileDocument>, { kind: 'ok' }>,
): string {
  if (result.kind === 'invalid') return result.reason;
  return `Unsupported machine profile schema: ${result.sawVersion}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'machine-profile'
  );
}
