// Toolbar — top bar with File-menu actions. Delegates to shared
// file-actions.ts so the keyboard shortcut listener in App.tsx can call
// the same handlers.

import {
  handleImportSvg,
  handleOpenProject,
  handleSaveGcode,
  handleSaveProject,
} from '../app/file-actions';
import { usePlatform } from '../app/platform-context';
import { buildBitmapFromVector, isConvertibleVector } from '../raster/vector-to-bitmap';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { rasterImportGeometry } from './image-import';
import { readImageDensity } from './image-density';

// F-A13 dirty-check. Returns true if it's safe to proceed (project is clean,
// or the user confirmed discard). Phase A uses the native confirm() —
// promoting to a Save / Don't Save / Cancel modal is Phase C polish.
function confirmDiscard(action: string): boolean {
  const dirty = useStore.getState().dirty;
  if (!dirty) return true;
  const name = useStore.getState().savedName ?? 'this project';
  return window.confirm(
    `Discard unsaved changes to ${name} and ${action}? (Cancel to keep editing — Save first via Save or Ctrl+S.)`,
  );
}

export function Toolbar(): JSX.Element {
  return (
    <header aria-label="Toolbar" style={barStyle}>
      <span style={titleStyle}>LaserForge 2.0</span>
      <BuildBadge />
      <span style={separatorStyle} />
      <FileButtons />
      <span style={separatorStyle} />
      <span style={hintStyle} title={SHORTCUT_HINT}>
        ⌨ shortcuts
      </span>
    </header>
  );
}

// Build identification — surfaces version + git SHA + build date so a
// user can confirm which deploy they're looking at after pushing.
// All three values are injected by Vite's `define` at build time
// (see vite.config.ts); by the time JS runs in the browser they're
// already inline literals. Hover shows the full ISO timestamp.
function BuildBadge(): JSX.Element {
  const sha = __GIT_SHA__;
  const version = __APP_VERSION__;
  const builtAt = __BUILD_TIME__;
  // Trim the ISO time to a YYYY-MM-DD HH:MM (UTC) form for the inline
  // display — the full ISO with seconds + Z lives in the title attr.
  const shortDate = builtAt.slice(0, 16).replace('T', ' ');
  const title = `Built ${builtAt}\nCommit ${sha}\nVersion ${version}`;
  return (
    <span style={buildBadgeStyle} title={title} aria-label="Build version">
      v{version} · {sha} · {shortDate} UTC
    </span>
  );
}

// All Toolbar buttons grouped — extracted so the parent stays a thin
// layout shell under the 80-line-per-function lint cap and so each
// button keeps its full title-attribute hint inline (the hint *is*
// the discoverability for users who don't read shortcut docs).
function FileButtons(): JSX.Element {
  const platform = usePlatform();
  const project = useStore((s) => s.project);
  const importSvgObject = useStore((s) => s.importSvgObject);
  const setProject = useStore((s) => s.setProject);
  const newProject = useStore((s) => s.newProject);
  const savedName = useStore((s) => s.savedName);
  const lastSaveTarget = useStore((s) => s.lastSaveTarget);
  const markSaved = useStore((s) => s.markSaved);
  const markLoaded = useStore((s) => s.markLoaded);
  const pushToast = useToastStore((s) => s.pushToast);
  const saveCtx = { platform, project, savedName, lastSaveTarget, markSaved, pushToast };
  return (
    <>
      <button
        type="button"
        title="New project (Ctrl+N)"
        onClick={() => {
          if (confirmDiscard('start a new project')) newProject();
        }}
      >
        New
      </button>
      <button
        type="button"
        title="Open .lf2 project (Ctrl+O)"
        onClick={() => {
          if (!confirmDiscard('open another project')) return;
          void handleOpenProject({ platform, setProject, markLoaded, pushToast });
        }}
      >
        Open…
      </button>
      <button
        type="button"
        title="Save project (Ctrl+S)"
        onClick={() => void handleSaveProject(saveCtx)}
      >
        Save
      </button>
      <button
        type="button"
        title="Save project as… (Ctrl+Shift+S)"
        onClick={() => void handleSaveProject(saveCtx, true)}
      >
        Save As…
      </button>
      <span style={separatorStyle} />
      <button
        type="button"
        title="Import SVG file (Ctrl+I) — you can also drag-drop"
        onClick={() => void handleImportSvg(platform, importSvgObject, pushToast)}
      >
        Import SVG…
      </button>
      <TextButton />
      <ImportImageButton />
      <TraceImageButton />
      <ConvertToBitmapButton />
      <button
        type="button"
        title="Export G-code for the current scene (Ctrl+E)"
        onClick={() => void handleSaveGcode({ platform, project, savedName, pushToast })}
      >
        Save G-code…
      </button>
    </>
  );
}

// Phase D — Add Text opens the AddTextDialog. Edit happens by
// double-clicking an existing text in the workspace; that path is
// in Workspace.tsx.
function TextButton(): JSX.Element {
  const openTextDialog = useUiStore((s) => s.openTextDialog);
  return (
    <button
      type="button"
      title="Add text to the scene"
      onClick={() => openTextDialog({ mode: 'add' })}
    >
      Text…
    </button>
  );
}

// ADR-027 — Trace is a TOOL run on a SELECTED bitmap: it opens the
// ImportImageDialog seeded with that image and overlays the resulting
// vectors on it (the bitmap stays as the deletable source). Disabled
// until a raster-image is selected, mirroring LightBurn's greyed-out
// Trace with no image selected.
function TraceImageButton(): JSX.Element {
  const openImageDialog = useUiStore((s) => s.openImageDialog);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const objects = useStore((s) => s.project.scene.objects);
  const selected =
    selectedObjectId === null ? undefined : objects.find((o) => o.id === selectedObjectId);
  const raster = selected !== undefined && selected.kind === 'raster-image' ? selected : null;
  return (
    <button
      type="button"
      title={
        raster === null
          ? 'Select an image first, then trace it into vectors'
          : 'Trace the selected image into vectors'
      }
      disabled={raster === null}
      onClick={(): void => {
        if (raster !== null) openImageDialog(raster);
      }}
    >
      Trace Image…
    </button>
  );
}

// ADR-029 — Convert to Bitmap is a TOOL run on a SELECTED vector (SVG, text, or
// traced image): it rasterizes the vector into a RasterImage engrave-source and
// replaces the original in place. LightBurn discards the source vector on
// convert (documented behavior), so this is one-way — hence no '…' (it is
// immediate; no dialog in A2). Disabled until a convertible vector is selected,
// mirroring LightBurn's greyed-out menu item. The try/catch guards the one
// browser-only step (canvas toDataURL inside buildBitmapFromVector), surfacing
// failure as a toast like ImportImageButton does.
function ConvertToBitmapButton(): JSX.Element {
  const convertToBitmap = useStore((s) => s.convertToBitmap);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const objects = useStore((s) => s.project.scene.objects);
  const pushToast = useToastStore((s) => s.pushToast);
  const selected =
    selectedObjectId === null ? undefined : objects.find((o) => o.id === selectedObjectId);
  const convertible = selected !== undefined && isConvertibleVector(selected) ? selected : null;
  return (
    <button
      type="button"
      title={
        convertible === null
          ? 'Select a vector (SVG, text, or trace) to convert into a bitmap'
          : 'Convert the selected vector into a bitmap — replaces it'
      }
      disabled={convertible === null}
      onClick={(): void => {
        if (convertible === null) return;
        try {
          const raster = buildBitmapFromVector(convertible);
          convertToBitmap(convertible.id, raster);
          pushToast(`Converted to bitmap: ${raster.source}`, 'success');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          pushToast(`Could not convert to bitmap: ${message}`, 'error');
        }
      }}
    >
      Convert to Bitmap
    </button>
  );
}

// ADR-027 — the single Import Image action. An image always enters the
// scene as a bitmap (RasterImage) on an image-mode layer, matching
// LightBurn; vectorizing it is a separate tool (TraceImageButton) run on
// the selection afterward. 96-DPI mm sizing keeps the import an ergonomic
// size to scale rather than tiny pixel-multiples.
function ImportImageButton(): JSX.Element {
  const importRasterImage = useStore((s) => s.importRasterImage);
  const pushToast = useToastStore((s) => s.pushToast);
  const onPick = (file: File): void => {
    void (async () => {
      try {
        const { loadImageAsRawData, extractLumaBase64, readFileAsDataUrl, readImageNaturalSize } =
          await import('../trace/image-loader');
        const natural = await readImageNaturalSize(file);
        const image = await loadImageAsRawData(file);
        // Honour embedded PNG/JPEG density so the import lands at its real-world
        // size; fall back to 96 DPI when there is none (P2-A).
        const density = await readImageDensity(file);
        const { DEFAULT_RASTER_LAYER_COLOR, IDENTITY_TRANSFORM } = await import('../../core/scene');
        const geometry = rasterImportGeometry({
          naturalWidth: natural.width,
          naturalHeight: natural.height,
          sampledWidth: image.width,
          sampledHeight: image.height,
          ...(density !== null ? { dpi: density } : {}),
        });
        const dataUrl = await readFileAsDataUrl(file);
        const lumaBase64 = extractLumaBase64(image);
        importRasterImage({
          kind: 'raster-image',
          id: crypto.randomUUID(),
          source: file.name,
          dataUrl,
          pixelWidth: geometry.pixelWidth,
          pixelHeight: geometry.pixelHeight,
          bounds: geometry.bounds,
          transform: IDENTITY_TRANSFORM,
          color: DEFAULT_RASTER_LAYER_COLOR,
          dither: 'floyd-steinberg',
          linesPerMm: 10,
          lumaBase64,
        });
        pushToast(`Added image: ${file.name} (${image.width}×${image.height} px)`, 'success');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        pushToast(`Could not load image: ${message}`, 'error');
      }
    })();
  };
  return (
    <FileButton
      title="Import an image (PNG/JPG) as a bitmap"
      onPick={onPick}
      label="Import Image…"
      accept="image/png,image/jpeg"
    />
  );
}

// Generic hidden-input file picker. Used by ImportImageButton to
// avoid touching the platform.pickFilesForOpen pipeline (which
// returns text-only FileHandles; binary images need the raw File).
function FileButton(props: {
  readonly title: string;
  readonly accept: string;
  readonly label: string;
  readonly onPick: (file: File) => void;
}): JSX.Element {
  const inputId = `lf2-file-${props.label.replace(/\s+/g, '-')}`;
  return (
    <>
      <input
        id={inputId}
        type="file"
        accept={props.accept}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file !== undefined) props.onPick(file);
          // Reset so picking the same file twice still fires onChange.
          e.target.value = '';
        }}
      />
      <button
        type="button"
        title={props.title}
        onClick={() => document.getElementById(inputId)?.click()}
      >
        {props.label}
      </button>
    </>
  );
}

// One-place shortcut reference — surfaces on hover of the small "⌨ shortcuts"
// badge in the toolbar. Lists every binding the audit confirmed exists;
// edit this when shortcuts.ts adds new ones.
const SHORTCUT_HINT = [
  'File: Ctrl+N new · Ctrl+O open · Ctrl+S save · Ctrl+Shift+S save as · Ctrl+I import · Ctrl+E export G-code',
  'Edit: Ctrl+Z undo · Ctrl+Shift+Z redo · Ctrl+A select all · Delete/Backspace remove · Escape deselect',
  'Transform: ←↑↓→ nudge 1mm · Shift+arrows 10mm · H flip horizontal · V flip vertical',
  'View: F or 0 fit-to-bed · +/- zoom · P preview · Space+drag pan',
].join('\n');

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  background: '#2c2c2c',
  color: '#ddd',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  borderBottom: '1px solid #111',
};
const titleStyle: React.CSSProperties = { fontWeight: 600 };
const buildBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#888',
  fontFamily: 'ui-monospace, Menlo, monospace',
  cursor: 'help',
  userSelect: 'none',
};
const separatorStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 1,
  height: 16,
  background: '#444',
  margin: '0 4px',
};
const hintStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: 11,
  color: '#999',
  cursor: 'help',
  userSelect: 'none',
};
