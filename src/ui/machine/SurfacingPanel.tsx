import { SurfacingFields, useSurfacingValues } from './SurfacingFields';
// SurfacingPanel — spoilboard facing wizard (ADR-103 G8, F-CNC25). Collects
// the area + cut numbers, generates the serpentine program in pure core, and
// saves it as a standalone .nc file. Defaults prefill from the machine's
// stock footprint and active bit.

import type { CncMachineConfig } from '../../core/scene';
import { usePlatform } from '../app/platform-context';
import { RailSection } from '../kit';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { useToastStore } from '../state/toast-store';
import { useSurfacingSave } from './use-surfacing-save';

export function SurfacingPanel(props: { readonly machine: CncMachineConfig }): JSX.Element {
  const platform = usePlatform();
  const pushToast = useToastStore((s) => s.pushToast);
  const project = useStore((s) => s.project);
  const projectDocumentEpoch = useStore((s) => s.projectDocumentEpoch);
  const controllerSettings = useLaserStore((s) => s.controllerSettings);
  const settingsCapability = useLaserStore((s) => s.capabilities.settings);
  const { machine } = props;
  const values = useSurfacingValues(machine, project, projectDocumentEpoch);

  const { save, cancel, phase } = useSurfacingSave(
    {
      platform,
      pushToast,
      project,
      machine,
      controllerSettings,
      settingsCapability,
      inputs: values.inputs,
    },
    projectDocumentEpoch,
  );

  return (
    <RailSection
      label="Surface spoilboard"
      hint="Generate a serpentine facing program to flatten the spoilboard or stock top."
    >
      <SurfacingFields values={values} machine={machine} />
      <button
        type="button"
        onClick={save}
        title="Generate the facing G-code with the active bit and save it as a standalone .nc file."
      >
        Save surfacing G-code…
      </button>
      {phase !== null && (
        <div role="status">
          {phase === 'preparing'
            ? 'Checking surfacing program… '
            : phase === 'writing'
              ? 'Writing surfacing program… '
              : 'Finishing surfacing save… '}
          {phase !== 'finalizing' && (
            <button type="button" onClick={cancel} title={cancelSaveTitle}>
              Cancel surfacing save
            </button>
          )}
        </div>
      )}
    </RailSection>
  );
}

const cancelSaveTitle =
  'Stop preparing the surfacing program or discard its uncommitted file bytes.';
