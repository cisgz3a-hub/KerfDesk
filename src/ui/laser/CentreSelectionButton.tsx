import { rotaryAppliesTo } from '../../core/job/rotary-job';
import { machineKindOf } from '../../core/scene';
import {
  devicePositioningLightIssue,
  isLaserDotLight,
  LASER_DOT_AUTO_OFF_MS,
  positioningLightSupported,
} from '../../core/devices/positioning-light';
import { useStore } from '../state';
import { laserDotLit, withoutLaserDotLatch } from '../state/laser-dot-light';
import { useLaserStore } from '../state/laser-store';
import { headMoveBlockMessage } from './head-move-dispatch';
import { centreSelectionLight } from './centre-selection-light';
import { openMachineSetup } from './device-setup/machine-setup-dialog-store';
import { controllerActionFailureHandler } from './report-controller-action-failure';
import type { ArtworkLightTarget } from './selected-artwork-light-targets';
import { artworkCentreBlockMessage, useArtworkLightChoice } from './artwork-centre-control-state';

export function CentreSelectionButton({
  disabled,
}: {
  readonly disabled: boolean;
}): JSX.Element | null {
  const project = useStore((state) => state.project);
  const { targets, target, chooseTarget } = useArtworkLightChoice();
  const laserMode = machineKindOf(project.machine) === 'laser';
  const needsSetup = positioningSetupNeeded(project.device);
  const fileOnly =
    project.device.controllerKind === 'ruida' || project.device.controllerKind === 'lihuiyu';
  const lightEnabled = useLaserStore((state) => state.positioningLightEnabled);
  // Centring puts the dot out before it moves, so the dot's own latch is no block.
  const machineBlocked = useLaserStore((state) =>
    headMoveBlockMessage(withoutLaserDotLatch(state)),
  );
  const placementBlocked = usePlacementBlockMessage();
  const dot = isLaserDotLight(project.device.positioningLight);
  const blocked = artworkCentreBlockMessage({
    fileOnly,
    needsSetup,
    count: targets.length,
    chosen: target !== undefined,
    rotary: rotaryAppliesTo(project.device, project.machine),
    placementBlocked,
    machineBlocked,
    disabled,
  });
  if (!positioningControlsVisible(laserMode, lightEnabled, project.device.gcodeDialect?.dialectId))
    return null;
  return (
    <div className="lf-jog-light-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {laserMode && targets.length > 1 ? (
        <ArtworkTargetChooser targets={targets} target={target} choose={chooseTarget} />
      ) : null}
      {laserMode ? <ArtworkCentreAction target={target} blocked={blocked} dot={dot} /> : null}
      {laserMode && needsSetup && !fileOnly ? (
        <button
          type="button"
          className="lf-btn"
          title="Open Machine Setup to configure the separate positioning light and its offset."
          onClick={() =>
            openMachineSetup({ kind: 'step', step: 'options', highlight: 'positioning-light' })
          }
        >
          Set up LED
        </button>
      ) : null}
      <PositioningLightControls configured={laserMode && !needsSetup && !fileOnly} dot={dot} />
    </div>
  );
}

const AUTO_OFF_S = LASER_DOT_AUTO_OFF_MS / 1000;

function ArtworkTargetChooser(props: {
  readonly targets: ReadonlyArray<ArtworkLightTarget>;
  readonly target: ArtworkLightTarget | undefined;
  readonly choose: (id: string) => void;
}): JSX.Element {
  return (
    <label style={{ display: 'grid', gap: 3, flexBasis: '100%', minWidth: 0 }}>
      Artwork to centre
      <select
        aria-label="Artwork to centre"
        title="Choose which selected artwork the LED centres on. Choosing alone does not move the head."
        value={props.target?.id ?? ''}
        onChange={(event) => props.choose(event.target.value)}
        style={{ width: '100%', minWidth: 0 }}
      >
        <option value="">Choose selected artwork…</option>
        {props.targets.map((entry, index) => (
          <option key={entry.id} value={entry.id}>
            {index + 1}. {entry.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ArtworkCentreAction(props: {
  readonly target: ArtworkLightTarget | undefined;
  readonly blocked: string | null;
  readonly dot: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className="lf-btn"
      aria-label="Artwork centre & LED"
      title={
        props.blocked ??
        (props.dot
          ? `Move with the beam off to this artwork’s centre on the board, then turn the laser on at low power so its dot shows where it will burn. Wear laser safety glasses. KerfDesk requests off after ${AUTO_OFF_S} s while the app and connection remain responsive.`
          : 'Move with the cutting beam off to this artwork’s centre on the board, then leave the separate LED on until you switch it off.')
      }
      disabled={props.blocked !== null}
      onClick={() => {
        if (props.target === undefined) return;
        void centreSelectionLight(props.target.objectIds).catch(
          controllerActionFailureHandler('Artwork centre & LED'),
        );
      }}
    >
      Artwork centre &amp; LED
    </button>
  );
}

function PositioningLightControls({
  configured,
  dot,
}: {
  readonly configured: boolean;
  readonly dot: boolean;
}): JSX.Element | null {
  const lightEnabled = useLaserStore((state) => state.positioningLightEnabled);
  // A reset or LASER OFF can put the dot out without LED off: the beam's own
  // latch says whether it may still be on.
  const lit = useLaserStore((state) => (dot ? laserDotLit(state) : state.positioningLightEnabled));
  const on = useLaserStore((state) => state.switchPositioningLightOn);
  const off = useLaserStore((state) => state.switchPositioningLightOff);
  const blocked = useLaserStore((state) => headMoveBlockMessage(withoutLaserDotLatch(state)));
  if (!lightEnabled && !configured) return null;
  const switchLight = (enabled: boolean): void => {
    void (enabled ? on() : off()).catch(
      controllerActionFailureHandler(enabled ? 'LED on' : 'LED off'),
    );
  };
  return (
    <div
      role="group"
      aria-label="Positioning LED"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}
    >
      {configured ? (
        <button
          type="button"
          className="lf-btn"
          aria-label="LED on"
          aria-pressed={lit}
          title={
            blocked ??
            (dot
              ? `Turn the laser on at low power here, without moving the head, so its dot shows where it will burn. Wear laser safety glasses. KerfDesk requests off after ${AUTO_OFF_S} s while the app and connection remain responsive.`
              : 'Switch on the separate LED here without moving the head. No timer.')
          }
          disabled={blocked !== null}
          onClick={() => switchLight(true)}
        >
          LED on
        </button>
      ) : null}
      <button
        type="button"
        className="lf-btn"
        aria-label="LED off"
        title={
          blocked ??
          (dot
            ? 'Switch the laser dot off (M5).'
            : 'Switch off the separate positioning light. Its physical state is not reported by the controller.')
        }
        disabled={blocked !== null}
        onClick={() => switchLight(false)}
      >
        LED off
      </button>
    </div>
  );
}

function usePlacementBlockMessage(): string | null {
  const absolute = useStore((state) => state.jobPlacement.startFrom === 'absolute');
  const frame = useLaserStore((state) => state.framedRun ?? state.completedFrame);
  if (frame?.candidate.authorizationContext !== undefined)
    return 'Frame the ordinary artwork job before centring this artwork.';
  return !absolute && frame == null
    ? 'Frame the job once to locate this artwork on the board, then choose Artwork centre & LED.'
    : null;
}

function positioningControlsVisible(
  laserMode: boolean,
  enabled: boolean,
  dialect: string | undefined,
): boolean {
  return positioningLightSupported(dialect) && (laserMode || enabled);
}

function positioningSetupNeeded(
  device: ReturnType<typeof useStore.getState>['project']['device'],
): boolean {
  return device.positioningLight === undefined || devicePositioningLightIssue(device) !== null;
}
