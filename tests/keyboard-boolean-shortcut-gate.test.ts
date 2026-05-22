/**
 * F45-08-004: Boolean keyboard shortcuts must use the same UI feature gate
 * as the context menu before invoking async Boolean work.
 *
 * Run: npx tsx tests/keyboard-boolean-shortcut-gate.test.ts
 */
import { entitlementService, type EntitlementState } from '../src/entitlements';
import { runBooleanKeyboardShortcut } from '../src/ui/hooks/useAppKeyboardWorkflow';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function setEntitlement(state: EntitlementState): void {
  (entitlementService as unknown as { state: EntitlementState }).state = state;
}

async function waitForMicrotasks(): Promise<void> {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function run(): Promise<void> {
  const originalConfirm = (globalThis as unknown as { confirm?: (message?: string) => boolean }).confirm;
  const originalOpen = (globalThis as unknown as { open?: (...args: unknown[]) => unknown }).open;
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;
  let confirmCalls = 0;
  let windowOpenCalls = 0;
  (globalThis as unknown as { confirm: (message?: string) => boolean }).confirm = () => {
    confirmCalls++;
    return false;
  };
  (globalThis as unknown as { window: { open: (...args: unknown[]) => null } }).window = {
    open: () => {
      windowOpenCalls++;
      return null;
    },
  };

  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);

  try {
    console.log('\n=== F45-08-004 Boolean keyboard shortcut gate ===\n');

    {
      setEntitlement({ tier: 'free', hasPro: false });
      let performCalls = 0;
      runBooleanKeyboardShortcut(
        {
          performBoolean: async () => {
            performCalls++;
          },
        },
        'union',
      );
      await waitForMicrotasks();
      assert(performCalls === 1, 'Temporary Pro access lets a free-state shortcut call performBoolean');
      assert(confirmCalls === 0, 'Temporary Pro access does not invoke the UI Pro gate');
      assert(windowOpenCalls === 0, 'Dismissed Pro gate does not open the landing page');
      assert(unhandled.length === 0, 'Temporary Pro shortcut produces no unhandled rejection');
    }

    {
      setEntitlement({ tier: 'paid', hasPro: true, features: ['nesting'] });
      let performCalls = 0;
      runBooleanKeyboardShortcut(
        {
          performBoolean: async () => {
            performCalls++;
          },
        },
        'subtract',
      );
      await waitForMicrotasks();
      assert(performCalls === 1, 'Temporary Pro access lets a partial-license shortcut call performBoolean');
      assert(confirmCalls === 0, 'Temporary Pro access does not invoke the UI Pro gate for partial licenses');
      assert(unhandled.length === 0, 'Temporary Pro partial-license shortcut produces no unhandled rejection');
    }

    {
      setEntitlement({ tier: 'paid', hasPro: true, features: ['boolean_ops'] });
      const seen: string[] = [];
      runBooleanKeyboardShortcut(
        {
          performBoolean: async op => {
            seen.push(op);
          },
        },
        'intersect',
      );
      await waitForMicrotasks();
      assert(seen.join(',') === 'intersect', 'Allowed shortcut calls performBoolean with the requested operation');
      assert(confirmCalls === 0, 'Allowed shortcut does not invoke the Pro gate');
      assert(unhandled.length === 0, 'Allowed shortcut success produces no unhandled rejection');
    }
  } finally {
    process.off('unhandledRejection', onUnhandled);
    if (originalConfirm) {
      (globalThis as unknown as { confirm: (message?: string) => boolean }).confirm = originalConfirm;
    } else {
      delete (globalThis as unknown as { confirm?: (message?: string) => boolean }).confirm;
    }
    if (originalOpen) {
      (globalThis as unknown as { open: (...args: unknown[]) => unknown }).open = originalOpen;
    } else {
      delete (globalThis as unknown as { open?: (...args: unknown[]) => unknown }).open;
    }
    if (originalWindow !== undefined) {
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    } else {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  }
}

void run().then(
  () => {
    if (failed > 0) {
      console.error(`\n${failed} assertion(s) failed.`);
      process.exit(1);
    }

    console.log(`\nAll ${passed} assertions passed.`);
  },
  error => {
    console.error(error);
    process.exit(1);
  },
);
