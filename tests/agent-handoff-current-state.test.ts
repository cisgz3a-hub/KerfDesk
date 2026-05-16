/**
 * T1-231 introduced the handoff file as the local continuation contract for other agents.
 * Later audit-fix tickets keep it current so it does not drift back to an old snapshot.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const handoff = readFileSync('docs/AGENT_HANDOFF.md', 'utf8');

test('handoff names the current audit-fix state and next roadmap queue', () => {
  assert.match(handoff, /Last shipped roadmap item: \*\*T2-6 Phase 3as\*\*/);
  assert.match(handoff, /Current audit-fix run completed: \*\*T1-223 through T1-260\*\*/);
  assert.match(handoff, /## Next Roadmap Queue/);
  assert.match(handoff, /T1-17 verification/);
  assert.match(handoff, /continue T2-6 with another small App\.tsx split slice/);
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
  assert.match(handoff, /T1-17 trace atomic-commit follow-up removes the extra standalone selection update/);
  assert.match(handoff, /T2-6 Phase 3z extracts text-dialog scene mutation/);
  assert.match(handoff, /T2-6 Phase 3aa extracts mode-tab layer creation/);
  assert.match(handoff, /T2-6 Phase 3ab extracts delete-selection scene transaction/);
  assert.match(handoff, /T2-6 Phase 3ac extracts active-layer scene transaction/);
  assert.match(handoff, /T2-6 Phase 3ad extracts start-mode selection scene update/);
  assert.match(handoff, /T2-6 Phase 3ae extracts camera-position scene transaction/);
  assert.match(handoff, /T2-6 Phase 3af extracts user-mode and production-mode branch decisions/);
  assert.match(handoff, /T2-6 Phase 3ag extracts undo\/redo history navigation/);
  assert.match(handoff, /T2-6 Phase 3ah extracts material-suggestion request derivation/);
  assert.match(handoff, /T2-6 Phase 3ai extracts toolpath-preview clear\/compile decisions/);
  assert.match(handoff, /T2-6 Phase 3aj extracts text-preview font-load request formatting/);
  assert.match(handoff, /T2-6 Phase 3ak extracts autosave skip\/persist decisions/);
  assert.match(handoff, /T2-6 Phase 3al extracts exit-flow decisions/);
  assert.match(handoff, /T2-6 Phase 3am extracts start-mode status-label formatting/);
  assert.match(handoff, /T2-6 Phase 3an extracts window-to-canvas resize sizing/);
  assert.match(handoff, /T2-6 Phase 3ao extracts selected-text quick-action predicate/);
  assert.match(handoff, /T2-6 Phase 3ap extracts connection-panel bounds fallback props/);
  assert.match(handoff, /T2-6 Phase 3aq extracts connection-panel machine-plan bounds selection/);
  assert.match(handoff, /T2-6 Phase 3ar extracts text-dialog open\/edit decisions/);
  assert.match(handoff, /T2-6 Phase 3as extracts autosave payload planning/);
  assert.doesNotMatch(handoff, /Full `npm test` currently times out under F-019/);
  assert.match(handoff, /Do not stage `.claude\/`/);
  assert.match(handoff, /Dependabot PRs must not be merged blindly/);
});
