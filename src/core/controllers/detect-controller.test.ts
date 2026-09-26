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

  it('detects Marlin boot banners and M115 identity lines', () => {
    expect(detectControllerFromBanner('start')).toBe('marlin');
    expect(detectControllerFromBanner('FIRMWARE_NAME:Marlin 2.1.2 (bugfix)')).toBe('marlin');
    expect(detectControllerFromBanner('Marlin 2.1.2')).toBe('marlin');
  });

  it('detects Smoothieware banners and M115 identity lines', () => {
    expect(detectControllerFromBanner('Smoothie command shell')).toBe('smoothieware');
    expect(detectControllerFromBanner('FIRMWARE_NAME:Smoothieware, FIRMWARE_URL:x')).toBe(
      'smoothieware',
    );
  });

  // Audit HF-8: grblHAL at COMPATIBILITY_LEVEL >= 1 prints "Grbl 1.1f ['$' for
  // help]" (report.c:310-314; GRBL_VERSION is "1.1f" at every level, grbl.h:38-43).
  it('reads the stock "Grbl 1.1f" banner as grblHAL when the grblHAL driver runs', () => {
    const banner = "Grbl 1.1f ['$' for help]";
    expect(detectControllerFromBanner(banner, 'grblhal')).toBe('grblhal');
    expect(detectControllerFromBanner(banner, 'grbl-v1.1')).toBe('grbl-v1.1');
    expect(detectControllerFromBanner(banner, 'fluidnc')).toBe('grbl-v1.1');
    expect(detectControllerFromBanner(banner)).toBe('grbl-v1.1');
  });

  it('keeps other GRBL versions and FluidNC unambiguous on a grblHAL driver', () => {
    expect(detectControllerFromBanner("Grbl 1.1h ['$' for help]", 'grblhal')).toBe('grbl-v1.1');
    expect(detectControllerFromBanner('Grbl 0.9j', 'grblhal')).toBe('grbl-v1.1');
    expect(detectControllerFromBanner("Grbl 3.9 [FluidNC v4.0.3 '$' for help]", 'grblhal')).toBe(
      'fluidnc',
    );
  });

  it('returns null for non-banner lines', () => {
    expect(detectControllerFromBanner('ok')).toBeNull();
    expect(detectControllerFromBanner('<Idle|MPos:0.000,0.000,0.000|FS:0,0>')).toBeNull();
    expect(detectControllerFromBanner('restart')).toBeNull();
  });
});
