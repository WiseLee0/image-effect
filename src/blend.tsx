import { useEffect, useRef } from "react";
import { createTextureFromImageBitmap, getProgram } from "./utils";
import vsSource from "./shader/blend.vert?raw";
import fsSource from "./shader/blend.frag?raw";
import * as dat from "dat.gui";
import { useStore } from "./store";

const blendModes = {
  DARKEN: 2,
  MULTIPLY: 3,
  LINEAR_BURN: 4,
  COLOR_BURN: 5,
  LIGHTEN: 6,
  SCREEN: 7,
  LINEAR_DODGE: 8,
  COLOR_DODGE: 9,
  OVERLAY: 10,
  SOFT_LIGHT: 11,
  HARD_LIGHT: 12,
  DIFFERENCE: 13,
  EXCLUSION: 14,
  HUE: 15,
  SATURATION: 16,
  COLOR: 17,
  LUMINOSITY: 18,
};
const BlendComponent = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext>(null);
  const programRef = useRef<WebGLProgram>(null);
  const uniformsRef = useRef<any>({
    type: "DARKEN",
  });

  const count = useStore((state: any) => state.count);

  const resize = (imageWidth: number, imageHeight: number) => {
    if (!canvasRef.current || !glRef.current) return;
    const gl = glRef.current;
    const canvas = canvasRef.current;
    const maxSize = 400;
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
      preserveDrawingBuffer: true,
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

  const drawScene = async () => {
    const gl = glRef.current;
    const program = programRef.current;
    const uniforms = uniformsRef.current;
    if (!gl || !program || !uniforms) return;
    gl.useProgram(program);
    const uniformLocations = {
      type: gl.getUniformLocation(program, "type"),
      alpha: gl.getUniformLocation(program, "alpha"),
    };
    gl.uniform1i(uniformLocations.type, (blendModes as any)[uniforms.type]);
    gl.uniform1f(uniformLocations.alpha, 1);
    const texture0Location = gl.getUniformLocation(program, "texture0");
    const texture1Location = gl.getUniformLocation(program, "texture1");
    gl.uniform1i(texture0Location, 0);
    gl.uniform1i(texture1Location, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const controlPannel = () => {
    const gui = new dat.GUI({
      width: 300,
    });
    const updateUniform = () => {
      drawScene();
    };
    gui
      .add(uniformsRef.current, "type", Object.keys(blendModes))
      .name("混合模式")
      .onChange(updateUniform);

    gui.domElement.style.position = "absolute"; // 使用绝对定位
    gui.domElement.style.top = "265px";
    gui.domElement.style.right = "320px";
  };

  const loadImage = async () => {
    const canvas1 = document.getElementById("canvas1")! as HTMLCanvasElement;
    const canvas2 = document.getElementById("canvas2")! as HTMLCanvasElement;
    const imageBitmap1 = await createImageBitmap(canvas1);
    const imageBitmap2 = await createImageBitmap(canvas2);

    createTextureFromImageBitmap(glRef.current!, imageBitmap1, 1);
    createTextureFromImageBitmap(glRef.current!, imageBitmap2, 0);

    resize(400, 400);
    drawScene();
  };

  useEffect(() => {
    const handle = setTimeout(() => {
      loadImage();
    }, 0);
    return () => {
      clearTimeout(handle);
    };
  }, [count]);

  const main = async () => {
    controlPannel();
    initWebGL();
    setTimeout(() => {
      loadImage();
    }, 300);
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

export default BlendComponent;
