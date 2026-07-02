import { describe, expect, it } from 'vitest';
import { detectControllerFromBanner } from './detect-controller';

describe('detectControllerFromBanner', () => {
  it('detects vanilla GRBL v1.1 banners', () => {
    expect(detectControllerFromBanner("Grbl 1.1f ['$' for help]")).toBe('grbl-v1.1');
    expect(detectControllerFromBanner('Grbl 1.1h')).toBe('grbl-v1.1');
  });

  it('detects grblHAL banners', () => {
    expect(detectControllerFromBanner("GrblHAL 1.1f ['$' or '$HELP' for help]")).toBe('grblhal');
    expect(detectControllerFromBanner('grblHAL 1.1f')).toBe('grblhal');
  });

  it('detects FluidNC before falling through to the generic GRBL match', () => {
    expect(detectControllerFromBanner("Grbl 3.7 [FluidNC v3.7.8 (wifi) '$' for help]")).toBe(
      'fluidnc',
    );
  });

  it('returns null for non-banner lines', () => {
    expect(detectControllerFromBanner('ok')).toBeNull();
    expect(detectControllerFromBanner('<Idle|MPos:0.000,0.000,0.000|FS:0,0>')).toBeNull();
    expect(detectControllerFromBanner('start')).toBeNull();
  });
});
