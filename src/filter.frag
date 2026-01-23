#version 300 es
precision highp float;
uniform sampler2D texture0;
in vec2 _coord2;
out vec4 out_FragColor;
uniform int colorConversionType;
vec3 lin_sRGB(vec3 color) {
    vec3 result;
    for(int i = 0; i < 3; i++) {
        float val = color[i];
        float sign = val < 0.0f ? -1.0f : 1.0f;
        float abs_val = abs(val);
        if(abs_val < 0.04045f) {
            result[i] = val / 12.92f;
        } else {
            result[i] = sign * pow((abs_val + 0.055f) / 1.055f, 2.4f);
        }

    }
    return result;
}
vec3 gam_sRGB(vec3 color) {
    vec3 result;
    for(int i = 0; i < 3; i++) {
        float val = color[i];
        float sign = val < 0.0f ? -1.0f : 1.0f;
        float abs_val = abs(val);
        if(abs_val > 0.0031308f) {
            result[i] = sign * (1.055f * pow(abs_val, 1.0f / 2.4f) - 0.055f);
        } else {
            result[i] = 12.92f * val;
        }

    }
    return result;
}
vec3 colorSpaceConvert(vec3 src) {
    const int NO_CONVERSION = 0;
    const int SRGB_TO_DISPLAY_P3 = 1;
    const int DISPLAY_P3_TO_SRGB = 2;
    if(colorConversionType == NO_CONVERSION) {
        return src;
    } else if(colorConversionType == SRGB_TO_DISPLAY_P3) {
        vec3 lin_srgb = lin_sRGB(src);
        mat3 lin_sRGB_to_XYZ = mat3(0.4123907992659595f, 0.21263900587151036f, 0.01933081871559185f, 0.35758433938387796f, 0.7151686787677559f, 0.11919477979462599f, 0.1804807884018343f, 0.07219231536073371f, 0.9505321522496606f);
        mat3 XYZ_to_lin_P3 = mat3(2.4934969119414245f, -0.829488969561575f, 0.035845830243784335f, -0.9313836179191236f, 1.7626640603183468f, -0.07617238926804171f, -0.40271078445071684f, 0.02362468584194359f, 0.9568845240076873f);
        vec3 lin_p3 = XYZ_to_lin_P3 * lin_sRGB_to_XYZ * lin_srgb;
        vec3 p3 = gam_sRGB(lin_p3);
        return p3;
    } else if(colorConversionType == DISPLAY_P3_TO_SRGB) {
        vec3 lin_p3 = lin_sRGB(src);
        mat3 lin_P3_to_XYZ = mat3(0.48657094864821626f, 0.22897456406974884f, 0, 0.26566769316909294f, 0.6917385218365062f, 0.045113381858902575f, 0.1982172852343625f, 0.079286914093745f, 1.0439443689009757f);
        mat3 XYZ_to_lin_sRGB = mat3(3.2409699419045213f, -0.9692436362808798f, 0.05563007969699361f, -1.5373831775700935f, 1.8759675015077206f, -0.20397695888897657f, -0.4986107602930033f, 0.04155505740717561f, 1.0569715142428786f);
        vec3 lin_srgb = XYZ_to_lin_sRGB * lin_P3_to_XYZ * lin_p3;
        vec3 srgb = gam_sRGB(lin_srgb);
        vec3 gamut_mapped_srgb = clamp(srgb, 0.0f, 1.0f);
        return gamut_mapped_srgb;
    }
    return src;
}
uniform float globalTint;
uniform float globalColor;
uniform float globalShadows;
uniform float globalHighlights;
uniform float globalExposure;
uniform float globalTemperature;
uniform float globalContrast;
uniform float highlightShadowThreshold;
uniform float alpha;
uniform float brightness;
uniform float whites;
uniform float blacks;
uniform float hue;
uniform float vibrance;
const vec3 RGB2Y = vec3(0.2126f, 0.7152f, 0.0722f);
vec3 colorToLinear(vec3 color) {
    color = pow(color, vec3(2.2f));
    return color;
}
vec3 colorFromLinear(vec3 color) {
    color = pow(color, vec3(1.0f / 2.2f));
    return color;
}
float rangeFactor(vec3 color, float shadows, float highlights) {
    float lThreshold = dot(color, RGB2Y) - pow(highlightShadowThreshold, 2.2f);
    return 0.75f * lThreshold / sqrt(1.0f + 4.0f * lThreshold * lThreshold) * (lThreshold > 0.0f ? highlights : -shadows * 0.999f);
}
vec3 adjustExposure(vec3 color, float exposureAdjust) {
    float lFactor = pow(10.0f, 2.0f * exposureAdjust) - 1.0f;
    const float lSqueeze = 0.75f;
    float lUnsqueeze = 1.0f / (1.0f - lSqueeze) - 1.0f;
    float gray = dot(color, RGB2Y);
    lUnsqueeze *= 1.0f + gray * gray * min(0.0f, exposureAdjust) / (0.2f - min(0.0f, exposureAdjust));
    color += (gray - color) * lSqueeze;
    if(exposureAdjust < 0.0f) {
        color *= 1.0f + exposureAdjust / 16.0f;
        gray *= 1.0f + exposureAdjust / 16.0f;
    }
    color *= (lFactor + 1.0f) / (color * lFactor + 1.0f);
    gray *= (lFactor + 1.0f) / (gray * lFactor + 1.0f);
    color += (color - gray) * lUnsqueeze;
    color = clamp(color, 0.0f, 1.0f);
    return color;
}
vec3 adjustColor(vec3 color, float colorAdjust) {
    float gray = dot(color, RGB2Y);
    if(colorAdjust <= 0.0f) {
        color -= (gray - color) * colorAdjust;
    } else {
        float lNeg = gray / (gray - min(min(color.r, color.g), color.b) + 1e-6f);
        float lPos = (1.0f - gray) / (max(max(color.r, color.g), color.b) - gray + 1e-6f);
        float lFactor = mix(1.0f, min(lNeg, lPos), colorAdjust);
        lFactor = min(lFactor, 2.0f);
        color += (gray - color) * (1.0f - lFactor);
    }
    return color;
}
float smootherstep(float edge0, float edge1, float x) {
    x = clamp((x - edge0) / (edge1 - edge0), 0.0f, 1.0f);
    return x * x * x * (x * (x * 6.0f - 15.0f) + 10.0f);
}
vec3 adjustTempTintContrast(vec3 color, float temp, float tint, float contrast) {
    vec3 lXYZ = mat3(0.4124564f, 0.2126729f, 0.0193339f, 0.3575761f, 0.7151522f, 0.1191920f, 0.1804375f, 0.0721750f, 0.9503041f) * color;
    lXYZ.x /= 0.95047f;
    lXYZ.z /= 1.08883f;
    lXYZ = pow(lXYZ, vec3(1.0f / 3.0f));
    vec3 lLAB = vec3(116.0f * lXYZ.y - 16.0f, 500.0f * (lXYZ.x - lXYZ.y), 200.0f * (lXYZ.y - lXYZ.z));
    lLAB.y += 30.0f * tint;
    lLAB.z += 30.0f * temp;
    float scaledThreshold = highlightShadowThreshold * 100.0f;
    float thresholdDelta = 30.0f;
    float contrastLeftCurve = contrast < 0.0f ? (lLAB.x - scaledThreshold) * 0.2f + 50.0f : lLAB.x;
    float contrastRightCurve = contrast < 0.0f ? lLAB.x : smootherstep(scaledThreshold - thresholdDelta, scaledThreshold + thresholdDelta, lLAB.x) * 100.0f;
    float interp = contrast < 0.0f ? contrast + 1.0f : contrast;
    lLAB.x = mix(contrastLeftCurve, contrastRightCurve, interp);
    lXYZ.y = (lLAB.x + 16.0f) / 116.0f;
    lXYZ.x = lLAB.y / 500.0f + lXYZ.y;
    lXYZ.z = lXYZ.y - lLAB.z / 200.0f;
    lXYZ *= lXYZ * lXYZ;
    lXYZ.x *= 0.95047f;
    lXYZ.z *= 1.08883f;
    color = mat3(3.2404542f, -0.9692660f, 0.0556434f, -1.5371385f, 1.8760108f, -0.2040259f, -0.4985314f, 0.0415560f, 1.0572252f) * lXYZ;
    color = clamp(color, 0.0f, 1.0f);
    return color;
}
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0f, -1.0f / 3.0f, 2.0f / 3.0f, -1.0f);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10f;
    return vec3(abs(q.z + (q.w - q.y) / (6.0f * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0f, 2.0f / 3.0f, 1.0f / 3.0f, 3.0f);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0f - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0f, 1.0f), c.y);
}
vec3 adjustBrightness(vec3 color, float brightnessAdjust) {
    color += brightnessAdjust;
    return clamp(color, 0.0f, 1.0f);
}
vec3 adjustWhites(vec3 color, float whitesAdjust) {
    float lum = dot(color, RGB2Y);
    float whiteMask = smoothstep(0.5f, 1.0f, lum);
    color += whitesAdjust * whiteMask;
    return clamp(color, 0.0f, 1.0f);
}
vec3 adjustBlacks(vec3 color, float blacksAdjust) {
    float lum = dot(color, RGB2Y);
    float blackMask = smoothstep(0.5f, 0.0f, lum);
    color += blacksAdjust * blackMask;
    return clamp(color, 0.0f, 1.0f);
}
vec3 adjustHue(vec3 color, float hueAdjust) {
    float hueShift = hueAdjust * 0.5f;
    vec3 hsv = rgb2hsv(color);
    hsv.x = fract(hsv.x + hueShift);
    return hsv2rgb(hsv);
}
vec3 adjustVibrance(vec3 color, float vibranceAdjust) {
    vec3 hsv = rgb2hsv(color);
    float saturation = hsv.y;
    // 对低饱和度颜色增加更多，对高饱和度颜色增加较少
    float mask = 1.0f - saturation;
    float adjustment = vibranceAdjust * mask;
    hsv.y = clamp(saturation + adjustment, 0.0f, 1.0f);
    return hsv2rgb(hsv);
}
vec3 pipeline(vec3 color) {
    color = colorToLinear(color);
    float originalRangeFactor = rangeFactor(color, globalShadows, globalHighlights);
    color = adjustTempTintContrast(color, globalTemperature, globalTint, globalContrast);
    color = adjustExposure(color, globalExposure + originalRangeFactor);
    color = adjustColor(color, clamp(globalColor, -1.0f, 1.0f));
    color = colorFromLinear(color);
    color = adjustBrightness(color, brightness);
    color = adjustWhites(color, whites);
    color = adjustBlacks(color, blacks);
    color = adjustHue(color, hue);
    color = adjustVibrance(color, vibrance);
    return color;
}

vec4 sampleImage() {
    if(_coord2 == clamp(_coord2, 0.0f, 1.0f)) {
        return texture(texture0, _coord2);
    } else {
        return vec4(0.0f);
    }

}

void main() {
    vec4 color = sampleImage();
    color.rgb = colorSpaceConvert(pipeline(color.rgb)) * color.a;
    out_FragColor = color * alpha;
}