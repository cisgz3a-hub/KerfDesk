import type { ConsoleSettingWrite, ControllerDriver, FrameBounds } from './controller-driver';
import { buildJogCommand, CMD_SPINDLE_OFF, type JogParams } from './grbl/commands';
import { formatGcodeFeedMmPerMin } from '../gcode/feed-word';
import { buildFramePerimeter } from '../job/frame-perimeter';

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
      // Frame asserts laser-off with M5 and every perimeter line carries S0;
      // it must not touch the pump. Creality's A1 firmware treats M9 as a
      // stateful low/standby request (`$152` delay) and has dropped the pump
      // around dwells, so the generic M5+M9 tool-off immediately before Start
      // left the opening operation burning without air (ADR-323). The generic
      // GRBL driver keeps M5+M9 because CNC projects trace with coolant off.
      frameToolOffLines: [CMD_SPINDLE_OFF],
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
    // The Falcon A1's air settings exist only in stock-GRBL numbering. On
    // grblHAL, the Falcon A1 Pro's firmware, $150-$152 are the X, Y and Z
    // microsteps, so that contract sends no numeric write (ADR-370 Amendment 1).
    consoleSettingWrites: driver.kind === 'grbl-v1.1' ? FALCON_A1_AIR_SETTING_WRITES : [],
  };
}

/** Creality's Falcon A1 parameter page documents these air-assist settings,
 *  each 0-100, as set from a software console. The A1 numbers its settings as
 *  stock GRBL does: an A1 `$$` (LightBurn forum topic 181704, 2026-01-25) reads
 *  `[VER:1.1f.20220810:]` and `$150=25 $151=100 $152=30`, the page's defaults.
 *  The Falcon A1 Pro's own settings page lists none of them, and an A1 Pro
 *  `$I`/`$$` (barebaric/rayforge PR #461) reads grblHAL with
 *  `[PLUGIN:Trinamic v0.12]` and `$150=16 $151=16 $152=16 $153=16`: grblHAL's
 *  axis microsteps, which the plugin changes for any power of two without
 *  touching steps/mm. So only the stock-GRBL Falcon contract lists them. Every
 *  other numeric write stays out of host software on this contract (ADR-370
 *  and its Amendment 1). Sources:
 *  https://wiki.creality.com/en/laser-engraver/falcon-a1/random-data/description-for-GRBL-configuration-parameters
 *  https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.h#L553-L562
 *  https://github.com/grblHAL/Plugins_motor/blob/11c937c85f07f7f4a52be6dfdd0e49f4fcfe1886/trinamic.c#L245-L259 */
const FALCON_A1_AIR_SETTING_WRITES: ReadonlyArray<ConsoleSettingWrite> = [
  { id: 150, min: 0, max: 100, meaning: 'engraving airflow level' },
  { id: 151, min: 0, max: 100, meaning: 'cutting airflow level' },
  { id: 152, min: 0, max: 100, meaning: 'air pump standby wait in seconds, 100 = never' },
];

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
  const corners = buildFramePerimeter(bounds, bounds.startPoint);
  return [
    'G21 G90\n',
    ...corners.map(
      ({ x, y }) => `G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${formatGcodeFeedMmPerMin(feed)} S0\n`,
    ),
  ];
}
