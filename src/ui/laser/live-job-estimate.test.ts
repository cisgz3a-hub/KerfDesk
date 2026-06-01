import { describe, expect, it } from 'vitest';

import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type TracedImage,
} from '../../core/scene';
import {
  countOutputVectorSegments,
  estimateLiveJob,
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
});
