// One way to retire a Web Worker (code quality audit C1, C5-P3-2). Ten worker
// clients each wrote their own; three only called `terminate()` and relied on
// an identity check to ignore anything the old worker might still deliver.

/**
 * Drops the worker's handlers and terminates it. With the handlers gone, a
 * message or error already queued for the page when it stops can reach nothing.
 */
export function stopWorker(worker: Worker): void {
  worker.onmessage = null;
  worker.onerror = null;
  worker.onmessageerror = null;
  worker.terminate();
}
