import {
  normalizeProjectStartPoints,
  type Project,
  type ProjectStartPoints,
} from '../../core/scene';

const STORAGE_KEY = 'kerfdesk:start-point-defaults:v1';
type StartPointStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(): StartPointStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readStartPointDefaults(
  storage: StartPointStorage | undefined = browserStorage(),
): ProjectStartPoints | undefined {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const points = raw ? normalizeProjectStartPoints(JSON.parse(raw) as unknown) : undefined;
    if (points?.job !== undefined && points.job.relative !== true) return undefined;
    return points;
  } catch {
    return undefined;
  }
}

/** The caller converts the job point to a relative preference before saving. */
export function writeStartPointDefaults(
  value: ProjectStartPoints,
  storage: StartPointStorage | undefined = browserStorage(),
): boolean {
  if (storage === undefined) return false;
  const normalized = normalizeProjectStartPoints(value);
  if (normalized?.job !== undefined && normalized.job.relative !== true) return false;
  try {
    if (normalized === undefined) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

/** Only call when creating a new blank document, never while opening a project. */
export function applyStartPointDefaults(
  project: Project,
  storage: StartPointStorage | undefined = browserStorage(),
): Project {
  if (project.startPoints !== undefined || project.scene.objects.length > 0) return project;
  const startPoints = readStartPointDefaults(storage);
  return startPoints === undefined ? project : { ...project, startPoints };
}
