import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { phonePage } from './phone-workspace-support.mjs';
import { appPage } from './workspace-ui-support.mjs';
import {
  checkMachine,
  enterMachine,
  machineFixture,
  machineIdle,
  motionCommands,
  REVIEW_ID,
  NEXT_REVIEW_ID,
  noOverflow,
} from './machine-ui-support.mjs';

let browser;
before(async () => {
  browser = await chromium.launch({
    ...(process.env.KERFDESK_TEST_BROWSER === 'chromium' ? {} : { channel: 'chrome' }),
    headless: true,
  });
});
after(async () => {
  await browser?.close();
});

// A protocol fixture of the 207-warning/201-operation compiler regression. No controller/provider.
function fixture() {
  const state = machineFixture();
  state.framed = true;
  state.artworkShared = true;
  const id = randomUUID();
  const warnings = Array.from({ length: 207 }, (_, index) => ({
    code: `review-${index + 1}`,
    message: `Narrow feature warning ${index + 1}`,
  }));
  const operations = Array.from({ length: 201 }, (_, index) => ({
    operationId: `op-${index}`,
    index,
    summaryOffset: 0,
    summaryTotal: 1,
    summaries: [`Operation summary ${index + 1}`],
  }));
  const facts = [
    {
      kind: 'stat',
      value: { label: 'Distance', value: '2010 mm', detail: 'Current canonical toolpath' },
    },
    ...warnings.map((value) => ({ kind: 'warning', value })),
    ...operations.map((value) => ({ kind: 'operation', value })),
  ];
  function page(offset, reviewId = REVIEW_ID) {
    const items = facts.slice(offset, offset + 60),
      nextOffset = offset + items.length < facts.length ? offset + items.length : null;
    return {
      reviewId,
      revision: `fixture-${state.revision}`,
      mode: 'laser',
      artworkShared: state.artworkShared,
      stats: items.filter((item) => item.kind === 'stat').map((item) => item.value),
      warnings: items
        .filter((item) => item.kind === 'warning')
        .map((item) =>
          state.artworkShared
            ? item.value
            : { ...item.value, message: 'Review this artwork-specific warning on the PC.' },
        ),
      operations: items.filter((item) => item.kind === 'operation').map((item) => item.value),
      pagination: {
        offset,
        nextOffset,
        totalFacts: facts.length,
        totalWarnings: 207,
        totalOperations: 201,
        totalStats: 1,
        totalSummaries: 201,
      },
      acknowledgement: {
        kind: 'laser-unverified',
        prompt: 'Confirm the same reviewed job on this computer?',
      },
      frame: { required: true, complete: true },
    };
  }
  const operation = () => ({
    operationId: id,
    kind: 'job',
    state: 'awaiting_review',
    revision: `fixture-${state.revision}`,
    committed: false,
    review: page(0, state.reviewId ?? REVIEW_ID),
  });
  state.latestOperation = operation();
  state.controlReceipts.set(id, state.latestOperation);
  state.readHook = async (name, args) => {
    if (name !== 'get_control_operation' || !args.reviewPage) return null;
    assert.equal(args.operationId, id);
    const review = page(args.reviewPage.offset, state.reviewId ?? REVIEW_ID);
    const value = {
      result: { revision: `fixture-${state.revision}`, operation: { ...operation(), review } },
    };
    if (state.holdPage)
      return new Promise((resolve) => {
        state.releasePage = () => resolve(value);
      });
    return value;
  };
  state.replaceReview = () => {
    state.revision++;
    state.reviewId = NEXT_REVIEW_ID;
    state.latestOperation = operation();
  };
  state.changeSharing = (enabled) => {
    state.artworkShared = enabled;
    state.latestOperation = operation();
  };
  return state;
}

const surfaces = {
  phone: async (state) => {
    const loaded = await phonePage(browser, state, 320);
    return { ...loaded, surface: loaded.page };
  },
  app: async (state) => {
    const loaded = await appPage(browser, state, 320);
    return { ...loaded, surface: loaded.frame };
  },
};
const pageIdle = (surface) =>
  surface.waitForFunction(
    () =>
      !globalThis.document
        .getElementById('machine-review-page-info')
        .textContent.startsWith('Reading'),
  );

for (const [kind, load] of Object.entries(surfaces)) {
  test(`${kind}: truthful complete counts, every warning/operation inspectable, chosen page survives polling and no automatic Start`, async () => {
    const state = fixture(),
      loaded = await load(state),
      p = loaded.surface;
    try {
      await enterMachine(p);
      assert.match(await p.locator('#machine-warning-count').textContent(), /207 total/);
      assert.match(
        await p.locator('#machine-review-page-info').textContent(),
        /207 warnings · 201 operations/,
      );
      const warnings = [],
        operations = [];
      let pages = 0;
      for (;;) {
        assert.ok(pages++ < 10);
        warnings.push(...(await p.locator('#machine-review-warnings p').allTextContents()));
        operations.push(...(await p.locator('#machine-review-operations p').allTextContents()));
        if (await p.locator('#machine-review-next').isDisabled()) break;
        await p.locator('#machine-review-next').click();
        await pageIdle(p);
        const current = await p.locator('#machine-review-page-info').textContent();
        await checkMachine(p);
        assert.equal(await p.locator('#machine-review-page-info').textContent(), current);
      }
      assert.equal(warnings.length, 207);
      assert.equal(new Set(warnings).size, 207);
      assert.equal(warnings.at(-1), 'Narrow feature warning 207');
      assert.equal(operations.length, 201);
      assert.equal(operations.at(-1), 'Operation summary 201');
      assert.equal(await p.locator('#machine-start').isEnabled(), true);
      assert.equal(motionCommands(state).length, 0);
      assert.equal(await noOverflow(p), true);
      await p.locator('#machine-review-first').click();
      await pageIdle(p);
      assert.match(await p.locator('#machine-review-page-info').textContent(), /facts 1–60/);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

  test(`${kind}: changed review cannot supply an old page or leave Start enabled`, async () => {
    const state = fixture(),
      loaded = await load(state),
      p = loaded.surface;
    try {
      await enterMachine(p);
      state.replaceReview();
      await p.locator('#machine-review-next').click();
      await pageIdle(p);
      assert.match(await p.locator('#machine-message').textContent(), /review changed/);
      assert.equal(await p.locator('#machine-start').isDisabled(), true);
      assert.equal(motionCommands(state).length, 0);
      await checkMachine(p);
      assert.equal(await p.locator('#machine-start').isEnabled(), true);
      assert.match(await p.locator('#machine-review-page-info').textContent(), /facts 1–60/);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

  test(`${kind}: Abort remains available during a pending read and an old page cannot restore cancelled review`, async () => {
    const state = fixture(),
      loaded = await load(state),
      p = loaded.surface;
    try {
      await enterMachine(p);
      state.holdPage = true;
      await p.locator('#machine-review-next').click();
      await p.waitForFunction(() =>
        globalThis.document
          .getElementById('machine-review-page-info')
          .textContent.startsWith('Reading'),
      );
      assert.equal(await p.locator('#machine-start').isDisabled(), true);
      assert.equal(await p.locator('#machine-abort').isEnabled(), true);
      await p.locator('#machine-abort').click();
      await state.whenAdmitted('abort_job');
      state.releasePage();
      await machineIdle(p);
      assert.equal(await p.locator('#machine-review-card').isHidden(), true);
      assert.equal(motionCommands(state).filter((item) => item.name === 'abort_job').length, 1);
      assert.equal(motionCommands(state).filter((item) => item.name === 'start_job').length, 0);
      assert.deepEqual(loaded.errors, []);
    } finally {
      state.releasePage?.();
      await loaded.context.close();
    }
  });

  test(`${kind}: opt-out replaces a cached selected page and opt-in refreshes it without changing review identity`, async () => {
    const state = fixture(),
      loaded = await load(state),
      p = loaded.surface;
    try {
      await enterMachine(p);
      await p.locator('#machine-review-next').click();
      await pageIdle(p);
      assert.match(
        await p.locator('#machine-review-warnings').textContent(),
        /Narrow feature warning 61/,
      );
      const revision = state.revision,
        reviewId = state.latestOperation.review.reviewId;
      state.changeSharing(false);
      await checkMachine(p);
      assert.doesNotMatch(
        await p.locator('#machine-review-warnings').textContent(),
        /Narrow feature/,
      );
      assert.match(await p.locator('#machine-review-page-info').textContent(), /facts 1–60/);
      await p.locator('#machine-review-next').click();
      await pageIdle(p);
      assert.doesNotMatch(
        await p.locator('#machine-review-warnings').textContent(),
        /Narrow feature/,
      );
      state.changeSharing(true);
      await checkMachine(p);
      assert.match(
        await p.locator('#machine-review-warnings').textContent(),
        /Narrow feature warning 1/,
      );
      assert.match(await p.locator('#machine-review-page-info').textContent(), /facts 1–60/);
      assert.equal(state.revision, revision);
      assert.equal(state.latestOperation.review.reviewId, reviewId);
      assert.equal(motionCommands(state).length, 0);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

  test(`${kind}: an in-flight unredacted page cannot overwrite a newer sharing-off status`, async () => {
    const state = fixture(),
      loaded = await load(state),
      p = loaded.surface;
    try {
      await enterMachine(p);
      state.holdPage = true;
      await p.locator('#machine-review-next').click();
      await p.waitForFunction(() =>
        globalThis.document
          .getElementById('machine-review-page-info')
          .textContent.startsWith('Reading'),
      );
      state.changeSharing(false);
      await checkMachine(p);
      assert.doesNotMatch(
        await p.locator('#machine-review-warnings').textContent(),
        /Narrow feature/,
      );
      state.releasePage();
      await p.locator('#machine-message').filter({ hasText: 'job review changed' }).waitFor();
      await pageIdle(p);
      assert.doesNotMatch(
        await p.locator('#machine-review-warnings').textContent(),
        /Narrow feature/,
      );
      assert.equal(await p.locator('#machine-start').isDisabled(), true);
      await checkMachine(p);
      assert.doesNotMatch(
        await p.locator('#machine-review-warnings').textContent(),
        /Narrow feature/,
      );
      assert.equal(motionCommands(state).length, 0);
      assert.deepEqual(loaded.errors, []);
    } finally {
      state.releasePage?.();
      await loaded.context.close();
    }
  });
}
