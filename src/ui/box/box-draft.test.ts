import { describe, expect, it } from 'vitest';
import {
  BOX_DRAFT_PERSISTED_FIELDS,
  defaultBoxDraft,
  parseBoxDraft,
  type BoxMachineContext,
} from './box-draft';

const CNC: BoxMachineContext = { kind: 'cnc', stockThicknessMm: 6.35, toolDiameterMm: 3.175 };

describe('defaultBoxDraft', () => {
  it('seeds laser defaults with a press fit and no relief tool', () => {
    const draft = defaultBoxDraft({ kind: 'laser' });
    expect(draft.clearance).toBe('0');
    expect(draft.thickness).toBe('3');
    expect(draft.toolDiameter).toBe('');
  });

  it('prefills CNC defaults from the machine: stock, tool, glue fit', () => {
    const draft = defaultBoxDraft(CNC);
    expect(draft.thickness).toBe('6.35');
    expect(draft.toolDiameter).toBe('3.175');
    expect(draft.clearance).toBe('0.15');
  });
});

describe('parseBoxDraft', () => {
  it('reports every empty required field, including the CNC tool', () => {
    const draft = { ...defaultBoxDraft(CNC), width: ' ', toolDiameter: '' };
    const parsed = parseBoxDraft(draft, CNC);
    expect(parsed.kind).toBe('incomplete');
    if (parsed.kind !== 'incomplete') return;
    expect(parsed.emptyFields).toEqual(['width', 'reliefTool']);
  });

  it('ignores the tool field for laser machines', () => {
    const draft = { ...defaultBoxDraft({ kind: 'laser' }), toolDiameter: '' };
    const parsed = parseBoxDraft(draft, { kind: 'laser' });
    expect(parsed.kind).toBe('spec');
    if (parsed.kind !== 'spec') return;
    expect(parsed.spec.relief).toEqual({ kind: 'none' });
  });

  it('maps mode, style, and relief into the spec', () => {
    const draft = { ...defaultBoxDraft(CNC), mode: 'outer', style: 'open-top' };
    const parsed = parseBoxDraft(draft, CNC);
    expect(parsed.kind).toBe('spec');
    if (parsed.kind !== 'spec') return;
    expect(parsed.spec.dimensionMode).toBe('outer');
    expect(parsed.spec.style).toBe('open-top');
    expect(parsed.spec.relief).toEqual({ kind: 'corner-overcut', toolDiameterMm: 3.175 });
  });
});

describe('BOX_DRAFT_PERSISTED_FIELDS', () => {
  it('never persists the relief tool diameter (the machine is the truth)', () => {
    expect(BOX_DRAFT_PERSISTED_FIELDS).not.toContain('toolDiameter');
  });
});
