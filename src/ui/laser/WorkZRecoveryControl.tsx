import { selectControllerDriver } from '../../core/controllers';
import { activeCncTool } from '../../core/scene';
import { useStore } from '../state';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import {
  isWorkZEvidenceCurrentForStart,
  type WorkZZeroEvidence,
} from '../state/work-z-zero-evidence';

export function WorkZRecoveryControl(): JSX.Element | null {
  const machine = useStore((state) => state.project.machine);
  const connection = useLaserStore((state) => state.connection.kind);
  const controllerState = useLaserStore((state) => state.statusReport?.state ?? null);
  const controllerOperation = useLaserStore((state) => state.controllerOperation);
  const activeControllerKind = useLaserStore((state) => state.activeControllerKind);
  const evidence = useLaserStore((state) => state.workZZeroEvidence);
  const workZReferenceEpoch = useLaserStore((state) => state.workZReferenceEpoch);
  const controllerSessionEpoch = useLaserStore((state) => state.controllerSessionEpoch);
  const recover = useLaserStore((state) => state.recoverWorkZFromController);
  if (machine?.kind !== 'cnc') return null;

  const tool = activeCncTool(machine);
  const commands = selectControllerDriver(activeControllerKind).commands;
  const supported = commands.modalStateQuery !== null && commands.offsetsQuery !== null;
  const currentEvidence = currentWorkZEvidenceForTool(
    evidence,
    tool.id,
    workZReferenceEpoch,
    controllerSessionEpoch,
  );
  const recovered = controllerReadbackEvidence(currentEvidence);

  if (recovered !== null) {
    return (
      <div
        className="lf-chip"
        role="status"
        aria-label="Existing controller Z zero verified"
        style={verifiedStyle}
      >
        <strong>Controller Z zero verified</strong>
        <span style={copyStyle}>
          {recovered.activeWcs} offset {formatMm(recovered.offsetZMm)} for {tool.name}.
        </span>
      </div>
    );
  }

  const canOfferReuse = canOfferControllerReuse(
    currentEvidence,
    supported,
    connection,
    controllerState,
  );
  if (!canOfferReuse) return null;

  return (
    <details style={detailsStyle} aria-label="Advanced controller setup reuse">
      <summary
        style={summaryStyle}
        title="Show the advanced option for reusing a Z zero already stored by the controller."
      >
        Advanced: Reuse existing controller setup
      </summary>
      <div style={containerStyle}>
        <span style={copyStyle}>
          Use only when the active controller offset already defines the stock top for this exact
          loaded bit. This reads the active WCS; it does not probe, move, zero, or measure anything.
        </span>
        <button
          type="button"
          className="lf-button"
          disabled={controllerOperation !== null}
          title={controllerReuseTitle(controllerOperation !== null)}
          onClick={() => void confirmAndRecover(tool.id, tool.name, recover)}
        >
          Use existing controller Z zero
        </button>
      </div>
    </details>
  );
}

function currentWorkZEvidenceForTool(
  evidence: WorkZZeroEvidence | null,
  toolId: string,
  workZReferenceEpoch: number,
  controllerSessionEpoch: number,
): WorkZZeroEvidence | null {
  if (evidence?.toolId !== toolId) return null;
  return isWorkZEvidenceCurrentForStart(evidence, workZReferenceEpoch, controllerSessionEpoch)
    ? evidence
    : null;
}

function controllerReadbackEvidence(evidence: WorkZZeroEvidence | null): WorkZZeroEvidence | null {
  return evidence?.source === 'controller-readback' ? evidence : null;
}

function canOfferControllerReuse(
  currentEvidence: WorkZZeroEvidence | null,
  supported: boolean,
  connection: string,
  controllerState: string | null,
): boolean {
  return (
    currentEvidence === null &&
    supported &&
    connection === 'connected' &&
    controllerState === 'Idle'
  );
}

function controllerReuseTitle(blocked: boolean): string {
  return blocked
    ? 'Wait for the active controller operation to finish.'
    : 'Read the active WCS and Z offset through owned, acknowledged controller queries.';
}

async function confirmAndRecover(
  toolId: string,
  toolName: string,
  recover: ReturnType<typeof useLaserStore.getState>['recoverWorkZFromController'],
): Promise<void> {
  const confirmed = jobAwareConfirm(
    `Use existing controller Z zero for ${toolName}?\n\n` +
      'Confirm the active controller WCS already defines Z0 at the stock top for this exact loaded bit, ' +
      'and KerfDesk is the only command sender. This readback does not measure the stock or cutter.',
  );
  if (!confirmed) return;
  try {
    await recover({ activeToolId: toolId, controllerOffsetRepresentsStockTop: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    jobAwareAlert(`Could not use the existing controller Z zero:\n\n${message}`);
  }
}

function formatMm(value: number | undefined): string {
  return value === undefined ? 'unknown' : `${value.toFixed(3)} mm`;
}

const containerStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  paddingTop: 8,
};

const copyStyle: React.CSSProperties = { fontSize: 11, lineHeight: 1.35 };

const detailsStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '6px 8px',
};

const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontWeight: 600 };

const verifiedStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  marginTop: 6,
  padding: '4px 6px',
};
