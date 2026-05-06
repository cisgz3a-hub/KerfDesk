import React from 'react';
import { WelcomeWizard, type WizardResult } from './WelcomeWizard';
import { type MachineOriginCorner } from '../../core/devices/DeviceProfile';

export interface AppRecoverySetupProps {
  showRecover: boolean;
  showSetup: boolean;
  recoverAutosaveTimeLabel: string | null;
  onRecover: () => void;
  onDismissRecover: () => void;
  onWizardComplete: (result: WizardResult) => void;
  onWizardSkip: () => void;
  initialBedWidth: number;
  initialBedHeight: number;
  initialMaterialType?: string;
  initialMaterialName?: string;
  initialMaterialColor?: string;
  initialMaterialWidth?: number;
  initialMaterialHeight?: number;
  initialMaterialThickness?: number;
  initialMachineName?: string;
  initialMachineWatts?: string;
  initialMachineType?: string;
  initialOriginCorner?: MachineOriginCorner;
  initialHomingEnabled?: boolean;
  initialMaxSpindle?: number;
}

export function AppRecoverySetup(props: AppRecoverySetupProps): React.ReactElement | null {
  return React.createElement(React.Fragment, null,
    props.showRecover && !props.showSetup && React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 12, padding: '6px 16px',
        background: 'rgba(0, 212, 255, 0.06)',
        borderBottom: '1px solid rgba(0, 212, 255, 0.15)',
        fontFamily: "'DM Sans', system-ui, sans-serif",
        fontSize: 11,
      },
    },
      React.createElement('span', { style: { color: '#8888aa' } },
        `Unsaved work found from ${props.recoverAutosaveTimeLabel ?? 'previous session'}`,
      ),
      React.createElement('button', {
        onClick: props.onRecover,
        style: {
          padding: '3px 12px', background: 'rgba(0, 212, 255, 0.1)',
          border: '1px solid #00d4ff', borderRadius: 4,
          color: '#00d4ff', fontSize: 10, cursor: 'pointer',
          fontFamily: "'DM Sans', system-ui, sans-serif", fontWeight: 500,
        },
      }, 'Recover'),
      React.createElement('button', {
        onClick: props.onDismissRecover,
        style: {
          padding: '3px 12px', background: 'transparent',
          border: '1px solid #252540', borderRadius: 4,
          color: '#555570', fontSize: 10, cursor: 'pointer',
          fontFamily: "'DM Sans', system-ui, sans-serif",
        },
      }, 'Dismiss'),
    ),

    props.showSetup && React.createElement(WelcomeWizard, {
      onComplete: props.onWizardComplete,
      onSkip: props.onWizardSkip,
      initialBedWidth: props.initialBedWidth,
      initialBedHeight: props.initialBedHeight,
      initialMaterialType: props.initialMaterialType,
      initialMaterialName: props.initialMaterialName,
      initialMaterialColor: props.initialMaterialColor,
      initialMaterialWidth: props.initialMaterialWidth,
      initialMaterialHeight: props.initialMaterialHeight,
      initialMaterialThickness: props.initialMaterialThickness,
      initialMachineName: props.initialMachineName,
      initialMachineWatts: props.initialMachineWatts,
      initialMachineType: props.initialMachineType,
      initialOriginCorner: props.initialOriginCorner,
      initialHomingEnabled: props.initialHomingEnabled,
      initialMaxSpindle: props.initialMaxSpindle,
    }),
  );
}
