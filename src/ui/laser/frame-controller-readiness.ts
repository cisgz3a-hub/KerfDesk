import { useLaserStore } from '../state/laser-store';
import { hasPendingControllerWrite } from '../state/laser-start-queue-fence';
import { waitForFreshIdleFramePosition } from './frame-position-readiness';

const FRAME_QUEUE_SETTLE_TIMEOUT_MS = 1_500;
const FRAME_QUEUE_POLL_MS = 25;
const FRAME_QUEUE_BUSY_MESSAGE =
  'The controller is still finishing a previous command. Wait for its acknowledgement, then Frame again.';

export type FrameWcsNormalization =
  | { readonly ok: true; readonly warning?: string }
  | {
      readonly ok: false;
      readonly messages: ReadonlyArray<string>;
      readonly warning?: string;
    };

/** Wait until no earlier owned or untracked write can cross Frame preparation. */
export async function frameControllerQueueIssue(): Promise<string | null> {
  const deadline = Date.now() + FRAME_QUEUE_SETTLE_TIMEOUT_MS;
  while (hasPendingControllerWrite(useLaserStore.getState())) {
    if (Date.now() > deadline) return FRAME_QUEUE_BUSY_MESSAGE;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, FRAME_QUEUE_POLL_MS);
    });
  }
  return null;
}

/** Select the emitted G54 frame and retain disclosure of any named WCS change. */
export async function normalizeFrameWorkCoordinateSystem(): Promise<FrameWcsNormalization> {
  const before = useLaserStore.getState();
  const originalActiveWcs = before.activeWcs;
  if (before.capabilities.transport !== 'serial' || originalActiveWcs === 'G54') {
    return { ok: true };
  }
  const warning = knownWcsNormalizationWarning(originalActiveWcs);
  try {
    await before.selectPrimaryWcsForFrame();
  } catch (error) {
    return normalizationFailure(
      [
        `Frame could not select the program's G54 coordinate system: ${error instanceof Error ? error.message : String(error)}`,
      ],
      undefined,
    );
  }
  const queueIssue = await frameControllerQueueIssue();
  if (queueIssue !== null) return normalizationFailure([queueIssue], warning);
  const afterSelectionSequence = useLaserStore.getState().statusSequence;
  if (!(await waitForFreshIdleFramePosition(afterSelectionSequence))) {
    return normalizationFailure(
      [
        'G54 was selected, but the controller did not report a fresh Idle position in that coordinate system. Wait for a complete status report, then Frame again.',
      ],
      warning,
    );
  }
  if (useLaserStore.getState().activeWcs !== 'G54') {
    return normalizationFailure(
      [
        'The controller did not confirm the G54 coordinate system required by the prepared program.',
      ],
      warning,
    );
  }
  return warning === undefined ? { ok: true } : { ok: true, warning };
}

function knownWcsNormalizationWarning(
  originalActiveWcs: ReturnType<typeof useLaserStore.getState>['activeWcs'],
): string | undefined {
  if (originalActiveWcs === null || originalActiveWcs === 'G54') return undefined;
  return (
    `Controller was using ${originalActiveWcs}. KerfDesk selected G54 because both this physical ` +
    `Frame and the reviewed program run in G54. Your ${originalActiveWcs} offset was not erased, ` +
    'and neither was any other G54-G59 offset. If you cancel, G54 remains selected.'
  );
}

function normalizationFailure(
  messages: ReadonlyArray<string>,
  warning: string | undefined,
): FrameWcsNormalization {
  return warning === undefined ? { ok: false, messages } : { ok: false, messages, warning };
}
