import type { DeviceProfile } from '../../core/devices';
import {
  createMachineProfileDocument,
  deserializeMachineProfileDocument,
  serializeMachineProfileDocument,
  type MachineProfileDocument,
} from '../../io/machine-profile';
import {
  importLightBurnDeviceProfile,
  type LightBurnDeviceImportResult,
  type LightBurnImportReviewRow,
} from '../../io/lightburn';
import type { FileHandle, PlatformAdapter } from '../../platform/types';
import { usePlatform } from '../app/platform-context';
import { Button } from '../kit';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useState } from 'react';

type ImportReview =
  | { readonly kind: 'laserforge'; readonly document: MachineProfileDocument }
  | {
      readonly kind: 'lightburn';
      readonly result: Extract<LightBurnDeviceImportResult, { readonly kind: 'review' }>;
    };

export function MachineProfileImportExportPanel(): JSX.Element {
  const platform = usePlatform();
  const device = useStore((state) => state.project.device);
  const replaceDeviceProfile = useStore((state) => state.replaceDeviceProfile);
  const pushToast = useToastStore((state) => state.pushToast);
  const [review, setReview] = useState<ImportReview | null>(null);
  return (
    <div style={stackStyle}>
      <div style={actionsStyle}>
        <Button onClick={() => runExport(platform, device, pushToast)}>Export active profile</Button>
        <Button onClick={() => runImport(platform, setReview, pushToast)}>Import profile</Button>
      </div>
      {review !== null ? (
        <ImportReviewCard
          review={review}
          onApply={(profile) => {
            replaceDeviceProfile(profile);
            setReview(null);
            pushToast(`Active machine profile set to ${profile.name}.`, 'success');
          }}
        />
      ) : (
        <p style={copyStyle}>
          Import/export uses deterministic LaserForge `.lfmachine.json`. Legacy LightBurn `.lbdev`
          files are imported only after review; LightBurn `.lbzip` bundles are not imported yet.
        </p>
      )}
    </div>
  );
}

async function runExport(
  platform: PlatformAdapter,
  profile: DeviceProfile,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
): Promise<void> {
  const target = await platform.pickFileForSave({
    suggestedName: `${slug(profile.name)}.lfmachine.json`,
    extensions: ['.lfmachine.json'],
  });
  if (target === null) return;
  const document = createMachineProfileDocument(profile, {
    source: { kind: profile.profileSource ?? 'custom', label: profile.name },
    reviewNotes: profile.evidence?.map((item) => item.note) ?? [],
  });
  await target.write(serializeMachineProfileDocument(document));
  pushToast(`Exported machine profile to ${target.displayName}.`, 'success');
}

async function runImport(
  platform: PlatformAdapter,
  setReview: (review: ImportReview | null) => void,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
): Promise<void> {
  const [file] = await platform.pickFilesForOpen({
    accept: ['.lfmachine.json', '.lbdev', '.lbzip'],
    multiple: false,
  });
  if (file === undefined) return;
  const text = await file.text();
  const review = parseImport(file, text);
  if (review.kind === 'unsupported') {
    pushToast(review.message, 'error');
    return;
  }
  if (review.kind === 'invalid') {
    pushToast(review.reason, 'error');
    return;
  }
  setReview(review.review);
}

function parseImport(
  file: FileHandle,
  text: string,
):
  | { readonly kind: 'ok'; readonly review: ImportReview }
  | { readonly kind: 'unsupported'; readonly message: string }
  | { readonly kind: 'invalid'; readonly reason: string } {
  if (file.name.toLowerCase().endsWith('.lfmachine.json') || text.trimStart().startsWith('{')) {
    const result = deserializeMachineProfileDocument(text);
    if (result.kind === 'ok') return { kind: 'ok', review: { kind: 'laserforge', document: result.document } };
    const reason =
      result.kind === 'schema-too-new'
        ? `Machine profile schema ${result.sawVersion} is newer than this LaserForge build.`
        : result.reason;
    return { kind: 'invalid', reason };
  }
  const lightBurn = importLightBurnDeviceProfile(text, file.name);
  if (lightBurn.kind === 'unsupported-bundle') {
    return { kind: 'unsupported', message: lightBurn.message };
  }
  if (lightBurn.kind === 'invalid') return { kind: 'invalid', reason: lightBurn.reason };
  return { kind: 'ok', review: { kind: 'lightburn', result: lightBurn } };
}

function ImportReviewCard(props: {
  readonly review: ImportReview;
  readonly onApply: (profile: DeviceProfile) => void;
}): JSX.Element {
  if (props.review.kind === 'laserforge') {
    const { document } = props.review;
    return (
      <section style={cardStyle}>
        <strong>{document.profile.name}</strong>
        <p style={copyStyle}>{document.source.label}</p>
        <ReviewList title="Review Notes" rows={document.reviewNotes.map(noteRow)} />
        <Button onClick={() => props.onApply(document.profile)}>Apply imported profile</Button>
      </section>
    );
  }
  const { result } = props.review;
  return (
    <section style={cardStyle}>
      <strong>{result.profile.name}</strong>
      <ReviewList title="Applied" rows={result.applied} />
      <ReviewList title="Needs Review" rows={result.needsReview} />
      <ReviewList title="Ignored" rows={result.ignored} />
      <Button disabled={!result.canCreateProfile} onClick={() => props.onApply(result.profile)}>
        Create profile from import
      </Button>
    </section>
  );
}

function ReviewList(props: {
  readonly title: string;
  readonly rows: ReadonlyArray<LightBurnImportReviewRow>;
}): JSX.Element {
  if (props.rows.length === 0) return <></>;
  return (
    <div>
      <strong>{props.title}</strong>
      <ul style={listStyle}>
        {props.rows.map((row) => (
          <li key={`${row.label}:${row.value}`}>
            <span>{row.label}: </span>
            <code>{row.value}</code>
            <span style={copyStyle}> {row.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function noteRow(note: string): LightBurnImportReviewRow {
  return { label: 'Note', value: note, note: '' };
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-|-$/g, '') || 'machine-profile'
  );
}

const stackStyle: React.CSSProperties = { display: 'grid', gap: 10 };
const actionsStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const cardStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: 8,
  display: 'grid',
  gap: 8,
};
const listStyle: React.CSSProperties = { margin: '4px 0', paddingLeft: 18 };
const copyStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  margin: 0,
  lineHeight: 1.35,
};
