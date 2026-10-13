import fc from 'fast-check';

// Reproducible audit sampling; individual tests retain their original numRuns.
fc.configureGlobal({ seed: 20261013 });
