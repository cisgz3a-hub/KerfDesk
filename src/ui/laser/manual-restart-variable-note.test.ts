// A manual restart's confirmation says what it does to variable text (oracle
// audit O1, O5-P2-1): evaluated now it takes the current serial and record,
// which a completed job may already have advanced past the part's own, and a
// restart never advances them itself.

import { describe, expect, it } from 'vitest';
import { createProject, IDENTITY_TRANSFORM, type Project, type TextObject } from '../../core/scene';
import { manualRestartVariableNote } from './manual-restart-source';

const serialText: TextObject = {
  kind: 'text',
  id: 'serial',
  content: 'SN',
  color: '#ff0000',
  fontKey: 'relief-single-line',
  sizeMm: 3,
  alignment: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  transform: IDENTITY_TRANSFORM,
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  paths: [],
  variableTemplate: { tokens: [{ kind: 'serial', prefix: 'SN', width: 4 }] },
};

function project(advancement: 'manual' | 'after-successful-stream', variable = true): Project {
  const base = createProject();
  return {
    ...base,
    variables: { recordIndex: 0, serialValue: 42, advancement },
    scene: { ...base.scene, objects: variable ? [serialText] : [] },
  };
}

describe('manual restart variable-text note', () => {
  it('says a restart evaluated now takes the current serial number and record', () => {
    const note = manualRestartVariableNote(project('manual'), true) ?? '';
    expect(note).toContain('current serial number and CSV record');
    expect(note).toContain('serial number or record in it can differ');
  });

  it('says a restart does not advance when the project advances after each job', () => {
    expect(manualRestartVariableNote(project('after-successful-stream'), false)).toBe(
      'A manual restart does not advance the serial number or CSV record; if it finishes the part, press Next before the next job.',
    );
  });

  it('says nothing for a reproduced run that never advances, or without variable text', () => {
    expect(manualRestartVariableNote(project('manual'), false)).toBeNull();
    expect(manualRestartVariableNote(project('after-successful-stream', false), true)).toBeNull();
  });
});
