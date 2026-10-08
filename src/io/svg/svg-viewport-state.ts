import type { Bounds } from '../../core/scene';
import type { SvgMatrix } from './svg-curve-transform';
import type { PresentationState } from './svg-presentation';
import { multiplySvgMatrix } from './svg-transform-attribute';
import { svgViewportTransform, type SvgRect } from './svg-viewport';

/** The viewport clip is in parent space, before the viewBox maps child geometry. */
export function nestedSvgViewportState(
  element: Element,
  state: PresentationState,
  size: { readonly width: number | null; readonly height: number | null },
): PresentationState | null {
  const viewport = svgViewportTransform(element, state.viewport, size);
  if (viewport === null) return null;
  const transform = multiplySvgMatrix(state.transform, viewport.matrix);
  // Only this viewport's own clip-path uses its content coordinate system.
  // Ancestor clips keep the user space in which their owner specified them.
  const presented = {
    ...state,
    clips: state.clips.map((clip) =>
      clip.kind !== 'viewport' && clip.element === element
        ? { ...clip, transform, contentViewport: viewport.viewport }
        : clip,
    ),
  };
  return {
    ...clippedViewportState(element, presented, viewport.rectangle),
    transform,
    viewport: viewport.viewport,
  };
}

/** Map the root's millimetre viewport back through its axis-aligned viewBox mapping. */
export function rootSvgViewportState(
  element: Element,
  state: PresentationState,
  viewport: { readonly bounds: Bounds; readonly matrix: SvgMatrix },
): PresentationState {
  const { bounds, matrix } = viewport;
  return clippedViewportState(element, state, {
    x: (bounds.minX - matrix.e) / matrix.a,
    y: (bounds.minY - matrix.f) / matrix.d,
    width: (bounds.maxX - bounds.minX) / matrix.a,
    height: (bounds.maxY - bounds.minY) / matrix.d,
  });
}

function clippedViewportState(
  element: Element,
  state: PresentationState,
  rectangle: SvgRect,
): PresentationState {
  if (state.overflow !== 'hidden' && state.overflow !== 'scroll') return state;
  return {
    ...state,
    clips: [...state.clips, { kind: 'viewport', rectangle, transform: state.transform, element }],
  };
}
