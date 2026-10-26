// Kept apart from workspace-ui.ts on purpose: most specs import that file, and
// a pull request's browser smoke runs every spec whose imports changed (ADR-647).
import { expect, type Page } from '@playwright/test';

/** The connect-time controller settings read has finished. A read with nothing
 * new to report raises no "Machine settings detected" toast (ADR-611
 * Amendment 2, ADR-648), so this waits on the store's own record of the read
 * and the end of the handshake. */
export async function expectControllerSettingsRead(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const moduleUrl = '/src/ui/state/laser-store.ts';
        const { useLaserStore } = (await import(moduleUrl)) as {
          useLaserStore: {
            getState: () => {
              lastSettingsReadAt: number | null;
              controllerQualification: { kind: string };
              controllerOperation: unknown;
            };
          };
        };
        const state = useLaserStore.getState();
        return (
          state.lastSettingsReadAt !== null &&
          state.controllerQualification.kind === 'qualified' &&
          state.controllerOperation === null
        );
      }),
    )
    .toBe(true);
}
