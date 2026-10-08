import { AiFailure } from './failure.js';
export type AiConfiguration = { readonly apiKey: string; readonly model: string };
export type AiDraft = {
  readonly title: string;
  readonly explanation: string;
  readonly paths: readonly {
    readonly closed: boolean;
    readonly points: readonly { readonly x: number; readonly y: number }[];
  }[];
  readonly matches: readonly { readonly id: string; readonly reason: string }[];
};
export type AiRequest = {
  readonly task: 'vector' | 'material';
  readonly prompt: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly photo: string | null;
  readonly candidates: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
  }[];
};
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
export function validConfiguration(value: unknown): value is AiConfiguration {
  return (
    record(value) &&
    boundedText(value['apiKey'], 4000) &&
    /^[A-Za-z0-9_-]+$/.test(value['apiKey']) &&
    boundedText(value['model'], 200) &&
    /^[A-Za-z0-9._:-]+$/.test(value['model'])
  );
}
export function parseAiRequest(value: unknown): AiRequest {
  if (!record(value) || !['vector', 'material'].includes(String(value['task']))) invalid();
  const item = value as Record<string, unknown>;
  if (
    !boundedText(item['prompt'], 4000) ||
    !dimension(item['widthMm']) ||
    !dimension(item['heightMm'])
  )
    invalid();
  if (item['photo'] !== null && !validPhoto(item['photo'])) invalid();
  const candidates = item['candidates'];
  if (!Array.isArray(candidates) || candidates.length > 50) invalid();
  validateCandidates(candidates);
  if (item['task'] === 'vector' && candidates.length !== 0) invalid();
  const request = value as AiRequest;
  return {
    task: request.task,
    prompt: request.prompt,
    widthMm: request.widthMm,
    heightMm: request.heightMm,
    photo: request.photo,
    candidates: request.candidates.map(({ id, name, description }) => ({ id, name, description })),
  };
}
function validateCandidates(candidates: unknown[]): void {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!record(candidate) || !boundedText(candidate['id'], 200)) invalid();
    if (!boundedText(candidate['name'], 500) || !boundedText(candidate['description'], 2000))
      invalid();
    if (seen.has(candidate['id'])) invalid();
    seen.add(candidate['id']);
  }
}
function validPhoto(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length <= 1_600_000 &&
    /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}
function dimension(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 1000;
}
function invalid(): never {
  throw new AiFailure('Invalid assistant request.');
}
