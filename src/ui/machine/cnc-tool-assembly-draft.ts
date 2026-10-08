import {
  normalizeCncToolAssembly,
  type CncToolAssemblyMetadata,
} from '../../core/cnc/cnc-tool-assembly';
import type { CncTool } from '../../core/scene';

export type CncHolderDraft = {
  readonly name: string;
  readonly startMm: string;
  readonly lengthMm: string;
  readonly diameterMm: string;
};
export type CncAssemblyDraft = {
  readonly fluteLengthMm: string;
  readonly stickoutMm: string;
  readonly shankDiameterMm: string;
  readonly holders: ReadonlyArray<CncHolderDraft>;
};
export function cncAssemblyDraft(tool: CncTool): CncAssemblyDraft {
  return {
    fluteLengthMm: tool.fluteLengthMm?.toString() ?? '',
    stickoutMm: tool.stickoutMm?.toString() ?? '',
    shankDiameterMm: tool.shankDiameterMm?.toString() ?? '',
    holders: (tool.holderSegments ?? []).map((s) => ({
      name: s.name,
      startMm: String(s.startMm),
      lengthMm: String(s.lengthMm),
      diameterMm: String(s.diameterMm),
    })),
  };
}
export function parseCncAssemblyDraft(draft: CncAssemblyDraft): {
  readonly assembly: CncToolAssemblyMetadata | null;
  readonly error: string | null;
} {
  const dimensions = [draft.fluteLengthMm, draft.stickoutMm, draft.shankDiameterMm];
  if (
    dimensions.some(
      (value) => value.trim() !== '' && (!Number.isFinite(Number(value)) || Number(value) <= 0),
    )
  )
    return {
      assembly: null,
      error:
        'Known flute, stickout and shank dimensions must be finite positive millimetres. Leave unknown dimensions blank.',
    };
  if (draft.holders.length > 32 || draft.holders.some((s) => !validHolderDraft(s)))
    return {
      assembly: null,
      error:
        'Each holder needs a name, nonnegative distance above the tip, and positive length and diameter in millimetres.',
    };
  const holderSegments = draft.holders.map((s) => ({
    name: s.name.trim(),
    startMm: Number(s.startMm),
    lengthMm: Number(s.lengthMm),
    diameterMm: Number(s.diameterMm),
  }));
  const assembly = normalizeCncToolAssembly({
    ...(draft.fluteLengthMm.trim() === '' ? {} : { fluteLengthMm: Number(draft.fluteLengthMm) }),
    ...(draft.stickoutMm.trim() === '' ? {} : { stickoutMm: Number(draft.stickoutMm) }),
    ...(draft.shankDiameterMm.trim() === ''
      ? {}
      : { shankDiameterMm: Number(draft.shankDiameterMm) }),
    ...(holderSegments.length === 0 ? {} : { holderSegments }),
  });
  return { assembly, error: null };
}
function validHolderDraft(s: CncHolderDraft): boolean {
  return (
    s.name.trim() !== '' &&
    s.name.length <= 120 &&
    s.startMm.trim() !== '' &&
    Number.isFinite(Number(s.startMm)) &&
    Number(s.startMm) >= 0 &&
    [s.lengthMm, s.diameterMm].every(
      (value) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) > 0,
    ) &&
    Number.isFinite(Number(s.startMm) + Number(s.lengthMm))
  );
}
