// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CameraFrameSources } from './camera-frame-sources';

describe('camera frame sources (audit v2 04-P2-1)', () => {
  it('gives each camera one id, and a camera registered again the same one', () => {
    let next = 0;
    const sources = new CameraFrameSources(() => `id-${++next}`);
    expect(sources.register('http://192.168.10.1:8080/a')).toBe('id-1');
    expect(sources.register('http://192.168.10.2:8080/b')).toBe('id-2');
    expect(sources.register('http://192.168.10.1:8080/a')).toBe('id-1');
    expect(sources.cameraUrl('id-2')).toBe('http://192.168.10.2:8080/b');
    expect(sources.cameraUrl('id-3')).toBeUndefined();
  });

  it('forgets the least recently registered camera beyond 32', () => {
    let next = 0;
    const sources = new CameraFrameSources(() => `id-${++next}`);
    for (let index = 1; index <= 32; index += 1) sources.register(`http://192.168.1.${index}/x`);
    // Registering the first again keeps it; the second is now the oldest.
    sources.register('http://192.168.1.1/x');
    sources.register('http://192.168.1.99/x');
    expect(sources.cameraUrl('id-1')).toBe('http://192.168.1.1/x');
    expect(sources.cameraUrl('id-2')).toBeUndefined();
    expect(sources.cameraUrl('id-33')).toBe('http://192.168.1.99/x');
  });
});
