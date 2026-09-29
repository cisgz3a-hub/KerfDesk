import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { publishedPreviews, versionParts } from './desktop-preview-releases.mjs';

// A private GitHub archive can exist while public distribution has failed.
// Only the completed canonical release workflow proves the whole lane shipped.
export function completedPreviewReleases(releasePages, workflowPages) {
  if (!Array.isArray(workflowPages))
    throw new Error('Expected paginated release workflow metadata');
  const runs = workflowPages
    .flatMap((page) => {
      if (!page || !Array.isArray(page.workflow_runs))
        throw new Error('Invalid release workflow metadata');
      return page.workflow_runs;
    })
    .filter(
      (run) =>
        run &&
        run.status === 'completed' &&
        run.conclusion === 'success' &&
        run.event === 'push' &&
        run.path === '.github/workflows/release-desktop-preview.yml' &&
        versionParts(run.head_branch) !== null &&
        typeof run.head_sha === 'string' &&
        /^[a-f0-9]{40}$/u.test(run.head_sha) &&
        typeof run.updated_at === 'string' &&
        Number.isFinite(Date.parse(run.updated_at)),
    );
  return publishedPreviews(releasePages).filter((release) =>
    runs.some(
      (run) =>
        run.head_branch === release.tagName &&
        Date.parse(run.updated_at) >= Date.parse(release.publishedAt),
    ),
  );
}

export function fetchCompletedPreviewReleases(run = execFileSync) {
  const request = (endpoint) =>
    JSON.parse(
      run('gh', ['api', '--paginate', '--slurp', endpoint], {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        timeout: 60_000,
      }),
    );
  const releases = request('repos/cisgz3a-hub/KerfDesk/releases?per_page=100');
  const workflows = request(
    'repos/cisgz3a-hub/KerfDesk/actions/workflows/release-desktop-preview.yml/runs?event=push&status=success&per_page=100',
  );
  return completedPreviewReleases(releases, workflows);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, first, second] = process.argv.slice(2);
    if (mode === '--fetch' && first && !second) {
      writeFileSync(first, `${JSON.stringify(fetchCompletedPreviewReleases(), null, 2)}\n`);
    } else if (mode && first && second) {
      writeFileSync(
        second,
        `${JSON.stringify(completedPreviewReleases(JSON.parse(readFileSync(mode, 'utf8')), JSON.parse(readFileSync(first, 'utf8'))), null, 2)}\n`,
      );
    } else
      throw new Error(
        'Usage: filter-completed-previews.mjs --fetch <output.json> OR <releases.json> <workflow-runs.json> <output.json>',
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
