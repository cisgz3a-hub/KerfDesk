import { describe, expect, it } from 'vitest';
import { isStreamingModeCompatible, streamingModeForController } from './controller-streaming-mode';
import { KNOWN_CONTROLLER_KINDS } from './device-profile';

describe('controller streaming-mode compatibility', () => {
  it.each(['marlin', 'smoothieware'] as const)('%s requires ping-pong streaming', (kind) => {
    expect(streamingModeForController(kind, 'char-counted')).toBe('ping-pong');
    expect(isStreamingModeCompatible(kind, 'char-counted')).toBe(false);
    expect(isStreamingModeCompatible(kind, 'ping-pong')).toBe(true);
  });

  it('preserves supported GRBL-family choices', () => {
    for (const kind of ['grbl-v1.1', 'grblhal', 'fluidnc'] as const) {
      expect(streamingModeForController(kind, 'char-counted')).toBe('char-counted');
      expect(streamingModeForController(kind, 'ping-pong')).toBe('ping-pong');
    }
  });

  it('defines a deterministic answer for every controller kind', () => {
    for (const kind of KNOWN_CONTROLLER_KINDS) {
      expect(['char-counted', 'ping-pong']).toContain(
        streamingModeForController(kind, 'char-counted'),
      );
    }
  });
});
