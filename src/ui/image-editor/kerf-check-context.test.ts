import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { createSession } from './editor-session';
import { isKerfCheckContextCurrent, kerfCheckContext } from './kerf-check-context';

const OBJECT_ID = 'kerf-context-image';
const COLOR = '#808080';
const SIZE_PX = 20;
const BOUNDS = { minX: 0, minY: 0, maxX: 20, maxY: 20 };

function image(): RasterImage {
  return {
    kind: 'raster-image',
    id: OBJECT_ID,
    source: 'source.png',
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: SIZE_PX,
    pixelHeight: SIZE_PX,
    bounds: BOUNDS,
    transform: IDENTITY_TRANSFORM,
    color: COLOR,
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: 'AAA=',
  };
}

function project(): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      objects: [image()],
      layers: [
        {
          ...createLayer({ id: 'kerf-context-layer', color: COLOR, mode: 'image' }),
          dotWidthCorrectionMm: 1,
          linesPerMm: 1,
        },
      ],
    },
  };
}

describe('kerf-check context ownership', () => {
  it('invalidates a result when its revision, document, or layer settings change', () => {
    const session = createSession(
      OBJECT_ID,
      'source.png',
      createRgbaBuffer(SIZE_PX, SIZE_PX),
      BOUNDS,
    );
    const sourceProject = project();
    const context = kerfCheckContext(session, sourceProject);
    if (context === null) throw new Error('expected a kerf-check context');

    expect(isKerfCheckContextCurrent(context, session, sourceProject)).toBe(true);
    expect(
      isKerfCheckContextCurrent(
        context,
        { ...session, revision: session.revision + 1 },
        sourceProject,
      ),
    ).toBe(false);
    expect(
      isKerfCheckContextCurrent(
        context,
        { ...session, doc: createRgbaBuffer(SIZE_PX, SIZE_PX) },
        sourceProject,
      ),
    ).toBe(false);
    expect(
      isKerfCheckContextCurrent(context, session, {
        ...sourceProject,
        scene: {
          ...sourceProject.scene,
          layers: sourceProject.scene.layers.map((layer) => ({
            ...layer,
            dotWidthCorrectionMm: 0.5,
          })),
        },
      }),
    ).toBe(false);
  });

  it('invalidates every independently owned freshness input', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'object',
          'layer',
          'source-doc',
          'revision',
          'active-layer',
          'dimensions',
          'threshold',
        ),
        (changedInput) => {
          const session = createSession(
            OBJECT_ID,
            'source.png',
            createRgbaBuffer(SIZE_PX, SIZE_PX),
            BOUNDS,
          );
          const sourceProject = project();
          const context = kerfCheckContext(session, sourceProject);
          if (context === null) throw new Error('expected a kerf-check context');
          let currentSession = session;
          let currentProject = sourceProject;

          if (changedInput === 'object') {
            currentProject = {
              ...sourceProject,
              scene: {
                ...sourceProject.scene,
                objects: sourceProject.scene.objects.map((object) => ({ ...object })),
              },
            };
          } else if (changedInput === 'layer') {
            currentProject = {
              ...sourceProject,
              scene: {
                ...sourceProject.scene,
                layers: sourceProject.scene.layers.map((layer) => ({ ...layer })),
              },
            };
          } else if (changedInput === 'source-doc') {
            currentSession = {
              ...session,
              doc: createRgbaBuffer(SIZE_PX, SIZE_PX),
            };
          } else if (changedInput === 'revision') {
            currentSession = { ...session, revision: session.revision + 1 };
          } else if (changedInput === 'active-layer') {
            currentSession = { ...session, activeLayerId: 'different-layer' };
          } else if (changedInput === 'dimensions') {
            currentSession = {
              ...session,
              doc: createRgbaBuffer(SIZE_PX + 1, SIZE_PX),
            };
          } else {
            currentProject = {
              ...sourceProject,
              scene: {
                ...sourceProject.scene,
                layers: sourceProject.scene.layers.map((layer) => ({
                  ...layer,
                  dotWidthCorrectionMm: 0.5,
                })),
              },
            };
          }

          expect(isKerfCheckContextCurrent(context, currentSession, currentProject)).toBe(false);
        },
      ),
    );
  });
});
