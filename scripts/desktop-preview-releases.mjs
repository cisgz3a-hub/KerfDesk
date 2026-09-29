// Shared, authenticated GitHub release metadata boundary for Preview reminders
// and release notes. Bare tags and drafts never count as shipped releases.
const PREVIEW_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-preview\.(0|[1-9]\d*)$/;

export function versionParts(tag) {
  const match = typeof tag === 'string' ? PREVIEW_TAG.exec(tag) : null;
  return match === null ? null : match.slice(1).map(BigInt);
}

export function compareTags(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (a === null || b === null) throw new Error('expected canonical Preview tags');
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export function publishedPreviews(releases) {
  if (!Array.isArray(releases)) throw new Error('release metadata must be a JSON array');
  // gh api --paginate --slurp returns response pages. A single page or
  // normalised list remains accepted for local callers.
  return releases
    .flat()
    .filter((release) => release !== null && typeof release === 'object')
    .map((release) => ({
      tagName: release.tagName ?? release.tag_name,
      publishedAt: release.publishedAt ?? release.published_at,
      isDraft: release.isDraft ?? release.draft,
      isPrerelease: release.isPrerelease ?? release.prerelease,
      immutable: release.immutable,
    }))
    .filter(
      (release) =>
        release.isDraft === false &&
        release.isPrerelease === true &&
        release.immutable === true &&
        versionParts(release.tagName) !== null &&
        typeof release.publishedAt === 'string' &&
        Number.isFinite(Date.parse(release.publishedAt)),
    )
    .sort((left, right) => compareTags(right.tagName, left.tagName));
}

export function nextPreviewTag(tag) {
  const parts = versionParts(tag);
  if (parts === null) throw new Error(`not a Preview tag: ${tag}`);
  return `v${parts.slice(0, 3).join('.')}-preview.${parts[3] + 1n}`;
}

export function nextUnusedPreviewTag(lastTag, tags) {
  const existing = [lastTag, ...tags.filter((tag) => versionParts(tag) !== null)];
  existing.sort((left, right) => compareTags(right, left));
  return nextPreviewTag(existing[0]);
}
