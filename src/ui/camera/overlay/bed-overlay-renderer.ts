// WebGL2 host for the bed overlay shader (ADR-440): owns one context on the
// overlay canvas, one program and one frame texture, and redraws the whole
// canvas from the latest camera frame on every draw() call.
//
// The canvas is composited over the workspace by the page, so the drawing
// buffer is cleared to transparent and the shader writes premultiplied colour
// straight into it (no blending). A lost context is survivable: the renderer
// goes quiet, and rebuilds its GPU objects when the browser restores it.

import {
  BED_OVERLAY_FRAGMENT_SHADER,
  BED_OVERLAY_FRAME_SAMPLER,
  BED_OVERLAY_UNIFORM_KINDS,
  BED_OVERLAY_VERTEX_SHADER,
  type BedOverlayUniformKind,
  type BedOverlayUniforms,
} from './bed-overlay-shader';

export type BedOverlayRenderer = {
  /**
   * Upload `source` and redraw. The canvas backing store is kept at
   * uniforms.uCanvasSize so the shader's y flip always matches it. A frame that
   * cannot be uploaded clears the overlay instead of throwing, so a stale image
   * never stays registered on the bed.
   */
  draw(
    source: TexImageSource,
    sourceWidth: number,
    sourceHeight: number,
    uniforms: BedOverlayUniforms,
  ): void;
  /** Make the overlay fully transparent. */
  clear(): void;
  /** Release GPU objects and listeners; later calls are no-ops. */
  dispose(): void;
  /** True while the context is lost (or could not be rebuilt after a restore). */
  readonly lost: boolean;
};

type UniformName = keyof BedOverlayUniforms;

// Cast: Object.keys widens to string[]; the kinds table is typed to have
// exactly the BedOverlayUniforms keys (satisfies Record<keyof ..., ...>).
const UNIFORM_NAMES = Object.keys(BED_OVERLAY_UNIFORM_KINDS) as UniformName[];

const FRAME_TEXTURE_UNIT = 0;

const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
};

type GpuResources = {
  readonly program: WebGLProgram;
  readonly texture: WebGLTexture;
  readonly vertexArray: WebGLVertexArrayObject;
  readonly locations: ReadonlyMap<UniformName, WebGLUniformLocation | null>;
};

export function createBedOverlayRenderer(canvas: HTMLCanvasElement): BedOverlayRenderer | null {
  const gl = webgl2Context(canvas);
  if (gl === null) return null;
  let resources = createResources(gl);
  if (resources === null) return null;
  let lost = false;
  let disposed = false;

  const onLost = (event: Event): void => {
    // Without preventDefault the browser never offers webglcontextrestored.
    event.preventDefault();
    lost = true;
    // The GPU objects died with the context; deleting them is neither needed nor possible.
    resources = null;
  };
  const onRestored = (): void => {
    if (disposed) return;
    resources = createResources(gl);
    lost = resources === null;
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  // The lost event is dispatched asynchronously, so also ask the context.
  const live = (): GpuResources | null =>
    disposed || lost || gl.isContextLost() ? null : resources;

  return {
    get lost() {
      return lost || (!disposed && gl.isContextLost());
    },
    draw(source, sourceWidth, sourceHeight, uniforms) {
      const res = live();
      if (res === null) return;
      if (!(sourceWidth > 0 && sourceHeight > 0)) {
        clearCanvas(gl);
        return;
      }
      drawFrame(gl, canvas, res, source, uniforms);
    },
    clear() {
      if (live() !== null) clearCanvas(gl);
    },
    dispose() {
      if (disposed) return;
      const res = live();
      disposed = true;
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      if (res !== null) {
        clearCanvas(gl);
        deleteResources(gl, res);
      }
      resources = null;
    },
  };
}

function webgl2Context(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  try {
    return canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
  } catch {
    // A canvas already bound to another context type, or a sandboxed GPU, throws.
    return null;
  }
}

function drawFrame(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  res: GpuResources,
  source: TexImageSource,
  uniforms: BedOverlayUniforms,
): void {
  const [width, height] = uniforms.uCanvasSize;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  clearCanvas(gl);
  gl.activeTexture(gl.TEXTURE0 + FRAME_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, res.texture);
  if (!uploadFrame(gl, source)) return;
  gl.useProgram(res.program);
  applyUniforms(gl, res.locations, uniforms);
  gl.bindVertexArray(res.vertexArray);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function uploadFrame(gl: WebGL2RenderingContext, source: TexImageSource): boolean {
  try {
    // Re-specifying level 0 each frame lets the source change size freely
    // (camera renegotiation) without the renderer tracking it.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return true;
  } catch {
    // Tainted cross-origin frames and closed ImageBitmaps throw; skip the frame.
    return false;
  }
}

function clearCanvas(gl: WebGL2RenderingContext): void {
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

function applyUniforms(
  gl: WebGL2RenderingContext,
  locations: ReadonlyMap<UniformName, WebGLUniformLocation | null>,
  uniforms: BedOverlayUniforms,
): void {
  for (const name of UNIFORM_NAMES) {
    setUniform(gl, locations.get(name) ?? null, BED_OVERLAY_UNIFORM_KINDS[name], uniforms[name]);
  }
}

function setUniform(
  gl: WebGL2RenderingContext,
  location: WebGLUniformLocation | null,
  kind: BedOverlayUniformKind,
  value: number | ReadonlyArray<number>,
): void {
  const data = typeof value === 'number' ? [value] : value;
  switch (kind) {
    case 'float':
      gl.uniform1fv(location, data);
      return;
    case 'vec2':
      gl.uniform2fv(location, data);
      return;
    case 'vec3':
      gl.uniform3fv(location, data);
      return;
    case 'vec4':
      gl.uniform4fv(location, data);
      return;
    case 'mat3':
      // Packed column-major by bedOverlayUniforms, so no transpose.
      gl.uniformMatrix3fv(location, false, data);
      return;
  }
}

function createResources(gl: WebGL2RenderingContext): GpuResources | null {
  if (gl.isContextLost()) return null;
  const program = linkProgram(gl);
  if (program === null) return null;
  const texture: WebGLTexture | null = gl.createTexture();
  const vertexArray: WebGLVertexArrayObject | null = gl.createVertexArray();
  if (texture === null || vertexArray === null) {
    gl.deleteProgram(program);
    if (texture !== null) gl.deleteTexture(texture);
    if (vertexArray !== null) gl.deleteVertexArray(vertexArray);
    return null;
  }
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // No mipmaps: LINEAR minification keeps level 0 alone complete.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // Row 0 of the frame must land at v = 0: the shader's v runs down the image.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, BED_OVERLAY_FRAME_SAMPLER), FRAME_TEXTURE_UNIT);
  const locations = new Map(
    UNIFORM_NAMES.map((name) => [name, gl.getUniformLocation(program, name)] as const),
  );
  return { program, texture, vertexArray, locations };
}

function linkProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, BED_OVERLAY_VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, BED_OVERLAY_FRAGMENT_SHADER);
  const program: WebGLProgram | null =
    vertex !== null && fragment !== null ? gl.createProgram() : null;
  if (program !== null && vertex !== null && fragment !== null) {
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
  }
  // A linked program keeps its own copy; the shader objects are done either way.
  if (vertex !== null) gl.deleteShader(vertex);
  if (fragment !== null) gl.deleteShader(fragment);
  if (program === null) return null;
  if (gl.getProgramParameter(program, gl.LINK_STATUS) === true) return program;
  gl.deleteProgram(program);
  return null;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: GLenum,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true) return shader;
  gl.deleteShader(shader);
  return null;
}

function deleteResources(gl: WebGL2RenderingContext, res: GpuResources): void {
  gl.deleteVertexArray(res.vertexArray);
  gl.deleteTexture(res.texture);
  gl.deleteProgram(res.program);
}
