import { machineKindOf, type Project } from '../../core/scene';
import { openedMachineNoticeWords } from '../app/opened-machine-notice-words';
import { sameMachineSetup } from '../state/job-machine-lock';
import type { AppState } from '../state/store';
import { safeLabel } from './projections';

/**
 * ADR-584 Amendment 1 (rolling audit v5 J7-P2-1). A remote Undo or Redo runs the PC's own step,
 * machine steps included: undoing Keep current machine brings back the opened file's machine and
 * the PC's notice about it (ADR-440 Amendment 6), and the phone's Frame and Start then use that
 * machine. The notice is on the PC only, so the receipt says what changed, as an import receipt
 * carries the PC's toasts (ADR-125 Amendment 2).
 */
const MAX_NOTICE_LENGTH = 2048;

/** Receipt fields for an Undo or Redo that changed the machine setup; none when it did not. */
export function historyMachineNoticeFields(
  before: AppState,
  after: AppState,
  action: 'undo' | 'redo',
): Record<string, unknown> {
  if (sameMachineSetup(before.project, after.project)) return {};
  const step = action === 'undo' ? 'Undo' : 'Redo';
  const plain = changedWords(step, before, after, false);
  const message = safeLabel(machineMessage(step, before, after), plain, MAX_NOTICE_LENGTH);
  return { notices: [{ level: 'warning', message }] };
}

function machineMessage(step: string, before: AppState, after: AppState): string {
  const notice = after.projectBedReconciliation;
  if (notice === null || notice === before.projectBedReconciliation) {
    return changedWords(step, before, after, true);
  }
  return (
    `${step} brought back the opened file's machine, and the PC asks again which machine to use. ` +
    "Until that is answered on the PC, Frame and Start use the file's machine. The PC says:" +
    openedMachineNoticeWords(notice)
  );
}

function changedWords(step: string, before: AppState, after: AppState, named: boolean): string {
  const closed =
    before.projectBedReconciliation !== null && after.projectBedReconciliation === null
      ? " and closed the PC's question about the opened file's machine"
      : '';
  return (
    `${step} changed the machine setup that Frame and Start use, to ${machineSummary(after.project, named)}` +
    `${closed}. Check it on the PC before you Frame.`
  );
}

function machineSummary(project: Project, named: boolean): string {
  const { device } = project;
  const kind = machineKindOf(project.machine) === 'cnc' ? 'CNC' : 'Laser';
  const name = named && device.name !== '' ? `“${device.name}”, ` : '';
  return `${name}${kind} with a ${device.bedWidth} × ${device.bedHeight} mm bed`;
}
