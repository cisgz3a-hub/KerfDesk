import { useEffect, useState } from 'react';
import {
  effectiveObjectPowerPercent,
  effectiveOperationForObject,
} from '../../core/effective-output';
import type { Layer } from '../../core/scene';
import { photoBurnSettings, type ToneCalibrationSeed } from '../calibration/tone-calibration-draft';
import { Button, Dialog, DialogActions } from '../kit';
import type { PhotoEngravingApply } from './photo-engraving-apply';
import {
  initialPhotoEngravingDraft,
  photoEngravingPatch,
  photoProcessingChoices,
  type PhotoEngravingDraft,
} from './photo-engraving-settings';
import type { PhotoEngravingPreviewResult } from './photo-engraving-preview';
import type { PhotoEngravingSession } from './photo-engraving-store';
import { autoTonesPatch, photoRecipe, photoRecipePatch } from './photo-recipes';
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
  const workbench = usePhotoWorkbench(session, props.current);
  const { draft, update, result, histogram, recipeId, materialView } = workbench;
  const effective = effectiveOperationForObject(session.operation, session.image);
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
          materialView={materialView}
          onMaterialViewChange={workbench.setMaterialView}
          colours={workbench.material ?? undefined}
          materialName={workbench.material?.surfaceName}
        />
        <PhotoEngravingFields
          image={session.image}
          draft={draft}
          storedLinesPerMm={effective.linesPerMm}
          recipeId={recipeId}
          onRecipe={workbench.chooseRecipe}
          autoTonesReady={histogram !== null}
          recipeTonesPending={workbench.tonesPending}
          onAutoTones={workbench.autoTones}
          spotSizeMm={session.device.laserSubProfile?.spotSizeMm}
          processingChoices={photoProcessingChoices(effective.ditherAlgorithm)}
          power={effectiveObjectPowerPercent(effective, session.image)}
          speed={effective.speed}
          onChange={update}
          onCalibrateTones={() =>
            props.onCalibrateTones(toneCalibrationSeed(session, effective, draft))
          }
        />
      </div>
      <PhotoEngravingGuide current={props.current} onEditSource={props.onEditSource} />
      <PhotoEngravingFooter current={props.current} error={props.error} onCancel={props.onCancel} />
    </Dialog>
  );
}

function PhotoEngravingFooter(props: {
  readonly current: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
}): JSX.Element {
  return (
    <>
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
    </>
  );
}

/** The draft, its preview and the ADR-685 recipe, Auto tones and material view state. */
function usePhotoWorkbench(session: PhotoEngravingSession, current: boolean) {
  const [draft, setDraft] = useState<PhotoEngravingDraft>(() =>
    initialPhotoEngravingDraft(session.image, session.operation),
  );
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [materialView, setMaterialView] = useState(false);
  // A recipe picked before the first preview owes its Auto tones until the
  // histogram arrives, unless the operator sets a tone first (R8-P2-3).
  const [tonesPending, setTonesPending] = useState(false);
  const result = usePhotoEngravingPreview(session, draft, current, materialView);
  const histogram = useSourceHistogram(result);
  const update = (patch: Partial<PhotoEngravingDraft>): void => {
    if (TONE_KEYS.some((key) => key in patch)) setTonesPending(false);
    setDraft((previous) => ({ ...previous, ...patch }));
  };
  useEffect(() => {
    if (!tonesPending || histogram === null) return;
    setTonesPending(false);
    const tones = autoTonesPatch(histogram);
    if (tones !== null) setDraft((previous) => ({ ...previous, ...tones }));
  }, [tonesPending, histogram]);
  const recipe = photoRecipe(recipeId);
  return {
    draft,
    update,
    result,
    histogram,
    recipeId,
    tonesPending,
    materialView,
    setMaterialView,
    /** The recipe's colours, while its marking still matches the draft's. */
    material: recipe !== null && recipe.lightMarks === draft.negativeImage ? recipe : null,
    chooseRecipe: (id: string | null): void => {
      setRecipeId(id);
      const chosen = photoRecipe(id);
      if (chosen === null) {
        setTonesPending(false);
        return;
      }
      update(photoRecipePatch(chosen, histogram));
      setTonesPending(histogram === null);
      setMaterialView(true);
    },
    autoTones: (): void => {
      const tones = autoTonesPatch(histogram);
      if (tones !== null) update(tones);
    },
  };
}

const TONE_KEYS = ['brightness', 'contrast', 'gamma'] as const;

/** ADR-685: the photo's histogram from the latest preview; the source never changes in a session. */
function useSourceHistogram(result: PhotoEngravingPreviewResult | null): Uint32Array | null {
  const [histogram, setHistogram] = useState<Uint32Array | null>(null);
  useEffect(() => {
    if (result?.sourceHistogram !== undefined) setHistogram(result.sourceHistogram);
  }, [result]);
  return histogram;
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
        More DPI can make a burn darker through overlapping marks; the On material preview shows how
        much. Blue Noise keeps the most facial detail in KerfDesk&apos;s portrait measurements, with
        Jarvis and Stucki as alternatives; test a small portrait before the full size.
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

/**
 * ADR-670: the wedge burns with the photo's settings as this window has them,
 * at the power the photo burns with (Amd 1).
 */
function toneCalibrationSeed(
  session: PhotoEngravingSession,
  effective: Layer,
  draft: PhotoEngravingDraft,
): ToneCalibrationSeed {
  return {
    sourceName: session.image.source,
    settings: {
      ...photoBurnSettings(effective, session.image),
      mode: 'image',
      ditherAlgorithm: draft.ditherAlgorithm,
      linesPerMm: draft.linesPerMm,
      negativeImage: draft.negativeImage,
      passThrough: false,
    },
  };
}
