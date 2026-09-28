#!/usr/bin/env node
// A signed stable build must name its own signer in app-update.yml
// (ADR-142 Amendment 1). electron-updater installs a downloaded Windows update
// only when the update's signer matches that file's publisherName, and when
// publisherName is missing it installs the update without checking its
// signature at all (NsisUpdater.verifySignature). electron-builder writes
// publisherName from the signing certificate, so a build that signed with no
// certificate, or read the wrong one, would ship an updater that trusts any
// download. This check reads the file the way electron-updater does and
// matches the name against the certificate that actually signed the installer.
//
// Usage: node scripts/verify-update-publisher.mjs <app-update.yml> <signer subject DN>

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

// The DN parser electron-updater itself uses, from its own dependency.
const updaterRequire = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const { parseDn } = updaterRequire('builder-util-runtime');

function publisherNames(updateConfig) {
  const names = updateConfig?.publisherName;
  if (typeof names === 'string') return [names];
  if (Array.isArray(names)) return names.filter((name) => typeof name === 'string');
  return [];
}

// Mirrors electron-updater's verifySignature: a full DN must match on every key
// it names; a bare name must equal the signer's CN.
function nameMatchesSigner(name, signer) {
  const dn = parseDn(name);
  if (dn.size > 0) return [...dn.keys()].every((key) => dn.get(key) === signer.get(key));
  return name === signer.get('CN');
}

/** Problems with an app-update.yml for an installer signed by `signerSubject`. */
export function updatePublisherProblems(updateConfigText, signerSubject) {
  const names = publisherNames(yaml.load(updateConfigText));
  if (names.length === 0) {
    return [
      'app-update.yml names no publisherName, so installed copies would accept unsigned updates',
    ];
  }
  const signer = parseDn(signerSubject);
  if (!names.some((name) => nameMatchesSigner(name, signer))) {
    return [
      `app-update.yml publisherName (${names.join(' | ')}) does not match the installer signer (${signerSubject})`,
    ];
  }
  return [];
}

function runCli([updateConfigPath, signerSubject]) {
  if (updateConfigPath === undefined || signerSubject === undefined) {
    process.stderr.write(
      'Usage: node scripts/verify-update-publisher.mjs <app-update.yml> <signer subject DN>\n',
    );
    process.exit(2);
  }
  let updateConfigText;
  try {
    updateConfigText = readFileSync(updateConfigPath, 'utf8');
  } catch (error) {
    process.stderr.write(`Cannot read ${updateConfigPath}: ${error.message}\n`);
    process.exit(1);
  }
  const problems = updatePublisherProblems(updateConfigText, signerSubject);
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    process.exit(1);
  }
  process.stdout.write('UPDATE_PUBLISHER_OK=true\n');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2));
}
