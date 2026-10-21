import { applyHomography, invertMat3 } from '../../../../core/camera/homography';
import { boardOutlineAnchors, defaultCaptureOrder, outlineBounds } from '../../../../core/scene';
import { traceBoardOutline } from '../../../../core/camera/board-photo/trace-board';
import { loadImageAsRawData } from '../../../trace/image-loader';
import {
  displayPointToImage,
  nearestOutlineVertex,
  toggleOutlineAnchor,
} from './outline-photo-logic';
import { beginRectify } from './outline-photo-rectify';
import type { OutlinePhotoDispatch, OutlinePhotoSession } from './use-outline-photo-session';

export async function loadOutlinePhoto(
  file: File | undefined,
  dispatch: OutlinePhotoDispatch,
): Promise<void> {
  if (file === undefined) return;
  try {
    dispatch({ type: 'photo-loaded', image: await loadImageAsRawData(file, 2048) });
  } catch (error) {
    dispatch({
      type: 'error',
      error: error instanceof Error ? error.message : 'Could not load that photo.',
    });
  }
}

export function straightenOutlinePhoto(
  state: OutlinePhotoSession,
  dispatch: OutlinePhotoDispatch,
): void {
  dispatch({ type: 'busy-start', label: 'Straightening photo…' });
  beginRectify({
    image: state.image,
    corners: state.corners,
    reference: state.reference,
    customWidth: state.customWidth,
    customHeight: state.customHeight,
    setBusy: (busy) => {
      if (!busy) dispatch({ type: 'busy-end' });
    },
    setError: (error) => dispatch({ type: 'error', error }),
    setTrace: (trace) => {
      if (trace !== null) dispatch({ type: 'trace-ready', trace });
    },
  });
}

export function handleOutlinePhotoClick(
  event: React.MouseEvent<HTMLCanvasElement>,
  state: OutlinePhotoSession,
  dispatch: OutlinePhotoDispatch,
): void {
  if (state.image === null) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const pixel = displayPointToImage({ x: event.clientX, y: event.clientY }, rect, state.image);
  if (state.trace === null) {
    dispatch({ type: 'corner-added', point: pixel });
    return;
  }
  if (state.outline === null) {
    traceAt(pixel, state, dispatch);
    return;
  }
  toggleAnchor(event, rect, state, dispatch);
}

function traceAt(
  pixel: { readonly x: number; readonly y: number },
  state: OutlinePhotoSession,
  dispatch: OutlinePhotoDispatch,
): void {
  const trace = state.trace;
  if (trace === null) return;
  dispatch({ type: 'busy-start', label: 'Tracing board outline…' });
  setTimeout(() => {
    const result = traceBoardOutline({
      rectified: trace.rectified,
      region: trace.region,
      pixelsPerMm: trace.pixelsPerMm,
      tapMm: applyHomography(trace.toMm, pixel),
    });
    if (!result.ok) dispatch({ type: 'error', error: result.reason });
    else dispatchTraced(result, state.reference === 'skip', dispatch);
    dispatch({ type: 'busy-end' });
  }, 0);
}

function dispatchTraced(
  result: Extract<ReturnType<typeof traceBoardOutline>, { readonly ok: true }>,
  skipReference: boolean,
  dispatch: OutlinePhotoDispatch,
): void {
  const anchors = boardOutlineAnchors(result.outlineMm);
  const order = defaultCaptureOrder(result.outlineMm, anchors);
  const bounds = outlineBounds(result.outlineMm);
  dispatch({
    type: 'traced',
    outline: result.outlineMm,
    anchors,
    firstAnchor: order?.[0] ?? anchors[0] ?? 0,
    width: skipReference ? '' : (bounds.maxX - bounds.minX).toFixed(1),
    height: skipReference ? '' : (bounds.maxY - bounds.minY).toFixed(1),
    partial: result.partial,
  });
}

function toggleAnchor(
  event: React.MouseEvent<HTMLCanvasElement>,
  rect: DOMRect,
  state: OutlinePhotoSession,
  dispatch: OutlinePhotoDispatch,
): void {
  if (state.image === null || state.trace === null || state.outline === null) return;
  const image = state.image;
  const inverse = invertMat3(state.trace.toMm);
  if (inverse === null) return;
  const screenVertices = state.outline.map((point) => {
    const imagePoint = applyHomography(inverse, point);
    return {
      x: (imagePoint.x * rect.width) / image.width,
      y: (imagePoint.y * rect.height) / image.height,
    };
  });
  const nearest = nearestOutlineVertex(
    { x: event.clientX - rect.left, y: event.clientY - rect.top },
    screenVertices,
  );
  if (nearest === null) return;
  const toggled = toggleOutlineAnchor(nearest, state.anchors);
  dispatch({ type: 'anchors-changed', anchors: toggled.anchors });
  dispatch({
    type: 'anchor-hint',
    hint: toggled.blocked ? 'Choose between 2 and 6 anchors.' : null,
  });
}
