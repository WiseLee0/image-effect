/**
 * WebGPU WGSL 着色器代码
 */

// 通用顶点着色器
export const vertexShader = `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn main(@location(0) position: vec2<f32>, @location(1) uv: vec2<f32>) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4<f32>(position, 0.0, 1.0);
  output.uv = uv;
  return output;
}
`;

// 直通着色器
export const passFragment = `
@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(uTexture, uSampler, uv);
}
`;

// 自然饱和度
export const vibranceFragment = `
struct Params {
  amount: f32,
}

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let col = textureSample(uTexture, uSampler, uv);
  var color = col.rgb;
  let luminance = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
  let mn = min(min(color.r, color.g), color.b);
  let mx = max(max(color.r, color.g), color.b);
  let sat = (1.0 - (mx - mn)) * (1.0 - mx) * luminance * 5.0;
  let lightness = vec3<f32>((mn + mx) / 2.0);
  color = mix(color, mix(color, lightness, -params.amount), sat);
  return vec4<f32>(
    mix(color, lightness, (1.0 - lightness) * (1.0 - params.amount) / 2.0 * abs(params.amount)),
    col.a
  );
}
`;

// 饱和度
export const saturationFragment = `
struct Params {
  matrix: array<vec4<f32>, 5>,
}

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let c = textureSample(uTexture, uSampler, uv);
  var result: vec4<f32>;
  result.r = params.matrix[0].x * c.r + params.matrix[0].y * c.g + params.matrix[0].z * c.b + params.matrix[0].w * c.a + params.matrix[1].x;
  result.g = params.matrix[1].y * c.r + params.matrix[1].z * c.g + params.matrix[1].w * c.b + params.matrix[2].x * c.a + params.matrix[2].y;
  result.b = params.matrix[2].z * c.r + params.matrix[2].w * c.g + params.matrix[3].x * c.b + params.matrix[3].y * c.a + params.matrix[3].z;
  result.a = params.matrix[3].w * c.r + params.matrix[4].x * c.g + params.matrix[4].y * c.b + params.matrix[4].z * c.a + params.matrix[4].w;
  return result;
}
`;

// 色温
export const temperatureFragment = `
struct Params {
  amount: f32,
}

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  var color = textureSample(uTexture, uSampler, uv);
  color.r = clamp(color.r + params.amount, 0.0, 1.0);
  color.b = clamp(color.b - params.amount, 0.0, 1.0);
  return color;
}
`;

// 色调
export const tintFragment = `
struct Params {
  amount: f32,
}

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  var color = textureSample(uTexture, uSampler, uv);
  color.g = clamp(color.g + params.amount, 0.0, 1.0);
  return color;
}
`;

// 色相
export const hueFragment = `
struct Params {
  rotation: f32,
}

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4<f32>(c.bg, K.wz), vec4<f32>(c.gb, K.xy), vec4<f32>(step(c.b, c.g)));
  let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), vec4<f32>(step(p.x, c.r)));
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let base = textureSample(uTexture, uSampler, uv);
  var hsv = rgb2hsv(base.rgb);
  hsv.x = fract(hsv.x + params.rotation);
  return vec4<f32>(hsv2rgb(hsv), base.a);
}
`;

// 亮度
export const brightnessFragment = `
struct Params {
  amount: f32,
}

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

const PI: f32 = 3.1415926535897932384626433832795;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  var color = textureSample(uTexture, uSampler, uv);
  if (params.amount >= 0.0) {
    color.r = color.r + params.amount * sin(color.r * PI);
    color.g = color.g + params.amount * sin(color.g * PI);
    color.b = color.b + params.amount * sin(color.b * PI);
  } else {
    color.r = (1.0 + params.amount) * color.r;
    color.g = (1.0 + params.amount) * color.g;
    color.b = (1.0 + params.amount) * color.b;
  }
  return color;
}
`;

// 曝光
export const exposureFragment = `
struct Params {
  amount: f32,
}

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

const epsilon: f32 = 0.000001;
const mx: f32 = 1.0 - 0.000001;

// GLSL mat3 列主序: mat3(col0_elem0, col0_elem1, col0_elem2, col1_elem0, ...)
// WGSL mat3x3 也是列主序: mat3x3(vec3_col0, vec3_col1, vec3_col2)
const matRGBtoROMM = mat3x3<f32>(
  vec3<f32>(0.5293459296226501, 0.3300727903842926, 0.14058130979537964),   // 第一列
  vec3<f32>(0.09837432950735092, 0.8734610080718994, 0.028164653107523918), // 第二列
  vec3<f32>(0.01688321679830551, 0.11767247319221497, 0.8654443025588989)   // 第三列
);

const matROMMtoRGB = mat3x3<f32>(
  vec3<f32>(2.0340757369995117, -0.727334201335907, -0.3067416846752167),         // 第一列
  vec3<f32>(-0.22881317138671875, 1.2317301034927368, -0.0029169507324695587),    // 第二列
  vec3<f32>(-0.008569774217903614, -0.1532866358757019, 1.1618564128875732)       // 第三列
);

fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4<f32>(c.bg, K.wz), vec4<f32>(c.gb, K.xy), vec4<f32>(step(c.b, c.g)));
  let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), vec4<f32>(step(p.x, c.r)));
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

fn setHue(res: vec3<f32>, base: vec3<f32>) -> vec3<f32> {
  let hsv = rgb2hsv(base);
  let res_hsv = rgb2hsv(res);
  return hsv2rgb(vec3<f32>(hsv.x, res_hsv.y, res_hsv.z));
}

fn ramp(t_in: f32) -> f32 {
  var t = t_in * 2.0;
  if (t >= 1.0) {
    t = t - 1.0;
    t = log(0.5) / log(0.5 * (1.0 - t) + 0.9332 * t);
  }
  return clamp(t, 0.001, 10.0);
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let col = textureSample(uTexture, uSampler, uv);
  var base = col.rgb * matRGBtoROMM;
  let a = abs(params.amount) * col.a + epsilon;
  let v = pow(2.0, a * 2.0 + 1.0) - 2.0;
  let m = mx - exp(-v);
  var res: vec3<f32>;
  if (params.amount > 0.0) {
    res = (1.0 - exp(-v * base)) / m;
  } else {
    res = log(1.0 - base * m) / -v;
  }
  res = mix(base, res, min(a * 100.0, 1.0));
  res = setHue(res, base);
  res = pow(res, vec3<f32>(ramp(1.0 - (0.0 * col.a + 1.0) / 2.0)));
  res = res * matROMMtoRGB;
  return vec4<f32>(res, col.a);
}
`;

// 对比度
export const contrastFragment = saturationFragment; // 使用相同的矩阵着色器

// 白色
export const whitesFragment = `
struct Params {
  amount: f32,
}

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

const RGB2Y = vec3<f32>(0.2126, 0.7152, 0.0722);

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let base = textureSample(uTexture, uSampler, uv);
  var color = base.rgb;
  let lum = dot(color, RGB2Y);
  let whiteMask = smoothstep(0.5, 1.0, lum);
  color = color + params.amount * whiteMask;
  return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), base.a);
}
`;

// 黑色（使用查找表）
export const blacksFragment = `
@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var uPaletteMap: texture_2d<f32>;
@group(0) @binding(3) var uPaletteSampler: sampler;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let base = textureSample(uTexture, uSampler, uv);
  let r = textureSample(uPaletteMap, uPaletteSampler, vec2<f32>(base.r, 0.0)).r;
  let g = textureSample(uPaletteMap, uPaletteSampler, vec2<f32>(base.g, 0.0)).g;
  let b = textureSample(uPaletteMap, uPaletteSampler, vec2<f32>(base.b, 0.0)).b;
  return vec4<f32>(r, g, b, base.a);
}
`;

// 高光
export const highlightsFragment = `
struct Params {
  amount: f32,
}

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

const epsilon: f32 = 0.000001;
const mx: f32 = 1.0 - 0.000001;

const matRGBtoROMM = mat3x3<f32>(
  vec3<f32>(0.5293459296226501, 0.3300727903842926, 0.14058130979537964),
  vec3<f32>(0.09837432950735092, 0.8734610080718994, 0.028164653107523918),
  vec3<f32>(0.01688321679830551, 0.11767247319221497, 0.8654443025588989)
);

const matROMMtoRGB = mat3x3<f32>(
  vec3<f32>(2.0340757369995117, -0.727334201335907, -0.3067416846752167),
  vec3<f32>(-0.22881317138671875, 1.2317301034927368, -0.0029169507324695587),
  vec3<f32>(-0.008569774217903614, -0.1532866358757019, 1.1618564128875732)
);

fn luma_romm(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.242655, 0.755158, 0.002187));
}

fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4<f32>(c.bg, K.wz), vec4<f32>(c.gb, K.xy), vec4<f32>(step(c.b, c.g)));
  let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), vec4<f32>(step(p.x, c.r)));
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

fn setHue(res: vec3<f32>, base: vec3<f32>) -> vec3<f32> {
  let hsv = rgb2hsv(base);
  let res_hsv = rgb2hsv(res);
  return hsv2rgb(vec3<f32>(hsv.x, res_hsv.y, res_hsv.z));
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let col = textureSample(uTexture, uSampler, uv);
  let map = col.rgb;
  var base = col.rgb * matRGBtoROMM;
  let map_lum = luma_romm(map * matRGBtoROMM);
  let exposure = mix(params.amount, 0.0, 1.0 - map_lum) * col.a;
  let a = abs(exposure) * col.a + epsilon;
  let v = pow(2.0, a + 1.0) - 2.0;
  let m = mx - exp(-v);
  var res: vec3<f32>;
  if (exposure > 0.0) {
    res = (1.0 - exp(-v * base)) / m;
  } else {
    res = log(1.0 - base * m) / -v;
  }
  res = mix(base, res, min(a * 100.0, 1.0));
  res = setHue(res, base);
  res = res * matROMMtoRGB;
  return vec4<f32>(res, col.a);
}
`;

// 暗调
export const shadowsFragment = `
struct Params {
  amount: f32,
}

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

const epsilon: f32 = 0.000001;
const mx: f32 = 1.0 - 0.000001;

const matRGBtoROMM = mat3x3<f32>(
  vec3<f32>(0.5293459296226501, 0.3300727903842926, 0.14058130979537964),
  vec3<f32>(0.09837432950735092, 0.8734610080718994, 0.028164653107523918),
  vec3<f32>(0.01688321679830551, 0.11767247319221497, 0.8654443025588989)
);

const matROMMtoRGB = mat3x3<f32>(
  vec3<f32>(2.0340757369995117, -0.727334201335907, -0.3067416846752167),
  vec3<f32>(-0.22881317138671875, 1.2317301034927368, -0.0029169507324695587),
  vec3<f32>(-0.008569774217903614, -0.1532866358757019, 1.1618564128875732)
);

fn luma_romm(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.242655, 0.755158, 0.002187));
}

fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4<f32>(c.bg, K.wz), vec4<f32>(c.gb, K.xy), vec4<f32>(step(c.b, c.g)));
  let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), vec4<f32>(step(p.x, c.r)));
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

fn setHue(res: vec3<f32>, base: vec3<f32>) -> vec3<f32> {
  let hsv = rgb2hsv(base);
  let res_hsv = rgb2hsv(res);
  return hsv2rgb(vec3<f32>(hsv.x, res_hsv.y, res_hsv.z));
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let col = textureSample(uTexture, uSampler, uv);
  let map = col.rgb;
  var base = col.rgb * matRGBtoROMM;
  let map_lum = luma_romm(map * matRGBtoROMM);
  let exposure = mix(0.0, params.amount, 1.0 - map_lum) * col.a;
  let a = abs(exposure) * col.a + epsilon;
  let v = pow(2.0, a + 1.0) - 2.0;
  let m = mx - exp(-v);
  var res: vec3<f32>;
  if (exposure > 0.0) {
    res = (1.0 - exp(-v * base)) / m;
  } else {
    res = log(1.0 - base * m) / -v;
  }
  res = mix(base, res, min(a * 100.0, 1.0));
  res = setHue(res, base);
  res = res * matROMMtoRGB;
  return vec4<f32>(res, col.a);
}
`;

// 除雾
export const dehazeFragment = `
struct Params {
  amount: f32,
  width: f32,
  height: f32,
  _pad: f32,
}

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

fn hazeMap(coord: vec2<f32>) -> f32 {
  var color = vec3<f32>(1.0);
  let stepSize = vec2<f32>(1.0 / params.width, 1.0 / params.height);
  for (var i: i32 = -1; i <= 1; i = i + 1) {
    for (var j: i32 = -1; j <= 1; j = j + 1) {
      let offset = vec2<f32>(f32(i), f32(j)) * stepSize;
      let uv = clamp(coord + offset, vec2<f32>(0.0), vec2<f32>(1.0));
      let sample = textureSample(uTexture, uSampler, uv).rgb;
      color = min(color, sample);
    }
  }
  return min(color.r, min(color.g, color.b));
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let base = textureSample(uTexture, uSampler, uv);
  let haze = hazeMap(uv);
  let transmission = 1.0 - 0.95 * haze;
  let A = 0.95;
  let t0 = 0.1;
  let t = mix(1.0, max(t0, transmission), params.amount);
  let J = (base.rgb - A) / t + A;
  return vec4<f32>(J, base.a);
}
`;

// 泛光
export const bloomFragment = `
struct Params {
  amount: f32,
  texelX: f32,
  texelY: f32,
  threshold: f32,
}

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  var sum = vec4<f32>(0.0);
  let texel = vec2<f32>(params.texelX, params.texelY);
  
  for (var j: i32 = -2; j <= 2; j = j + 1) {
    for (var i: i32 = -2; i <= 2; i = i + 1) {
      sum = sum + textureSample(uTexture, uSampler, uv + vec2<f32>(f32(i), f32(j)) * texel);
    }
  }
  sum = sum / 25.0;
  
  var base = textureSample(uTexture, uSampler, uv);
  if (length(sum.rgb) > params.threshold) {
    base = base + sum * params.amount;
  }
  return base;
}
`;

// 氛围美化
export const glamourFragment = `
struct Params {
  amount: f32,
  texelX: f32,
  texelY: f32,
  _pad: f32,
}

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

fn normpdf(x: f32, sigma: f32) -> f32 {
  return 0.39894 * exp(-0.5 * x * x / (sigma * sigma)) / sigma;
}

fn luma(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.299, 0.587, 0.114));
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let texel = vec2<f32>(params.texelX, params.texelY);
  let sigma = 7.0;
  var final_colour = vec3<f32>(0.0);
  var Z = 0.0;
  
  // 简化版高斯模糊
  for (var i: i32 = -5; i <= 5; i = i + 1) {
    for (var j: i32 = -5; j <= 5; j = j + 1) {
      let weight = normpdf(f32(i), sigma) * normpdf(f32(j), sigma);
      final_colour = final_colour + weight * textureSample(uTexture, uSampler, uv + vec2<f32>(f32(i), f32(j)) * texel).rgb;
      Z = Z + weight;
    }
  }
  final_colour = final_colour / Z;
  
  let base = textureSample(uTexture, uSampler, uv);
  var color = vec3<f32>(luma(final_colour));
  
  // Soft light blend
  color = vec3<f32>(
    select(1.0 - 2.0 * (1.0 - base.r) * (1.0 - color.r), 2.0 * base.r * color.r, base.r <= 0.5),
    select(1.0 - 2.0 * (1.0 - base.g) * (1.0 - color.g), 2.0 * base.g * color.g, base.g <= 0.5),
    select(1.0 - 2.0 * (1.0 - base.b) * (1.0 - color.b), 2.0 * base.b * color.b, base.b <= 0.5)
  );
  
  return mix(base, vec4<f32>(color, base.a), params.amount);
}
`;

// 清晰度
export const clarityFragment = `
struct Params {
  amount: f32,
  texelX: f32,
  texelY: f32,
  _pad: f32,
}

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

fn Lum(c: vec3<f32>) -> f32 {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

fn BlendOverlayf(base: f32, blend: f32) -> f32 {
  return select(1.0 - 2.0 * (1.0 - base) * (1.0 - blend), 2.0 * base * blend, base < 0.5);
}

fn BlendOverlay(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(BlendOverlayf(base.r, blend.r), BlendOverlayf(base.g, blend.g), BlendOverlayf(base.b, blend.b));
}

fn BlendVividLightf(base: f32, blend: f32) -> f32 {
  let BlendColorBurnf = select(max(1.0 - ((1.0 - base) / (2.0 * blend)), 0.0), 2.0 * blend, (2.0 * blend) == 0.0);
  let BlendColorDodgef = select(min(base / (1.0 - (2.0 * (blend - 0.5))), 1.0), 2.0 * (blend - 0.5), (2.0 * (blend - 0.5)) == 1.0);
  return select(BlendColorDodgef, BlendColorBurnf, blend < 0.5);
}

fn BlendVividLight(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(BlendVividLightf(base.r, blend.r), BlendVividLightf(base.g, blend.g), BlendVividLightf(base.b, blend.b));
}

fn normpdf(x: f32, sigma: f32) -> f32 {
  return 0.39894 * exp(-0.5 * x * x / (sigma * sigma)) / sigma;
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let texel = vec2<f32>(params.texelX, params.texelY);
  let sigma = 7.0;
  var blur = vec3<f32>(0.0);
  var Z = 0.0;
  
  for (var i: i32 = -5; i <= 5; i = i + 1) {
    for (var j: i32 = -5; j <= 5; j = j + 1) {
      let weight = normpdf(f32(i), sigma) * normpdf(f32(j), sigma);
      blur = blur + weight * textureSample(uTexture, uSampler, uv + vec2<f32>(f32(i), f32(j)) * texel).rgb;
      Z = Z + weight;
    }
  }
  blur = blur / Z;
  
  let base4 = textureSample(uTexture, uSampler, uv);
  let base = base4.rgb;
  var intensity = params.amount;
  if (params.amount < 0.0) {
    intensity = params.amount / 2.0;
  }
  
  let lum = Lum(base);
  let col = vec3<f32>(lum);
  let mask = vec3<f32>(1.0 - pow(lum, 1.8));
  let layer = vec3<f32>(1.0 - Lum(blur));
  let detail = clamp(BlendVividLight(col, layer), vec3<f32>(0.0), vec3<f32>(1.0));
  let inverse = mix(1.0 - detail, detail, (intensity + 1.0) / 2.0);
  
  return vec4<f32>(BlendOverlay(base, mix(vec3<f32>(0.5), inverse, mask)), base4.a);
}
`;

// 卷积核（锐化/平滑）
export const kernelFragment = `
struct Params {
  texelX: f32,
  texelY: f32,
  amount: f32,
  _pad: f32,
  kernel: array<f32, 12>, // 9 + 3 padding
}

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let texel = vec2<f32>(params.texelX, params.texelY);
  
  let c11 = textureSample(uTexture, uSampler, uv - texel);
  let c12 = textureSample(uTexture, uSampler, vec2<f32>(uv.x, uv.y - texel.y));
  let c13 = textureSample(uTexture, uSampler, vec2<f32>(uv.x + texel.x, uv.y - texel.y));
  let c21 = textureSample(uTexture, uSampler, vec2<f32>(uv.x - texel.x, uv.y));
  let c22 = textureSample(uTexture, uSampler, uv);
  let c23 = textureSample(uTexture, uSampler, vec2<f32>(uv.x + texel.x, uv.y));
  let c31 = textureSample(uTexture, uSampler, vec2<f32>(uv.x - texel.x, uv.y + texel.y));
  let c32 = textureSample(uTexture, uSampler, vec2<f32>(uv.x, uv.y + texel.y));
  let c33 = textureSample(uTexture, uSampler, uv + texel);
  
  let color = c11 * params.kernel[0] + c12 * params.kernel[1] + c13 * params.kernel[2] +
              c21 * params.kernel[3] + c22 * params.kernel[4] + c23 * params.kernel[5] +
              c31 * params.kernel[6] + c32 * params.kernel[7] + c33 * params.kernel[8];
  
  return color * params.amount + (c22 * (1.0 - params.amount));
}
`;

// 模糊
export const blurFragment = `
struct Params {
  sizeX: f32,
  sizeY: f32,
  _pad1: f32,
  _pad2: f32,
}

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

fn random(scale: vec3<f32>, seed: f32, coord: vec3<f32>) -> f32 {
  return fract(sin(dot(coord + seed, scale)) * 43758.5453 + seed);
}

@fragment
fn main(@location(0) uv: vec2<f32>, @builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  var color = vec4<f32>(0.0);
  var total = 0.0;
  let size = vec2<f32>(params.sizeX, params.sizeY);
  let offset = random(vec3<f32>(12.9898, 78.233, 151.7182), 0.0, fragCoord.xyz);
  
  for (var t: i32 = -30; t <= 30; t = t + 1) {
    let percent = (f32(t) + offset - 0.5) / 30.0;
    let weight = 1.0 - abs(percent);
    var sample = textureSample(uTexture, uSampler, uv + size * percent);
    sample = vec4<f32>(sample.rgb * sample.a, sample.a);
    color = color + sample * weight;
    total = total + weight;
  }
  
  color = color / total;
  return vec4<f32>(color.rgb / (color.a + 0.00001), color.a);
}
`;

// 暗角
export const vignetteFragment = `
struct Params {
  amount: f32,
  size: f32,
  _pad1: f32,
  _pad2: f32,
}

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  var color = textureSample(uTexture, uSampler, uv);
  let dist = distance(uv, vec2<f32>(0.5, 0.5));
  let amt = clamp(params.amount, -1.0, 1.0);
  let edge = dist * (abs(amt) * 0.75 + params.size * 2.0);
  var vignette = smoothstep(0.8, params.size * 0.799, edge);
  
  if (amt < 0.0) {
    vignette = 1.0 + (1.0 - vignette) * (-amt);
  } else {
    vignette = mix(1.0, vignette, amt);
  }
  
  color = vec4<f32>(color.rgb * vignette, color.a);
  return color;
}
`;

// 颗粒
export const grainFragment = `
struct Params {
  width: f32,
  height: f32,
  amount: f32,
  time: f32,
}

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

fn rnm(tc: vec2<f32>) -> vec4<f32> {
  let noise = sin(dot(tc + vec2<f32>(params.time), vec2<f32>(12.9898, 78.233))) * 43758.5453;
  return vec4<f32>(
    fract(noise) * 2.0 - 1.0,
    fract(noise * 1.2154) * 2.0 - 1.0,
    fract(noise * 1.3453) * 2.0 - 1.0,
    fract(noise * 1.3647) * 2.0 - 1.0
  );
}

fn fade(t: f32) -> f32 {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let grainsize = 1.8;
  let lumamount = 1.0;
  
  let rotCoordsR = uv;
  let noiseScale = vec2<f32>(params.width / grainsize, params.height / grainsize);
  let noise = vec3<f32>(rnm(rotCoordsR * noiseScale).rgb);
  
  let tex = textureSample(uTexture, uSampler, uv);
  var col = tex.rgb;
  let lumcoeff = vec3<f32>(0.299, 0.587, 0.114);
  let luminance = mix(0.0, dot(col, lumcoeff), lumamount);
  var lum = smoothstep(0.2, 0.0, luminance);
  lum = lum + luminance;
  let finalNoise = mix(noise, vec3<f32>(0.0), pow(lum, 4.0));
  col = col + finalNoise * params.amount;
  
  return vec4<f32>(col, tex.a);
}
`;
