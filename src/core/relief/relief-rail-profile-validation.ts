import type { ReliefRailProfileSource } from '../scene/relief/relief-rail-profile';
import { railProfileTriangles } from './relief-rail-profile';

type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 1024;
const all = (values: readonly boolean[]): boolean => values.every(Boolean);
const point = (v: unknown): v is { x: number; y: number } =>
  record(v) && finite(v['x']) && finite(v['y']);

export function reliefRailProfileError(raw: unknown, legacy = false): string | null {
  if (!record(raw) || raw['kind'] !== 'rail-profile-v1') return 'Unsupported rail/profile source.';
  const steps = raw['samplingSteps'],
    width = raw['widthMm'],
    sections = raw['sections'];
  if (!all([stepsValid(steps), widthValid(width), sectionCollectionValid(sections)]))
    return 'Rail source requires a positive width, 1–128 sampling steps and 2–32 positioned profiles.';
  const rail = railError(raw['rail']);
  if (rail !== null) return rail;
  if (raw['secondRail'] !== undefined) {
    const second = railError(raw['secondRail']);
    if (second !== null) return second;
  }
  const profile = sectionsError(sections as unknown[]);
  if (profile !== null) return profile;
  try {
    railProfileTriangles(raw as unknown as ReliefRailProfileSource, legacy);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Rail surface is not single-valued.';
  }
}
function railError(raw: unknown): string | null {
  if (!record(raw)) return 'Missing open rail.';
  const points = raw['points'];
  if (
    !Array.isArray(points) ||
    !all([
      points.length >= 2,
      points.length <= 32,
      points.every(point),
      raw['linkedObjectId'] === undefined || text(raw['linkedObjectId']),
      raw['reversed'] === undefined || typeof raw['reversed'] === 'boolean',
      raw['linkComponentTransform'] === undefined || transformValid(raw['linkComponentTransform']),
    ])
  )
    return 'Rails require 2–32 finite open vector points and valid link placement.';
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1],
      b = points[i];
    if (point(a) && point(b) && Math.hypot(a.x - b.x, a.y - b.y) <= 1e-9)
      return 'Rail contains a collapsed segment.';
  }
  return null;
}
function sectionsError(sections: unknown[]): string | null {
  const ids = new Set<string>();
  let previous = -1;
  for (const raw of sections) {
    if (!record(raw)) return 'Invalid rail profile section.';
    const position = raw['position'],
      width = raw['widthScale'];
    if (
      !all([
        text(raw['id']),
        !ids.has(String(raw['id'])),
        positionValid(position, previous),
        scaleValid(width),
      ])
    )
      return 'Profile positions must increase from 0 to 1; each width scale must be in (0,10].';
    ids.add(String(raw['id']));
    previous = position as number;
    const error = profileError(raw['profile']);
    if (error !== null) return error;
  }
  const first = sections[0],
    last = sections[sections.length - 1];
  return record(first) && record(last) && first['position'] === 0 && last['position'] === 1
    ? null
    : 'Positioned profiles must include both rail ends, 0 and 1.';
}
function profileError(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 64 || !raw.every(point))
    return 'A profile needs 2–64 finite graph points.';
  let previous = -1;
  for (const p of raw) {
    if (!graphPointValid(p, previous))
      return 'Profile must be a single-valued increasing graph across normalized width, with non-negative mm heights.';
    previous = p.x;
  }
  return raw[0]?.x === 0 && raw[raw.length - 1]?.x === 1
    ? null
    : 'Profile graph must span normalized width 0 to 1.';
}
function transformValid(raw: unknown): boolean {
  return (
    record(raw) &&
    all([
      finite(raw['x']),
      finite(raw['y']),
      finite(raw['rotationDeg']),
      finite(raw['scaleX']) && raw['scaleX'] > 0,
      finite(raw['scaleY']) && raw['scaleY'] > 0,
      typeof raw['mirrorX'] === 'boolean',
      typeof raw['mirrorY'] === 'boolean',
    ])
  );
}
export function reliefSourceWork(source: unknown): number {
  if (!record(source) || source['kind'] !== 'rail-profile-v1') return 1;
  const rail = source['rail'],
    second = source['secondRail'],
    sections = source['sections'];
  const count = (v: unknown): number =>
    record(v) && Array.isArray(v['points']) ? v['points'].length : 0;
  return (
    2 *
      (typeof source['samplingSteps'] === 'number'
        ? source['samplingSteps'] +
          count(rail) +
          count(second) +
          (Array.isArray(sections) ? sections.length : 0) +
          1
        : 256) +
    railSectionWork(sections)
  );
}

function railSectionWork(sections: unknown): number {
  if (!Array.isArray(sections)) return 0;
  if (sections.length > 32) return Infinity;
  let profilePoints = 0;
  for (const section of sections)
    if (record(section) && Array.isArray(section['profile']))
      profilePoints = Math.max(profilePoints, section['profile'].length);
  return sections.length + 2 * profilePoints;
}

function stepsValid(value: unknown): boolean {
  return finite(value) && Number.isInteger(value) && value >= 1 && value <= 128;
}
function widthValid(value: unknown): boolean {
  return finite(value) && value > 0;
}
function sectionCollectionValid(value: unknown): boolean {
  return Array.isArray(value) && value.length >= 2 && value.length <= 32;
}
function positionValid(value: unknown, previous: number): boolean {
  return finite(value) && value >= 0 && value <= 1 && value > previous;
}
function scaleValid(value: unknown): boolean {
  return finite(value) && value > 0 && value <= 10;
}
function graphPointValid(value: { x: number; y: number }, previous: number): boolean {
  return value.x > previous && value.x >= 0 && value.x <= 1 && value.y >= 0;
}
