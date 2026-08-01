import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_PLAN_CORPUS } from '../../__fixtures__/executable-plan-corpus';
import { validateAgainstSchema } from '../../__fixtures__/json-schema-subset';
import type { ProgramEvent } from '../gcode-view';
import { buildExecutablePlan } from './build-executable-plan';
import type { ExecutablePlanController } from './executable-plan-types';

const SCHEMA_PATH = 'docs/schemas/executable-plan-v1.schema.json';

/**
 * A `Record` over the union makes TypeScript reject the map when a member is
 * added or removed, so the compiler carries the drift signal and the assertions
 * below carry it into the versioned schema file.
 */
const EVENT_KINDS: Record<ProgramEvent['kind'], true> = {
  units: true,
  'spindle-on': true,
  'spindle-off': true,
  'coolant-on': true,
  'coolant-off': true,
  dwell: true,
  pause: true,
  synchronization: true,
  'program-end': true,
  'wcs-select': true,
  'canned-cycle': true,
  'tool-word': true,
  home: true,
};

const EMITTER_IDS: Record<ExecutablePlanController, true> = {
  grbl: true,
  'grbl-cnc': true,
  marlin: true,
  smoothieware: true,
};

function readSchema(): Readonly<Record<string, unknown>> {
  const text = readFileSync(resolve(__dirname, '../../..', SCHEMA_PATH), 'utf8');
  return JSON.parse(text) as Readonly<Record<string, unknown>>;
}

function schemaEventKinds(schema: Readonly<Record<string, unknown>>): ReadonlyArray<string> {
  const kinds: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const entries = Object.entries(node as Record<string, unknown>);
    for (const [key, value] of entries) {
      if (key === 'kind' && typeof value === 'object' && value !== null) {
        const constant = (value as Record<string, unknown>)['const'];
        if (typeof constant === 'string') kinds.push(constant);
      }
      walk(value);
    }
  };
  walk(schema);
  return kinds;
}

describe('executable-plan-v1.schema.json', () => {
  const schema = readSchema();

  for (const fixture of EXECUTABLE_PLAN_CORPUS) {
    it(`accepts the plan built from ${fixture.name}`, () => {
      const built = buildExecutablePlan(fixture.gcode, {
        machineKind: fixture.machineKind,
        controller: fixture.controller,
      });
      expect(built.kind).toBe('ok');
      if (built.kind !== 'ok') return;

      const violations = validateAgainstSchema(built.plan, schema);

      expect(violations.map((entry) => `${entry.path}: ${entry.message}`)).toEqual([]);
    });
  }

  it('enumerates exactly the controller emitters the type allows', () => {
    const controller = (schema['properties'] as Record<string, unknown>)['controller'];
    const emitter = (
      (controller as Record<string, unknown>)['properties'] as Record<string, unknown>
    )['emitter'];
    const declared = (emitter as Record<string, unknown>)['enum'];

    expect(declared).toEqual(Object.keys(EMITTER_IDS));
  });

  it('enumerates exactly the program-event kinds the type allows', () => {
    expect([...schemaEventKinds(schema)].sort()).toEqual(Object.keys(EVENT_KINDS).sort());
  });

  // A validator that accepts everything would make the suite above meaningless,
  // so each rejection mode the schema relies on is exercised directly.
  it('rejects the contract violations the schema relies on', () => {
    const built = buildExecutablePlan(EXECUTABLE_PLAN_CORPUS[0]?.gcode ?? '', {
      machineKind: 'laser',
      controller: 'grbl',
    });
    if (built.kind !== 'ok') throw new Error('fixture did not build');
    const { plan } = built;
    const firstMotion = plan.motions[0];
    if (firstMotion === undefined) throw new Error('fixture has no motions');

    const wrongConst = validateAgainstSchema({ ...plan, schemaVersion: 2 }, schema);
    const { totals: _dropped, ...missingRequired } = plan;
    const unexpected = validateAgainstSchema({ ...plan, surprise: 1 }, schema);
    const badEnum = validateAgainstSchema(
      { ...plan, motions: [{ ...firstMotion, intent: 'engrave' }, ...plan.motions.slice(1)] },
      schema,
    );
    const shortArray = validateAgainstSchema(
      { ...plan, motions: [{ ...firstMotion, pointsMm: firstMotion.pointsMm.slice(0, 1) }] },
      schema,
    );
    const negative = validateAgainstSchema(
      { ...plan, motions: [{ ...firstMotion, lengthMm: -1 }, ...plan.motions.slice(1)] },
      schema,
    );

    expect(wrongConst.length).toBeGreaterThan(0);
    expect(validateAgainstSchema(missingRequired, schema).length).toBeGreaterThan(0);
    expect(unexpected.length).toBeGreaterThan(0);
    expect(badEnum.length).toBeGreaterThan(0);
    expect(shortArray.length).toBeGreaterThan(0);
    expect(negative.length).toBeGreaterThan(0);
  });
});
