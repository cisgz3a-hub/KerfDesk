// Job Review warnings for laser lead-in and lead-out (ADR-626). Advisory
// only (rule 7): a contour without its lead is still cut, exactly as it would
// be with leads off, so nothing here can refuse Frame or Start.

type LeadDiagnostic =
  | {
      readonly kind: 'laser-leads-perforated';
      readonly layerId: string;
      readonly layerName: string;
      readonly count: number;
    }
  | {
      readonly kind: 'laser-leads-tabbed';
      readonly layerId: string;
      readonly layerName: string;
      readonly count: number;
    }
  | {
      readonly kind: 'laser-leads-adjusted';
      readonly layerId: string;
      readonly layerName: string;
      readonly shortened: number;
      readonly omitted: number;
    }
  | {
      readonly kind: 'laser-leads-side-unknown';
      readonly layerId: string;
      readonly layerName: string;
      readonly count: number;
      readonly aroundName: string;
      readonly aroundOpenPaths?: true;
    };

export function isLaserLeadDiagnostic<T extends { readonly kind: string }>(
  diagnostic: T,
): diagnostic is T & LeadDiagnostic {
  return (
    diagnostic.kind === 'laser-leads-perforated' ||
    diagnostic.kind === 'laser-leads-tabbed' ||
    diagnostic.kind === 'laser-leads-adjusted' ||
    diagnostic.kind === 'laser-leads-side-unknown'
  );
}

/** One warning per operation (by id: names can repeat) and kind, and for an
 * unknown side per operation holding the shapes; an operation compiled object
 * by object reports once per object. */
export function laserLeadWarnings(diagnostics: ReadonlyArray<LeadDiagnostic>): string[] {
  const merged: LeadDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const index = merged.findIndex((earlier) => sameWarning(earlier, diagnostic));
    const earlier = merged[index];
    if (earlier === undefined) merged.push(diagnostic);
    else merged[index] = mergedLeadDiagnostic(earlier, diagnostic);
  }
  return merged.map(laserLeadWarning);
}

function sameWarning(a: LeadDiagnostic, b: LeadDiagnostic): boolean {
  if (a.kind !== b.kind || a.layerId !== b.layerId) return false;
  return a.kind !== 'laser-leads-side-unknown' || b.kind !== 'laser-leads-side-unknown'
    ? true
    : a.aroundName === b.aroundName && a.aroundOpenPaths === b.aroundOpenPaths;
}

function mergedLeadDiagnostic(earlier: LeadDiagnostic, next: LeadDiagnostic): LeadDiagnostic {
  if (earlier.kind === 'laser-leads-tabbed' && next.kind === 'laser-leads-tabbed')
    return { ...earlier, count: earlier.count + next.count };
  if (earlier.kind === 'laser-leads-perforated' && next.kind === 'laser-leads-perforated')
    return { ...earlier, count: earlier.count + next.count };
  if (earlier.kind === 'laser-leads-adjusted' && next.kind === 'laser-leads-adjusted')
    return {
      ...earlier,
      shortened: earlier.shortened + next.shortened,
      omitted: earlier.omitted + next.omitted,
    };
  if (earlier.kind === 'laser-leads-side-unknown' && next.kind === 'laser-leads-side-unknown')
    return { ...earlier, count: earlier.count + next.count };
  return earlier;
}

function laserLeadWarning(diagnostic: LeadDiagnostic): string {
  const where = `Lead-in/lead-out on layer "${diagnostic.layerName}"`;
  switch (diagnostic.kind) {
    case 'laser-leads-perforated':
      return `${where}: ${shapes(diagnostic.count)} with perforation ${diagnostic.count === 1 ? 'gets' : 'get'} no leads. Perforation cuts the line as dashes, so there is no closed shape to lead into.`;
    case 'laser-leads-tabbed':
      return `${where}: ${shapes(diagnostic.count)} with tabs ${diagnostic.count === 1 ? 'gets' : 'get'} no leads. A tabbed shape starts and stops at its tabs, where the edge is broken anyway.`;
    case 'laser-leads-adjusted':
      return `${where}: ${adjustedParts(diagnostic.shortened, diagnostic.omitted)}, because a full lead there would leave the scrap side, come too close to another cut line or run off the bed. Check the preview.${diagnostic.omitted > 0 ? ' Where a lead is missing, that shape starts or stops on its edge, as with leads off.' : ''}`;
    case 'laser-leads-side-unknown':
      if (diagnostic.aroundOpenPaths === true) return openLinesWarning(where, diagnostic);
      return `${where}: ${shapes(diagnostic.count)} inside a closed shape on layer "${diagnostic.aroundName}", which has no leads, ${diagnostic.count === 1 ? 'gets' : 'get'} no leads. That shape may be a part, or only a score line or border, so which side is scrap is unknown. Turn on leads for "${diagnostic.aroundName}" if it cuts parts out, or set Lead side to Always outside or Always inside.`;
  }
}

// ADR-626 Amendments 8 and 10: open lines that close a region round a shape,
// or nearly close it, may be a part's outline that was never joined, such as a
// CAD plate drawn as LINEs or a plate drawn with one corner left open.
function openLinesWarning(
  where: string,
  diagnostic: Extract<LeadDiagnostic, { readonly kind: 'laser-leads-side-unknown' }>,
): string {
  const one = diagnostic.count === 1;
  return `${where}: ${shapes(diagnostic.count)} inside open lines on layer "${diagnostic.aroundName}" ${one ? 'gets' : 'get'} no leads. Those lines run all or nearly all the way round ${one ? 'it' : 'them'} but are not one closed shape, so they may be the outline of a part, and which side is scrap is unknown. Close the outline with Tools > Join paths, or set Lead side to Always outside or Always inside.`;
}

function adjustedParts(shortened: number, omitted: number): string {
  const parts: string[] = [];
  if (shortened > 0)
    parts.push(`${shapes(shortened)} ${shortened === 1 ? 'gets' : 'get'} a shorter lead`);
  if (omitted > 0)
    parts.push(
      `${shapes(omitted)} ${omitted === 1 ? 'gets' : 'get'} no lead-in or no lead-out on at least one pass`,
    );
  return parts.join(' and ');
}

function shapes(count: number): string {
  return count === 1 ? '1 shape' : `${count} shapes`;
}
