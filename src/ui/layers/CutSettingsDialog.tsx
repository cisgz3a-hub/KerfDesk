import { useEffect, useRef, useState } from 'react';
import type { Layer, LayerMode } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';
import { CutSettingsCommonFields } from './CutSettingsCommonFields';
import {
  CutSettingsDefaultActions,
  type CutSettingsDefaultHandlers,
} from './CutSettingsDefaultActions';
import { CutSettingsFillFields } from './CutSettingsFillFields';
import { CutSettingsImageFields } from './CutSettingsImageFields';
import { readCutSettingsPatch, type LayerPatch } from './cut-settings-draft';
import {
  changedCutSettingsPatch,
  cutSettingField,
  withoutUntouchedLineDefaults,
} from './cut-settings-field-edits';
import './laser-operation-settings.css';

type CutSettingsDialogProps = {
  readonly layer: Layer;
  readonly maxFeed?: number;
  readonly selectionCount?: number;
  /** Artwork settings (ADR-317 §1): Apply sends only the fields the operator
   * changed, so every other field keeps following the operation. Implied by
   * `selectionCount`. */
  readonly onlyChangedFields?: boolean;
  /** The operation as a Process switch alone would leave it (ADR-496 §6). When
   * given, the dialog shows it as soon as Process changes, provided nothing
   * else has been edited yet, and a switch alone applies as `{ mode }`. */
  readonly previewModeSwitch?: (mode: LayerMode) => Layer | undefined;
  readonly operationMembershipEditable?: boolean;
  readonly onCancel: () => void;
  readonly onApply: (patch: LayerPatch) => void;
} & Partial<CutSettingsDefaultHandlers>;

export function CutSettingsDialog(props: CutSettingsDialogProps): JSX.Element {
  const maxFeed = positiveFiniteLimit(props.maxFeed);
  const changedFields = useRef(new Map<string, HTMLElement>());
  const signature = layerFormSignature(props.layer);
  // Tied to the stored layer it was made from, so a store change drops it.
  const [switched, setSwitched] = useState<{ readonly from: string; readonly layer: Layer }>();
  const layer = switched?.from === signature ? switched.layer : props.layer;
  const onlyChangedFields = props.onlyChangedFields === true || props.selectionCount !== undefined;
  useEffect(() => {
    changedFields.current.clear();
  }, [signature]);
  const onProcessChange = (mode: LayerMode): void => {
    if (props.previewModeSwitch === undefined || editedBesidesProcess(changedFields.current))
      return;
    const next = mode === props.layer.mode ? undefined : props.previewModeSwitch(mode);
    setSwitched(next === undefined ? undefined : { from: signature, layer: next });
  };
  const onSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    // A Process switch and nothing else is the inspector's one-field edit, so
    // the store reseeds it exactly as it does that one.
    if (layer !== props.layer && !editedBesidesProcess(changedFields.current)) {
      props.onApply({ mode: layer.mode });
      return;
    }
    const patch = readCutSettingsPatch(new FormData(form), layer, {
      ...(maxFeed === null ? {} : { maxFeed }),
      deferArtworkBounds: props.selectionCount !== undefined,
    });
    props.onApply(
      onlyChangedFields
        ? changedCutSettingsPatch(form, patch, changedFields.current)
        : withoutUntouchedLineDefaults(form, patch, layer, changedFields.current),
    );
  };
  return (
    <Dialog
      onClose={props.onCancel}
      ariaLabel={`Cut settings for ${props.layer.color}`}
      as="form"
      onSubmit={onSubmit}
      size="md"
      panelClassName="lf-cut-settings-dialog"
    >
      {/* Keyed on the layer's own settings: the fields are uncontrolled drafts
          that read `defaultValue` once, and Apply submits whatever the DOM holds.
          "Reset to Default" rewrites the layer in the store while the dialog is
          open, so without this remount the boxes kept the pre-reset numbers and
          Apply wrote them straight back — silently undoing the reset. Typing never
          changes the stored layer, so an in-progress edit is never remounted.
          A previewed Process switch remounts too, but only before any other
          field is edited. */}
      <div
        className="lf-cut-settings-content"
        onChangeCapture={(event) => {
          const field = cutSettingField(event.target);
          if (field !== undefined) changedFields.current.set(field.name, field.control);
        }}
      >
        <CutSettingsBody
          key={layerFormSignature(layer)}
          layer={layer}
          selectionCount={props.selectionCount}
          deferArtworkBounds={props.selectionCount !== undefined}
          operationMembershipEditable={props.operationMembershipEditable !== false}
          onProcessChange={onProcessChange}
          {...(maxFeed === null ? {} : { maxFeed })}
        />
      </div>
      {hasDefaultHandlers(props) ? <CutSettingsDefaultActions {...props} /> : null}
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary">
          Apply settings
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CutSettingsBody(props: {
  readonly layer: Layer;
  readonly selectionCount: number | undefined;
  readonly maxFeed?: number;
  readonly deferArtworkBounds: boolean;
  readonly operationMembershipEditable: boolean;
  readonly onProcessChange: (mode: LayerMode) => void;
}): JSX.Element {
  const [mode, setMode] = useState<LayerMode>(props.layer.mode);
  const [dither, setDither] = useState<Layer['ditherAlgorithm']>(props.layer.ditherAlgorithm);
  const [fillLineIntervalMm, setFillLineIntervalMm] = useState(props.layer.hatchSpacingMm);
  const [imageLinesPerMm, setImageLinesPerMm] = useState(props.layer.linesPerMm);
  const [power, setPower] = useState(props.layer.power);
  const maxFeedProps = props.maxFeed === undefined ? {} : { maxFeed: props.maxFeed };
  return (
    <>
      <Header layer={props.layer} />
      {props.selectionCount !== undefined ? (
        <p className="lf-subheading">
          Values start from the first selected artwork. Only fields you change are applied to all{' '}
          {props.selectionCount} selected artworks. Each artwork keeps its own power and density
          limits.
        </p>
      ) : null}
      <CutSettingsCommonFields
        layer={props.layer}
        operationMembershipEditable={props.operationMembershipEditable}
        mode={mode}
        onModeChange={(next) => {
          setMode(next);
          props.onProcessChange(next);
        }}
        onPowerChange={setPower}
        {...maxFeedProps}
      />
      {mode === 'fill' ? (
        <CutSettingsFillFields
          layer={props.layer}
          lineIntervalMm={fillLineIntervalMm}
          onLineIntervalMmChange={setFillLineIntervalMm}
          showCutSettingsExtras
        />
      ) : null}
      {mode === 'image' ? (
        <CutSettingsImageFields
          layer={props.layer}
          deferArtworkBounds={props.deferArtworkBounds}
          dither={dither}
          maxPower={power}
          imageLinesPerMm={imageLinesPerMm}
          showOverscan
          showScanPattern
          onDitherChange={setDither}
          onImageLinesPerMmChange={setImageLinesPerMm}
        />
      ) : null}
    </>
  );
}

// Value-based, over the whole layer rather than a hand-listed subset: any
// store-side rewrite (Reset to Default, undo, a preset apply) re-seeds the
// form, and a field added to Layer later cannot silently fall out of the
// signature. Equal values produce an equal string, so the store's ordinary
// re-renders do not remount anything.
function layerFormSignature(layer: Layer): string {
  return JSON.stringify(layer);
}

// Unmounted controls (a process change hid them, or a preview remounted the
// form) no longer count as edits, as on Apply.
function editedBesidesProcess(changed: ReadonlyMap<string, HTMLElement>): boolean {
  return [...changed].some(([name, control]) => name !== 'mode' && control.isConnected);
}

function positiveFiniteLimit(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? Math.max(1, value) : null;
}

function hasDefaultHandlers(
  props: CutSettingsDialogProps,
): props is CutSettingsDialogProps & CutSettingsDefaultHandlers {
  return (
    props.onMakeDefault !== undefined &&
    props.onMakeDefaultForAll !== undefined &&
    props.onResetToDefault !== undefined &&
    props.makeDefaultColor !== undefined
  );
}

function Header({ layer }: { readonly layer: Layer }): JSX.Element {
  return (
    <header className="lf-cut-settings-header">
      {/* The swatch background is scene data (the layer color), inline by
          the ADR-047 dynamic-styles policy. */}
      <span style={{ ...swatchStyle, background: layer.color }} />
      <div className="lf-cut-settings-header__text">
        <div className="lf-cut-settings-header__title">
          <h2 className="lf-dialog-title">Cut Settings</h2>
        </div>
        <p className="lf-subheading">{layer.name} · Fine-tune this laser operation</p>
      </div>
    </header>
  );
}

const swatchStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: 3,
  border: '1px solid var(--lf-border-strong)',
};
