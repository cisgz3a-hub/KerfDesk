import { describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { type ProjectStartPoints } from '../../core/scene/start-points';
import {
  applyStartPointDefaults,
  readStartPointDefaults,
  writeStartPointDefaults,
} from './start-point-defaults';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

const defaults: ProjectStartPoints = {
  frame: { edge: 1, fraction: 0.5 },
  job: { x: 0.25, y: 0.75, relative: true },
};

describe('start point defaults', () => {
  it('saves relative preferences and applies them to new blank projects', () => {
    const storage = memoryStorage();
    expect(writeStartPointDefaults(defaults, storage)).toBe(true);
    expect(readStartPointDefaults(storage)).toEqual(defaults);
    expect(applyStartPointDefaults(createProject(), storage).startPoints).toEqual(defaults);
    expect(writeStartPointDefaults({}, storage)).toBe(true);
    expect(readStartPointDefaults(storage)).toBeUndefined();
  });

  it('preserves an explicitly selected project start', () => {
    const storage = memoryStorage();
    writeStartPointDefaults(defaults, storage);
    const project = { ...createProject(), startPoints: { job: { x: 27, y: 35 } } };
    expect(applyStartPointDefaults(project, storage)).toBe(project);
  });

  it('requires a relative job preference for future artwork', () => {
    const storage = memoryStorage();
    expect(writeStartPointDefaults({ job: { x: 20, y: 30 } }, storage)).toBe(false);
    expect(readStartPointDefaults(storage)).toBeUndefined();
  });

  it('reports storage failure and tolerates unavailable or corrupt settings', () => {
    const inaccessible = {
      getItem: () => {
        throw new Error('unavailable');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('unavailable');
      },
    };
    expect(readStartPointDefaults(inaccessible)).toBeUndefined();
    expect(writeStartPointDefaults(defaults, inaccessible)).toBe(false);
    expect(writeStartPointDefaults({}, inaccessible)).toBe(false);
    expect(
      readStartPointDefaults({ ...memoryStorage(), getItem: () => '{broken' }),
    ).toBeUndefined();
    expect(
      readStartPointDefaults({ ...memoryStorage(), getItem: () => '{"job":{"x":5,"y":8}}' }),
    ).toBeUndefined();
  });
});
