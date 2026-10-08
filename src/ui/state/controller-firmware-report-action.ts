import {
  firmwareReportQuery,
  parseFirmwareReport,
  type ControllerFirmwareReport,
} from '../../core/controllers/controller-firmware-report';
import type { LiveRefs, LaserState } from './laser-store';
import { machineSettingsReadBlockReason } from './machine-settings-read-readiness';
import {
  controllerOperationOwner,
  interactiveControllerOperation,
} from './laser-controller-operation';
import { startControllerCommand } from './laser-interactive-command';
import type { SafeWrite } from './laser-safe-write';

type SetFn = (partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState>)) => void;

export function firmwareReportActions(
  set: SetFn,
  get: () => LaserState,
  refs: LiveRefs,
  write: SafeWrite,
): Pick<LaserState, 'readFirmwareReport'> {
  return {
    readFirmwareReport: async () => {
      const query = firmwareReportQuery(refs.driver);
      if (query === null)
        throw new Error('This controller command set has no documented firmware-report adapter.');
      const blocked = machineSettingsReadBlockReason(get(), {
        settingsCollectionActive: refs.settingsCollector.kind === 'collecting',
      });
      if (blocked !== null) throw new Error(blocked);
      const connection = refs.connection;
      const driver = refs.driver;
      const sessionEpoch = get().controllerSessionEpoch;
      const operation = interactiveControllerOperation(
        'Reading firmware report',
        'terminal-exchange',
      );
      const owns = (): boolean => {
        const current = get().controllerOperation;
        return (
          connection !== null &&
          refs.connection === connection &&
          refs.driver === driver &&
          get().controllerSessionEpoch === sessionEpoch &&
          current !== null &&
          controllerOperationOwner(current) === operation
        );
      };
      set({ controllerOperation: operation, controllerFirmwareReport: null });
      try {
        const responses = await startControllerCommand(
          refs,
          (line, action, source) =>
            write(line, action, source, () => {
              if (!owns()) throw new Error('Firmware report lost controller ownership.');
            }),
          {
            kind: 'controller-identity',
            label: 'firmware report',
            command: `${query}\n`,
            action: 'console',
            source: 'console',
          },
        );
        if (!owns()) throw new Error('Firmware report belongs to an obsolete controller session.');
        const report: ControllerFirmwareReport = {
          ...parseFirmwareReport(driver.kind, responses),
          controllerKind: driver.kind,
          query,
          sessionEpoch,
          observedAt: Date.now(),
        };
        set({ controllerFirmwareReport: report });
        return report;
      } finally {
        const current = get().controllerOperation;
        if (current !== null && controllerOperationOwner(current) === operation)
          set({ controllerOperation: null });
      }
    },
  };
}
