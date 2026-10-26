import { useState } from 'react';
import { effectiveOperationForObject } from '../../core/effective-output';
import { captureLayerOperationSettings, type Layer } from '../../core/scene';
import type { ToneCalibrationSeed } from '../calibration/tone-calibration-draft';
import { Button, Dialog, DialogActions } from '../kit';
import type { PhotoEngravingApply } from './photo-engraving-apply';
import {
  initialPhotoEngravingDraft,
  photoEngravingPatch,
  type PhotoEngravingDraft,
} from './photo-engraving-settings';
import type { PhotoEngravingSession } from './photo-engraving-store';
import { PhotoEngravingFields } from './PhotoEngravingFields';
import { PhotoEngravingPreview } from './PhotoEngravingPreview';
import { usePhotoEngravingPreview } from './use-photo-engraving-preview';
import './photo-engraving.css';

export default function PhotoEngravingDialog(props: {
  readonly session: PhotoEngravingSession;
  readonly current: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onApply: (patch: PhotoEngravingApply) => void;
  readonly onEditSource: () => void;
  readonly onCalibrateTones: (seed: ToneCalibrationSeed) => void;
}): JSX.Element {
  const { session } = props;
  const [draft, setDraft] = useState<PhotoEngravingDraft>(() =>
    initialPhotoEngravingDraft(session.image, session.operation),
  );
  const result = usePhotoEngravingPreview(session, draft, props.current);
  const effective = effectiveOperationForObject(session.operation, session.image);
  const update = (patch: Partial<PhotoEngravingDraft>): void =>
    setDraft((previous) => ({ ...previous, ...patch }));
  return (
    <Dialog
      title="Photo engraving"
      onClose={props.onCancel}
      size="xl"
      panelClassName="lf-photo-engraving"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (props.current) props.onApply(photoEngravingPatch(draft));
      }}
    >
      <p className="lf-photo-engraving__intro">
        Turn portraits into fine laser dots that preserve highlights, midtones and shadows.
      </p>
      <p className="lf-photo-engraving__filename" title={session.image.source}>
        {session.image.source}
      </p>
      <PhotoOperationHint session={session} />
      <div className="lf-photo-engraving__layout">
        <PhotoEngravingPreview
          image={session.image}
          device={session.device}
          result={result}
          negativeImage={draft.negativeImage}
          current={props.current}
        />
        <PhotoEngravingFields
          image={session.image}
          draft={draft}
          storedLinesPerMm={effective.linesPerMm}
          power={effective.power}
          speed={effective.speed}
          onChange={update}
          onCalibrateTones={() =>
            props.onCalibrateTones(toneCalibrationSeed(session, effective, draft))
          }
        />
      </div>
      <PhotoEngravingGuide current={props.current} onEditSource={props.onEditSource} />
      <p className="lf-photo-engraving__hint">
        Applies an Image operation to this photo. Power and speed use its current operation
        settings. Review the job, then Frame and Start when ready.
      </p>
      {!props.current || props.error !== null ? (
        <p role="alert">
          {props.error ??
            'The photo, selection or operation changed. Close this window and open Photo engraving again.'}
        </p>
      ) : null}
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!props.current}>
          Apply photo settings
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PhotoOperationHint({ session }: { readonly session: PhotoEngravingSession }): JSX.Element {
  return (
    <p className="lf-photo-engraving__hint lf-photo-engraving__operation">
      <strong>Operation: {session.operation.name}.</strong>{' '}
      {session.operation.output
        ? 'The preview and engraving settings apply to this operation for the selected photo.'
        : 'Output is off for this operation. These settings will engrave when you enable its output.'}
    </p>
  );
}

function PhotoEngravingGuide(props: {
  readonly current: boolean;
  readonly onEditSource: () => void;
}): JSX.Element {
  return (
    <details className="lf-photo-engraving__guide">
      <summary title="Show how to prepare a portrait and test its material settings.">
        Prepare a clear portrait on your material
      </summary>
      <ol>
        <li>
          Use a sharp photo with visible detail in the eyes and hair. Set its engraving size on the
          canvas first.
        </li>
        <li>
          Focus the laser, then use Tools → Material Test to choose power and speed for the
          material. Use Tools → Interval Test to find spacing where marks just meet.
        </li>
        <li>
          Burn a Tools → Tone Calibration wedge with these settings and record it, then choose that
          material tone calibration here. It corrects how much darker the material burns.
        </li>
        <li>
          Choose dark or light marks to match the material. Adjust midtones first, then brightness
          and contrast.
        </li>
        <li>
          For cropping, background cleanup, Levels, Curves or Unsharp Mask, open Image Studio below,
          then return here.
        </li>
      </ol>
      <p>
        More DPI can make a burn darker through overlapping marks. Jarvis and Stucki are starting
        options; test a small portrait before the full size.
      </p>
      <p>For a lined illustration instead, use Trace Image → Photo shading.</p>
      <Button
        onClick={props.onEditSource}
        disabled={!props.current}
        title="Close this preview without applying its adjustments and edit the source photo."
      >
        Edit source in Image Studio…
      </Button>
    </details>
  );
}

/** ADR-670: the wedge burns with the photo's settings as this window has them. */
function toneCalibrationSeed(
  session: PhotoEngravingSession,
  effective: Layer,
  draft: PhotoEngravingDraft,
): ToneCalibrationSeed {
  return {
    sourceName: session.image.source,
    settings: {
      ...captureLayerOperationSettings(effective),
      mode: 'image',
      ditherAlgorithm: draft.ditherAlgorithm,
      linesPerMm: draft.linesPerMm,
      negativeImage: draft.negativeImage,
      passThrough: false,
    },
  };
}
