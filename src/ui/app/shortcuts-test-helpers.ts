import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
  type Transform,
} from '../../core/scene';

export function projectWithObject(object: SceneObject): Project {
  const project = createProject();
  return { ...project, scene: { ...project.scene, objects: [object] } };
}

export function shapeObject(transform: Transform): SceneObject {
  return {
    kind: 'shape',
    id: 'shape-1',
    spec: { kind: 'rect', widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
    // eslint-disable-next-line no-restricted-syntax -- fixture scene data needs a stable source color.
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, ...transform },
    paths: [],
  };
}
