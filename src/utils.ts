export function createShader(
  gl: WebGLRenderingContext,
  type: GLenum,
  source: string
) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}
export function createProgram(
  gl: WebGLRenderingContext,
  vs: WebGLShader,
  fs: WebGLShader
) {
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

export function getProgram(
  gl: WebGLRenderingContext,
  vsSource: string,
  fsSource: string
) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource)!;
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource)!;
  return createProgram(gl, vertexShader, fragmentShader);
}

export function createTextureFromImageBitmap(
  gl: WebGLRenderingContext,
  imageBitmap: ImageBitmap
): WebGLTexture | null {
  const texture = gl.createTexture();
  if (!texture) {
    console.error("Unable to create texture");
    return null;
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);

  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    imageBitmap
  );

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // gl.bindTexture(gl.TEXTURE_2D, null);

  return texture;
}
