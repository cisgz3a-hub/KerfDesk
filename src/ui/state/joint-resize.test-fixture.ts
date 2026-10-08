import { createLayer, createProject, IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
// Scene artwork colours, not UI chrome.
/* eslint-disable no-restricted-syntax */

export function jointResizeFixture() {
  const points = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 13, y: 20 },
    { x: 13, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 20 },
    { x: 0, y: 20 },
    { x: 0, y: 0 },
  ];
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'slot',
    source: 'slot.svg',
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    paths: [{ color: '#000000', operationIds: ['cut'], polylines: [{ closed: true, points }] }],
    operationIds: ['cut'],
  };
  const project = {
    ...createProject(),
    scene: {
      objects: [object],
      layers: [createLayer({ id: 'cut', color: '#000000' })],
      groups: [{ id: 'group', name: 'Part assembly', objectIds: ['slot'] }],
    },
  };
  return { object, project };
}
