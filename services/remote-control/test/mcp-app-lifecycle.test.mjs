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
  const bundle = await build({
    stdin: {
      contents: `
        import { Controller } from './app/src/core/controller';
        import { store } from './app/src/core/store';
        import { publishModelContext } from './app/src/mcp/app-tools';
        window.subject = { Controller, store, publishModelContext };
      `,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
  });
  script = bundle.outputFiles[0].text;
});
after(async () => browser?.close());

async function setup() {
  const page = await browser.newPage();
  await page.route('https://remote.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }),
  );
  await page.goto('https://remote.test/');
  await page.clock.install();
  await page.addScriptTag({ content: script });
  await page.evaluate((data) => {
    const { Controller, store } = window.subject;
    store.reset({ scopes: data.scopes });
    window.makeTransport = (revision, held = []) => {
      const pending = [];
      const calls = [];
      const response = (name, args) => {
        if (name === 'get_workspace') return { ...data.workspace, revision };
        if (name === 'get_workspace_scene') return { ...data.scene, revision };
        if (name === 'get_machine_status') return { ...data.machine, revision };
        if (name === 'list_fonts') return { fonts: [{ id: revision, name: revision }] };
        if (name === 'list_material_recipes') return { recipes: [{ id: revision }] };
        return { operation: { operationId: args?.requestId, state: 'completed', revision } };
      };
      return {
        calls,
        pending,
        transport: {
          kind: 'mcp',
          socketOpen: () => false,
          heartbeat: () => {},
          releaseHolds: () => {},
          subscribe: () => () => {},
          call: async (name, args) => {
            calls.push({ name, args });
            if (held.includes(name))
              return new Promise((resolve, reject) =>
                pending.push({
                  name,
                  resolve: (value) => resolve(value ?? response(name, args)),
                  reject,
                }),
              );
            if (name === 'wait_for_change') throw new Error('unsupported');
            return response(name, args);
          },
        },
      };
    };
    window.control = new Controller();
  }, fixture());
  return page;
}

test('MCP change cursor advances while the workspace response is still in flight', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      window.connection = window.makeTransport('r1', ['get_workspace', 'wait_for_change']);
      window.control.start(window.connection.transport);
      window.connection.pending
        .find((item) => item.name === 'wait_for_change')
        .resolve({ revision: 'r2', machineSeq: 1, reason: 'workspace' });
    });
    const waits = await page.evaluate(() =>
      window.connection.calls.filter((item) => item.name === 'wait_for_change'),
    );
    assert.equal(waits.length, 2);
    assert.equal(waits[1].args.sinceRevision, 'r2');
  } finally {
    await page.close();
  }
});

test('replacement MCP connection ignores late workspace, machine and library responses', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      window.old = window.makeTransport('old', [
        'get_workspace',
        'get_machine_status',
        'list_fonts',
        'list_material_recipes',
      ]);
      window.control.start(window.old.transport);
      window.current = window.makeTransport('current');
      window.control.start(window.current.transport);
    });
    await page.evaluate(() => {
      for (const item of window.old.pending) item.resolve();
    });
    const state = await page.evaluate(() => window.subject.store.get());
    assert.equal(state.workspace.revision, 'current');
    assert.equal(state.scene.revision, 'current');
    assert.equal(state.machine.revision, 'current');
    assert.equal(state.fonts[0].id, 'current');
    assert.equal(state.recipes[0].id, 'current');
    assert.equal(
      await page.evaluate(() =>
        window.old.calls.some((item) => item.name === 'get_workspace_scene'),
      ),
      false,
    );
  } finally {
    await page.close();
  }
});

test('MCP teardown cancels queued status refreshes and receipt polling', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      window.connection = window.makeTransport('r1');
      window.control.start(window.connection.transport);
    });
    await page.evaluate(async () => {
      await window.control.machineAction('frame_job');
      void window.control.refreshMachine();
      window.control.stop();
    });
    const before = await page.evaluate(() => window.connection.calls.length);
    await page.clock.runFor(2000);
    assert.equal(await page.evaluate(() => window.connection.calls.length), before);
    assert.equal(
      await page.evaluate(() =>
        window.connection.calls.some((item) => item.name === 'get_control_operation'),
      ),
      false,
    );
  } finally {
    await page.close();
  }
});

test('late mutation receipt cannot replace the new connection state or decrement its pending count', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      window.old = window.makeTransport('old', ['transform_artwork', 'frame_job']);
      window.control.start(window.old.transport);
    });
    await page.evaluate(() => {
      window.write = window.control.write('transform_artwork');
      window.action = window.control.machineAction('frame_job');
      window.current = window.makeTransport('current');
      window.control.start(window.current.transport);
      window.subject.store.set({ operation: null, pending: 0 });
      for (const item of window.old.pending) item.resolve();
    });
    await page.evaluate(() => Promise.all([window.write, window.action]));
    await page.clock.runFor(1500);
    const state = await page.evaluate(() => window.subject.store.get());
    assert.equal(state.pending, 0);
    assert.equal(state.operation, null);
    assert.equal(
      await page.evaluate(() =>
        window.current.calls.some((item) => item.name === 'get_control_operation'),
      ),
      false,
    );
  } finally {
    await page.close();
  }
});

test('teardown of model context cancels its pending publication and subscription', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      window.contexts = [];
      const stop = window.subject.publishModelContext({
        updateModelContext: async (context) => window.contexts.push(context),
      });
      window.subject.store.set({ tab: 'machine' });
      stop();
      window.subject.store.set({ tab: 'layers' });
    });
    await page.clock.runFor(1000);
    assert.deepEqual(await page.evaluate(() => window.contexts), []);
  } finally {
    await page.close();
  }
});

test('workspace refresh cannot display geometry from an older or newer revision', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      window.connection = window.makeTransport('r1');
      window.control.start(window.connection.transport);
    });
    assert.equal(await page.evaluate(() => window.subject.store.get().scene.revision), 'r1');
    await page.evaluate(() => {
      const original = window.connection.transport.call;
      window.connection.transport.call = async (name, args) => {
        if (name === 'get_workspace_scene')
          return new Promise((resolve) => {
            window.finishScene = () => resolve({ revision: 'r3', status: 'ready', objects: [] });
          });
        const result = await original(name, args);
        return name === 'get_workspace' ? { ...result, revision: 'r2' } : result;
      };
      void window.control.refreshWorkspace();
    });
    const during = await page.evaluate(() => window.subject.store.get());
    assert.equal(during.workspace.revision, 'r2');
    assert.equal(during.scene, null, 'Retire old artwork while replacement geometry is pending.');
    await page.evaluate(() => window.finishScene());
    assert.equal(
      await page.evaluate(() => window.subject.store.get().scene),
      null,
      'A newer scene cannot be combined with stale workspace bounds and IDs.',
    );
  } finally {
    await page.close();
  }
});

for (const interrupted of ['replaced', 'rejected']) {
  test(`legacy resize cannot move artwork after its first step is ${interrupted}`, async () => {
    const page = await setup();
    try {
      await page.evaluate(() => {
        window.old = window.makeTransport('r1', ['transform_artwork']);
        window.control.start(window.old.transport);
      });
      await page.evaluate((interrupted) => {
        const { store } = window.subject;
        store.set({ workspace: { ...store.get().workspace, capabilities: {} } });
        window.resize = window.control.scale(
          ['a1'],
          { minX: 10, minY: 10, maxX: 50, maxY: 40 },
          { minX: 20, minY: 20, maxX: 60, maxY: 50 },
        );
        if (interrupted === 'replaced') {
          window.current = window.makeTransport('r2');
          window.control.start(window.current.transport);
          window.old.pending[0].resolve();
        } else {
          window.current = window.old;
          window.old.pending[0].reject(new Error('resize rejected'));
        }
      }, interrupted);
      await page.evaluate(() => window.resize);
      assert.equal(
        await page.evaluate(() =>
          window.current.calls.some((item) => item.args?.transform?.type === 'move'),
        ),
        false,
      );
    } finally {
      await page.close();
    }
  });
}

test('legacy resize uses the confirmed first revision for its anchored move before reads settle', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      window.connection = window.makeTransport('r1', ['transform_artwork']);
      window.control.start(window.connection.transport);
    });
    await page.evaluate(() => {
      const { store } = window.subject;
      store.set({ workspace: { ...store.get().workspace, capabilities: {} } });
      window.resize = window.control.scale(
        ['a1'],
        { minX: 10, minY: 10, maxX: 50, maxY: 40 },
        { minX: 20, minY: 20, maxX: 60, maxY: 50 },
      );
      window.connection.pending[0].resolve({ revision: 'r2' });
    });
    const move = await page.evaluate(() =>
      window.connection.calls.find((item) => item.args?.transform?.type === 'move'),
    );
    assert.equal(move.args.expectedRevision, 'r2');
    await page.evaluate(() => window.connection.pending[1].resolve({ revision: 'r3' }));
    await page.evaluate(() => window.resize);
  } finally {
    await page.close();
  }
});
