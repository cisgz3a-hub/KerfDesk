import { describe, expect, it } from 'vitest';

import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import {
  countOutputVectorSegments,
  estimateLiveJob,
  LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET,
  LIVE_ESTIMATE_RAW_VECTOR_SEGMENT_BUDGET,
} from './live-job-estimate';

function tracedLineProject(segmentCount: number): Project {
  const points = Array.from({ length: segmentCount + 1 }, (_, x) => ({ x, y: 0 }));
  const traced: TracedImage = {
    kind: 'traced-image',
    id: 'trace-1',
    source: 'trace.png',
    traceMode: 'centerline',
    bounds: { minX: 0, minY: 0, maxX: segmentCount, maxY: 0 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [{ closed: false, points }] }],
  };
  const project = createProject();
  return {
    ...project,
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'line' })],
      objects: [traced],
    },
  };
}

function imageOnlyProject(): Project {
  const raster: RasterImage = {
    kind: 'raster-image',
    id: 'image-1',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: 'AAAAAAAAAAA=',
  };
  const project = createProject();
  return {
    ...project,
    scene: {
      layers: [
        {
          ...createLayer({ id: '#808080', color: '#808080', mode: 'image' }),
          ditherAlgorithm: 'threshold',
          linesPerMm: 1,
        },
      ],
      objects: [raster],
    },
  };
}

function denseFillProject(): Project {
  const height = (LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET + 5) * 0.1;
  const filled: ImportedSvg = {
    kind: 'imported-svg',
    id: 'dense-fill',
    source: 'dense-fill.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: height },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: height },
              { x: 0, y: height },
            ],
          },
        ],
      },
    ],
  };
  const project = createProject();
  return {
    ...project,
    scene: {
      layers: [
        {
          ...createLayer({ id: '#000000', color: '#000000', mode: 'fill' }),
          hatchSpacingMm: 0.1,
        },
      ],
      objects: [filled],
    },
  };
}

describe('live job estimate', () => {
  it('estimates small vector jobs', () => {
    expect(estimateLiveJob(tracedLineProject(2)).kind).toBe('estimated');
  });

  it('skips huge traces before compiling or optimizing them in React render', () => {
    const project = tracedLineProject(LIVE_ESTIMATE_RAW_VECTOR_SEGMENT_BUDGET + 1);

    expect(countOutputVectorSegments(project.scene)).toBe(
      LIVE_ESTIMATE_RAW_VECTOR_SEGMENT_BUDGET + 1,
    );
    expect(estimateLiveJob(project)).toEqual({ kind: 'too-large' });
  });

  it('estimates image-only jobs instead of showing them as empty', () => {
    expect(estimateLiveJob(imageOnlyProject()).kind).toBe('estimated');
  });

  it('skips dense fill jobs even when their raw vector count is small', () => {
    const project = denseFillProject();

    expect(countOutputVectorSegments(project.scene)).toBeLessThan(
      LIVE_ESTIMATE_RAW_VECTOR_SEGMENT_BUDGET,
    );
    expect(estimateLiveJob(project)).toEqual({ kind: 'too-large' });
  });
});
