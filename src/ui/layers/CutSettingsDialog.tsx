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
  readonly onCancel: () => void;
  readonly onApply: (patch: LayerPatch) => void;
} & Partial<CutSettingsDefaultHandlers>;

export function CutSettingsDialog(props: CutSettingsDialogProps): JSX.Element {
  const [mode, setMode] = useState<LayerMode>(props.layer.mode);
  const [dither, setDither] = useState<Layer['ditherAlgorithm']>(props.layer.ditherAlgorithm);
  const [fillLineIntervalMm, setFillLineIntervalMm] = useState(props.layer.hatchSpacingMm);
  const [imageLinesPerMm, setImageLinesPerMm] = useState(props.layer.linesPerMm);
  const onSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    props.onApply(readCutSettingsPatch(new FormData(form), props.layer));
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
      <CutSettingsCommonFields layer={props.layer} mode={mode} onModeChange={setMode} />
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
          imageLinesPerMm={imageLinesPerMm}
          onDitherChange={setDither}
          onImageLinesPerMmChange={setImageLinesPerMm}
        />
      ) : null}
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
