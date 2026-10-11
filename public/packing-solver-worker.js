/* First-party host for the pinned classic Emscripten module with no-eval glue.
 * No network service is used. The owning client terminates this worker and its
 * pthread descendants on completion, cancellation, errors or the time limit. */
/* global self, URL, importScripts, PackingSolver, setTimeout, console */
const mainScript = new URL('./vendor/packingsolver/49bf6c7/packingsolver.js', self.location.href)
  .href;
// This build boots pthreads from the enclosing worker URL. Its module installs
// the pthread handler when imported in a worker named em-pthread.
if (self.name === 'em-pthread') importScripts(mainScript);
let started = false;
if (self.name !== 'em-pthread')
  self.onmessage = async (event) => {
    if (started || event.data?.kind !== 'start') return;
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
          self.postMessage({
            kind: 'error',
            message: 'The advanced engine could not initialise. The standard draft is retained.',
          }),
      });
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
          self.postMessage({ kind: 'certificate', certificate: result.certificate });
        if (result?.error) throw new Error('The advanced engine could not finish this layout.');
      };
      const poll = () => {
        try {
          const value = JSON.parse(session.poll());
          for (const result of value.solutions || []) publish(result);
          if (value.done) {
            publish(value.result);
            session.delete();
            session = undefined;
            self.postMessage({ kind: 'complete' });
          } else setTimeout(poll, 50);
        } catch {
          self.postMessage({
            kind: 'error',
            message: 'Advanced optimisation stopped. The best valid draft is retained.',
          });
        }
      };
      poll();
    } catch {
      self.postMessage({
        kind: 'error',
        message: 'Advanced optimisation is unavailable. The standard draft is retained.',
      });
    }
  };
