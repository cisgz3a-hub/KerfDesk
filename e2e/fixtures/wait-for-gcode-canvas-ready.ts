import type { Page } from '@playwright/test';

const DEFAULT_READINESS_TIMEOUT_MS = 30_000;
const REFRESH_BUTTON_SELECTOR = 'button[title="Recompile this project\'s G-code"]';
const PLAYBACK_SELECTOR = '[aria-label="Playback"]';
const READY_SCENE_SELECTOR = '[data-viewer-state="ready"]';

/** Waits through a cheap DOM predicate so the probe excludes Playwright tree traversal. */
export async function waitForGcodeCanvasReady(
  page: Page,
  timeout = DEFAULT_READINESS_TIMEOUT_MS,
): Promise<void> {
  await page.waitForFunction(
    ({ refreshSelector, playbackSelector, readySceneSelector }) => {
      const refresh = document.querySelector<HTMLButtonElement>(refreshSelector);
      const playback = document.querySelector<HTMLElement>(playbackSelector);
      const scene = document.querySelector<HTMLElement>(readySceneSelector);
      return (
        refresh?.disabled === false &&
        playback !== null &&
        playback.offsetParent !== null &&
        scene !== null
      );
    },
    {
      refreshSelector: REFRESH_BUTTON_SELECTOR,
      playbackSelector: PLAYBACK_SELECTOR,
      readySceneSelector: READY_SCENE_SELECTOR,
    },
    { timeout },
  );
}
