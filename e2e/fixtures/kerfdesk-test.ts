import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type FixtureEvent = Readonly<Record<string, unknown>> & { readonly kind: string };
export interface OpenFileFixture {
  readonly name: string;
  readonly text?: string;
  readonly kind?: 'text' | 'png-fixture';
  readonly width?: number;
  readonly height?: number;
}

export interface KerfDeskFixture {
  readonly events: () => Promise<readonly FixtureEvent[]>;
  readonly savedFiles: () => Promise<Readonly<Record<string, string>>>;
  readonly emitSerialLine: (line: string) => Promise<void>;
  readonly setSerialSetting: (id: number, value: string) => Promise<void>;
  readonly acknowledgeSerial: (count: number) => Promise<void>;
  readonly disconnectSerial: () => Promise<void>;
  readonly setAutoAcknowledge: (enabled: boolean) => Promise<void>;
  readonly setOpenFiles: (files: readonly OpenFileFixture[]) => Promise<void>;
}

const browserFixturePath = fileURLToPath(new URL('./browser-apis.js', import.meta.url));
const projectFixturePath = fileURLToPath(new URL('./project-basic.lf2', import.meta.url));
const browserFixtureSource = readFileSync(browserFixturePath, 'utf8').replace(
  "'__KERFDESK_E2E_PROJECT_FIXTURE__'",
  JSON.stringify(readFileSync(projectFixturePath, 'utf8')),
);

export const test = base.extend<{ kerfdesk: KerfDeskFixture }>({
  kerfdesk: [
    async ({ page }, use) => {
      const pageErrors: Error[] = [];
      page.on('pageerror', (error) => pageErrors.push(error));
      await page.addInitScript({ content: browserFixtureSource });
      await use(createFixtureControl(page, pageErrors));
    },
    { auto: true },
  ],
});

function createFixtureControl(page: Page, pageErrors: readonly Error[]): KerfDeskFixture {
  return {
    events: async () => {
      const events = await page.evaluate(
        () =>
          (
            window as typeof window & {
              __KERFDESK_E2E__?: { events: FixtureEvent[] };
            }
          ).__KERFDESK_E2E__?.events ?? null,
      );
      if (events !== null) return structuredClone(events);
      throw new Error(`Browser fixture failed to initialize: ${formatPageErrors(pageErrors)}`);
    },
    savedFiles: () =>
      page.evaluate(() =>
        structuredClone(
          (
            window as typeof window & {
              __KERFDESK_E2E__: { savedFiles: Record<string, string> };
            }
          ).__KERFDESK_E2E__.savedFiles,
        ),
      ),
    emitSerialLine: (line) =>
      page.evaluate((value) => {
        (
          window as typeof window & {
            __KERFDESK_E2E__: { emitSerialLine: (line: string) => void };
          }
        ).__KERFDESK_E2E__.emitSerialLine(value);
      }, line),
    setSerialSetting: (id, value) =>
      page.evaluate(
        ([settingId, settingValue]) => {
          (
            window as typeof window & {
              __KERFDESK_E2E__: {
                setSerialSetting: (id: number, value: string) => void;
              };
            }
          ).__KERFDESK_E2E__.setSerialSetting(settingId, settingValue);
        },
        [id, value] as const,
      ),
    acknowledgeSerial: (count) =>
      page.evaluate((value) => {
        (
          window as typeof window & {
            __KERFDESK_E2E__: { acknowledgeSerial: (count: number) => void };
          }
        ).__KERFDESK_E2E__.acknowledgeSerial(value);
      }, count),
    disconnectSerial: () =>
      page.evaluate(() => {
        (
          window as typeof window & {
            __KERFDESK_E2E__: { disconnectSerial: () => void };
          }
        ).__KERFDESK_E2E__.disconnectSerial();
      }),
    setAutoAcknowledge: (enabled) =>
      page.evaluate((value) => {
        (
          window as typeof window & {
            __KERFDESK_E2E__: { setAutoAcknowledge: (enabled: boolean) => void };
          }
        ).__KERFDESK_E2E__.setAutoAcknowledge(value);
      }, enabled),
    setOpenFiles: (files) =>
      page.evaluate((value) => {
        (
          window as typeof window & {
            __KERFDESK_E2E__: {
              setOpenFiles: (files: readonly OpenFileFixture[]) => void;
            };
          }
        ).__KERFDESK_E2E__.setOpenFiles(value);
      }, files),
  };
}

function formatPageErrors(errors: readonly Error[]): string {
  return errors.length === 0
    ? 'no page error was captured'
    : errors.map((error) => error.stack).join('\n');
}

export { expect, type Locator, type Page };
