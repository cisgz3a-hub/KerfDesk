// Settings → Machine & materials. Machine and material settings belong to the
// machine profile and the material library, not to the app, so this section
// holds no copies: each button closes Settings and opens the place they live.
// Laser and CNC keep their own homes (ADR-101): CNC gets its bit library and
// its Recipes tab instead of laser Materials.

import type { MachineKind } from '../../core/scene';
import { openMachineSetup } from '../laser/device-setup/machine-setup-dialog-store';
import { Button } from '../kit';
import { useUiStore } from '../state/ui-store';
import {
  settingsGroupStyle,
  settingsHeadingStyle,
  settingsLinkRowStyle,
  settingsNoteStyle,
} from './settings-styles';

type SettingsLink = {
  readonly key: string;
  readonly heading: string;
  readonly detail: string;
  readonly button: string;
  readonly title: string;
  readonly open: () => void;
};

export function SettingsMachineSection(props: {
  readonly machineKind: MachineKind;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <>
      {settingsLinks(props.machineKind).map((link) => (
        <section key={link.key} style={settingsGroupStyle}>
          <h3 style={settingsHeadingStyle}>{link.heading}</h3>
          <div style={settingsLinkRowStyle}>
            <p style={settingsNoteStyle}>{link.detail}</p>
            <Button
              title={link.title}
              onClick={() => {
                props.onClose();
                link.open();
              }}
            >
              {link.button}
            </Button>
          </div>
        </section>
      ))}
    </>
  );
}

export function settingsLinks(machineKind: MachineKind): ReadonlyArray<SettingsLink> {
  const machine: SettingsLink = {
    key: 'machine-setup',
    heading: 'Machine',
    detail:
      'Bed size, origin, homing, the controller and machine options are part of the machine profile.',
    button: 'Open Machine Setup...',
    title: 'Close Settings and open Machine Setup',
    open: () => openMachineSetup(),
  };
  if (machineKind === 'cnc') {
    return [
      machine,
      {
        key: 'bit-library',
        heading: 'Bits',
        detail: 'Your router bits are kept in the bit library in Machine Setup.',
        button: 'Open Bit Library...',
        title: 'Close Settings and open the bit library in Machine Setup',
        open: () => openMachineSetup({ kind: 'cnc', field: 'bit-library' }),
      },
      materialsLink(
        'Recipes',
        'Saved cutting recipes are in the Recipes tab of the Artwork panel.',
      ),
    ];
  }
  return [
    machine,
    materialsLink(
      'Materials',
      'Material libraries and their saved cut settings are in the Materials tab of the Artwork panel.',
    ),
  ];
}

function materialsLink(tab: 'Materials' | 'Recipes', detail: string): SettingsLink {
  return {
    key: 'materials',
    heading: tab,
    detail,
    button: `Show ${tab}`,
    title: `Close Settings and show the ${tab} tab of the Artwork panel`,
    open: () => {
      const ui = useUiStore.getState();
      ui.setCutsLayersView('materials');
      ui.focusRailPanel('layers');
    },
  };
}
