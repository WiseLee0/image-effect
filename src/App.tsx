import { useEffect, useRef } from "react";
import { createTextureFromImageBitmap, getProgram } from "./utils";
import vsSource from "./filter.vert?raw";
import fsSource from "./filter.frag?raw";
import * as dat from "dat.gui";
import imageURL from "./image.jpg";

const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext>(null);
  const programRef = useRef<WebGLProgram>(null);
  const uniformsRef = useRef<any>({
    globalTint: 0,
    globalColor: 0,
    globalShadows: 0,
    globalHighlights: 0,
    globalExposure: 0,
    globalTemperature: 0,
    globalContrast: 0,
    highlightShadowThreshold: 0.5,
    colorConversionType: 0,
  });

  const resize = (imageWidth: number, imageHeight: number) => {
    if (!canvasRef.current || !glRef.current) return;
    const gl = glRef.current;
    const canvas = canvasRef.current;
    const maxSize = 800;
    let clampedImageWidth = imageWidth;
    let clampedImageHeight = imageHeight;
    if (clampedImageWidth > maxSize || clampedImageHeight > maxSize) {
      const scale = Math.min(
        maxSize / clampedImageWidth,
        maxSize / clampedImageHeight
      );
      clampedImageWidth *= scale;
      clampedImageHeight *= scale;
    }
    const imageAspect = clampedImageWidth / clampedImageHeight;
    const displayWidth = maxSize;
    const displayHeight = maxSize;
    const canvasAspect = displayWidth / displayHeight;
    let renderWidth, renderHeight;
    if (imageAspect > canvasAspect) {
      renderWidth = displayWidth;
      renderHeight = displayWidth / imageAspect;
    } else {
      renderHeight = displayHeight;
      renderWidth = displayHeight * imageAspect;
    }
    canvas.width = renderWidth * devicePixelRatio;
    canvas.height = renderHeight * devicePixelRatio;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    canvas.style.width = `${renderWidth}px`;
    canvas.style.height = `${renderHeight}px`;
  };

  const initWebGL = () => {
    if (!canvasRef.current) return;
    const gl = canvasRef.current.getContext("webgl2", {
      premultipliedAlpha: true,
    })!;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.enable(gl.BLEND);
    gl.blendColor(0, 0, 0, 0);
    gl.blendFuncSeparate(
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA
    );
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
    const program = getProgram(gl, vsSource, fsSource)!;
    const positions = new Float32Array([
      -1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1,
    ]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    const aPosition = gl.getAttribLocation(program, "aPosition");
    const aTexCoord = gl.getAttribLocation(program, "aTexCoord");
    gl.enableVertexAttribArray(aPosition);
    gl.enableVertexAttribArray(aTexCoord);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 16, 8);
    glRef.current = gl;
    programRef.current = program;
    return gl;
  };

  const drawScene = () => {
    const gl = glRef.current;
    const program = programRef.current;
    const uniforms = uniformsRef.current;
    if (!gl || !program || !uniforms) return;
    gl.useProgram(program);
    const uniformLocations = {
      globalTint: gl.getUniformLocation(program, "globalTint"),
      globalColor: gl.getUniformLocation(program, "globalColor"),
      globalShadows: gl.getUniformLocation(program, "globalShadows"),
      globalHighlights: gl.getUniformLocation(program, "globalHighlights"),
      globalExposure: gl.getUniformLocation(program, "globalExposure"),
      globalTemperature: gl.getUniformLocation(program, "globalTemperature"),
      globalContrast: gl.getUniformLocation(program, "globalContrast"),
      highlightShadowThreshold: gl.getUniformLocation(
        program,
        "highlightShadowThreshold"
      ),
      colorConversionType: gl.getUniformLocation(
        program,
        "colorConversionType"
      ),
      alpha: gl.getUniformLocation(program, "alpha"),
    };
    gl.uniform1f(uniformLocations.globalTint, uniforms.globalTint);
    gl.uniform1f(uniformLocations.globalColor, uniforms.globalColor);
    gl.uniform1f(uniformLocations.globalShadows, uniforms.globalShadows);
    gl.uniform1f(uniformLocations.globalHighlights, uniforms.globalHighlights);
    gl.uniform1f(uniformLocations.globalExposure, uniforms.globalExposure);
    gl.uniform1f(
      uniformLocations.globalTemperature,
      uniforms.globalTemperature
    );
    gl.uniform1f(uniformLocations.globalContrast, uniforms.globalContrast);
    gl.uniform1f(
      uniformLocations.highlightShadowThreshold,
      uniforms.highlightShadowThreshold
    );
    gl.uniform1i(
      uniformLocations.colorConversionType,
      uniforms.colorConversionType
    );
    gl.uniform1f(uniformLocations.alpha, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const controlPannel = () => {
    const controls = {
      replaceImage: () => replaceImage(), // 替换图片按钮
    };
    const gui = new dat.GUI({
      width: 300,
    });
    const updateUniform = () => {
      drawScene();
    };
    gui
      .add(uniformsRef.current, "globalExposure", -1.0, 1.0)
      .name("曝光")
      .step(0.01)
      .onChange(updateUniform);
    gui
      .add(uniformsRef.current, "globalContrast", -0.3, 0.3)
      .name("对比度")
      .step(0.01)
      .onChange(updateUniform);
    gui
      .add(uniformsRef.current, "globalColor", -1.0, 1.0)
      .name("饱和度")
      .step(0.01)
      .onChange(updateUniform);
    gui
      .add(uniformsRef.current, "globalTemperature", -1.0, 1.0)
      .name("色温")
      .step(0.01)
      .onChange(updateUniform);
    gui
      .add(uniformsRef.current, "globalTint", -1.0, 1.0)
      .name("色调")
      .step(0.01)
      .onChange(updateUniform);
    gui
      .add(uniformsRef.current, "globalHighlights", -1.0, 1.0)
      .name("高光")
      .step(0.01)
      .onChange(updateUniform);
    gui
      .add(uniformsRef.current, "globalShadows", -1.0, 1.0)
      .name("阴影")
      .step(0.01)
      .onChange(updateUniform);
    gui.add(controls, "replaceImage").name("替换图片 Click me");
  };

  const replaceImage = () => {
    if (!glRef.current) return;
    // 创建文件输入元素
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = false; // 允许选择多个文件
    input.style.display = "none";
    input.addEventListener("change", async (event: Event) => {
      const files = (event.target as any)?.files;
      if (!files || files.length !== 1) return;
      const imageFile = files[0];
      const blob = await imageFile
        .arrayBuffer()
        .then((buffer: ArrayBuffer) => new Blob([buffer]));
      const imageBitmap = await createImageBitmap(blob);
      createTextureFromImageBitmap(glRef.current!, imageBitmap);
      resize(imageBitmap.width, imageBitmap.height);
      drawScene();
    });
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  };

  const loadDefaultImage = () => {
    fetch(imageURL).then(async (res) => {
      const buffer = await (await res.blob()).arrayBuffer();
      const blob = new Blob([buffer]);
      const imageBitmap = await createImageBitmap(blob);
      createTextureFromImageBitmap(glRef.current!, imageBitmap);
      resize(imageBitmap.width, imageBitmap.height);
      drawScene();
    });
  };

  const main = async () => {
    controlPannel();
    initWebGL();
    loadDefaultImage();
  };

  useEffect(() => {
    main();
  }, []);
  return (
    <div>
      <canvas ref={canvasRef}></canvas>
    </div>
  );
};

export default App;
