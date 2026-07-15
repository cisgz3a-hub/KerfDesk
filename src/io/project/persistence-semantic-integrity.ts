type JsonRecord = Record<string, unknown>;

// Open remains deliberately tolerant of legacy/malformed optional fields, but
// Save must not rewrite the live job into different machine or output semantics
// and then mark the unchanged in-memory project clean. Groups are excluded:
// adding the missing empty group list is structural normalization only.
export function firstPersistenceSemanticDrift(
  beforeJson: string,
  afterJson: string,
): string | null {
  const before = persistedSemantics(JSON.parse(beforeJson) as unknown);
  const after = persistedSemantics(JSON.parse(afterJson) as unknown);
  return firstDifference(before, after, '');
}

function persistedSemantics(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const scene = isRecord(value['scene']) ? value['scene'] : {};
  return {
    schemaVersion: value['schemaVersion'],
    device: value['device'],
    workspace: value['workspace'],
    optimization: value['optimization'],
    notes: value['notes'],
    machine: value['machine'],
    variables: value['variables'],
    embeddedFonts: value['embeddedFonts'],
    printAndCutTargets: value['printAndCutTargets'],
    scene: {
      objects: scene['objects'],
      layers: scene['layers'],
      artworkOrder: scene['artworkOrder'],
    },
  };
}

function firstDifference(left: unknown, right: unknown, path: string): string | null {
  if (Object.is(left, right)) return null;
  if (Array.isArray(left) && Array.isArray(right)) return firstArrayDifference(left, right, path);
  if (!isRecord(left) || !isRecord(right)) return path;
  return firstRecordDifference(left, right, path);
}

function firstArrayDifference(left: unknown[], right: unknown[], path: string): string | null {
  if (left.length !== right.length) return path;
  for (let index = 0; index < left.length; index += 1) {
    const difference = firstDifference(left[index], right[index], `${path}[${index}]`);
    if (difference !== null) return difference;
  }
  return null;
}

function firstRecordDifference(left: JsonRecord, right: JsonRecord, path: string): string | null {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  for (const key of keys) {
    const childPath = path === '' ? key : `${path}.${key}`;
    if (!(key in left) || !(key in right)) return childPath;
    const difference = firstDifference(left[key], right[key], childPath);
    if (difference !== null) return difference;
  }
  return null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
