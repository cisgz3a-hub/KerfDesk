import { selectControllerDriver } from '../../core/controllers';
import { activeCncTool } from '../../core/scene';
import { useStore } from '../state';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';

export function WorkZRecoveryControl(): JSX.Element | null {
  const machine = useStore((state) => state.project.machine);
  const connection = useLaserStore((state) => state.connection.kind);
  const controllerState = useLaserStore((state) => state.statusReport?.state ?? null);
  const controllerOperation = useLaserStore((state) => state.controllerOperation);
  const activeControllerKind = useLaserStore((state) => state.activeControllerKind);
  const evidence = useLaserStore((state) => state.workZZeroEvidence);
  const recover = useLaserStore((state) => state.recoverWorkZFromController);
  if (machine?.kind !== 'cnc') return null;

  const tool = activeCncTool(machine);
  const commands = selectControllerDriver(activeControllerKind).commands;
  const supported = commands.modalStateQuery !== null && commands.offsetsQuery !== null;
  const disabled =
    !supported ||
    connection !== 'connected' ||
    controllerState !== 'Idle' ||
    controllerOperation !== null;
  const recovered = evidence?.source === 'controller-readback' ? evidence : null;

  return (
    <div className="lf-chip" style={containerStyle} aria-label="Controller Work-Z recovery">
      <strong>Existing controller Work Z</strong>
      <span style={copyStyle}>
        Use only when the controller already retains stock-top Z0 for the loaded bit. This reads the
        active WCS; it does not touch or measure the stock.
      </span>
      <button
        type="button"
        className="lf-button"
        disabled={disabled}
        title={recoveryTitle(supported, connection, controllerState)}
        onClick={() => void confirmAndRecover(tool.id, tool.name, recover)}
      >
        Read &amp; recover Work Z
      </button>
      {recovered !== null ? (
        <span role="status" style={copyStyle}>
          Recovered {recovered.activeWcs} Z offset {formatMm(recovered.offsetZMm)} for {tool.name}.
        </span>
      ) : null}
    </div>
  );
}

async function confirmAndRecover(
  toolId: string,
  toolName: string,
  recover: ReturnType<typeof useLaserStore.getState>['recoverWorkZFromController'],
): Promise<void> {
  const confirmed = jobAwareConfirm(
    `Recover controller Work Z for ${toolName}?\n\n` +
      'Confirm the active controller WCS already defines Z0 at the stock top for this exact loaded bit, ' +
      'and KerfDesk is the only command sender. This readback does not measure the stock or cutter.',
  );
  if (!confirmed) return;
  try {
    await recover({ activeToolId: toolId, controllerOffsetRepresentsStockTop: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    jobAwareAlert(`Could not recover Work Z:\n\n${message}`);
  }
}

function recoveryTitle(
  supported: boolean,
  connection: string,
  controllerState: string | null,
): string {
  if (!supported) return 'The active controller cannot provide owned modal/WCS readback.';
  if (connection !== 'connected') return 'Connect to the CNC controller first.';
  if (controllerState !== 'Idle') return 'Wait for a fresh Idle report before reading Work Z.';
  return 'Read the active WCS and its Z offset through owned, acknowledged controller queries.';
}

function formatMm(value: number | undefined): string {
  return value === undefined ? 'unknown' : `${value.toFixed(3)} mm`;
}

const containerStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  marginTop: 6,
  padding: 8,
};

const copyStyle: React.CSSProperties = { fontSize: 11, lineHeight: 1.35 };
