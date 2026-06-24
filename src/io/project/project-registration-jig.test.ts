import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addObject,
  createProject,
  createRegistrationLayer,
  REGISTRATION_LAYER_COLOR,
  REGISTRATION_LAYER_ID,
  type Project,
} from '../../core/scene';
import { createRegistrationBox } from '../../core/shapes';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function jigProject(): Project {
  const base = createProject();
  let scene = addObject(
    base.scene,
    createRegistrationBox({ widthMm: 80, heightMm: 40, x: 10, y: 20 }),
  );
  scene = addLayer(scene, createRegistrationLayer());
  return { ...base, scene };
}

describe('registration jig IO', () => {
  it('round-trips the reserved registration layer and the box (no schema change)', () => {
    const result = deserializeProject(serializeProject(jigProject()));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    const layer = result.project.scene.layers.find((l) => l.id === REGISTRATION_LAYER_ID);
    expect(layer).toBeDefined();
    expect(layer?.color).toBe(REGISTRATION_LAYER_COLOR);
    expect(layer?.mode).toBe('line');

    const box = result.project.scene.objects[0];
    expect(box?.kind).toBe('shape');
    if (box?.kind !== 'shape') return;
    expect(box.color).toBe(REGISTRATION_LAYER_COLOR);
    expect(box.transform.x).toBe(10);
    expect(box.transform.y).toBe(20);
    expect(box.spec).toMatchObject({ kind: 'rect', widthMm: 80, heightMm: 40 });
  });
});
