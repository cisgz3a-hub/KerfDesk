import { describe, expect, it, vi } from 'vitest';
import {
  buildAppCommands,
  commandById,
  runCommand,
  type AppCommandContext,
  type CommandId,
} from './command-registry';
import { baseCtx } from './command-registry-test-helpers';

describe('tools.close-open-fill-contours command', () => {
  it('is gated from closeable open Fill contour selection state', () => {
    const closeSelectedOpenFillContours = vi.fn();
    const disabled = buildAppCommands(
      baseCtx({ canCloseOpenFillContours: false, closeSelectedOpenFillContours }),
    );

    expect(commandById(disabled, 'tools.close-open-fill-contours').enabled).toBe(false);
    expect(runCommand(commandById(disabled, 'tools.close-open-fill-contours'))).toBe(false);
    expect(closeSelectedOpenFillContours).not.toHaveBeenCalled();

    const enabled = buildAppCommands(
      baseCtx({ canCloseOpenFillContours: true, closeSelectedOpenFillContours }),
    );
    expect(commandById(enabled, 'tools.close-open-fill-contours').enabled).toBe(true);
    expect(runCommand(commandById(enabled, 'tools.close-open-fill-contours'))).toBe(true);
    expect(closeSelectedOpenFillContours).toHaveBeenCalledTimes(1);
  });

  it('opens the tolerance review command when selected Fill contours are open', () => {
    const reviewCloseOpenFillContours = vi.fn();
    const disabled = buildAppCommands(
      baseCtx({
        canReviewCloseOpenFillContours: false,
        reviewCloseOpenFillContours,
      } as Partial<AppCommandContext>),
    );
    const id = 'tools.close-fill-contours-with-tolerance' as CommandId;

    expect(commandById(disabled, id).enabled).toBe(false);
    expect(runCommand(commandById(disabled, id))).toBe(false);
    expect(reviewCloseOpenFillContours).not.toHaveBeenCalled();

    const enabled = buildAppCommands(
      baseCtx({
        canReviewCloseOpenFillContours: true,
        reviewCloseOpenFillContours,
      } as Partial<AppCommandContext>),
    );
    expect(commandById(enabled, id).enabled).toBe(true);
    expect(runCommand(commandById(enabled, id))).toBe(true);
    expect(reviewCloseOpenFillContours).toHaveBeenCalledTimes(1);
  });
});
