import { afterEach, describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  createProject,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import {
  captureTraceCommitOwner,
  claimTraceCommitOwner,
  closeOwnedTraceDialog,
  sameTraceSourceContent,
} from './trace-commit-ownership';

afterEach(() => {
  useUiStore.setState({ imageDialog: null });
});

describe('Trace commit ownership', () => {
  it('assigns a new request owner every time Trace is opened', () => {
    const seed = raster();
    useUiStore.getState().openImageDialog(seed);
    const first = useUiStore.getState().imageDialog?.requestToken;
    useUiStore.getState().closeImageDialog();
    useUiStore.getState().openImageDialog(seed);

    expect(first).toBeTypeOf('string');
    expect(useUiStore.getState().imageDialog?.requestToken).not.toBe(first);
  });

  it('rejects an equivalent source in a replacement document', () => {
    const seed = raster();
    const token = 'trace-document-owner';
    install(seed, 7, token, seed);
    const owner = captureTraceCommitOwner(seed, token);
    expect(owner).not.toBeNull();

    install(raster(), 8, token, seed);

    expect(owner === null ? null : claimTraceCommitOwner(owner)).toBeNull();
  });

  it('rejects an equivalent replacement object inside the same document epoch', () => {
    const seed = raster();
    const token = 'trace-source-owner';
    install(seed, 9, token, seed);
    const owner = captureTraceCommitOwner(seed, token);
    expect(owner).not.toBeNull();

    install(raster(), 9, token, seed);

    expect(owner === null ? null : claimTraceCommitOwner(owner)).toBeNull();
  });

  it('does not let an old request close a reopened Trace dialog', () => {
    const seed = raster();
    const oldToken = 'old-trace';
    install(seed, 10, oldToken, seed);
    const owner = captureTraceCommitOwner(seed, oldToken);
    expect(owner).not.toBeNull();

    const newToken = 'new-trace';
    useUiStore.setState({ imageDialog: { source: seed, requestToken: newToken } });
    closeOwnedTraceDialog(oldToken);

    expect(owner === null ? null : claimTraceCommitOwner(owner)).toBeNull();
    expect(useUiStore.getState().imageDialog?.requestToken).toBe(newToken);
  });

  it('treats a different paged source asset as different trace content', () => {
    const seed = raster({ imageAsset: imageAsset('source-a') });
    const replacement = raster({ imageAsset: imageAsset('source-b') });

    expect(sameTraceSourceContent(replacement, seed)).toBe(false);
  });
});

function install(
  source: RasterImage,
  projectDocumentEpoch: number,
  requestToken: string,
  dialogSource: RasterImage,
): void {
  useStore.setState({ project: projectWith(source), projectDocumentEpoch });
  useUiStore.setState({ imageDialog: { source: dialogSource, requestToken } });
}

function projectWith(source: RasterImage): Project {
  const project = createProject();
  return { ...project, scene: { ...project.scene, objects: [source] } };
}

function raster(over: Partial<RasterImage> = {}): RasterImage {
  return {
    kind: 'raster-image',
    id: 'source-1',
    source: 'source.png',
    dataUrl: 'data:image/png;base64,AAA',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    transform: IDENTITY_TRANSFORM,
    color: '#000000',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    ...over,
  };
}

function imageAsset(sourceAssetId: string): NonNullable<RasterImage['imageAsset']> {
  return {
    schemaVersion: 1,
    repository: 'curvedesk-import-assets-v1',
    sourceAssetId,
    lumaAssetId: `${sourceAssetId}-luma`,
    sourceMimeType: 'image/png',
    sourceByteLength: 4,
    lumaByteLength: 4,
    naturalWidth: 2,
    naturalHeight: 2,
    sampledWidth: 2,
    sampledHeight: 2,
    thumbnail: {
      mimeType: 'image/bmp',
      dataUrl: 'data:image/bmp;base64,AAA',
      width: 2,
      height: 2,
    },
  };
}
