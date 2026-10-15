/* global window */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { fixture, launch } from './remote-app-support.mjs';

let browser;
let script;
before(async () => {
  browser = await launch();
  const result = await build({
    stdin: {
      contents: `
        import { Controller } from './app/src/core/controller';
        import { store } from './app/src/core/store';
        import { RemoteError } from './app/src/core/transport';
        import { viewState } from './app/src/mcp/app-tools';
        window.subject = { Controller, store, RemoteError, viewState };
      `,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
  });
  script = result.outputFiles[0].text;
});
after(async () => browser?.close());

async function setup(readOnly = false) {
  const page = await browser.newPage();
  await page.route('https://remote.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }),
  );
  await page.goto('https://remote.test/');
  await page.clock.install();
  await page.addScriptTag({ content: script });
  await page.evaluate(
    ({ data, readOnly }) => {
      const { Controller, store, RemoteError } = window.subject;
      store.reset({ scopes: readOnly ? ['read'] : ['read', 'edit'] });
      window.server = {
        calls: [],
        writes: [],
        reads: [],
        holdReads: false,
        revision: 1,
        workspace: data.workspace,
      };
      const server = window.server;
      window.transport = {
        kind: 'phone',
        socketOpen: () => false,
        heartbeat: () => {},
        releaseHolds: () => {},
        subscribe: () => () => {},
        call: async (name, args) => {
          server.calls.push({ name, args });
          if (name === 'get_workspace') {
            const snapshot = structuredClone({
              ...server.workspace,
              revision: `r${server.revision}`,
            });
            if (server.holdReads)
              return new Promise((resolve) => server.reads.push(() => resolve(snapshot)));
            return snapshot;
          }
          if (name === 'get_workspace_scene')
            return { ...data.scene, revision: `r${server.revision}` };
          if (name === 'get_machine_status')
            return { ...data.machine, revision: `r${server.revision}` };
          if (['get_control_operation', 'frame_job', 'abort_job'].includes(name))
            return {
              operation: {
                operationId: args.operationId ?? args.requestId,
                revision: `r${server.revision}`,
                state: 'completed',
              },
            };
          if (name === 'list_fonts') return { fonts: [] };
          if (name === 'list_material_recipes') return { recipes: [] };
          if (args.expectedRevision !== `r${server.revision}`)
            throw new RemoteError('stale_revision');
          if (name !== 'set_selection') return { revision: `r${++server.revision}` };
          return new Promise((resolve, reject) =>
            server.writes.push({
              args,
              reject: () => reject(new RemoteError('stale_revision')),
              finish: () => {
                server.workspace.selection = args.mode === 'all' ? ['a1'] : args.artworkIds;
                server.workspace.totalSelected = server.workspace.selection.length;
                server.workspace.selectionTruncated = false;
                resolve({
                  revision: `r${++server.revision}`,
                  selection: server.workspace.selection,
                });
              },
            }),
          );
        },
      };
      window.control = new Controller();
      window.control.start(window.transport);
    },
    { data: fixture(), readOnly },
  );
  await page.waitForFunction(() => window.subject.store.get().workspace !== null);
  return page;
}

test('rapid selection writes are ordered, coalesced and use the preceding receipt revision', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      void window.control.select(['a1']);
    });
    await page.evaluate(() => {
      void window.control.select(['another']);
      void window.control.select([]);
    });
    assert.equal(await page.evaluate(() => window.server.writes.length), 1);
    await page.evaluate(() => window.server.writes[0].finish());
    const next = await page.evaluate(() => window.server.writes[1].args);
    assert.deepEqual(next.artworkIds, []);
    assert.equal(next.expectedRevision, 'r2');
    assert.deepEqual(await page.evaluate(() => window.subject.store.get().selection), []);
    await page.evaluate(() => window.server.writes[1].finish());
    assert.deepEqual(await page.evaluate(() => window.server.workspace.selection), []);
    assert.equal(await page.evaluate(() => window.subject.store.get().selectionSync), 'desktop');
  } finally {
    await page.close();
  }
});

test('a workspace read started before the selection cannot restore the old selection', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      window.server.holdReads = true;
      void window.control.refreshWorkspace();
      void window.control.select(['a1']);
    });
    await page.evaluate(() => window.server.writes[0].finish());
    await page.evaluate(() => {
      window.server.holdReads = false;
      window.server.reads[0]();
    });
    assert.deepEqual(await page.evaluate(() => window.subject.store.get().selection), ['a1']);
  } finally {
    await page.close();
  }
});

test('read-only selection remains local across refresh and is described honestly to the model', async () => {
  const page = await setup(true);
  try {
    await page.evaluate(async () => {
      await window.control.select(['a1']);
      await window.control.refreshWorkspace();
    });
    const view = await page.evaluate(() => window.subject.viewState());
    assert.deepEqual(view.selection, ['a1']);
    assert.equal(view.selectionCount, 1);
    assert.equal(view.selectionSync, 'local');
    assert.equal(await page.evaluate(() => window.server.writes.length), 0);
  } finally {
    await page.close();
  }
});

test('oversized selections are refused without silently trimming local or desktop selection', async () => {
  const page = await setup();
  try {
    await page.evaluate(() =>
      window.control.select(Array.from({ length: 201 }, (_, i) => `art-${i}`)),
    );
    assert.deepEqual(await page.evaluate(() => window.subject.store.get().selection), []);
    assert.equal(await page.evaluate(() => window.server.writes.length), 0);
    assert.match(
      await page.evaluate(() => window.subject.store.get().toasts.at(-1).message),
      /200/,
    );
  } finally {
    await page.close();
  }
});

test('a rejected edit cannot erase newer read-only inspection after permission loss', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      void window.control.select(['a1']);
    });
    await page.evaluate(() => {
      void window.control.select([]);
      window.subject.store.set({ scopes: ['read'] });
      void window.control.select(['a1']);
      window.server.writes[0].reject();
    });
    assert.equal(await page.evaluate(() => window.server.writes.length), 1);
    assert.deepEqual(await page.evaluate(() => window.subject.store.get().selection), ['a1']);
    assert.equal(await page.evaluate(() => window.subject.store.get().selectionSync), 'local');
  } finally {
    await page.close();
  }
});

test('machine requests reuse a confirmed selection revision and Abort never waits for selection', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      window.subject.store.set({ scopes: ['read', 'edit', 'control'] });
      window.server.holdReads = true;
      void window.control.select(['a1']);
    });
    await page.evaluate(() => window.control.abort());
    const abort = await page.evaluate(() =>
      window.server.calls.find((call) => call.name === 'abort_job'),
    );
    assert.equal(abort.args.expectedRevision, undefined);
    await page.evaluate(() => window.server.writes[0].finish());
    await page.evaluate(() => window.control.machineAction('frame_job'));
    const frame = await page.evaluate(() =>
      window.server.calls.find((call) => call.name === 'frame_job'),
    );
    assert.equal(frame.args.expectedRevision, 'r2');
  } finally {
    await page.close();
  }
});

test('transform waits for selection and uses its confirmed revision before workspace refresh', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      window.server.holdReads = true;
      void window.control.select(['a1']);
    });
    await page.evaluate(() => {
      window.move = window.control.move(['a1'], 2, 0);
    });
    assert.equal(
      await page.evaluate(() =>
        window.server.calls.some((call) => call.name === 'transform_artwork'),
      ),
      false,
    );
    await page.evaluate(() => window.server.writes[0].finish());
    await page.evaluate(() => window.move);
    const move = await page.evaluate(() =>
      window.server.calls.find((call) => call.name === 'transform_artwork'),
    );
    assert.equal(move.args.expectedRevision, 'r2');
  } finally {
    await page.close();
  }
});

test('replacing the connection discards queued selection and prevents a waiting transform', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      void window.control.select(['a1']);
    });
    await page.evaluate(() => {
      void window.control.select([]);
      window.move = window.control.move(['a1'], 2, 0);
      window.control.start(window.transport);
      window.server.writes[0].finish();
    });
    await page.evaluate(() => window.move);
    const calls = await page.evaluate(() =>
      window.server.calls.filter((call) => call.args?.requestId),
    );
    assert.equal(calls.length, 1);
  } finally {
    await page.close();
  }
});

test('a rejected selection cancels its waiting transform instead of retrying against refreshed artwork', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      void window.control.select(['a1']);
      window.move = window.control.move(['a1'], 2, 0);
    });
    await page.evaluate(() => window.server.writes[0].reject());
    await page.evaluate(() => window.move);
    assert.deepEqual(
      await page.evaluate(() =>
        window.server.calls.filter((call) => call.args?.requestId).map((call) => call.name),
      ),
      ['set_selection'],
    );
  } finally {
    await page.close();
  }
});

for (const outcome of ['confirmed', 'rejected', 'replaced']) {
  test(`legacy direct drag selects its target and handles a ${outcome} selection receipt`, async () => {
    const page = await setup();
    try {
      await page.evaluate(() => {
        const { store } = window.subject;
        store.set({
          workspace: { ...store.get().workspace, capabilities: { designControl: false } },
        });
        window.server.holdReads = true;
        window.move = window.control.move(['a1'], 2, 0);
      });
      assert.deepEqual(await page.evaluate(() => window.server.writes[0].args.artworkIds), ['a1']);
      assert.equal(
        await page.evaluate(() =>
          window.server.calls.some((call) => call.name === 'transform_artwork'),
        ),
        false,
      );
      await page.evaluate((outcome) => {
        if (outcome === 'replaced') window.control.start(window.transport);
        window.server.writes[0][outcome === 'rejected' ? 'reject' : 'finish']();
      }, outcome);
      await page.evaluate(() => window.move);
      const transforms = await page.evaluate(() =>
        window.server.calls.filter((call) => call.name === 'transform_artwork'),
      );
      assert.equal(transforms.length, outcome === 'confirmed' ? 1 : 0);
      if (outcome === 'confirmed') {
        assert.equal(transforms[0].args.expectedRevision, 'r2');
        assert.deepEqual(await page.evaluate(() => window.server.workspace.selection), ['a1']);
      }
    } finally {
      await page.close();
    }
  });
}

test('Select All uses the new desktop capability and refuses an incomplete old-desktop view', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      const { store } = window.subject;
      store.set({
        workspace: { ...store.get().workspace, totalArtwork: 2, truncated: true, capabilities: {} },
      });
      void window.control.selectAll();
    });
    assert.equal(await page.evaluate(() => window.server.writes.length), 0);
    await page.evaluate(() => {
      const { store } = window.subject;
      store.set({
        workspace: { ...store.get().workspace, capabilities: { selectionModes: true } },
      });
      void window.control.selectAll();
    });
    assert.equal(await page.evaluate(() => window.server.writes[0].args.mode), 'all');
    await page.evaluate(() => window.server.writes[0].finish());
    assert.deepEqual(await page.evaluate(() => window.subject.store.get().selection), ['a1']);
  } finally {
    await page.close();
  }
});

test('model context reports the full count and explicit truncation instead of a misleading prefix', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      const { store } = window.subject;
      const ids = Array.from({ length: 200 }, (_, i) => `id-${i}`);
      store.set({
        selection: ids,
        workspace: {
          ...store.get().workspace,
          selection: ids,
          totalSelected: 250,
          selectionTruncated: true,
        },
      });
    });
    const view = await page.evaluate(() => window.subject.viewState());
    assert.equal(view.selection.length, 200);
    assert.equal(view.selectionCount, 250);
    assert.equal(view.selectionTruncated, true);
    assert.equal(view.selectionBounds, null);
  } finally {
    await page.close();
  }
});

for (const readOnly of [false, true]) {
  test(
    'Select All ignores operation-only truncation (' +
      (readOnly ? 'read-only' : 'legacy editing') +
      ')',
    async () => {
      const page = await setup(readOnly);
      try {
        await page.evaluate(() => {
          const { store } = window.subject;
          const workspace = store.get().workspace;
          store.set({
            workspace: {
              ...workspace,
              totalArtwork: workspace.artwork.length,
              totalOperations: 201,
              truncated: true,
              capabilities: {},
            },
          });
          void window.control.selectAll();
        });
        if (readOnly) {
          assert.equal(await page.evaluate(() => window.server.writes.length), 0);
          assert.equal(
            await page.evaluate(() => window.subject.store.get().selectionSync),
            'local',
          );
        } else {
          assert.deepEqual(await page.evaluate(() => window.server.writes[0].args.artworkIds), [
            'a1',
          ]);
          await page.evaluate(() => window.server.writes[0].finish());
        }
        assert.deepEqual(await page.evaluate(() => window.subject.store.get().selection), ['a1']);
        assert.deepEqual(await page.evaluate(() => window.subject.store.get().toasts), []);
      } finally {
        await page.close();
      }
    },
  );
}
