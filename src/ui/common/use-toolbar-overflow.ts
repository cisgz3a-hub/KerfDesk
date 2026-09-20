import { useLayoutEffect, useRef, useState } from 'react';
import type { AppCommand, CommandId } from '../commands/command-registry';

export const TOOLBAR_GROUPS: ReadonlyArray<ReadonlyArray<CommandId>> = [
  ['file.new', 'file.open', 'file.save', 'file.save-as'],
  ['file.import'],
  [
    'tools.add-text',
    'tools.registration-jig',
    'tools.camera',
    'tools.place-board',
    'tools.box-generator',
  ],
  ['tools.trace-image', 'tools.edit-image', 'tools.convert-to-bitmap'],
  ['file.save-gcode'],
  ['window.toggle-preview', 'file.inspect-gcode'],
];

const PRIMARY_GROUPS: ReadonlyArray<ReadonlyArray<CommandId>> = [
  ['file.new', 'file.open', 'file.save'],
  ['tools.add-text', 'tools.trace-image', 'tools.edit-image'],
];
const PRIMARY_IDS = PRIMARY_GROUPS.flat();
const OVERFLOW_PRIORITY: ReadonlyArray<CommandId> = [
  'tools.edit-image',
  'tools.trace-image',
  'tools.add-text',
  'file.new',
  'file.open',
  'file.save',
];

export function toolbarGroups(
  commands: ReadonlyArray<AppCommand>,
  primary = false,
): ReadonlyArray<ReadonlyArray<AppCommand>> {
  return (primary ? PRIMARY_GROUPS : TOOLBAR_GROUPS)
    .map((group) =>
      group
        .map((id) => commands.find((command) => command.id === id))
        .filter((command): command is AppCommand => command !== undefined),
    )
    .filter((group) => group.length > 0);
}

export function useToolbarOverflow(commands: ReadonlyArray<AppCommand>): {
  readonly containerRef: React.RefObject<HTMLDivElement>;
  readonly measureRef: React.RefObject<HTMLDivElement>;
  readonly primary: ReadonlyArray<AppCommand>;
  readonly overflow: ReadonlyArray<AppCommand>;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<ReadonlyArray<CommandId>>(PRIMARY_IDS);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const measurements = measureRef.current;
    if (container === null || measurements === null) return;
    const update = (): void => {
      const available = container.getBoundingClientRect().width;
      if (available <= 0) return;
      const widths = new Map(
        [...measurements.querySelectorAll<HTMLElement>('[data-measure-command]')].map((node) => [
          node.dataset['measureCommand'],
          node.getBoundingClientRect().width,
        ]),
      );
      const moreWidth =
        measurements.querySelector<HTMLElement>('[data-measure-more]')?.getBoundingClientRect()
          .width ?? 70;
      const next = fittingCommands(commands, widths, available, moreWidth);
      setVisible((previous) => (previous.join() === next.join() ? previous : next));
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(container);
    observer?.observe(measurements);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [commands]);
  const registered = toolbarGroups(commands).flat();
  return {
    containerRef,
    measureRef,
    primary: registered.filter((command) => visible.includes(command.id)),
    overflow: registered.filter((command) => !visible.includes(command.id)),
  };
}

function fittingCommands(
  commands: ReadonlyArray<AppCommand>,
  widths: ReadonlyMap<string | undefined, number>,
  available: number,
  moreWidth: number,
): ReadonlyArray<CommandId> {
  let visible = PRIMARY_IDS.filter((id) => commands.some((command) => command.id === id));
  const registered = toolbarGroups(commands).flat();
  for (const candidate of OVERFLOW_PRIORITY) {
    const groupCount = PRIMARY_GROUPS.filter((group) =>
      group.some((id) => visible.includes(id)),
    ).length;
    const hasOverflow = registered.length > visible.length;
    const gaps = Math.max(0, visible.length - 1) * 4 + Math.max(0, groupCount - 1) * 11;
    const needed =
      visible.reduce((total, id) => total + (widths.get(id) ?? 32), 0) +
      gaps +
      (hasOverflow ? moreWidth + 4 : 0);
    if (needed <= available) break;
    visible = visible.filter((id) => id !== candidate);
  }
  return visible;
}
