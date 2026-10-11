import { expect, it } from 'vitest';
import { createProject, createLayer, createRegistrationLayer } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { createRegistrationBox } from '../../core/shapes';
import {
  registrationJigArtworkInstances,
  withRegistrationJigBox,
} from '../../core/scene/registration-jig-artwork';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function project() {
  const source = withRegistrationJigBox(
    createRectangle({
      id: 'source',
      color: '#000000',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    }),
    'box-a',
  );
  return {
    ...createProject(),
    scene: {
      layers: [createRegistrationLayer(), createLayer({ id: 'art', color: '#000000' })],
      objects: [
        createRegistrationBox({ id: 'box-a', widthMm: 40, heightMm: 40 }),
        createRegistrationBox({ id: 'box-b', widthMm: 40, heightMm: 40, x: 50 }),
        source,
        { ...source, id: 'ordinary-duplicate' },
      ],
    },
  };
}

it('keeps copied stale jig metadata valid but inert through a project round-trip', () => {
  const opened = deserializeProject(serializeProject(project()));
  expect(opened.kind).toBe('ok');
  if (opened.kind !== 'ok') throw new Error('project did not reopen');
  expect(opened.project.scene.objects.some((object) => object.id === 'ordinary-duplicate')).toBe(
    true,
  );
  expect(
    registrationJigArtworkInstances(opened.project.scene).map((instance) =>
      instance.objects.map((object) => object.id),
    ),
  ).toEqual([['source']]);
});

it.each([
  null,
  { objectId: 'source', boxId: 'box-a', ancestors: [{ sourceId: 'root', kind: 'unknown' }] },
  { objectId: 'source', boxId: 'box-a', ancestors: [{ sourceId: '', kind: 'copy' }] },
  { objectId: 'source', boxId: 'box-a', ancestors: [], unexpected: true },
])('rejects malformed persisted jig metadata before scene use: %j', (registrationJig) => {
  const raw = JSON.parse(serializeProject(project()));
  raw.scene.objects[2].registrationJig = registrationJig;
  expect(deserializeProject(JSON.stringify(raw)).kind).toBe('invalid');
});
