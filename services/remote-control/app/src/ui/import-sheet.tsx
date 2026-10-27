import { useMemo, useState } from 'react';
import { controller } from '../core/controller';
import {
  bedFitDetail,
  bedFitHeadline,
  bedFitKeepLabel,
  fileSizeRestoredText,
  importNeedsReview,
  importSuccessText,
  readImportReceipt,
  type ImportNotice,
  type ImportReceipt,
} from '../core/import-receipt';
import { store } from '../core/store';
import { Icon } from './icons';
import { Banner, NumberField, Sheet } from './primitives';

const close = () => store.set({ sheet: null });
function bedCenter(): { x: number; y: number } {
  const bed = store.get().scene?.bed;
  return bed === undefined ? { x: 50, y: 50 } : { x: bed.widthMm / 2, y: bed.heightMm / 2 };
}

const MAX_IMPORT_BYTES = 178_000;
export function ImportSheet() {
  const [receipt, setReceipt] = useState<ImportReceipt | null>(null);
  return receipt === null ? (
    <ImportForm onReview={setReceipt} />
  ) : (
    <ImportReview receipt={receipt} />
  );
}

function ImportForm({ onReview }: { onReview: (receipt: ImportReceipt) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = useMemo(() => fileKind(file), [file]);
  const run = async () => {
    if (file === null || kind === null) return;
    setBusy(true);
    setError(null);
    try {
      const prepared =
        kind === 'image'
          ? await shrinkImage(file)
          : { mimeType: kind, bytes: new Uint8Array(await file.arrayBuffer()) };
      if (prepared.bytes.byteLength > MAX_IMPORT_BYTES) {
        setError(
          'This file is too large to send from the phone. Import it on the PC, or simplify it first.',
        );
        return;
      }
      const center = bedCenter();
      const result = await controller.write('import_file', {
        fileName: safeFileName(file.name),
        mimeType: prepared.mimeType,
        dataBase64: toBase64(prepared.bytes),
        ...(width === undefined
          ? {}
          : { widthMm: width, xMm: center.x - width / 2, yMm: center.y - width / 2 }),
      });
      if (result === null) return;
      // A bed fit or an import notice is shown here: the PC's toast is on a screen away from you.
      const receipt = readImportReceipt(result);
      if (importNeedsReview(receipt)) {
        onReview(receipt);
        return;
      }
      store.toast(importSuccessText(receipt), 'success');
      close();
    } catch {
      setError('This file couldn’t be read.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Import a file"
      onClose={close}
      footer={
        <button
          type="button"
          className="btn btn-primary"
          disabled={file === null || kind === null || busy}
          onClick={() => void run()}
        >
          {busy ? <span className="spinner" /> : <Icon name="import" />} Import
        </button>
      }
    >
      <label className="btn btn-soft btn-block" style={{ minHeight: 72 }}>
        <Icon name="import" /> {file === null ? 'Choose SVG, DXF, PNG or JPEG' : file.name}
        <input
          type="file"
          hidden
          accept=".svg,.dxf,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      {file !== null && kind === null ? (
        <Banner tone="warning">Use an SVG, DXF, PNG or JPEG file.</Banner>
      ) : null}
      <NumberField
        label="Width on the bed (optional)"
        unit="mm"
        min={1}
        max={100000}
        value={width}
        onCommit={setWidth}
      />
      <p className="note">
        Photos are resized on this phone before sending. Large SVG and DXF files are best imported
        on the PC.
      </p>
      {error === null ? null : <Banner tone="danger">{error}</Banner>}
    </Sheet>
  );
}

const TONE = {
  error: 'danger',
  warning: 'warning',
  info: 'info',
  success: 'success',
} as const satisfies Record<ImportNotice['level'], string>;

/**
 * What the import changed or assumed (ADR-125 Amendment 3). A bed fit makes the burn smaller
 * than the file, so it is acknowledged with Keep or undone with Restore; only the footer closes.
 */
function ImportReview({ receipt }: { receipt: ImportReceipt }) {
  const fit = receipt.bedFit;
  const revision = receipt.revision;
  const [busy, setBusy] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const restore = async () => {
    if (fit === null || revision === null) return;
    setBusy(true);
    // Sent against the import's own revision, so it undoes the fit step or is refused.
    const result = await controller.write('undo', {}, { expectedRevision: revision });
    setBusy(false);
    if (result === null) {
      setRestoreFailed(true);
      return;
    }
    store.toast(fileSizeRestoredText(fit), 'warning');
    close();
  };
  return (
    <Sheet
      title="Check this import"
      onClose={close}
      dismissible={fit === null}
      footer={
        fit === null ? (
          <button type="button" className="btn btn-primary" onClick={close}>
            Done
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-soft"
              disabled={busy || restoreFailed || revision === null}
              onClick={() => void restore()}
            >
              {busy ? <span className="spinner" /> : null} Restore file size
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={close}>
              {bedFitKeepLabel(fit.scale)}
            </button>
          </>
        )
      }
    >
      {fit === null ? null : (
        <Banner tone="warning">
          <div>
            <strong>{bedFitHeadline(fit)}</strong>
            <div className="small">{bedFitDetail(fit)}</div>
          </div>
        </Banner>
      )}
      {receipt.notices.map((notice, index) => (
        <Banner key={index} tone={TONE[notice.level]}>
          {notice.message}
        </Banner>
      ))}
      {restoreFailed ? (
        <p className="note">
          The fit may not have been undone. Check the size on the Design screen before you Frame.
        </p>
      ) : null}
    </Sheet>
  );
}

/** The PC accepts a plain name only: no path separators, reserved or control characters. */
function safeFileName(name: string): string {
  const cleaned = Array.from(name, (character) =>
    character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character) ? '_' : character,
  )
    .join('')
    .slice(0, 120);
  return cleaned === '' ? 'import' : cleaned;
}

function fileKind(file: File | null): 'image/svg+xml' | 'application/dxf' | 'image' | null {
  if (file === null) return null;
  const name = file.name.toLowerCase();
  if (name.endsWith('.svg')) return 'image/svg+xml';
  if (name.endsWith('.dxf')) return 'application/dxf';
  if (/\.(png|jpe?g)$/.test(name)) return 'image';
  return null;
}

/** Re-encode photos so one import fits the relay frame (ADR-584). */
async function shrinkImage(file: File): Promise<{ mimeType: string; bytes: Uint8Array }> {
  const bitmap = await createImageBitmap(file);
  for (const side of [1600, 1280, 1024, 800, 640]) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (context === null) break;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.72]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality),
      );
      if (blob !== null && blob.size <= MAX_IMPORT_BYTES)
        return { mimeType: 'image/jpeg', bytes: new Uint8Array(await blob.arrayBuffer()) };
    }
  }
  return {
    mimeType: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
