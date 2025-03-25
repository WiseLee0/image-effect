#version 300 es
precision highp float;
const float ditherFactor = 0.003922f;
uniform int type;
uniform float alpha;
uniform sampler2D texture0;
uniform sampler2D texture1;
in vec2 _coord2;
float minv3(vec3 c) {
    return min(min(c.r, c.g), c.b);
}
float maxv3(vec3 c) {
    return max(max(c.r, c.g), c.b);
}
float satv3(vec3 c) {
    return maxv3(c) - minv3(c);
}
float lumv3(vec3 c) {
    return dot(c, vec3(0.30f, 0.59f, 0.11f));
}
vec3 setLum(vec3 cbase, vec3 clum) {
    cbase = clamp(cbase, 0.0f, 1.0f);
    clum = clamp(clum, 0.0f, 1.0f);
    float llum = lumv3(clum);
    vec3 color = cbase + (llum - lumv3(cbase));
    float minc = minv3(color);
    float maxc = maxv3(color);
    if(minc < 0.0f) {
        color = mix(vec3(llum), color, llum / (llum - minc));
    } else if(maxc > 1.0f) {
        color = mix(vec3(llum), color, (1.0f - llum) / (maxc - llum));
    }
    return color;
}
vec3 setLumSat(vec3 cbase, vec3 csat, vec3 clum) {
    float sbase = satv3(cbase);
    vec3 color = vec3(0.0f);
    if(sbase > 0.0f) {
        float minbase = minv3(cbase);
        float ssat = satv3(csat);
        color = (cbase - minbase) * ssat / sbase;
    }
    return setLum(color, clum);
}
out vec4 fig_FragColor;
void main() {
    const int DARKEN = 2;
    const int MULTIPLY = 3;
    const int LINEAR_BURN = 4;
    const int COLOR_BURN = 5;
    const int LIGHTEN = 6;
    const int SCREEN = 7;
    const int LINEAR_DODGE = 8;
    const int COLOR_DODGE = 9;
    const int OVERLAY = 10;
    const int SOFT_LIGHT = 11;
    const int HARD_LIGHT = 12;
    const int DIFFERENCE = 13;
    const int EXCLUSION = 14;
    const int HUE = 15;
    const int SATURATION = 16;
    const int COLOR = 17;
    const int LUMINOSITY = 18;
    vec4 source = texture(texture0, _coord2) * alpha;
    vec4 target = texture(texture1, _coord2);
    float Sa = source.a;
    float Da = target.a;
    vec3 Dca = target.rgb;
    if(Sa == 0.0f) {
        fig_FragColor = vec4(Dca, Da);
    } else {
        float epsilon = 0.000001f;
        vec3 Sca = source.rgb;
        vec3 color = Sca * (1.0f - Da) + Dca * (1.0f - Sa);
        if(type == DARKEN) {
            color += min(Sca * Da, Dca * Sa);
        } else if(type == MULTIPLY) {
            color += Sca * Dca;
        } else if(type == LINEAR_BURN) {
            color = max(vec3(0.0f), Sca + Dca - Sa * Da);
        } else if(type == COLOR_BURN) {
            vec3 denominator = max(Sca * Da, ditherFactor);
            vec3 numerator = (Da - Dca) * Sa * step(ditherFactor, Da - Dca);
            color += Sa * Da * (1.0f - min(vec3(1.0f), numerator / denominator));
        } else if(type == LIGHTEN) {
            color += max(Sca * Da, Dca * Sa);
        } else if(type == SCREEN) {
            color = Sca + Dca - Sca * Dca;
        } else if(type == LINEAR_DODGE) {
            color = min(vec3(1.0f), Sca + Dca);
        } else if(type == COLOR_DODGE) {
            vec3 denominator = max(Da * (Sa - Sca), ditherFactor);
            vec3 numerator = Dca * Sa * step(ditherFactor, Dca);
            color += Sa * Da * min(vec3(1.0f), numerator / denominator);
        } else if(type == OVERLAY) {
            color += mix(Sa * Da - 2.0f * (Da - Dca) * (Sa - Sca), 2.0f * Sca * Dca, vec3(lessThanEqual(2.0f * Dca, vec3(Da))));
        } else if(type == HARD_LIGHT) {
            color += mix(2.0f * Sca * Dca, Sa * Da - 2.0f * (Da - Dca) * (Sa - Sca), vec3(greaterThan(2.0f * Sca, vec3(Sa))));
        } else if(type == DIFFERENCE) {
            color += abs(Dca * Sa - Sca * Da);
        } else if(type == EXCLUSION) {
            color += Sca * Da + Dca * Sa - 2.0f * Sca * Dca;
        } else {
            vec3 delta = vec3(0.0f);
            vec3 Sc = Sca;
            vec3 Dc = Dca;
            if(Sa > 0.0f)
                Sc /= Sa;
            if(Da > 0.0f)
                Dc /= Da;
            if(type == SOFT_LIGHT) {
                vec3 c0 = 1.0f - Dc;
                vec3 c1 = (16.0f * Dc - 12.0f) * Dc + 3.0f;
                vec3 c2 = inversesqrt(Dc + epsilon) - 1.0f;
                vec3 c = mix(c1, c2, vec3(greaterThan(Dc, vec3(0.25f))));
                c = mix(c, c0, vec3(greaterThan(Sc, vec3(0.50f))));
                delta = Dc * (1.0f + c * (2.0f * Sc - 1.0f));
            } else if(type == HUE) {
                delta = setLumSat(Sc, Dc, Dc);
            } else if(type == SATURATION) {
                delta = setLumSat(Dc, Sc, Dc);
            } else if(type == COLOR) {
                delta = setLum(Sc, Dc);
            } else if(type == LUMINOSITY) {
                delta = setLum(Dc, Sc);
            }
            color += Sa * Da * delta;
        }
        fig_FragColor = vec4(color, Sa + Da - Sa * Da);
    }

}
