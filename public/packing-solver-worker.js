/* First-party host for the pinned classic Emscripten module with no-eval glue.
 * No network service is used. On completion, cancellation, errors or the time
 * limit the owning client asks this host to retire, then terminates it. */
/* global self, URL, importScripts, PackingSolver, setTimeout, console */
const mainScript = new URL('./vendor/packingsolver/49bf6c7/packingsolver.js', self.location.href)
  .href;
// This build boots pthreads from the enclosing worker URL. Its module installs
// the pthread handler when imported in a worker named em-pthread.
if (self.name === 'em-pthread') importScripts(mainScript);
// Chromium drops a nested worker's termination notice when it reaches this
// worker during this worker's own shutdown, and then waits for that pthread
// forever: this thread, its Wasm memory and the pthread's thread are never
// released. So the host terminates its own pthread workers first and stays idle
// past Chromium's 2 s forcible-termination delay, letting every notice reach a
// live host, before it reports that the client may terminate it.
const RETIRE_MS = 2_500;
const pthreads = [];
let started = false;
let retiring = false;
if (self.name !== 'em-pthread') {
  const NativeWorker = self.Worker;
  self.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      pthreads.push(this);
    }
  };
  const send = (message) => {
    if (!retiring) self.postMessage(message);
  };
  self.onmessage = async (event) => {
    if (event.data?.kind === 'retire') {
      if (retiring) return;
      retiring = true;
      for (const worker of pthreads.splice(0)) {
        // A pthread stopped inside its synchronous script load reports that load
        // as failed; the runtime's handlers would rethrow it, so contain it here.
        worker.onmessage = null;
        worker.onerror = (error) => error.preventDefault();
        worker.terminate();
      }
      setTimeout(() => self.postMessage({ kind: 'retired' }), RETIRE_MS);
      return;
    }
    if (retiring || started || event.data?.kind !== 'start') return;
    started = true;
    let session;
    try {
      if (!self.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
        throw new Error('Local advanced optimisation is unavailable in this browser context.');
      }
      importScripts(mainScript);
      const module = await PackingSolver({
        locateFile: (name) => new URL(name, mainScript).href,
        print: () => {
          /* Progress is delivered through session messages. */
        },
        printErr: (message) => console.warn('Advanced nesting engine:', message),
        onAbort: () =>
          send({
            kind: 'error',
            message: 'The advanced engine could not initialise. The standard draft is retained.',
          }),
      });
      // A terminated pthread can hold a solver lock: never call the module again.
      if (retiring) return;
      session = new module.Session();
      const error = session.start(
        'irregular',
        event.data.instance,
        JSON.stringify({
          optimization_mode: 'anytime',
          time_limit: 5,
          verbosity_level: 0,
        }),
      );
      if (error)
        throw new Error(JSON.parse(error).error || 'Advanced optimisation could not start.');
      const publish = (result) => {
        // A bound improvement has a null certificate, not a placement candidate.
        if (typeof result?.certificate === 'string' && result.certificate.trim() !== 'null')
          send({ kind: 'certificate', certificate: result.certificate });
        if (result?.error) throw new Error('The advanced engine could not finish this layout.');
      };
      const poll = () => {
        if (retiring) return;
        try {
          const value = JSON.parse(session.poll());
          for (const result of value.solutions || []) publish(result);
          if (value.done) {
            publish(value.result);
            session.delete();
            session = undefined;
            send({ kind: 'complete' });
          } else setTimeout(poll, 50);
        } catch {
          send({
            kind: 'error',
            message: 'Advanced optimisation stopped. The best valid draft is retained.',
          });
        }
      };
      poll();
    } catch {
      send({
        kind: 'error',
        message: 'Advanced optimisation is unavailable. The standard draft is retained.',
      });
    }
  };
}
