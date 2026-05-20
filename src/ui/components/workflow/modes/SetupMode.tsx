/**
 * T1-207 (Phase 3): top-level Setup mode for the WorkflowPanel.
 *
 * Renders the TabBar + the active tab body. Tab state is persisted
 * to localStorage via `setupTabPersistence` so the user isn't
 * bounced to "Move" on every reload.
 *
 * The tab bodies (`MoveTab`, `JobTab`, `ConsoleTab`) each reuse an
 * existing legacy-panel component (`Jog`, `DeviceProfileSelector`,
 * `ConsolePanel`) so the safety surface stays shared between the
 * old and new panels during the rollout.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { TabBar } from './setup/TabBar';
import { MoveTab } from './setup/MoveTab';
import { JobTab } from './setup/JobTab';
import { ConsoleTab } from './setup/ConsoleTab';
import { ALL_SETUP_TABS, readSetupTab, writeSetupTab, type SetupTab } from './setup/setupTabPersistence';
import type { DeviceProfile } from '../../../../core/devices/DeviceProfile';
import type { LaserController } from '../../../../controllers/ControllerInterface';
import type { StructuredLogEvent } from '../../../../app/StructuredMessageLog';

/**
 * Setup-mode props bundled. The adapter builds this once with all
 * the wirings; the SetupMode component owns the active-tab
 * selection. Bundling keeps `WorkflowPanelProps` from growing
 * another ~15 fields.
 */
export interface SetupModeProps {
  // Move tab
  readonly jogStep: number;
  readonly setJogStep: (step: number) => void;
  readonly onJog: (axis: 'X' | 'Y', distance: number) => void;
  readonly onHome: () => void;
  readonly canHome: boolean;
  readonly canGoToLastPosition?: boolean;
  readonly lastPositionLabel?: string;
  readonly onGoToLastPosition?: () => void;
  readonly showFocus?: boolean;
  readonly canFocus?: boolean;
  readonly focusBusy?: boolean;
  readonly onFocus?: () => void;
  // T1-211: frame controls. Wired through to executionCoordinator
  // by the adapter. `canFrame` is the gate; null callbacks render
  // the buttons disabled.
  readonly canFrame: boolean;
  readonly onFrameSafe: (() => void) | null;
  readonly onFrameDot: (() => void) | null;
  // Job tab
  readonly activeProfile: DeviceProfile | null;
  readonly resolvedBedWidthMm: number;
  readonly resolvedBedHeightMm: number;
  readonly gcodeLoaded: boolean;
  readonly gcodeStale: boolean;
  readonly onRecompile: (() => void) | null;
  // Console tab
  readonly isConnected: boolean;
  readonly isRunning: boolean;
  readonly controller: LaserController | null;
  readonly sendUserCommand: (cmd: string) => void | Promise<void>;
  readonly messageEvents: readonly StructuredLogEvent[];
  readonly showConsole?: boolean;
}

export function SetupMode(props: SetupModeProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<SetupTab>(() => readSetupTab());
  const availableTabs = useMemo(
    () => props.showConsole === false
      ? ALL_SETUP_TABS.filter(tab => tab !== 'console')
      : ALL_SETUP_TABS,
    [props.showConsole],
  );

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      setActiveTab('move');
    }
  }, [activeTab, availableTabs]);

  useEffect(() => {
    if (availableTabs.includes(activeTab)) {
      writeSetupTab(activeTab);
    }
  }, [activeTab, availableTabs]);

  const effectiveActiveTab = availableTabs.includes(activeTab) ? activeTab : 'move';

  let body: React.ReactElement;
  switch (effectiveActiveTab) {
    case 'move':
      body = React.createElement(MoveTab, {
        jogStep: props.jogStep,
        setJogStep: props.setJogStep,
        onJog: props.onJog,
        onHome: props.onHome,
        canHome: props.canHome,
        canGoToLastPosition: props.canGoToLastPosition,
        lastPositionLabel: props.lastPositionLabel,
        onGoToLastPosition: props.onGoToLastPosition,
        showFocus: props.showFocus,
        canFocus: props.canFocus,
        focusBusy: props.focusBusy,
        onFocus: props.onFocus,
        canFrame: props.canFrame,
        onFrameSafe: props.onFrameSafe,
        onFrameDot: props.onFrameDot,
      });
      break;
    case 'job':
      body = React.createElement(JobTab, {
        activeProfile: props.activeProfile,
        resolvedBedWidthMm: props.resolvedBedWidthMm,
        resolvedBedHeightMm: props.resolvedBedHeightMm,
        gcodeLoaded: props.gcodeLoaded,
        gcodeStale: props.gcodeStale,
        onRecompile: props.onRecompile,
      });
      break;
    case 'console':
      body = React.createElement(ConsoleTab, {
        isConnected: props.isConnected,
        isRunning: props.isRunning,
        controller: props.controller,
        sendUserCommand: props.sendUserCommand,
        messageEvents: props.messageEvents,
      });
      break;
  }

  return React.createElement(
    'div',
    {
      'data-testid': 'workflow-setup-mode',
      'data-active-tab': effectiveActiveTab,
      style: {
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column' as const,
      },
    },
    React.createElement(TabBar, {
      active: effectiveActiveTab,
      tabs: availableTabs,
      onSelect: setActiveTab,
    }),
    body,
  );
}
