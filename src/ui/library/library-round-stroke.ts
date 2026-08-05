import { resolveUnitScale } from '../../io/svg/svg-units';
import type { LibraryEntry } from './design-library-types';

const ROUND = 'round';
const NONE = 'none';

/** Resolve the pinned Tabler outline's round stroke into imported local mm. */
export function libraryRoundStrokeWidthMm(
  entry: LibraryEntry,
  svgText: string,
): number | undefined {
  if (entry.provenance.sourceKind !== 'tabler') return undefined;
  const document = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (document.querySelector('parsererror') !== null) return undefined;
  const root = document.documentElement;
  if (!hasSupportedRootPresentation(root)) return undefined;
  return scaledStrokeWidthMm(root);
}

function hasSupportedRootPresentation(root: Element): boolean {
  const stroke = normalizedAttribute(root, 'stroke');
  return !(
    root.tagName.toLowerCase() !== 'svg' ||
    normalizedAttribute(root, 'fill') !== NONE ||
    stroke === null ||
    stroke === NONE ||
    normalizedAttribute(root, 'stroke-linecap') !== ROUND ||
    normalizedAttribute(root, 'stroke-linejoin') !== ROUND ||
    hasIncompatibleDescendantPresentation(root)
  );
}

function scaledStrokeWidthMm(root: Element): number | undefined {
  const sourceWidth = Number(root.getAttribute('stroke-width'));
  const scale = resolveUnitScale(root);
  if (
    !(sourceWidth > 0) ||
    !Number.isFinite(sourceWidth) ||
    !(scale.scaleX > 0) ||
    scale.scaleX !== scale.scaleY
  ) {
    return undefined;
  }
  return sourceWidth * scale.scaleX;
}

function hasIncompatibleDescendantPresentation(root: Element): boolean {
  const inherited = {
    fill: normalizedAttribute(root, 'fill'),
    strokeWidth: normalizedAttribute(root, 'stroke-width'),
    strokeLinecap: normalizedAttribute(root, 'stroke-linecap'),
    strokeLinejoin: normalizedAttribute(root, 'stroke-linejoin'),
  };
  return Array.from(
    root.querySelectorAll('[fill], [stroke-width], [stroke-linecap], [stroke-linejoin]'),
  ).some((element) => {
    const fill = normalizedAttribute(element, 'fill');
    const strokeWidth = normalizedAttribute(element, 'stroke-width');
    const strokeLinecap = normalizedAttribute(element, 'stroke-linecap');
    const strokeLinejoin = normalizedAttribute(element, 'stroke-linejoin');
    return (
      (fill !== null && fill !== inherited.fill) ||
      (strokeWidth !== null && strokeWidth !== inherited.strokeWidth) ||
      (strokeLinecap !== null && strokeLinecap !== inherited.strokeLinecap) ||
      (strokeLinejoin !== null && strokeLinejoin !== inherited.strokeLinejoin)
    );
  });
}

function normalizedAttribute(element: Element, name: string): string | null {
  return element.getAttribute(name)?.trim().toLowerCase() ?? null;
}
