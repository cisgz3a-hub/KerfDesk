import { RT_SOFT_RESET } from '../../core/controllers/grbl';

export function disconnectSafetyEvents(
  events: ReadonlyArray<string>,
  label: string,
): ReadonlyArray<string> {
  const expectedWrites = new Set([
    `${label}:write:${JSON.stringify(RT_SOFT_RESET)}`,
    `${label}:write:${JSON.stringify('M5\n')}`,
    `${label}:write:${JSON.stringify('M9\n')}`,
    `${label}:close`,
  ]);
  return events.filter((event) => expectedWrites.has(event));
}
