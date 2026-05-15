/**
 * T1-231 introduced the handoff file as the local continuation contract for other agents.
 * Later audit-fix tickets keep it current so it does not drift back to an old snapshot.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const handoff = readFileSync('docs/AGENT_HANDOFF.md', 'utf8');

test('handoff names the current audit-fix state and next ticket', () => {
  assert.match(handoff, /Last shipped roadmap item: \*\*T3-34 second slice\*\*/);
  assert.match(handoff, /Current audit-fix run completed: \*\*T1-223 through T1-260\*\*/);
  assert.match(handoff, /Next active audit-fix ticket: finish actual entitlement server deployment\/secret-store configuration/);
});

test('handoff no longer presents the stale T1-202 state as current', () => {
  assert.doesNotMatch(handoff, /Last shipped roadmap item: \*\*T1-202\*\*/);
  assert.doesNotMatch(handoff, /local `master` equals `origin\/master`/);
});

test('handoff preserves known verification caveats', () => {
  assert.match(handoff, /Full `npm test` passed during T1-260/);
  assert.match(handoff, /git diff --check` passed during the T1-260 close-out/);
  assert.match(handoff, /npx tsc --noEmit --pretty false` passed during the T1-260 close-out/);
  assert.match(handoff, /T1-242 closed F-020/);
  assert.match(handoff, /T1-243 closed F-021/);
  assert.match(handoff, /T1-244 closed F-022/);
  assert.match(handoff, /T1-245 fixed the user-reported long-job stop\/disconnect path/);
  assert.match(handoff, /T1-246 closed the largest stale-output audit cap/);
  assert.match(handoff, /T1-247 made Start require service-level safe-idle gates/);
  assert.match(handoff, /T1-248 made running-job heartbeat tolerant of short status delays/);
  assert.match(handoff, /T1-249 hardened trace conversion against accidental straight closure burns/);
  assert.match(handoff, /T1-250 separated autosave recovery truth from manual project-file dirty state/);
  assert.match(handoff, /T1-251 moved frame freshness into the final start path/);
  assert.match(handoff, /T1-252 made pause-time laser-off confirmation load-bearing/);
  assert.match(handoff, /T1-253 made support bundles user-exportable/);
  assert.match(handoff, /T1-254 removed raw local cache authority from commercial entitlements/);
  assert.match(handoff, /T1-255 added the real WebCrypto ES256 verifier/);
  assert.match(handoff, /T1-256 added the matching WebCrypto ES256 server signer/);
  assert.match(handoff, /T1-257 wired release checksum generation/);
  assert.match(handoff, /T1-258 wired CycloneDX SBOM generation/);
  assert.match(handoff, /T1-259 wired GitHub provenance\/SBOM attestations/);
  assert.match(handoff, /T1-260 added explicit `publish_release` \/ `release_tag` dispatch inputs/);
  assert.match(handoff, /T3-85 added the manual installer QA release gate/);
  assert.match(handoff, /T3-91 follow-up wires the unsafe-at-connect banner into the live connection panel/);
  assert.match(handoff, /T3-48 follow-up wires the previously-shipped Web Serial known-port helper/);
  assert.match(handoff, /T3-55 follow-up wires live controller firmware identity into Falcon autofocus profile healing/);
  assert.match(handoff, /T3-34 first slice removes eager raster scanline-array materialization/);
  assert.match(handoff, /T3-34 second slice removes the private raster move array/);
  assert.doesNotMatch(handoff, /Full `npm test` currently times out under F-019/);
  assert.match(handoff, /Do not stage `.claude\/`/);
  assert.match(handoff, /Dependabot PRs must not be merged blindly/);
});
