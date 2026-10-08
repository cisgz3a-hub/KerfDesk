/** Provider-independent review payloads. No model result contains executable code or settings. */
export type AiCandidate = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
};
export type AiRequest = {
  readonly task: 'vector' | 'material';
  readonly prompt: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly photo: string | null;
  readonly candidates: readonly AiCandidate[];
};
export type AiVectorPath = {
  readonly closed: boolean;
  readonly points: readonly { readonly x: number; readonly y: number }[];
};
export type AiDraft = {
  readonly title: string;
  readonly explanation: string;
  readonly paths: readonly AiVectorPath[];
  readonly matches: readonly { readonly id: string; readonly reason: string }[];
};
export type AiStatus = {
  readonly configured: boolean;
  readonly secureStorage: boolean;
  readonly model: string;
};
export type AiAssistant = {
  readonly status: () => Promise<AiStatus>;
  readonly configure: (apiKey: string, model: string) => Promise<AiStatus>;
  readonly forget: () => Promise<AiStatus>;
  readonly generate: (request: AiRequest, signal: AbortSignal) => Promise<AiDraft>;
};

export function parseAiDraft(value: unknown, request: AiRequest): AiDraft {
  if (!record(value) || !shortText(value['title'], 160) || !shortText(value['explanation'], 4000))
    throw new Error('The assistant returned an invalid description.');
  const paths = value['paths'];
  const matches = value['matches'];
  if (!Array.isArray(paths) || paths.length > 100 || !Array.isArray(matches) || matches.length > 10)
    throw new Error('The assistant returned too many paths or suggestions.');
  validatePaths(paths, request);
  validateMatches(matches, request);
  validateTask(paths, matches, request.task);
  const draft = value as AiDraft;
  return {
    title: draft.title,
    explanation: draft.explanation,
    paths: draft.paths.map((path) => ({
      closed: path.closed,
      points: path.points.map((point) => ({ x: point.x, y: point.y })),
    })),
    matches: draft.matches.map((match) => ({ id: match.id, reason: match.reason })),
  };
}
function validateTask(paths: unknown[], matches: unknown[], task: AiRequest['task']): void {
  if (task === 'vector' && (paths.length === 0 || matches.length !== 0))
    throw new Error('The assistant returned no vector design.');
  if (task === 'material' && paths.length !== 0)
    throw new Error('A material suggestion cannot change artwork.');
}
function validatePaths(paths: unknown[], request: AiRequest): void {
  let count = 0;
  for (const path of paths) {
    if (!record(path) || typeof path['closed'] !== 'boolean' || !Array.isArray(path['points']))
      throw new Error('The assistant returned an invalid path.');
    const points: unknown[] = path['points'];
    count += points.length;
    if (points.length < (path['closed'] ? 3 : 2) || count > 20_000)
      throw new Error('The assistant returned invalid or excessive geometry.');
    for (const point of points) {
      if (!validPoint(point, request))
        throw new Error('A generated point lies outside the design.');
    }
  }
}
function validPoint(point: unknown, request: AiRequest): boolean {
  return (
    record(point) && within(point['x'], request.widthMm) && within(point['y'], request.heightMm)
  );
}
function within(value: unknown, maximum: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum;
}
function validateMatches(matches: unknown[], request: AiRequest): void {
  const allowed = new Set(request.candidates.map((candidate) => candidate.id));
  const seen = new Set<string>();
  for (const match of matches) {
    if (!record(match) || !shortText(match['id'], 200) || !shortText(match['reason'], 2000))
      throw new Error('The assistant returned an invalid material suggestion.');
    const id = match['id'];
    if (!allowed.has(id) || seen.has(id))
      throw new Error('The assistant suggested a recipe outside the reviewed library.');
    seen.add(id);
  }
}
function shortText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum && value.trim().length > 0;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
