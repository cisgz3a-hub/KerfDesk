import { useState } from 'react';
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

type CutSettingsDialogProps = {
  readonly layer: Layer;
  readonly maxFeed?: number;
  readonly onCancel: () => void;
  readonly onApply: (patch: LayerPatch) => void;
} & Partial<CutSettingsDefaultHandlers>;

export function CutSettingsDialog(props: CutSettingsDialogProps): JSX.Element {
  const maxFeed = positiveFiniteLimit(props.maxFeed);
  const onSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    props.onApply(
      readCutSettingsPatch(new FormData(form), props.layer, maxFeed === null ? {} : { maxFeed }),
    );
  };
  return (
    <Dialog
      onClose={props.onCancel}
      ariaLabel={`Cut settings for ${props.layer.color}`}
      as="form"
      onSubmit={onSubmit}
      size="md"
    >
      <Header layer={props.layer} />
      {/* Keyed on the layer's own settings: the fields are uncontrolled drafts
          that read `defaultValue` once, and OK submits whatever the DOM holds.
          "Reset to Default" rewrites the layer in the store while the dialog is
          open, so without this remount the boxes kept the pre-reset numbers and
          OK wrote them straight back — silently undoing the reset. Typing never
          changes the stored layer, so an in-progress edit is never remounted. */}
      <CutSettingsBody
        key={layerFormSignature(props.layer)}
        layer={props.layer}
        {...(maxFeed === null ? {} : { maxFeed })}
      />
      {hasDefaultHandlers(props) ? <CutSettingsDefaultActions {...props} /> : null}
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary">
          OK
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CutSettingsBody(props: { readonly layer: Layer; readonly maxFeed?: number }): JSX.Element {
  const [mode, setMode] = useState<LayerMode>(props.layer.mode);
  const [dither, setDither] = useState<Layer['ditherAlgorithm']>(props.layer.ditherAlgorithm);
  const [fillLineIntervalMm, setFillLineIntervalMm] = useState(props.layer.hatchSpacingMm);
  const [imageLinesPerMm, setImageLinesPerMm] = useState(props.layer.linesPerMm);
  const [power, setPower] = useState(props.layer.power);
  const maxFeedProps = props.maxFeed === undefined ? {} : { maxFeed: props.maxFeed };
  return (
    <>
      <CutSettingsCommonFields
        layer={props.layer}
        mode={mode}
        onModeChange={setMode}
        onPowerChange={setPower}
        {...maxFeedProps}
      />
      {mode === 'fill' ? (
        <CutSettingsFillFields
          layer={props.layer}
          lineIntervalMm={fillLineIntervalMm}
          onLineIntervalMmChange={setFillLineIntervalMm}
        />
      ) : null}
      {mode === 'image' ? (
        <CutSettingsImageFields
          layer={props.layer}
          dither={dither}
          maxPower={power}
          imageLinesPerMm={imageLinesPerMm}
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

function positiveFiniteLimit(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? Math.max(1, value) : null;
}

function hasDefaultHandlers(
  props: CutSettingsDialogProps,
): props is CutSettingsDialogProps & CutSettingsDefaultHandlers {
  return (
    props.onMakeDefault !== undefined &&
    props.onMakeDefaultForAll !== undefined &&
    props.onResetToDefault !== undefined
  );
}

function Header({ layer }: { readonly layer: Layer }): JSX.Element {
  return (
    <header style={headerStyle}>
      {/* The swatch background is scene data (the layer color), inline by
          the ADR-047 dynamic-styles policy. */}
      <span style={{ ...swatchStyle, background: layer.color }} />
      <div>
        <h2 className="lf-dialog-title">Cut Settings</h2>
        <p className="lf-subheading">{layer.color}</p>
      </div>
    </header>
  );
}

const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const swatchStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: 3,
  border: '1px solid var(--lf-border-strong)',
};
