import { resetDeterministicCounter } from '../../../src/core/types';

(globalThis as { __LF_DETERMINISTIC_IDS__?: boolean }).__LF_DETERMINISTIC_IDS__ = true;
resetDeterministicCounter();

export {};
