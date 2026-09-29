// Help > Save Support Report (ADR-546): gathers what support needs from this
// window, and the desktop app's log, into a text file the customer saves and
// sends themselves. Nothing is uploaded.

import { machineKindOf } from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { activeEdition } from '../licensing/edition';
import { useStore } from '../state';
import type { ControllerQualification } from '../state/laser-controller-qualification';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { useToastStore } from '../state/toast-store';
import { recentRendererProblems } from './renderer-problems';
import {
  describeEdition,
  formatSupportReport,
  machineReportLines,
  type DesktopLogFact,
  type MachineReportInput,
  type SupportReportFacts,
} from './support-report';

const CONSOLE_LINES = 100;

/** Asks where to save first, while the menu click still counts as the user's gesture. */
export async function saveSupportReport(
  platform: PlatformAdapter,
  now: () => Date = () => new Date(),
): Promise<void> {
  const savedAt = now();
  const { pushToast } = useToastStore.getState();
  let target: SaveTarget | null;
  try {
    target = await platform.pickFileForSave({
      suggestedName: `kerfdesk-support-report-${fileStamp(savedAt)}.txt`,
      extensions: ['.txt'],
    });
  } catch (error) {
    pushToast(`Could not save the support report: ${errorText(error)}`, 'error');
    return;
  }
  if (target === null) return;
  try {
    await target.write(formatSupportReport(await gatherSupportReportFacts(platform, savedAt)));
    pushToast(
      `Saved ${target.displayName}. Read it, then email it to support@kerfdesk.com.`,
      'success',
    );
  } catch (error) {
    pushToast(`Could not save the support report: ${errorText(error)}`, 'error');
  }
}

export async function gatherSupportReportFacts(
  platform: PlatformAdapter,
  savedAt: Date,
): Promise<SupportReportFacts> {
  const { project } = useStore.getState();
  const laser = useLaserStore.getState();
  return {
    savedAt,
    build: { version: __APP_VERSION__, commit: __GIT_SHA__, builtAt: __BUILD_TIME__ },
    app: platform.id,
    edition: describeEdition(activeEdition()),
    system: systemFacts(),
    machine: machineReportLines(
      machineInput(project.device, machineKindOf(project.machine), laser),
    ),
    machineSettings: {
      readAt: laser.lastSettingsReadAt,
      lines: laser.grblSettingsRows.map((row) => `${row.code}=${row.rawValue}`),
    },
    machineConsole: laser.log.slice(-CONSOLE_LINES),
    problems: recentRendererProblems(),
    desktopLog: await readDesktopLog(platform),
  };
}

function machineInput(
  device: MachineReportInput['device'],
  machineKind: MachineReportInput['machineKind'],
  laser: LaserState,
): MachineReportInput {
  const status = laser.statusReport;
  return {
    device,
    machineKind,
    connection: laser.connection,
    usb: laser.serialPortInfo ?? null,
    detectedController: laser.detectedControllerKind,
    qualification: qualificationText(laser.controllerQualification),
    state: status?.state ?? null,
    alarmCode: laser.alarmCode,
    lastError: laser.lastError,
    resetRequired: laser.resetRequired === true,
    machinePosition: status?.mPos ?? null,
    workPosition: status?.wPos ?? null,
    workOrigin: laser.workOriginActive ? `set (${laser.workOriginSource})` : 'not set',
    homing: laser.homingState,
    jobRunning: isActiveJob(laser.streamer),
    firmwareLines: laser.controllerBuildInfoRawLines,
  };
}

function qualificationText(qualification: ControllerQualification): string {
  switch (qualification.kind) {
    case 'disconnected':
      return 'not checked';
    case 'qualifying':
      return `being checked (${qualification.phase})`;
    case 'qualified':
      return `ready (settings ${qualification.settings})`;
    case 'failed':
      return `check failed: ${qualification.message}`;
  }
}

function systemFacts(): SupportReportFacts['system'] {
  const scale = Math.round(window.devicePixelRatio * 100);
  return {
    userAgent: navigator.userAgent,
    languages: navigator.languages.length > 0 ? navigator.languages : [navigator.language],
    screen: `${window.screen.width} × ${window.screen.height} at ${scale}% scale, window ${window.innerWidth} × ${window.innerHeight}`,
    online: navigator.onLine,
  };
}

async function readDesktopLog(platform: PlatformAdapter): Promise<DesktopLogFact> {
  if (platform.readSupportLog === undefined) return { kind: 'none' };
  try {
    return { kind: 'read', text: await platform.readSupportLog() };
  } catch (error) {
    return { kind: 'failed', message: errorText(error) };
  }
}

function fileStamp(date: Date): string {
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
