/**
 * T1-231 introduced the handoff file as the local continuation contract for other agents.
 * Later audit-fix tickets keep it current so it does not drift back to an old snapshot.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const handoff = readFileSync('docs/AGENT_HANDOFF.md', 'utf8');

test('handoff names the current audit-fix state and next ticket', () => {
  assert.match(handoff, /Last shipped roadmap item: \*\*T1-243\*\*/);
  assert.match(handoff, /Current audit-fix run completed: \*\*T1-223 through T1-243\*\*/);
  assert.match(handoff, /Next active audit-fix ticket: none from `docs\/AUDIT-2026-05-12\.md`/);
});

test('handoff no longer presents the stale T1-202 state as current', () => {
  assert.doesNotMatch(handoff, /Last shipped roadmap item: \*\*T1-202\*\*/);
  assert.doesNotMatch(handoff, /local `master` equals `origin\/master`/);
});

test('handoff preserves known verification caveats', () => {
  assert.match(handoff, /Full `npm test` passed during T1-243/);
  assert.match(handoff, /T1-242 closed F-020/);
  assert.match(handoff, /T1-243 closed F-021/);
  assert.doesNotMatch(handoff, /Full `npm test` currently times out under F-019/);
  assert.match(handoff, /Do not stage `.claude\/`/);
  assert.match(handoff, /Dependabot PRs must not be merged blindly/);
});
