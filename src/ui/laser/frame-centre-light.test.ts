import { beforeEach, describe, expect, it, vi } from 'vitest';

const centre = vi.hoisted(() => ({
  wanted: vi.fn(() => true),
  move: vi.fn(async () => undefined),
  report: vi.fn(),
}));
vi.mock('./centre-selection-light', () => ({
  centreLightAfterFrameWanted: centre.wanted,
  centreLightOnFramedArtwork: centre.move,
}));
vi.mock('./report-controller-action-failure', () => ({
  controllerActionFailureHandler: () => centre.report,
}));

import { centreLightAfterCleanFrame } from './use-frame-action';

describe('Frame button finishing with Centre & LED (ADR-604)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('centres the light on the framed artwork after a clean Frame', async () => {
    await centreLightAfterCleanFrame(true);
    expect(centre.move).toHaveBeenCalledOnce();
  });

  it('does nothing after a refused or cancelled Frame', async () => {
    await centreLightAfterCleanFrame(false);
    expect(centre.wanted).not.toHaveBeenCalled();
    expect(centre.move).not.toHaveBeenCalled();
  });

  it('does nothing when the machine setting is off or unusable', async () => {
    centre.wanted.mockReturnValueOnce(false);
    await centreLightAfterCleanFrame(true);
    expect(centre.move).not.toHaveBeenCalled();
  });

  it('reports a failed light move without throwing into the Frame result', async () => {
    centre.move.mockRejectedValueOnce(new Error('busy'));
    await expect(centreLightAfterCleanFrame(true)).resolves.toBeUndefined();
    expect(centre.report).toHaveBeenCalledWith(new Error('busy'));
  });
});
