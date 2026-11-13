import {
  describeBurn,
  photoTestMismatches,
  usePhotoTestLibrary,
  type PhotoTestResult,
} from '../calibration/photo-test-library';
import { Button } from '../kit';
import type { PhotoEngravingDraft, TestedBurn } from './photo-engraving-settings';

const KEEP = 'keep';

/**
 * ADR-711: burn the photo with the power and speed picked from a Photo Test
 * Card, or make a card from this photo. Until one is chosen the photo keeps
 * its operation's own power and speed.
 */
export function PhotoTestedBurnField(props: {
  readonly draft: PhotoEngravingDraft;
  /** The power and speed the photo burns with now, kept when nothing is chosen. */
  readonly operationPower: number;
  readonly operationSpeed: number;
  readonly onChange: (patch: Partial<PhotoEngravingDraft>) => void;
  readonly onBurnTestCard: () => void;
}): JSX.Element {
  const results = usePhotoTestLibrary((state) => state.results);
  const { draft } = props;
  const chosen = resultFor(results, draft.testedBurn);
  const mismatches =
    chosen === undefined
      ? []
      : photoTestMismatches(chosen.processing, {
          ditherAlgorithm: draft.ditherAlgorithm,
          linesPerMm: draft.linesPerMm,
          negativeImage: draft.negativeImage,
        });
  return (
    <>
      <h3>Power and speed</h3>
      <label>
        <span>Tested power and speed</span>
        <select
          className="lf-select"
          aria-label="Tested power and speed"
          title="Burn this photo with the power and speed you picked from a burned test card."
          value={chosen?.id ?? KEEP}
          onChange={(event) => props.onChange({ testedBurn: burnFor(results, event.target.value) })}
        >
          <option value={KEEP}>
            Keep the current ({describeBurn(props.operationPower, props.operationSpeed)})
          </option>
          {results.map((result) => (
            <option key={result.id} value={result.id}>
              {result.label}
            </option>
          ))}
        </select>
      </label>
      <p className="lf-photo-engraving__hint">
        {chosen === undefined
          ? 'Not sure which power and speed suit this material? Burn a small test card made from this photo, then pick the square that looks best. Burn a test card applies the settings in this window first.'
          : 'Apply sets this power and speed for this photo only, at exactly the tested power.'}
      </p>
      {mismatches.length > 0 ? (
        <p className="lf-photo-engraving__hint" role="status">
          That card was burned with a different {mismatches.join(', ')}. Burn a new card with these
          settings to be sure.
        </p>
      ) : null}
      <Button
        variant="ghost"
        onClick={props.onBurnTestCard}
        title="Apply these settings to the photo, close this window and make a test card from it."
      >
        Burn a test card…
      </Button>
    </>
  );
}

function burnFor(results: ReadonlyArray<PhotoTestResult>, id: string): TestedBurn | undefined {
  const result = results.find((candidate) => candidate.id === id);
  return result === undefined ? undefined : { power: result.power, speed: result.speed };
}

function resultFor(
  results: ReadonlyArray<PhotoTestResult>,
  burn: TestedBurn | undefined,
): PhotoTestResult | undefined {
  return burn === undefined
    ? undefined
    : results.find((result) => result.power === burn.power && result.speed === burn.speed);
}
