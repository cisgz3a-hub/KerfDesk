import { describe, expect, it } from 'vitest';
import { classifyResponse } from './response';

describe('classifyResponse', () => {
  it('recognizes "ok"', () => {
    expect(classifyResponse('ok')).toEqual({ kind: 'ok' });
    expect(classifyResponse('  ok  \r\n')).toEqual({ kind: 'ok' });
  });

  it('parses error:N', () => {
    expect(classifyResponse('error:5')).toEqual({ kind: 'error', code: 5 });
  });

  it('parses ALARM:N', () => {
    expect(classifyResponse('ALARM:9')).toEqual({ kind: 'alarm', code: 9 });
  });

  it('parses status reports via the status-parser', () => {
    const r = classifyResponse('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    expect(r.kind).toBe('status');
    if (r.kind === 'status') {
      expect(r.report.state).toBe('Idle');
    }
  });

  it('parses status-only Alarm reports as status, not coded ALARM events', () => {
    const r = classifyResponse('<Alarm|MPos:0.000,0.000,12.089|FS:0,0>');
    expect(r.kind).toBe('status');
    if (r.kind === 'status') {
      expect(r.report.state).toBe('Alarm');
      expect(r.report.mPos?.z).toBe(12.089);
    }
  });

  it('parses settings lines ($N=value)', () => {
    expect(classifyResponse('$30=1000')).toEqual({
      kind: 'setting',
      id: 30,
      value: '1000',
    });
  });

  it('parses bracketed messages [TAG:body]', () => {
    expect(classifyResponse('[MSG:Pgm End]')).toEqual({
      kind: 'message',
      tag: 'MSG',
      body: 'Pgm End',
    });
    expect(classifyResponse('[VER:1.1h.20190825:]')).toEqual({
      kind: 'message',
      tag: 'VER',
      body: '1.1h.20190825:',
    });
  });

  it('recognizes the welcome banner', () => {
    const r = classifyResponse("Grbl 1.1h ['$' for help]");
    expect(r.kind).toBe('welcome');
  });

  it('returns kind=unknown for unrecognized lines', () => {
    expect(classifyResponse('something weird').kind).toBe('unknown');
  });
});
