// UX audit U5-P3-12: an uncaught error said "Error: Error: Cannot read
// properties of undefined", the toast's own label doubling the error's. The
// toast now says the design is still open and where to report it, with the
// developer text folded under its details, in one slot however many fire.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useToastStore } from '../state/toast-store';
import { UNCAUGHT_ERROR_MESSAGE, useGlobalErrorHandlers } from './use-global-error-handlers';

function Host(): null {
  useGlobalErrorHandlers();
  return null;
}

let unmount: () => void = () => undefined;

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<Host />));
  unmount = () => act(() => root.unmount());
});

afterEach(() => unmount());

it('names no developer text in the message and folds it under details', () => {
  const error = new TypeError("Cannot read properties of undefined (reading 'points')");
  act(() => {
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
  });
  const [toast] = useToastStore.getState().toasts;
  expect(toast?.message).toBe(UNCAUGHT_ERROR_MESSAGE);
  expect(toast?.message).not.toMatch(/^Error:/);
  expect(toast?.variant).toBe('error');
  expect(toast?.details).toEqual(["Cannot read properties of undefined (reading 'points')"]);
});

it('keeps a burst of failures in one slot', () => {
  act(() => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'first' }));
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: new Error('second') });
    window.dispatchEvent(rejection);
  });
  const toasts = useToastStore.getState().toasts;
  expect(toasts).toHaveLength(1);
  expect(toasts[0]?.details).toEqual(['Unhandled rejection: second']);
});
