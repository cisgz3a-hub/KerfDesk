import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addObject,
  createProject,
  createRegistrationLayer,
  findRegistrationBoxes,
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

function fiveJigProject(): Project {
  const base = createProject();
  let scene = base.scene;
  for (let index = 0; index < 5; index += 1) {
    scene = addObject(
      scene,
      createRegistrationBox({
        widthMm: 40,
        heightMm: 30,
        x: 10 + index * 50,
        y: 20,
        id: `registration-box-${index}`,
      }),
    );
  }
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

  it('round-trips every outline in a five-jig set without new schema fields', () => {
    const result = deserializeProject(serializeProject(fiveJigProject()));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    const boxes = findRegistrationBoxes(result.project.scene);
    expect(boxes).toHaveLength(5);
    expect(boxes.map((box) => box.transform.x)).toEqual([10, 60, 110, 160, 210]);
    expect(boxes.every((box) => box.operationIds?.includes(REGISTRATION_LAYER_ID))).toBe(true);
  });
});
