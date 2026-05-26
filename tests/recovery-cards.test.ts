/**
 * T2-62: recovery cards content layer. Pre-T2-62 recovery was
 * banner / log strings without next-step guidance.
 *
 * Run: npx tsx tests/recovery-cards.test.ts
 */
import {
  alarmRecoveryCard,
  disconnectRecoveryCard,
  frameFailedRecoveryCard,
  emergencyStopRecoveryCard,
  jobFailedRecoveryCard,
  alarmCodeReason,
  buildRecoveryCard,
  shouldShowRecoveryCard,
  type RecoveryVariant,
  type RecoveryAction,
} from '../src/ui/recovery/RecoveryCardContent';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-62 recovery card content ===\n');

void (async () => {

// 1. alarmRecoveryCard with code: title + ALARM:N + reason
{
  const c = alarmRecoveryCard(2);
  assert(c.variant === 'alarm', `variant=alarm`);
  assert(c.title === 'Machine Alarm', `title`);
  assert(c.whatHappened.includes('ALARM:2'), `code in whatHappened`);
  assert(/exceeds machine travel/i.test(c.whatHappened), `reason text`);
}

// 2. alarmRecoveryCard with null code: generic copy
{
  const c = alarmRecoveryCard(null);
  assert(c.whatHappened.includes('alarm'), `generic copy`);
  assert(!c.whatHappened.includes('ALARM:'), `no code reference`);
}

// 3. alarmRecoveryCard: 4 steps including unlock + re-home + reframe
{
  const c = alarmRecoveryCard(1);
  assert(c.steps.length === 4, `4 alarm steps`);
  const actions = c.steps.map(s => s.action).filter((a): a is RecoveryAction => !!a);
  assert(actions.includes('unlock'), `unlock action`);
  assert(actions.includes('re-home'), `re-home action`);
  assert(actions.includes('reframe'), `reframe action`);
}

// 4. alarmRecoveryCard: doNot warns about Start before re-frame
{
  const c = alarmRecoveryCard(2);
  assert(c.doNot !== null && c.doNot.toLowerCase().includes('start'),
    `doNot warns about Start`);
  assert(c.doNot?.toLowerCase().includes('re-fram') === true,
    `doNot mentions re-fram(e/ing)`);
}

// 5. disconnectRecoveryCard: title + content + reconnect action
{
  const c = disconnectRecoveryCard();
  assert(c.variant === 'disconnect', `variant=disconnect`);
  assert(c.title === 'Connection Lost', `title`);
  const actions = c.steps.map(s => s.action).filter((a): a is RecoveryAction => !!a);
  assert(actions.includes('reconnect'), `reconnect action`);
  assert(actions.includes('frame'), `frame action`);
}

// 6. disconnectRecoveryCard: warns about resuming previous job
{
  const c = disconnectRecoveryCard();
  assert(c.doNot !== null && c.doNot.toLowerCase().includes('resume'),
    `doNot warns about resume`);
}

// 7. disconnectRecoveryCard: whatItMeans names laser-still-on + machine-moving
{
  const c = disconnectRecoveryCard();
  assert(c.whatItMeans.toLowerCase().includes('laser') &&
         c.whatItMeans.toLowerCase().includes('moving'),
    `surface laser-on + still-moving risks`);
}

// 8. frameFailedRecoveryCard: timeout in copy
{
  const c = frameFailedRecoveryCard(15);
  assert(c.variant === 'frame-failed', `variant`);
  assert(c.whatHappened.includes('15'), `timeout in copy`);
  assert(c.doNot === null, `frame failure: no doNot warning`);
}

// 9. frameFailedRecoveryCard: stop + frame actions
{
  const c = frameFailedRecoveryCard(20);
  assert(c.whatHappened.includes('20'), `custom timeout in copy`);
  const actions = c.steps.map(s => s.action).filter((a): a is RecoveryAction => !!a);
  assert(actions.includes('stop') && actions.includes('frame'),
    `stop + frame actions`);
}

// 10. emergencyStopRecoveryCard: title + position-lost + reconnect/home/frame
{
  const c = emergencyStopRecoveryCard();
  assert(c.title === 'Emergency Stop Complete', `title`);
  assert(c.whatItMeans.toLowerCase().includes('position is lost'),
    `position lost named`);
  const actions = c.steps.map(s => s.action).filter((a): a is RecoveryAction => !!a);
  assert(actions.includes('reconnect') && actions.includes('home') && actions.includes('frame'),
    `reconnect + home + frame actions`);
}

// 11. emergencyStopRecoveryCard: doNot warns immediate Start
{
  const c = emergencyStopRecoveryCard();
  assert(c.doNot?.toLowerCase().includes('start') === true,
    `doNot warns about Start`);
}

// 12. jobFailedRecoveryCard: error message + steps
{
  const c = jobFailedRecoveryCard('Compiler error: bad line 42');
  assert(c.variant === 'job-failed', `variant`);
  assert(c.whatHappened === 'Compiler error: bad line 42', `error message preserved`);
  const actions = c.steps.map(s => s.action).filter((a): a is RecoveryAction => !!a);
  assert(actions.includes('stop'), `stop action`);
  assert(actions.includes('compile'), `compile action`);
}

// 13. alarmCodeReason: GRBL spec coverage
{
  assert(alarmCodeReason(1) === 'hard limit triggered', `code 1`);
  assert(alarmCodeReason(2).includes('travel'), `code 2`);
  assert(alarmCodeReason(3).includes('reset'), `code 3`);
  assert(alarmCodeReason(99) === 'unknown alarm code', `unknown code fallback`);
}

// 14. buildRecoveryCard: variant routing
{
  for (const v of ['alarm', 'disconnect', 'frame-failed',
                   'emergency-stop', 'job-failed'] as RecoveryVariant[]) {
    const c = buildRecoveryCard({ variant: v });
    assert(c.variant === v, `routes to '${v}'`);
  }
}

// 15. buildRecoveryCard: alarm passes alarmCode
{
  const c = buildRecoveryCard({ variant: 'alarm', alarmCode: 5 });
  assert(c.whatHappened.includes('ALARM:5'), `alarmCode threaded`);
}

// 16. buildRecoveryCard: frame-failed passes timeout
{
  const c = buildRecoveryCard({ variant: 'frame-failed', frameTimeoutSec: 30 });
  assert(c.whatHappened.includes('30'), `timeout threaded`);
}

// 17. buildRecoveryCard: job-failed passes errorMessage
{
  const c = buildRecoveryCard({ variant: 'job-failed', errorMessage: 'X failed' });
  assert(c.whatHappened === 'X failed', `errorMessage threaded`);
}

// 18. buildRecoveryCard: defaults are sane
{
  const c = buildRecoveryCard({ variant: 'job-failed' });
  assert(c.whatHappened === 'Job failed.', `default error message`);
  const f = buildRecoveryCard({ variant: 'frame-failed' });
  assert(f.whatHappened.includes('15'), `default 15s timeout`);
}

// 19. shouldShowRecoveryCard: 'none' → false
{
  assert(!shouldShowRecoveryCard({ controllerStatus: 'idle', recovery: 'none' }),
    `recovery='none' → no card`);
}

// 20. shouldShowRecoveryCard: any recovery → true
{
  for (const v of ['alarm', 'disconnect', 'frame-failed',
                   'emergency-stop', 'job-failed'] as RecoveryVariant[]) {
    assert(shouldShowRecoveryCard({ controllerStatus: 'alarm', recovery: v }),
      `recovery='${v}' → show card`);
  }
}

// 21. THE audit's headline: every variant has What/Why/Steps + at least 1 action
{
  for (const v of ['alarm', 'disconnect', 'frame-failed',
                   'emergency-stop', 'job-failed'] as RecoveryVariant[]) {
    const c = buildRecoveryCard({ variant: v });
    assert(c.whatHappened.length > 0, `'${v}' has whatHappened`);
    assert(c.whatItMeans.length > 0, `'${v}' has whatItMeans`);
    assert(c.steps.length > 0, `'${v}' has steps`);
    const hasAction = c.steps.some(s => s.action !== undefined);
    assert(hasAction, `'${v}' has at least 1 actionable step`);
  }
}

// 22. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/ui/recovery/RecoveryCardContent.ts'), 'utf-8');
  assert(/T2-62/.test(src), 'T2-62 marker');
  for (const id of [
    'RecoveryVariant', 'RecoveryAction', 'RecoveryStep',
    'RecoveryCardContent',
    'alarmRecoveryCard', 'disconnectRecoveryCard',
    'frameFailedRecoveryCard', 'emergencyStopRecoveryCard',
    'jobFailedRecoveryCard',
    'alarmCodeReason', 'buildRecoveryCard', 'shouldShowRecoveryCard',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const v of ['alarm', 'disconnect', 'frame-failed',
                   'emergency-stop', 'job-failed']) {
    assert(src.includes(`'${v}'`), `variant '${v}' declared`);
  }
  for (const a of ['unlock', 'home', 're-home', 'reconnect', 'reframe',
                   'frame', 'stop', 'compile']) {
    assert(src.includes(`'${a}'`), `action '${a}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
