// Global jsdom canvas context stub (vitest setupFile). jsdom ships no canvas
// backend, so HTMLCanvasElement.prototype.getContext logs a "Not implemented"
// virtual-console error and returns null. That noise let UI tests pass while
// silently tolerating UNCLASSIFIED render errors from real draw paths (audit
// finding D-S08-002).
//
// This installs a benign default so components exercise their real 2D draw /
// WebGL fallback branch cleanly:
//   - '2d'  → a no-op CanvasRenderingContext2D proxy (draw calls succeed).
//   - webgl → null (a genuine "WebGL unavailable", the same signal a browser
//             without WebGL gives). Three.js turns that into its own catchable
//             error, so the 3D viewers hit their real no-webgl fallback.
//
// It is deliberately NOT broad enough to hide a real regression: PNG encoding
// (toDataURL) is left to jsdom (still throws), getImageData returns a zeroed
// (fully transparent) region of the requested size, and any test that needs
// richer behavior overrides getContext per-instance or via its own prototype
// spy (e.g. App.mount.test).

const TWO_D_CONTEXT_TYPE = '2d';

// jsdom exposes ImageData only when a canvas backend is present; without one,
// draw paths that build an ImageData for putImageData throw ReferenceError.
// Provide a minimal spec-shaped ImageData so those paths run cleanly.
if (typeof (globalThis as { ImageData?: unknown }).ImageData === 'undefined') {
  class ImageDataStub {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly colorSpace = 'srgb' as const;
    constructor(
      dataOrWidth: Uint8ClampedArray | number,
      widthOrHeight: number,
      maybeHeight?: number,
    ) {
      if (typeof dataOrWidth === 'number') {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = maybeHeight ?? dataOrWidth.length / 4 / widthOrHeight;
      }
    }
  }
  (globalThis as { ImageData?: unknown }).ImageData = ImageDataStub;
}

function canvas2dContextStub(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  // Proxy so every unspecified method is a no-op and every property read is
  // benign — matching the established stub shape in App.mount.test.tsx.
  return new Proxy(
    {
      canvas,
      createLinearGradient: () => ({ addColorStop: () => undefined }),
      createPattern: () => null,
      createRadialGradient: () => ({ addColorStop: () => undefined }),
      // Honor the requested sw×sh with a zeroed buffer so callers that read
      // .width/.height or index .data get a real (transparent) region — a 0×0
      // shape no browser produces would flow degenerate ImageData down a
      // "capture succeeded" branch. Clamp to a minimum 1×1 so a 0-sized ask
      // still yields a non-empty, spec-shaped result.
      getImageData: (_sx: number, _sy: number, sw: number, sh: number) => {
        const width = Math.max(1, Math.floor(Number.isFinite(sw) ? sw : 0));
        const height = Math.max(1, Math.floor(Number.isFinite(sh) ? sh : 0));
        // Cast: a structural stub shaped to the browser ImageData type in a
        // test-only harness — a full ImageData impl is unnecessary here.
        return {
          colorSpace: 'srgb',
          data: new Uint8ClampedArray(width * height * 4),
          height,
          width,
        } as ImageData;
      },
      // Cast: a structural stub shaped to the browser TextMetrics type in a
      // test-only harness; only .width is read by the draw paths under test.
      measureText: () => ({ width: 0 }) as TextMetrics,
    },
    {
      get(target, property: string | symbol) {
        if (property in target) return target[property as keyof typeof target];
        // Excluded so an unknown-property read never makes the context act like
        // a thenable/iterator: `await ctx` probes `then`, and spread/iteration
        // probe the Symbol.iterator/toPrimitive hooks — returning a function for
        // those would misbehave. They fall through to `undefined` instead.
        if (property === 'then') return undefined;
        if (property === Symbol.iterator || property === Symbol.toPrimitive) return undefined;
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}

const canvasElementCtor = (globalThis as { HTMLCanvasElement?: typeof HTMLCanvasElement })
  .HTMLCanvasElement;

if (canvasElementCtor) {
  const originalGetContext = canvasElementCtor.prototype.getContext;

  // The concrete return type is `RenderingContext | null`; the outer cast bridges
  // getContext's overloaded property signature without needing `any`.
  canvasElementCtor.prototype.getContext = function getContext(
    this: HTMLCanvasElement,
    contextId: string,
    ...rest: unknown[]
  ): RenderingContext | null {
    if (contextId === TWO_D_CONTEXT_TYPE) return canvas2dContextStub(this);
    // webgl / webgl2 / experimental-webgl: report unavailable cleanly.
    if (contextId.includes('webgl')) return null;
    return (originalGetContext as (...args: unknown[]) => RenderingContext | null).call(
      this,
      contextId,
      ...rest,
    );
  } as typeof canvasElementCtor.prototype.getContext;
}
