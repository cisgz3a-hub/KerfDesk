import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { UPDATE_NOTES_LIMIT } from '../public/desktop-update-notes.mjs';
import { CommercialReleaseError } from './commercial-release-manifest.mjs';
import { validateReviewedNotes } from './manual-commercial-notes.mjs';

export const REVIEWED_NOTES_PATH = 'docs/releases/desktop-update-notes.json';

/** Read only committed notes belonging to the actual source, never a working file. */
export async function readReviewedDesktopUpdateNotes(
  sourceSha,
  root,
  execute = promisify(execFile),
) {
  if (!/^[a-f0-9]{40}$/u.test(sourceSha ?? ''))
    throw new CommercialReleaseError('Desktop notes require the exact release source SHA.');
  const options = {
    cwd: root,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: UPDATE_NOTES_LIMIT,
    encoding: 'buffer',
  };
  const command = async (...args) => (await execute('git', args, options)).stdout;
  const read = async (revision) => {
    const tree = (await command('ls-tree', '-z', revision, '--', REVIEWED_NOTES_PATH)).toString(
      'utf8',
    );
    if (tree === '') return null;
    if (!/^100(?:644|755) blob [a-f0-9]{40}\t[^\0]+\0$/u.test(tree))
      throw new CommercialReleaseError('Reviewed desktop notes must be a committed ordinary file.');
    const bytes = await command('show', `${revision}:${REVIEWED_NOTES_PATH}`);
    return validateReviewedNotes(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
  };
  try {
    const reviewedNotes = await read(sourceSha);
    if (reviewedNotes === null)
      throw new CommercialReleaseError(
        `Commit reviewed customer notes in ${REVIEWED_NOTES_PATH} before releasing.`,
      );
    if (reviewedNotes.sinceSourceSha !== null) {
      await command('merge-base', '--is-ancestor', reviewedNotes.sinceSourceSha, sourceSha);
      const previous = await read(reviewedNotes.sinceSourceSha);
      if (
        previous &&
        JSON.stringify(previous.highlights) === JSON.stringify(reviewedNotes.highlights)
      )
        throw new CommercialReleaseError(
          'Customer highlights must change since the previous release; changing only the baseline is not a review.',
        );
    }
    return reviewedNotes;
  } catch (error) {
    if (error instanceof CommercialReleaseError) throw error;
    throw new CommercialReleaseError(
      'Cannot verify committed desktop notes or previous-source ancestry.',
    );
  }
}
