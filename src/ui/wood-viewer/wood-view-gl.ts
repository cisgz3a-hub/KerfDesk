// wood-view-gl — WebGL2 and matrix plumbing for the ported preview (ADR-285).
// Verbatim behaviour from the standalone page: same program linking, same
// column-major matrix maths, same float16 packing.
//
// Separate from the scene so the scene module stays inside the file-size cap.

export type GlProgram = {
  readonly program: WebGLProgram;
  readonly uniforms: Readonly<Record<string, WebGLUniformLocation>>;
};

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error('WebGL could not create a shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
  }
  return shader;
}

/**
 * Links a program and indexes every active uniform by name.
 *
 * Attribute slot 0 is bound to both `aUv` and `aPos` because each program
 * declares only one of them; the surface grid and the board's sides never
 * share a program.
 *
 * @param gl The WebGL2 context.
 * @param vertexSource Vertex shader source.
 * @param fragmentSource Fragment shader source.
 * @returns The linked program and its uniform locations.
 */
export function linkProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): GlProgram {
  const program = gl.createProgram();
  if (program === null) throw new Error('WebGL could not create a program.');
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.bindAttribLocation(program, 0, 'aUv');
  gl.bindAttribLocation(program, 0, 'aPos');
  gl.bindAttribLocation(program, 1, 'aNrm');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
  }
  const uniforms: Record<string, WebGLUniformLocation> = {};
  const count: number = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let index = 0; index < count; index += 1) {
    const info = gl.getActiveUniform(program, index);
    if (info === null) continue;
    const location = gl.getUniformLocation(program, info.name);
    if (location !== null) uniforms[info.name.replace('[0]', '')] = location;
  }
  return { program, uniforms };
}

/** Column-major 4x4 multiply, matching the reference page. */
export function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] =
        (a[row] ?? 0) * (b[col * 4] ?? 0) +
        (a[4 + row] ?? 0) * (b[col * 4 + 1] ?? 0) +
        (a[8 + row] ?? 0) * (b[col * 4 + 2] ?? 0) +
        (a[12 + row] ?? 0) * (b[col * 4 + 3] ?? 0);
    }
  }
  return out;
}

export function perspective(
  fovYRad: number,
  aspect: number,
  near: number,
  far: number,
): Float32Array {
  const f = 1 / Math.tan(fovYRad / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[11] = -1;
  out[10] = (far + near) / (near - far);
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function lookAt(
  eye: readonly [number, number, number],
  centre: readonly [number, number, number],
  up: readonly [number, number, number],
): Float32Array {
  let zx = eye[0] - centre[0];
  let zy = eye[1] - centre[1];
  let zz = eye[2] - centre[2];
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl;
  zy /= zl;
  zz /= zl;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl;
  xy /= xl;
  xz /= xl;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return new Float32Array([
    xx,
    yx,
    zx,
    0,
    xy,
    yy,
    zy,
    0,
    xz,
    yz,
    zz,
    0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ]);
}

const f32 = new Float32Array(1);
const i32 = new Int32Array(f32.buffer);

/** IEEE-754 binary32 -> binary16, for the filterable R16F depth texture. */
export function toHalfFloat(value: number): number {
  f32[0] = value;
  const x = i32[0] ?? 0;
  let bits = (x >> 16) & 0x8000;
  let mantissa = (x >> 12) & 0x07ff;
  const exponent = (x >> 23) & 0xff;
  if (exponent < 103) return bits;
  if (exponent > 142) return bits | 0x7c00;
  if (exponent < 113) {
    mantissa |= 0x0800;
    return bits | ((mantissa >> (114 - exponent)) + ((mantissa >> (113 - exponent)) & 1));
  }
  bits |= ((exponent - 112) << 10) | (mantissa >> 1);
  return bits + (mantissa & 1);
}
