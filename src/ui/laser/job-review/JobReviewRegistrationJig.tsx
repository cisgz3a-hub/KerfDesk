import { Button } from '../../kit';
import { useStore } from '../../state';
import { useToastStore } from '../../state/toast-store';
import type { RegistrationJigReviewOutput } from './job-review-registration-jig';
import { useJobReviewStore } from './job-review-store';
import { sectionHeadingStyle, sectionStyle } from './job-review.styles';

export function JobReviewRegistrationJig(props: {
  readonly output: RegistrationJigReviewOutput | null | undefined;
  /** Selected-only or selection-origin runs never switch to Artwork only. */
  readonly wholeOutput?: boolean | undefined;
  readonly isPreparing: boolean;
}): JSX.Element | null {
  const chooseOutput = (scope: 'box' | 'artwork'): void => {
    // Cancel the pending Start before changing output. The newly selected job
    // needs its own review; coordinate changes require Frame under ADR-565.
    useJobReviewStore.getState().cancel();
    useStore.getState().setRegistrationOutput(scope);
    useToastStore
      .getState()
      .pushToast(
        `${scope === 'box' ? 'Outline' : 'Artwork'} selected. Check placement and Frame if the footprint changed, then press Start to review it.`,
        'info',
      );
  };
  if (props.output == null) return null;
  return (
    <section
      aria-label="Registration jig burn sequence"
      className="lf-banner lf-banner--info"
      style={sectionStyle}
    >
      <h3 style={sectionHeadingStyle}>Registration jig · What are you burning?</h3>
      <strong>
        {props.output === 'box'
          ? 'This job burns the outline only'
          : props.output === 'artwork'
            ? 'This job burns the artwork only'
            : 'This job burns BOTH the outline and artwork'}
      </strong>
      <ol style={{ margin: '8px 0', paddingLeft: 20 }}>
        <li>Burn the outline on the jig base before placing the piece.</li>
        <li>
          Place the piece inside the burned outline. Keep its X/Y placement and the work origin
          unchanged.
        </li>
        <li>Set the laser focus to the top surface of the piece, then burn the artwork.</li>
      </ol>
      {props.output === 'box' && props.wholeOutput === true && (
        <p style={{ margin: '8px 0' }}>
          After a successful complete outline run, Artwork only is selected automatically.
        </p>
      )}
      {props.output !== 'box' && (
        <p style={{ margin: '8px 0' }}>
          <strong>Check artwork focus height.</strong> The piece sits above the outline surface.
          Adjust focus for its top surface using your machine’s normal procedure. This selection
          does not change focus or move Z automatically.
        </p>
      )}
      {props.output === 'mixed' && (
        <p>Choose one output to avoid burning the outline over the piece.</p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {props.output !== 'box' && (
          <Button disabled={props.isPreparing} onClick={() => chooseOutput('box')}>
            Switch to Outline only
          </Button>
        )}
        {props.output !== 'artwork' && (
          <Button disabled={props.isPreparing} onClick={() => chooseOutput('artwork')}>
            Switch to Artwork only
          </Button>
        )}
      </div>
      <p style={{ margin: '8px 0 0' }}>
        Switching output closes this review. Frame again if the footprint or placement changes.
      </p>
    </section>
  );
}

export function registrationJigConfirmLabel(
  output: RegistrationJigReviewOutput | null | undefined,
  purpose: string,
  fallback: string,
): string {
  if (purpose !== 'start') return fallback;
  if (output === 'box') return 'Start outline';
  return output === 'artwork' ? 'Start artwork' : fallback;
}
