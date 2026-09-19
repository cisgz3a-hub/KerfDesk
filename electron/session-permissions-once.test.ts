import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { sessionPermissionsOnce } from './session-permissions-once.js';

describe('session permission ownership', () => {
  it('keeps one serial chooser when a Session is reused for successive windows', () => {
    const session = new EventEmitter();
    const pick = vi.fn();
    const install = sessionPermissionsOnce((target: EventEmitter) => {
      target.on('select-serial-port', pick);
    });
    install(session);
    install(session);
    install(session);
    session.emit('select-serial-port');
    expect(session.listenerCount('select-serial-port')).toBe(1);
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it('installs a different Session independently and retries a failed installation', () => {
    const first = {};
    const second = {};
    const install = vi.fn().mockImplementationOnce(() => {
      throw new Error('not ready');
    });
    const once = sessionPermissionsOnce(install);
    expect(() => once(first)).toThrow('not ready');
    once(first);
    once(first);
    once(second);
    expect(install).toHaveBeenCalledTimes(3);
  });
});
