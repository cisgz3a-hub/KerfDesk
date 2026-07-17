import { describe, expect, it } from 'vitest';
import { createLayer, type Layer } from '../../core/scene';
import { describeUncalibratedOperations } from './uncalibrated-job-warnings';

function named(id: string, name: string): Layer {
  return createLayer({ id, color: '#ff0000', name });
}

describe('describeUncalibratedOperations', () => {
  it('names a single operation and keeps the material-test advice', () => {
    expect(describeUncalibratedOperations(['a'], [named('a', 'Rectangle')])).toBe(
      'Operation "Rectangle" is still using the uncalibrated defaults (30% power, 1500 mm/min, 1 pass). Run a material test on scrap before burning final material.',
    );
  });

  it('groups several operations into one message listing every name', () => {
    const layers = [named('a', 'Rectangle'), named('b', 'Logo'), named('c', 'Text')];
    expect(describeUncalibratedOperations(['a', 'b', 'c'], layers)).toBe(
      '3 operations are still using the uncalibrated defaults (30% power, 1500 mm/min, 1 pass): "Rectangle", "Logo", "Text". Run a material test on scrap before burning final material.',
    );
  });

  it('truncates past four names so ten imports cannot flood the review', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const layers = ids.map((id) => named(id, `Op ${id.toUpperCase()}`));
    const message = describeUncalibratedOperations(ids, layers);
    expect(message).toContain('6 operations are still using the uncalibrated defaults');
    expect(message).toContain('"Op A", "Op B", "Op C", "Op D", and 2 more.');
    expect(message).not.toContain('Op E');
  });

  it('falls back to the raw id only when the layer is missing from the scene', () => {
    expect(describeUncalibratedOperations(['ghost'], [])).toContain('"ghost"');
  });
});
