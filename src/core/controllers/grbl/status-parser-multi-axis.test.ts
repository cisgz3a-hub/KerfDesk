import { describe, expect, it } from 'vitest';
import { parseStatusReport } from './status-parser';

describe('GRBL status reports with additional axes', () => {
  it('retains XYZ from the Falcon report captured when Frame lost its position', () => {
    const report = parseStatusReport(
      '<Idle|MPos:191.500,106.500,-21.100,0.000|Bf:512,65535|FS:0,0>',
    );

    expect(report).toMatchObject({
      state: 'Idle',
      mPos: { x: 191.5, y: 106.5, z: -21.1 },
      feed: 0,
      spindle: 0,
    });
  });

  it.each(['MPos', 'WPos', 'WCO'] as const)(
    'retains XYZ from %s vectors with extra axes',
    (field) => {
      const key = ({ MPos: 'mPos', WPos: 'wPos', WCO: 'wco' } as const)[field];
      const report = parseStatusReport(`<Idle|${field}:12.500,-4.250,3.000,90.000,0.000,1.000>`);
      expect(report?.[key]).toEqual({ x: 12.5, y: -4.25, z: 3 });
    },
  );

  it.each(['1,2', '1,,3,4', '1,2,3,', '1,2,3,NaN', '1,2,3,Infinity', '1,2,3,4mm'])(
    'keeps malformed or incomplete coordinate vectors unavailable: %s',
    (coordinates) => {
      const report = parseStatusReport(`<Idle|MPos:${coordinates}|FS:0,0>`);
      expect(report?.state).toBe('Idle');
      expect(report?.mPos).toBeNull();
    },
  );

  it('still requires exactly three override values', () => {
    expect(parseStatusReport('<Idle|MPos:1,2,3,4|Ov:100,100,100,100>')?.ov).toBeNull();
  });
});
