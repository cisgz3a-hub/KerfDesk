import { describe, expect, it } from 'vitest';
import { explainLine } from './word-glossary';

describe('explainLine', () => {
  it('explains motion, modal, and parameter words on a line', () => {
    const words = explainLine('G1 X10 Y-2.5 F800 S600');
    expect(words.map((word) => word.text)).toEqual(['G1', 'X10', 'Y-2.5', 'F800', 'S600']);
    expect(words[0]?.meaning).toContain('Linear move');
    expect(words[1]?.meaning).toContain('X target');
    expect(words[3]?.meaning).toContain('Feed rate');
    expect(words[4]?.meaning).toContain('laser power');
  });

  it('explains arc, units, and end words', () => {
    expect(explainLine('G2 X5 I3 J0')[0]?.meaning).toContain('Clockwise arc');
    expect(explainLine('G21')[0]?.meaning).toContain('millimetres');
    expect(explainLine('G20')[0]?.meaning).toContain('inches');
    expect(explainLine('M30')[0]?.meaning).toContain('rewind');
    expect(explainLine('M3 S1')[0]?.meaning).toContain('constant power');
    expect(explainLine('M4')[0]?.meaning).toContain('dynamic power');
  });

  it('names work coordinate systems across the G54-G59 range', () => {
    expect(explainLine('G54')[0]?.meaning).toContain('work coordinate system G54');
    expect(explainLine('G59')[0]?.meaning).toContain('work coordinate system G59');
  });

  it('says plainly when a word is not interpreted', () => {
    expect(explainLine('G64 P0.1')[0]?.meaning).toContain('not interpreted');
  });

  it('returns nothing for comments, blanks, and the tape marker', () => {
    expect(explainLine('; just a comment')).toEqual([]);
    expect(explainLine('(also a comment)')).toEqual([]);
    expect(explainLine('   ')).toEqual([]);
    expect(explainLine('%')).toEqual([]);
  });

  it('ignores an inline comment but still explains the code before it', () => {
    const words = explainLine('G0 X1 ; rapid over');
    expect(words.map((word) => word.text)).toEqual(['G0', 'X1']);
    expect(words[0]?.meaning).toContain('Rapid');
  });
});
