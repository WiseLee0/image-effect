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
  imageBitmap: ImageBitmap,
  textureUnit: number
): WebGLTexture | null {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + textureUnit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    imageBitmap
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  return texture;
}

export async function downloadImageBitmap(
  imageBitmap: ImageBitmap,
  fileName = "image.png"
) {
  // 1. 创建一个 canvas 元素
  const canvas = document.createElement("canvas");
  canvas.width = imageBitmap.width;
  canvas.height = imageBitmap.height;

  // 2. 将 ImageBitmap 绘制到 canvas 上
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(imageBitmap, 0, 0);

  // 3. 将 canvas 转换为 Blob
  canvas.toBlob((blob) => {
    if (!blob) {
      console.error("Failed to convert canvas to Blob.");
      return;
    }

    // 4. 创建下载链接
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName; // 设置下载的文件名
    document.body.appendChild(a);
    a.click(); // 触发下载

    // 5. 清理
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, "image/png"); // 可以改为 'image/jpeg' 或其他格式
}
