# 参考当前shader 
## 除雾化
范围（0~100）
```

#define GLSLIFY 1;
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform float amount;  // -1.0 ~ 1.0


uniform vec2 size;
float hazeMap(vec4 base) {
    vec3 color = vec3(1.0, 1.0, 1.0);
    vec2 step = vec2(1.0 / size.xy);
    const int patchRadius = 1; // the half size for shift in 3 x 3 patch.
    
    for (int i = -patchRadius; i <= patchRadius; ++i) {
        for (int j = -patchRadius; j <= patchRadius; ++j) {
            vec2 uv = clamp(uv + (vec2(i, j) * step), 0.0, 1.0);
            color = min(color, base.rgb);
        }

    }
    return min(color.r, min(color.g, color.b));
}
void main() {
    lowp vec4 base = texture2D(texture, uv.xy);
    lowp float haze = hazeMap(base);
    float transmission = 1.0 - 0.95 * haze;
    const float A = 0.95; //0.95 intensity. We can consider to collect 0.1% brightest pixel from the dark channel image.
    
    const float t0 = 0.1; //0.1 in the paper, we can increase it for solving the color bleeding.
    
    float t = mix(1.0, max(t0, transmission), amount);
    vec3 J = (base.rgb - A) / t + A;
    gl_FragColor = vec4(J, base.a);
}
```
## 绽放
范围（0~100）
```
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform float amount;
uniform vec2 px;
float thresh = .5;
void main() {
    vec4 sum = vec4(0);
    
    // mess of for loops due to gpu compiler/hardware limitations
    
    int j = -2;
    for( int i = -2; i <= 2; i++) sum += texture2D(texture, uv+vec2(i, j)*px);
    j = -1;
    for( int i = -2; i <= 2; i++) sum += texture2D(texture, uv+vec2(i, j)*px);
    j = 0;
    for( int i = -2; i <= 2; i++) sum += texture2D(texture, uv+vec2(i, j)*px);
    j = 1;
    for( int i = -2; i <= 2; i++) sum += texture2D(texture, uv+vec2(i, j)*px);
    j = 2;
    for( int i = -2; i <= 2; i++) sum += texture2D(texture, uv+vec2(i, j)*px);
    sum /= 25.0;
    gl_FragColor = texture2D(texture, uv);
    
    // use the blurred colour if it's bright enough
    
    if (length(sum) > thresh) {
        gl_FragColor += sum*amount;
    }

}
```
## 魅力
范围（0~100）
```
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform float amount;
uniform vec2 px;
float normpdf(in float x, in float sigma) {
    return 0.39894*exp(-0.5*x*x/(sigma*sigma))/sigma;
}
vec3 blurMap() {
    //declare stuff
    const int mSize = 11;
    const int kSize = (mSize-1)/2;
    float kernel[mSize];
    vec3 final_colour = vec3(0.0);
    
    //create the 1-D kernel
    
    float sigma = 7.0;
    float Z = 0.0;
    for (int j = 0; j <= kSize; ++j) {
        kernel[kSize+j] = kernel[kSize-j] = normpdf(float(j), sigma);
    }
    //get the normalization factor (as the gaussian has been clamped)
    for (int j = 0; j < mSize; ++j) {
        Z += kernel[j];
    }
    //read out the texels
    for (int i = -kSize; i <= kSize; ++i) {
        for (int j = -kSize; j <= kSize; ++j) {
            final_colour += kernel[kSize+j] * kernel[kSize+i] * texture2D(texture, (uv.xy + vec2(float(i), float(j))*px)).rgb;
        }

    }
    return vec3(final_colour/(Z*Z));
}
float luma(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
}
void main() {
    vec4 base = texture2D(texture, uv);
    vec3 color = blurMap();
    color = vec3(luma(color));
    color = vec3(
    (base.r <= 0.5) ? (2.0 * base.r * color.r) : (1.0 - 2.0 * (1.0 - base.r) * (1.0 - color.r)), (base.g <= 0.5) ? (2.0 * base.g * color.g) : (1.0 - 2.0 * (1.0 - base.g) * (1.0 - color.g)), (base.b <= 0.5) ? (2.0 * base.b * color.b) : (1.0 - 2.0 * (1.0 - base.b) * (1.0 - color.b))
    );
    gl_FragColor = mix(base, vec4(color, base.a), amount);
}
```
## 暗角
范围（-100~100）
```
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform float amount;
uniform float size;
void main() {
    vec4 color = texture2D(texture, uv);
    float dist = distance(uv, vec2(0.5, 0.5));
    color.rgb *= smoothstep(0.8, size * 0.799, dist * (amount*0.75 + size*2.0));
    gl_FragColor = color;
}
```
## 颗粒
范围（0~100）
```
precision highp float;
uniform sampler2D texture;
varying vec2 uv;
uniform float width;
uniform float height;
uniform float grainamount;
uniform float timer;
const float permTexUnit = 1.0/256.0;
const float permTexUnitHalf = 0.5/256.0;
float grainsize = 1.8;
float lumamount = 1.0;
vec4 rnm(in vec2 tc) {
    float noise = sin(dot(tc + vec2(timer, timer), vec2(12.9898, 78.233))) * 43758.5453;
    float noiseR = fract(noise)*2.0-1.0;
    float noiseG = fract(noise*1.2154)*2.0-1.0;
    float noiseB = fract(noise*1.3453)*2.0-1.0;
    float noiseA = fract(noise*1.3647)*2.0-1.0;
    return vec4(noiseR, noiseG, noiseB, noiseA);
}
float fade(in float t) {
    return t*t*t*(t*(t*6.0-15.0)+10.0);
}
float pnoise3D(in vec3 p) {
    vec3 pi = permTexUnit*floor(p)+permTexUnitHalf;
    vec3 pf = fract(p);
    float perm00 = rnm(pi.xy).a ;
    vec3  grad000 = rnm(vec2(perm00, pi.z)).rgb * 4.0 - 1.0;
    float n000 = dot(grad000, pf);
    vec3  grad001 = rnm(vec2(perm00, pi.z + permTexUnit)).rgb * 4.0 - 1.0;
    float n001 = dot(grad001, pf - vec3(0.0, 0.0, 1.0));
    float perm01 = rnm(pi.xy + vec2(0.0, permTexUnit)).a ;
    vec3  grad010 = rnm(vec2(perm01, pi.z)).rgb * 4.0 - 1.0;
    float n010 = dot(grad010, pf - vec3(0.0, 1.0, 0.0));
    vec3  grad011 = rnm(vec2(perm01, pi.z + permTexUnit)).rgb * 4.0 - 1.0;
    float n011 = dot(grad011, pf - vec3(0.0, 1.0, 1.0));
    float perm10 = rnm(pi.xy + vec2(permTexUnit, 0.0)).a ;
    vec3  grad100 = rnm(vec2(perm10, pi.z)).rgb * 4.0 - 1.0;
    float n100 = dot(grad100, pf - vec3(1.0, 0.0, 0.0));
    vec3  grad101 = rnm(vec2(perm10, pi.z + permTexUnit)).rgb * 4.0 - 1.0;
    float n101 = dot(grad101, pf - vec3(1.0, 0.0, 1.0));
    float perm11 = rnm(pi.xy + vec2(permTexUnit, permTexUnit)).a ;
    vec3  grad110 = rnm(vec2(perm11, pi.z)).rgb * 4.0 - 1.0;
    float n110 = dot(grad110, pf - vec3(1.0, 1.0, 0.0));
    vec3  grad111 = rnm(vec2(perm11, pi.z + permTexUnit)).rgb * 4.0 - 1.0;
    float n111 = dot(grad111, pf - vec3(1.0, 1.0, 1.0));
    vec4 n_x = mix(vec4(n000, n001, n010, n011), vec4(n100, n101, n110, n111), fade(pf.x));
    vec2 n_xy = mix(n_x.xy, n_x.zw, fade(pf.y));
    float n_xyz = mix(n_xy.x, n_xy.y, fade(pf.z));
    return n_xyz;
}
vec2 coordRot(in vec2 tc, in float angle) {
    float aspect = width/height;
    float rotX = ((tc.x*2.0-1.0)*aspect*cos(angle)) - ((tc.y*2.0-1.0)*sin(angle));
    float rotY = ((tc.y*2.0-1.0)*cos(angle)) + ((tc.x*2.0-1.0)*aspect*sin(angle));
    rotX = ((rotX/aspect)*0.5+0.5);
    rotY = rotY*0.5+0.5;
    return vec2(rotX, rotY);
}
void main() {
    vec3 rotOffset = vec3(1.425, 3.892, 5.835);
    vec2 rotCoordsR = coordRot(uv, timer + rotOffset.x);
    vec3 noise = vec3(pnoise3D(vec3(rotCoordsR*vec2(width/grainsize, height/grainsize), 0.0)));
    vec4 tex = texture2D(texture, uv);
    vec3 col = tex.rgb;
    vec3 lumcoeff = vec3(0.299, 0.587, 0.114);
    float luminance = mix(0.0, dot(col, lumcoeff), lumamount);
    float lum = smoothstep(0.2, 0.0, luminance);
    lum += luminance;
    noise = mix(noise, vec3(0.0), pow(lum, 4.0));
    col = col+noise*grainamount;
    gl_FragColor = vec4(col, tex.w);
}
```
## 模糊
范围（0~100）
```
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform vec2 size;
float random(vec3 scale, float seed) {
    return fract(sin(dot(gl_FragCoord.xyz + seed, scale)) * 43758.5453 + seed);
}
void main() {
    vec4 color = vec4(0.0);
    float total = 0.0;
    float offset = random(vec3(12.9898, 78.233, 151.7182), 0.0);
    for (float t = -30.0; t <= 30.0; t++) {
        float percent = (t + offset - 0.5) / 30.0;
        float weight = 1.0 - abs(percent);
        vec4 sample = texture2D(texture, uv + size * percent);
        sample.rgb *= sample.a;
        color += sample * weight;
        total += weight;
    }
    gl_FragColor = color / total;
    gl_FragColor.rgb /= gl_FragColor.a + 0.00001;
}
```
## 平滑
范围（0~100）
```
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform vec2 px;
uniform float m[9];
uniform float amount;
void main(void) {
    vec4 c11 = texture2D(texture, uv - px);
    vec4 c12 = texture2D(texture, vec2(uv.x, uv.y - px.y));
    vec4 c13 = texture2D(texture, vec2(uv.x + px.x, uv.y - px.y));
    vec4 c21 = texture2D(texture, vec2(uv.x - px.x, uv.y) );
    vec4 c22 = texture2D(texture, uv);
    vec4 c23 = texture2D(texture, vec2(uv.x + px.x, uv.y) );
    vec4 c31 = texture2D(texture, vec2(uv.x - px.x, uv.y + px.y) );
    vec4 c32 = texture2D(texture, vec2(uv.x, uv.y + px.y) );
    vec4 c33 = texture2D(texture, uv + px );
    vec4 color = c11 * m[0] + c12 * m[1] + c13 * m[2] +
    c21 * m[3] + c22 * m[4] + c23 * m[5] +
    c31 * m[6] + c32 * m[7] + c33 * m[8];
    gl_FragColor = color * amount + (c22 * (1.0 - amount));
}
```
## 清晰度
范围（-100~100）
```

#define GLSLIFY 1
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform float amount;
uniform vec2 px;
float Lum(vec3 c) {
    return 0.299*c.r + 0.587*c.g + 0.114*c.b;
}
float BlendOverlayf(float base, float blend) {
    return (base < 0.5 ? (2.0 * base * blend) : (1.0 - 2.0 * (1.0 - base) * (1.0 - blend)));
}
vec3 BlendOverlay(vec3 base, vec3 blend) {
    return vec3(BlendOverlayf(base.r, blend.r), BlendOverlayf(base.g, blend.g), BlendOverlayf(base.b, blend.b));
}
float BlendVividLightf(float base, float blend) {
    float BlendColorBurnf = (((2.0 * blend) == 0.0) ? (2.0 * blend) : max((1.0 - ((1.0 - base) / (2.0 * blend))), 0.0));
    float BlendColorDodgef = (((2.0 * (blend - 0.5)) == 1.0) ? (2.0 * (blend - 0.5)) : min(base / (1.0 - (2.0 * (blend - 0.5))), 1.0));
    return ((blend < 0.5) ? BlendColorBurnf : BlendColorDodgef);
}
vec3 BlendVividLight(vec3 base, vec3 blend) {
    return vec3(BlendVividLightf(base.r, blend.r), BlendVividLightf(base.g, blend.g), BlendVividLightf(base.b, blend.b));
}
float normpdf(in float x, in float sigma) {
    return 0.39894*exp(-0.5*x*x/(sigma*sigma))/sigma;
}
vec3 blurMap() {
    //declare stuff
    const int mSize = 11;
    const int kSize = (mSize-1)/2;
    float kernel[mSize];
    vec3 final_colour = vec3(0.0);
    
    //create the 1-D kernel
    
    float sigma = 7.0;
    float Z = 0.0;
    for (int j = 0; j <= kSize; ++j) {
        kernel[kSize+j] = kernel[kSize-j] = normpdf(float(j), sigma);
    }
    //get the normalization factor (as the gaussian has been clamped)
    for (int j = 0; j < mSize; ++j) {
        Z += kernel[j];
    }
    //read out the texels
    for (int i = -kSize; i <= kSize; ++i) {
        for (int j = -kSize; j <= kSize; ++j) {
            final_colour += kernel[kSize+j] * kernel[kSize+i] * texture2D(texture, (uv.xy + vec2(float(i), float(j))*px)).rgb;
        }

    }
    return vec3(final_colour/(Z*Z));
}
void main() {
    vec4 base4 = texture2D(texture, uv.xy);
    vec3 blurMap = blurMap();
    vec3 base = base4.rgb;
    float intensity = (amount < 0.0) ? (amount / 2.0) : amount;
    float lum = Lum(base);
    vec3 col = vec3(lum);
    vec3 mask = vec3(1.0 - pow(lum, 1.8));
    // invert blurred texture
    
    vec3 layer = vec3(1.0 - Lum(blurMap));
    vec3 detail = clamp(BlendVividLight(col, layer), 0.0, 1.0);
    // we get negative detail by inverting the detail layer
    
    vec3 inverse = mix(1.0 - detail, detail, (intensity+1.0)/2.0);
    gl_FragColor = vec4(BlendOverlay(base, mix(vec3(0.5), inverse, mask)), base4.a);
}
```
## 锐化
```
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform vec2 px;
uniform float m[9];
uniform float amount;
void main(void) {
    vec4 c11 = texture2D(texture, uv - px); // top left
    
    vec4 c12 = texture2D(texture, vec2(uv.x, uv.y - px.y)); // top center
    
    vec4 c13 = texture2D(texture, vec2(uv.x + px.x, uv.y - px.y)); // top right
    
    
    vec4 c21 = texture2D(texture, vec2(uv.x - px.x, uv.y) ); // mid left
    
    vec4 c22 = texture2D(texture, uv); // mid center
    
    vec4 c23 = texture2D(texture, vec2(uv.x + px.x, uv.y) ); // mid right
    
    
    vec4 c31 = texture2D(texture, vec2(uv.x - px.x, uv.y + px.y) ); // bottom left
    
    vec4 c32 = texture2D(texture, vec2(uv.x, uv.y + px.y) ); // bottom center
    
    vec4 c33 = texture2D(texture, uv + px ); // bottom right
    
    
    vec4 color = c11 * m[0] + c12 * m[1] + c13 * m[2] +
    c21 * m[3] + c22 * m[4] + c23 * m[5] +
    c31 * m[6] + c32 * m[7] + c33 * m[8];
    gl_FragColor = color * amount + (c22 * (1.0 - amount));
}
```

## 亮度
```

#define GLSLIFY 1
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform float amount;
uniform vec2 px;
float Lum(vec3 c) {
    return 0.299*c.r + 0.587*c.g + 0.114*c.b;
}
float BlendOverlayf(float base, float blend) {
    return (base < 0.5 ? (2.0 * base * blend) : (1.0 - 2.0 * (1.0 - base) * (1.0 - blend)));
}
vec3 BlendOverlay(vec3 base, vec3 blend) {
    return vec3(BlendOverlayf(base.r, blend.r), BlendOverlayf(base.g, blend.g), BlendOverlayf(base.b, blend.b));
}
float BlendVividLightf(float base, float blend) {
    float BlendColorBurnf = (((2.0 * blend) == 0.0) ? (2.0 * blend) : max((1.0 - ((1.0 - base) / (2.0 * blend))), 0.0));
    float BlendColorDodgef = (((2.0 * (blend - 0.5)) == 1.0) ? (2.0 * (blend - 0.5)) : min(base / (1.0 - (2.0 * (blend - 0.5))), 1.0));
    return ((blend < 0.5) ? BlendColorBurnf : BlendColorDodgef);
}
vec3 BlendVividLight(vec3 base, vec3 blend) {
    return vec3(BlendVividLightf(base.r, blend.r), BlendVividLightf(base.g, blend.g), BlendVividLightf(base.b, blend.b));
}
float normpdf(in float x, in float sigma) {
    return 0.39894*exp(-0.5*x*x/(sigma*sigma))/sigma;
}
vec3 blurMap() {
    //declare stuff
    const int mSize = 11;
    const int kSize = (mSize-1)/2;
    float kernel[mSize];
    vec3 final_colour = vec3(0.0);
    
    //create the 1-D kernel
    
    float sigma = 7.0;
    float Z = 0.0;
    for (int j = 0; j <= kSize; ++j) {
        kernel[kSize+j] = kernel[kSize-j] = normpdf(float(j), sigma);
    }
    //get the normalization factor (as the gaussian has been clamped)
    for (int j = 0; j < mSize; ++j) {
        Z += kernel[j];
    }
    //read out the texels
    for (int i = -kSize; i <= kSize; ++i) {
        for (int j = -kSize; j <= kSize; ++j) {
            final_colour += kernel[kSize+j] * kernel[kSize+i] * texture2D(texture, (uv.xy + vec2(float(i), float(j))*px)).rgb;
        }

    }
    return vec3(final_colour/(Z*Z));
}
void main() {
    vec4 base4 = texture2D(texture, uv.xy);
    vec3 blurMap = blurMap();
    vec3 base = base4.rgb;
    float intensity = (amount < 0.0) ? (amount / 2.0) : amount;
    float lum = Lum(base);
    vec3 col = vec3(lum);
    vec3 mask = vec3(1.0 - pow(lum, 1.8));
    // invert blurred texture
    
    vec3 layer = vec3(1.0 - Lum(blurMap));
    vec3 detail = clamp(BlendVividLight(col, layer), 0.0, 1.0);
    // we get negative detail by inverting the detail layer
    
    vec3 inverse = mix(1.0 - detail, detail, (intensity+1.0)/2.0);
    gl_FragColor = vec4(BlendOverlay(base, mix(vec3(0.5), inverse, mask)), base4.a);
}
```

## 曝光度
```
#define GLSLIFY 1
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform float amount;
const float epsilon = 0.000001;
const float mx = 1.0 - epsilon;
const mat3 matRGBtoROMM = mat3(0.5293459296226501, 0.3300727903842926, 0.14058130979537964, 0.09837432950735092, 0.8734610080718994, 0.028164653107523918, 0.01688321679830551, 0.11767247319221497, 0.8654443025588989);
const mat3 matROMMtoRGB = mat3(2.0340757369995117, -0.727334201335907, -0.3067416846752167, -0.22881317138671875, 1.2317301034927368, -0.0029169507324695587, -0.008569774217903614, -0.1532866358757019, 1.1618564128875732);
float ramp(in float t) {
    t *= 2.0;
    if (t >= 1.0) {
        t -= 1.0;
        t = log(0.5) / log(0.5*(1.0-t) + 0.9332*t);
    }
    return clamp(t, 0.001, 10.0);
}
vec3 rgb2hsv(in vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(in vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
vec3 setHue(in vec3 res, in vec3 base) {
    vec3 hsv = rgb2hsv(base);
    vec3 res_hsv = rgb2hsv(res);
    return hsv2rgb(vec3(hsv.x, res_hsv.y, res_hsv.z));
}
void main() {
    lowp vec4 col = texture2D(texture, uv.xy);
    vec3 base = col.rgb * matRGBtoROMM;
    float a = abs(amount) * col.a + epsilon;
    float v = pow(2.0, a*2.0+1.0)-2.0;
    float m = mx - exp(-v);
    vec3 res = (amount > 0.0) ? (1.0 - exp(-v*base)) / m : log(1.0-base*m) / -v;
    res = mix(base, res, min(a*100.0, 1.0));
    res = setHue(res, base);
    res = pow(res, vec3(ramp(1.0 - (0.0 * col.a + 1.0) / 2.0)));
    res = res * matROMMtoRGB;
    gl_FragColor = vec4(res, col.a);
}
```

## 对比度
```
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform float m[20];
void main(void) {
    vec4 c = texture2D(texture, uv);
    gl_FragColor.r = m[0] * c.r + m[1] * c.g + m[2] * c.b + m[3] * c.a + m[4];
    gl_FragColor.g = m[5] * c.r + m[6] * c.g + m[7] * c.b + m[8] * c.a + m[9];
    gl_FragColor.b = m[10] * c.r + m[11] * c.g + m[12] * c.b + m[13] * c.a + m[14];
    gl_FragColor.a = m[15] * c.r + m[16] * c.g + m[17] * c.b + m[18] * c.a + m[19];
}
```

## 黑色
```

#define GLSLIFY 1
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform sampler2D paletteMap;
void main() {
    lowp vec4 base = texture2D(texture, uv.xy);
    float r = texture2D(paletteMap, vec2(base.r, 0)).r;
    float g = texture2D(paletteMap, vec2(base.g, 0)).g;
    float b = texture2D(paletteMap, vec2(base.b, 0)).b;
    gl_FragColor = vec4(r, g, b, base.a);
}
```

## 白色
```
#define GLSLIFY 1
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform sampler2D paletteMap;
void main() {
    lowp vec4 base = texture2D(texture, uv.xy);
    float r = texture2D(paletteMap, vec2(base.r, 0)).r;
    float g = texture2D(paletteMap, vec2(base.g, 0)).g;
    float b = texture2D(paletteMap, vec2(base.b, 0)).b;
    gl_FragColor = vec4(r, g, b, base.a);
}
```

## 高光
```
#define GLSLIFY 1
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform float amount;
const float epsilon = 0.000001;
const float mx = 1.0 - epsilon;
const float PI = 3.1415926535897932384626433832795;
const mat3 matRGBtoROMM = mat3(0.5293459296226501, 0.3300727903842926, 0.14058130979537964, 0.09837432950735092, 0.8734610080718994, 0.028164653107523918, 0.01688321679830551, 0.11767247319221497, 0.8654443025588989);
const mat3 matROMMtoRGB = mat3(2.0340757369995117, -0.727334201335907, -0.3067416846752167, -0.22881317138671875, 1.2317301034927368, -0.0029169507324695587, -0.008569774217903614, -0.1532866358757019, 1.1618564128875732);
float luma_romm(in vec3 color) {
    return dot(color, vec3(0.242655, 0.755158, 0.002187));
}
float luma(in vec3 color) {
    return dot(color, vec3(0.298839, 0.586811, 0.11435));
}
vec3 rgb2hsv(in vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(in vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
vec3 setHue(in vec3 res, in vec3 base) {
    vec3 hsv = rgb2hsv(base);
    vec3 res_hsv = rgb2hsv(res);
    return hsv2rgb(vec3(hsv.x, res_hsv.y, res_hsv.z));
}
float gaussian(in float x) {
    return 1.0 - exp(-PI*2.0*x*x);
}
void main() {
    lowp vec4 col = texture2D(texture, uv.xy);
    lowp vec3 map = col.rgb;
    vec3 base = col.rgb * matRGBtoROMM;
    float base_lum = luma(col.rgb);
    float map_lum = luma_romm(map * matRGBtoROMM);
    float exposure = mix(amount, 0.0, 1.0 - map_lum) * col.a;
    float a = abs(exposure) * col.a + epsilon;
    float v = pow(2.0, a+1.0)-2.0;
    float m = mx - exp(-v);
    vec3 res = (exposure > 0.0) ? (1.0 - exp(-v*base)) / m : log(1.0-base*m) / -v;
    res = mix(base, res, min(a*100.0, 1.0));
    res = setHue(res, base);
    res = res * matROMMtoRGB;
    gl_FragColor = vec4(res, col.a);
}
```

## 暗调
```
#define GLSLIFY 1
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform float amount;
const float epsilon = 0.000001;
const float mx = 1.0 - epsilon;
const float PI = 3.1415926535897932384626433832795;
const mat3 matRGBtoROMM = mat3(0.5293459296226501, 0.3300727903842926, 0.14058130979537964, 0.09837432950735092, 0.8734610080718994, 0.028164653107523918, 0.01688321679830551, 0.11767247319221497, 0.8654443025588989);
const mat3 matROMMtoRGB = mat3(2.0340757369995117, -0.727334201335907, -0.3067416846752167, -0.22881317138671875, 1.2317301034927368, -0.0029169507324695587, -0.008569774217903614, -0.1532866358757019, 1.1618564128875732);
float luma_romm(in vec3 color) {
    return dot(color, vec3(0.242655, 0.755158, 0.002187));
}
float luma(in vec3 color) {
    return dot(color, vec3(0.298839, 0.586811, 0.11435));
}
vec3 rgb2hsv(in vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(in vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
vec3 setHue(in vec3 res, in vec3 base) {
    vec3 hsv = rgb2hsv(base);
    vec3 res_hsv = rgb2hsv(res);
    return hsv2rgb(vec3(hsv.x, res_hsv.y, res_hsv.z));
}
float gaussian(in float x) {
    return 1.0 - exp(-PI*2.0*x*x);
}
void main() {
    lowp vec4 col = texture2D(texture, uv.xy);
    lowp vec3 map = col.rgb;
    vec3 base = col.rgb * matRGBtoROMM;
    float base_lum = luma(col.rgb);
    float map_lum = luma_romm(map * matRGBtoROMM);
    float exposure = mix(0.0, amount, 1.0 - map_lum) * col.a;
    float a = abs(exposure) * col.a + epsilon;
    float v = pow(2.0, a+1.0)-2.0;
    float m = mx - exp(-v);
    vec3 res = (exposure > 0.0) ? (1.0 - exp(-v*base)) / m : log(1.0-base*m) / -v;
    res = mix(base, res, min(a*100.0, 1.0));
    res = setHue(res, base);
    res = res * matROMMtoRGB;
    gl_FragColor = vec4(res, col.a);
}
```

## 自然饱和度
```
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform float amount;
void main() {
    vec4 col = texture2D(texture, uv.xy);
    vec3 color = col.rgb;
    float luminance = color.r*0.299 + color.g*0.587 + color.b*0.114;
    float mn = min(min(color.r, color.g), color.b);
    float mx = max(max(color.r, color.g), color.b);
    float sat = (1.0-(mx - mn)) * (1.0-mx) * luminance * 5.0;
    vec3 lightness = vec3((mn + mx)/2.0);
    
    // vibrance
    
    color = mix(color, mix(color, lightness, -amount), sat);
    
    // negative vibrance
    
    gl_FragColor = vec4(mix(color, lightness, (1.0-lightness)*(1.0-amount)/2.0*abs(amount)), col.a);
}
```

## 饱和度
```
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform float m[20];
void main(void) {
    vec4 c = texture2D(texture, uv);
    gl_FragColor.r = m[0] * c.r + m[1] * c.g + m[2] * c.b + m[3] * c.a + m[4];
    gl_FragColor.g = m[5] * c.r + m[6] * c.g + m[7] * c.b + m[8] * c.a + m[9];
    gl_FragColor.b = m[10] * c.r + m[11] * c.g + m[12] * c.b + m[13] * c.a + m[14];
    gl_FragColor.a = m[15] * c.r + m[16] * c.g + m[17] * c.b + m[18] * c.a + m[19];
}
```

## 温度
```
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform float amount;
void main() {
    vec4 color = texture2D(texture, uv);
    color.r = clamp(color.r + amount, 0.0, 1.0);
    color.b = clamp(color.b - amount, 0.0, 1.0);
    gl_FragColor = color;
}
```

## 色调
```
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform float amount;
void main() {
    vec4 color = texture2D(texture, uv);
    color.g = clamp(color.g + amount, 0.0, 1.0);
    gl_FragColor = color;
}
```

## 色相
```
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
uniform float rotation;
uniform float from;
uniform float to;
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
void main() {
    lowp vec4 base = texture2D(texture, uv.xy);
    vec3 hsv = rgb2hsv(base.rgb);
    hsv.x += rotation;
    gl_FragColor = vec4(hsv2rgb(hsv), base.a);
}
```