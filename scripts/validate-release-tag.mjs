#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const PATTERNS = Object.freeze({
  stable: /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/,
  preview: /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)-preview\.(?:0|[1-9][0-9]*)$/,
});

function abort(message) {
  console.error(`Release tag rejected: ${message}`);
  process.exit(1);
}

const [lane, tag] = process.argv.slice(2);
if (lane !== 'stable' && lane !== 'preview') {
  abort('lane must be exactly "stable" or "preview".');
}
if (tag === undefined || !PATTERNS[lane].test(tag)) {
  abort(`${String(tag)} is not a strict ${lane} release tag.`);
}

let objectType;
try {
  objectType = execFileSync('git', ['cat-file', '-t', `refs/tags/${tag}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
} catch {
  abort(`${tag} does not resolve to a fetched Git tag object.`);
}

if (objectType !== 'tag') {
  abort(`${tag} is lightweight; releases require an annotated tag object.`);
}

console.log(`Validated annotated ${lane} release tag ${tag}.`);
