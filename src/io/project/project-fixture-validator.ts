import { normalizeFixtureTemplates } from '../../core/camera/fixtures/fixture-template-normalize';

/** Present malformed metadata is rejected, never silently converted into a live placement. */
export function validateFixtureTemplates(
  value: unknown,
  label = 'fixtureTemplates',
): string | null {
  return value === undefined || normalizeFixtureTemplates(value) !== undefined
    ? null
    : `${label} must contain valid bounded fixture geometry, camera context and manual observations.`;
}
