import type { ControllerDriver, FrameBounds } from './controller-driver';
import { buildJogCommand, type JogParams } from './grbl/commands';
import { formatGcodeFeedMmPerMin } from '../gcode/feed-word';

/** Creality's official Falcon A1 Pro LightBurn device disables $J and settings
 * fetch and uses $HX followed by $HY for Home. These are device defaults, not
 * a claim that the vendor's GRBL-LPC label identifies a grblHAL firmware build.
 * Source: https://wiki.creality.com/falcon_a1_pro_(lightburn_2.0.00+).lbzip */
export function withFalconCommandContract(driver: ControllerDriver): ControllerDriver {
  return {
    ...driver,
    commandSet: 'creality-falcon-a1-pro',
    label: 'Falcon A1 Pro (GRBL-compatible commands)',
    capabilities: {
      ...driver.capabilities,
      jog: 'gcode-relative',
      jogCancel: false,
      settings: 'none',
      firmwareSetupPanel: 'none',
    },
    realtime: { ...driver.realtime, jogCancel: null },
    commands: {
      ...driver.commands,
      home: '$HX\n$HY',
      settingsQuery: null,
      buildInfoQuery: null,
      buildJog: buildFalconJog,
      buildFrameLines: buildFalconFrame,
      buildFrameRetract: (z, feed) =>
        `G90 G21 G1 Z${z.toFixed(3)} F${formatGcodeFeedMmPerMin(feed)} S0\n`,
    },
    prepareConsoleCommand: (input) => {
      const prepared = driver.prepareConsoleCommand(input);
      return prepared.ok && prepared.command.normalized.toUpperCase() === '$HZ1'
        ? { ...prepared, command: { ...prepared.command, stateEffect: 'reference' } }
        : prepared;
    },
    consoleQuickCommands: driver.consoleQuickCommands.filter(({ command }) => command !== '$$'),
  };
}

function buildFalconJog(params: JogParams): string {
  // Reuse GRBL's finite-axis, finite-feed and nonempty-motion validation.
  buildJogCommand(params);
  const absolute = params.relative === false;
  const axes = [
    ['X', params.dx],
    ['Y', params.dy],
    ['Z', params.dz],
  ] as const;
  const words = axes.flatMap(([axis, value]) =>
    value === undefined || (!absolute && value === 0) ? [] : [`${axis}${value.toFixed(3)}`],
  );
  // G1 honours the requested jog feed on GRBL; G0 would use the configured
  // rapid rate regardless of F. Assert tool-off before any ordinary motion.
  return [
    'M5',
    `G21 ${absolute ? 'G90' : 'G91'}`,
    `G1 ${words.join(' ')} F${formatGcodeFeedMmPerMin(params.feed)} S0`,
    ...(absolute ? [] : ['G90']),
  ].join('\n');
}

function buildFalconFrame(bounds: FrameBounds, feed: number): ReadonlyArray<string> {
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, feed].every(Number.isFinite)) {
    throw new Error('Falcon frame coordinates and feed must be finite.');
  }
  const corners = [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY],
    [bounds.minX, bounds.minY],
  ] as const;
  return [
    'G21 G90\n',
    ...corners.map(
      ([x, y]) => `G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${formatGcodeFeedMmPerMin(feed)} S0\n`,
    ),
  ];
}
