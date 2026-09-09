import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

/** Launch settings that keep the packaged GUI visible for the native observation. */
export function nativeSmokeLaunchOptions(executable) {
  return {
    cwd: dirname(executable),
    stdio: ['ignore', 'pipe', 'pipe'],
    // This GUI's visibility is the subject of the test, not a background helper.
    windowsHide: false,
  };
}

/** Observe this one disposable GUI process; never relaunch or kill by process name. */
export function collectNativeSmokeProcess(executable, args, options) {
  return new Promise((resolveResult) => {
    const context = {
      child: null,
      spawned: false,
      exited: false,
      settled: false,
      code: null,
      signal: null,
      stdout: '',
      stderr: '',
      failure: null,
      terminationRequested: false,
      terminationAccepted: null,
      errors: [],
      listeners: [],
      runtimeTimer: null,
      drainTimer: null,
      resolveResult,
      setTimer: options.setTimer ?? setTimeout,
      clearTimer: options.clearTimer ?? clearTimeout,
      drainMs: options.drainMs ?? 5000,
    };
    try {
      context.child = (options.spawnProcess ?? spawn)(
        executable,
        args,
        nativeSmokeLaunchOptions(executable),
      );
      observeProcess(context);
      context.runtimeTimer = context.setTimer(() => {
        fail(context, 'timeout', `packaged app exceeded ${options.timeoutMs} ms`);
        beginDrain(context);
        requestTermination(context);
      }, options.timeoutMs);
    } catch (error) {
      fail(context, 'spawn-error', error.message);
      finish(context, context.child === null);
    }
  });
}

function observeProcess(context) {
  const child = context.child;
  for (const stream of ['stdout', 'stderr']) {
    child[stream].setEncoding('utf8');
    listen(context, child[stream], 'data', (chunk) => {
      context[stream] += chunk;
    });
    listen(context, child[stream], 'error', (error) =>
      processError(context, error, `${stream}-error`),
    );
  }
  listen(context, child, 'spawn', () => {
    context.spawned = true;
  });
  listen(context, child, 'error', (error) => processError(context, error));
  listen(context, child, 'exit', (code, signal) => {
    context.exited = true;
    context.code = code;
    context.signal = signal;
    if (code !== 0) {
      fail(context, 'exit', `packaged app exited ${code} (signal ${signal ?? 'none'})`);
    }
    // The app met its runtime deadline; trailing/inherited pipes have a separate grace.
    context.clearTimer(context.runtimeTimer);
    beginDrain(context);
  });
  listen(context, child, 'close', (code, signal) => {
    context.code = code;
    context.signal = signal;
    finish(context, true);
  });
}

function listen(context, emitter, event, listener) {
  const owned = (...args) => {
    if (!context.settled) listener(...args);
  };
  context.listeners.push([emitter, event, owned]);
  emitter.on(event, owned);
}

function fail(context, kind, message) {
  context.failure ??= { kind, message };
}

function processError(context, error, kind) {
  fail(context, kind ?? (context.spawned ? 'process-error' : 'spawn-error'), error.message);
  context.errors.push(error.message);
  context.clearTimer(context.runtimeTimer);
  beginDrain(context);
  if (context.spawned) requestTermination(context);
}

function beginDrain(context) {
  if (context.drainTimer !== null) return;
  context.drainTimer = context.setTimer(() => {
    fail(context, 'drain-timeout', `packaged app stdio did not close within ${context.drainMs} ms`);
    finish(context, false);
  }, context.drainMs);
}

function requestTermination(context) {
  if (context.terminationRequested || context.exited) return;
  context.terminationRequested = true;
  try {
    context.terminationAccepted = context.child.kill();
  } catch (error) {
    context.errors.push(`termination failed: ${error.message}`);
  }
}

function finish(context, childClosed) {
  if (context.settled) return;
  context.settled = true;
  context.clearTimer(context.runtimeTimer);
  context.clearTimer(context.drainTimer);
  for (const [emitter, event, listener] of context.listeners) emitter.off(event, listener);
  if (context.child !== null) {
    // Late errors after a bounded fallback must not crash or republish the observation.
    installLateErrorSink(context.child);
    installLateErrorSink(context.child.stdout);
    installLateErrorSink(context.child.stderr);
    if (!childClosed) {
      context.child.unref();
      context.child.stdout?.destroy();
      context.child.stderr?.destroy();
    }
  }
  context.resolveResult({
    code: context.code,
    signal: context.signal,
    spawned: context.spawned,
    exited: context.exited,
    childClosed,
    logsComplete: childClosed,
    stdout: context.stdout,
    stderr: context.stderr,
    failure: context.failure,
    terminationRequested: context.terminationRequested,
    terminationAccepted: context.terminationAccepted,
    errors: context.errors,
  });
}

function installLateErrorSink(emitter) {
  emitter?.on('error', () => {
    // This observation is terminal; a late error cannot replace or republish it.
  });
}
