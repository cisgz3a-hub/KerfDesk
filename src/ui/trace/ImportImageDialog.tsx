// ImportImageDialog — Phase E modal for picking a raster image,
// adjusting trace parameters, and committing the traced object to
// the scene.
//
// Flow:
//   1. User picks a PNG/JPG via <input type="file">
//   2. Image is decoded into RawImageData (image-loader.ts)
//   3. User adjusts color count + smoothing (or accepts defaults)
//   4. Submit → traceImageToSvgString → parseSvg → upsert via
//      the existing importSvgObject pipeline (it auto-fits, adds
//      layers per color, and pushes to the undo stack).
//
// Reuses parseSvg for two reasons: (a) the polyline conversion +
// color extraction are already battle-tested, and (b) the
// resulting object IS effectively an SVG import as far as the
// store is concerned. We then patch the result to mark it as a
// 'traced-image' so the source filename + future "re-trace from
// the original raster" workflow can find it.

import { useState } from 'react';
import { IDENTITY_TRANSFORM, type TracedImage } from '../../core/scene';
import {
  DEFAULT_TRACE_OPTIONS,
  TRACE_PRESETS,
  type TraceOptions,
  traceImageToSvgString,
} from '../../core/trace';
import { parseSvg } from '../../io/svg';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { loadImageAsRawData } from './image-loader';

export function ImportImageDialog(): JSX.Element | null {
  const open = useUiStore((s) => s.imageDialogOpen);
  if (!open) return null;
  return <DialogBody />;
}

function DialogBody(): JSX.Element {
  const close = useUiStore((s) => s.closeImageDialog);
  const importSvgObject = useStore((s) => s.importSvgObject);
  const pushToast = useToastStore((s) => s.pushToast);
  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState<string>('Smooth');
  const [busy, setBusy] = useState(false);
  const options: TraceOptions = TRACE_PRESETS[preset] ?? DEFAULT_TRACE_OPTIONS;

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (file === null) {
      pushToast('Pick an image file first.', 'warning');
      return;
    }
    void commit({ file, options }, { importSvgObject, pushToast, close, setBusy });
  };

  return (
    <div style={backdropStyle} role="dialog" aria-label="Import raster image">
      <form onSubmit={onSubmit} style={panelStyle}>
        <h2 style={headingStyle}>Trace Image</h2>
        <FilePicker file={file} onPick={setFile} />
        <PresetPicker value={preset} onChange={setPreset} />
        <p style={hintStyle}>
          <strong>Smooth</strong> — flowing lines, best for logos and clean engraving.{' '}
          <strong>Sharp</strong> — keeps fine pixel detail at the cost of jaggedness.{' '}
          <strong>Detailed</strong> — small features, ~4 color layers.{' '}
          <strong>Photo</strong> — many colors + heavy blur, for photographic input.
        </p>
        <DialogActions canSubmit={file !== null && !busy} busy={busy} onCancel={close} />
      </form>
    </div>
  );
}

function PresetPicker(props: {
  readonly value: string;
  readonly onChange: (next: string) => void;
}): JSX.Element {
  return (
    <Field label="Preset">
      <select value={props.value} onChange={(e) => props.onChange(e.target.value)} style={selectStyle}>
        {Object.keys(TRACE_PRESETS).map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
    </Field>
  );
}

async function commit(
  args: { readonly file: File; readonly options: TraceOptions },
  ctx: {
    readonly importSvgObject: ReturnType<typeof useStore.getState>['importSvgObject'];
    readonly pushToast: ReturnType<typeof useToastStore.getState>['pushToast'];
    readonly close: () => void;
    readonly setBusy: (v: boolean) => void;
  },
): Promise<void> {
  ctx.setBusy(true);
  try {
    const image = await loadImageAsRawData(args.file);
    const svg = traceImageToSvgString(image, args.options);
    const id = crypto.randomUUID();
    const result = parseSvg({ svgText: svg, id, source: args.file.name });
    if (result.object === null) {
      ctx.pushToast(`Tracing ${args.file.name} produced no paths — try a higher contrast image.`, 'warning');
      return;
    }
    // Re-tag the parsed object as a TracedImage variant so the rest
    // of the pipeline knows its origin. Same `paths` shape, just a
    // different `kind` discriminator.
    const traced: TracedImage = {
      kind: 'traced-image',
      id,
      source: args.file.name,
      bounds: result.object.bounds,
      transform: IDENTITY_TRANSFORM,
      paths: result.object.paths,
    };
    const outcome = ctx.importSvgObject(traced);
    if (outcome.kind === 'added') {
      const colorCount = traced.paths.length;
      ctx.pushToast(
        `Traced ${args.file.name} — ${colorCount} color${colorCount === 1 ? '' : 's'}`,
        'success',
      );
    }
    ctx.close();
  } catch (err) {
    ctx.pushToast(
      `Could not trace ${args.file.name}: ${err instanceof Error ? err.message : String(err)}`,
      'error',
    );
  } finally {
    ctx.setBusy(false);
  }
}

function FilePicker(props: {
  readonly file: File | null;
  readonly onPick: (f: File | null) => void;
}): JSX.Element {
  return (
    <Field label="Image">
      <input
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
        onChange={(e) => props.onPick(e.target.files?.[0] ?? null)}
        style={fileInputStyle}
      />
      {props.file !== null && (
        <span style={fileNameStyle} title={props.file.name}>
          {props.file.name}
        </span>
      )}
    </Field>
  );
}

function DialogActions(props: {
  readonly canSubmit: boolean;
  readonly busy: boolean;
  readonly onCancel: () => void;
}): JSX.Element {
  return (
    <div style={actionsStyle}>
      <button type="button" onClick={props.onCancel} disabled={props.busy}>
        Cancel
      </button>
      <button type="submit" disabled={!props.canSubmit}>
        {props.busy ? 'Tracing…' : 'Trace'}
      </button>
    </div>
  );
}

function Field(props: { readonly label: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{props.label}</span>
      <span style={fieldControlStyle}>{props.children}</span>
    </label>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};
const panelStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 6,
  padding: 16,
  minWidth: 380,
  maxWidth: 520,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  fontFamily: 'system-ui, sans-serif',
};
const headingStyle: React.CSSProperties = { margin: 0, fontSize: 16 };
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};
const fieldLabelStyle: React.CSSProperties = { width: 90, color: '#444' };
const fieldControlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};
const fileInputStyle: React.CSSProperties = { flex: 1, fontSize: 12 };
const fileNameStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#555',
  maxWidth: 240,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const selectStyle: React.CSSProperties = { flex: 1, fontSize: 13 };
const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#666',
  margin: '4px 0 0 0',
  fontStyle: 'italic',
};
const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 8,
};
