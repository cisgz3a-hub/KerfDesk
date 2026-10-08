import { useState } from 'react';
import { usePlatformOptional } from '../../app/platform-context';
import { buildGcodeMetadata } from '../../app/build-info';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { createDiagnosticBundle, type DiagnosticBundleReview } from './diagnostic-bundle';

function useDiagnosticBundleReview() {
  const platform = usePlatformOptional();
  const [includeTranscript, setIncludeTranscript] = useState(true);
  const [review, setReview] = useState<DiagnosticBundleReview | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const capture = (): void => {
    const project = useStore.getState().project;
    setReview(
      createDiagnosticBundle({
        app: buildGcodeMetadata(),
        platformId: platform?.id ?? 'unknown',
        device: project.device,
        machineKind: project.machine?.kind ?? 'laser',
        laser: useLaserStore.getState(),
        includeTranscript,
        createdAt: new Date().toISOString(),
      }),
    );
    setMessage('Snapshot captured. Review the JSON below before saving or sharing.');
  };
  const save = async (): Promise<void> => {
    if (review === null || platform === null || saving) return;
    setSaving(true);
    try {
      const target = await platform.pickFileForSave({
        suggestedName: 'kerfdesk-diagnostics.json',
        extensions: ['.json'],
      });
      if (target === null) setMessage('Diagnostic export cancelled.');
      else {
        await target.write(review.json);
        setMessage('Reviewed diagnostic bundle saved locally. Nothing was sent.');
      }
    } catch {
      setMessage('Could not save the diagnostic bundle. The reviewed snapshot is still available.');
    } finally {
      setSaving(false);
    }
  };
  return {
    platform,
    includeTranscript,
    setIncludeTranscript,
    review,
    setReview,
    saving,
    message,
    capture,
    save,
  };
}

export function DiagnosticBundleReviewPanel(): JSX.Element {
  const {
    platform,
    includeTranscript,
    setIncludeTranscript,
    review,
    setReview,
    saving,
    message,
    capture,
    save,
  } = useDiagnosticBundleReview();
  return (
    <details>
      <summary title="Review and save a redacted snapshot of existing diagnostic observations.">
        Local diagnostic bundle
      </summary>
      <DiagnosticDisclosure />
      <label>
        <input
          type="checkbox"
          title="Include recent console observations after redaction and size filtering in the diagnostic snapshot."
          checked={includeTranscript}
          disabled={saving}
          onChange={(event) => {
            setIncludeTranscript(event.target.checked);
            setReview(null);
          }}
        />
        Include recent diagnostic console lines
      </label>
      <div style={{ display: 'flex', gap: 8, marginBlock: 8 }}>
        <button
          type="button"
          title="Capture existing app and controller observations for local JSON review without querying the machine."
          onClick={capture}
          disabled={saving}
        >
          Review diagnostic bundle
        </button>
        <button
          type="button"
          title="Choose a local file for the captured JSON after reviewing it for sensitive information; nothing is sent automatically."
          onClick={() => void save()}
          disabled={review === null || platform === null || saving}
        >
          {saving ? 'Saving…' : 'Save reviewed JSON'}
        </button>
      </div>
      {review === null ? null : <ReviewedSnapshot review={review} />}
      {message === '' ? null : <p role="status">{message}</p>}
    </details>
  );
}

function DiagnosticDisclosure(): JSX.Element {
  return (
    <>
      <p>
        Includes app/build identity, declared machine settings, known connection/controller status,
        numeric settings and an optional recent console transcript. Uses existing observations; it
        does not query or change the machine.
      </p>
      <p>
        Omits artwork, job/motion G-code, profile/file names, accounts, licences and device serial
        numbers. Recognised sensitive text is removed or redacted. Check the JSON for unlabelled
        secrets before sharing. Nothing is sent automatically.
      </p>
    </>
  );
}

function ReviewedSnapshot({ review }: { readonly review: DiagnosticBundleReview }): JSX.Element {
  return (
    <>
      <p>
        {review.bytes.toLocaleString()} bytes (maximum 128 KiB). {review.transcriptIncluded} console
        lines included; {review.transcriptOmitted} omitted by choice, filtering or size limits. This
        snapshot stays fixed while controller state changes.
      </p>
      <textarea
        readOnly
        title="Read the fixed diagnostic snapshot and check for unlabelled secrets before saving or sharing it."
        value={review.json}
        aria-label="Diagnostic bundle JSON to review"
        style={{ width: '100%', minHeight: 180, boxSizing: 'border-box' }}
      />
    </>
  );
}
