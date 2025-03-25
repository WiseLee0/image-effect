#version 300 es
in vec4 aPosition;
in vec2 aTexCoord;
out vec2 _coord2;
void main() {
    gl_Position = aPosition;
    _coord2 = vec2(aTexCoord.x, 1.f - aTexCoord.y);
}