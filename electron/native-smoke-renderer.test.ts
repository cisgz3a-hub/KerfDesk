import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { RENDERER_NODE_PRIMITIVES_SOURCE } from './native-smoke-renderer.js';

describe('packaged renderer Node exposure evidence', () => {
  it('observes absent primitives in a browser-like realm', () => {
    expect(runInNewContext(RENDERER_NODE_PRIMITIVES_SOURCE)).toEqual({
      require: 'undefined',
      process: 'undefined',
      module: 'undefined',
      Buffer: 'undefined',
    });
  });

  it('reports leaked Node primitives without invoking any of them', () => {
    const forbidden = () => {
      throw new Error('the smoke must only inspect primitive types');
    };
    expect(
      runInNewContext(RENDERER_NODE_PRIMITIVES_SOURCE, {
        require: forbidden,
        process: { exit: forbidden },
        module: { require: forbidden },
        Buffer: forbidden,
      }),
    ).toEqual({ require: 'function', process: 'object', module: 'object', Buffer: 'function' });
  });
});
