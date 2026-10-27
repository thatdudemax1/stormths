// ---------------------------------------------------------------
// GLSL shaders
// State texture channels: R = u, G = v, B = temperature anomaly, A = smoke
// ---------------------------------------------------------------

export const VS = `#version 300 es
void main() {
  // Fullscreen triangle without vertex buffers
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FS_HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 outColor;
uniform ivec2 uSize;

vec4 fetch(sampler2D t, ivec2 p) {
  return texelFetch(t, clamp(p, ivec2(0), uSize - 1), 0);
}

// Manual bilinear sampling (works for 16F and 32F textures)
vec4 bilerp(sampler2D t, vec2 pos) {
  pos = clamp(pos, vec2(0.0), vec2(uSize - 1));
  ivec2 i0 = ivec2(floor(pos));
  vec2 f = pos - vec2(i0);
  vec4 a = fetch(t, i0);
  vec4 b = fetch(t, i0 + ivec2(1, 0));
  vec4 c = fetch(t, i0 + ivec2(0, 1));
  vec4 d = fetch(t, i0 + ivec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

// Forces: buoyancy, ground heating, mouse brush
export const FS_FORCES = `
uniform sampler2D uState;
uniform float uDt, uBuoy, uGroundHeat, uTMax, uHeatRows;
uniform int uHeating, uFrame, uMode;
uniform vec2 uMouse, uMouseDelta;
uniform float uRadius, uForce, uHeatAmt, uSmokeAmt;

float hash(uint x) {
  x ^= x >> 16; x *= 0x7feb352dU;
  x ^= x >> 15; x *= 0x846ca68bU;
  x ^= x >> 16;
  return float(x) / 4294967295.0;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, p, 0);

  // Buoyancy: warm air rises, cold air sinks
  s.y += uDt * uBuoy * s.z;

  // Uneven solar heating of the ground
  if (uHeating == 1 && float(p.y) < uHeatRows) {
    float n = hash(uint(p.x) * 1973u + uint(uFrame) * 9277u);
    s.z += uDt * uGroundHeat * (0.5 + n);
  }

  // Mouse brush
  if (uMode > 0) {
    float d = distance(vec2(p) + 0.5, uMouse);
    if (d < uRadius) {
      float fall = 1.0 - d / uRadius;
      s.xy += uMouseDelta * uForce * fall;
      if (uMode == 1)      s.z += uHeatAmt * fall;
      else if (uMode == 2) s.z -= uHeatAmt * fall;
      else if (uMode == 3) s.w = min(s.w + uSmokeAmt * fall, 2.0);
    }
  }

  s.z = clamp(s.z, -uTMax, uTMax);
  outColor = s;
}`;

// Semi-Lagrangian advection of everything in the state texture
export const FS_ADVECT = `
uniform sampler2D uState;
uniform float uDt, uKeep, uSmokeDecay, uTMax;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 vel = texelFetch(uState, p, 0).xy;
  vec4 s = bilerp(uState, vec2(p) - uDt * vel);
  s.z = clamp(s.z * uKeep, -uTMax, uTMax);
  s.w *= uSmokeDecay;
  outColor = s;
}`;

// Divergence (walls reflect the normal velocity)
export const FS_DIVERGENCE = `
uniform sampler2D uState;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 c = texelFetch(uState, p, 0).xy;
  float uL = p.x > 0            ? fetch(uState, p - ivec2(1, 0)).x : -c.x;
  float uR = p.x < uSize.x - 1  ? fetch(uState, p + ivec2(1, 0)).x : -c.x;
  float vB = p.y > 0            ? fetch(uState, p - ivec2(0, 1)).y : -c.y;
  float vT = p.y < uSize.y - 1  ? fetch(uState, p + ivec2(0, 1)).y : -c.y;
  outColor = vec4(-0.5 * (uR - uL + vT - vB), 0.0, 0.0, 1.0);
}`;

// One Jacobi iteration of the pressure Poisson equation
export const FS_JACOBI = `
uniform sampler2D uP, uDiv;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float c = texelFetch(uP, p, 0).r;
  float l = p.x > 0            ? fetch(uP, p - ivec2(1, 0)).r : c;
  float r = p.x < uSize.x - 1  ? fetch(uP, p + ivec2(1, 0)).r : c;
  float b = p.y > 0            ? fetch(uP, p - ivec2(0, 1)).r : c;
  float t = p.y < uSize.y - 1  ? fetch(uP, p + ivec2(0, 1)).r : c;
  float d = texelFetch(uDiv, p, 0).r;
  outColor = vec4((d + l + r + b + t) * 0.25, 0.0, 0.0, 1.0);
}`;

// Subtract pressure gradient -> incompressible flow
export const FS_GRADIENT = `
uniform sampler2D uState, uP;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, p, 0);
  float c = texelFetch(uP, p, 0).r;
  float l = p.x > 0            ? fetch(uP, p - ivec2(1, 0)).r : c;
  float r = p.x < uSize.x - 1  ? fetch(uP, p + ivec2(1, 0)).r : c;
  float b = p.y > 0            ? fetch(uP, p - ivec2(0, 1)).r : c;
  float t = p.y < uSize.y - 1  ? fetch(uP, p + ivec2(0, 1)).r : c;
  s.x -= 0.5 * (r - l);
  s.y -= 0.5 * (t - b);
  if (p.x == 0 || p.x == uSize.x - 1) s.x = 0.0;
  if (p.y == 0 || p.y == uSize.y - 1) s.y = 0.0;
  outColor = s;
}`;

// Display
export const FS_RENDER = `
uniform sampler2D uState;
uniform int uView;
uniform float uTVis, uVelScale;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, p, 0);
  float sky = (float(p.y) + 0.5) / float(uSize.y);
  vec3 base = vec3(30.0 + 40.0 * sky, 60.0 + 60.0 * sky, 110.0 + 80.0 * sky) / 255.0;
  vec3 col;

  if (uView == 0) {
    float t = clamp(s.z / uTVis, -1.0, 1.0);
    col = t >= 0.0
      ? mix(base, vec3(255.0, 90.0, 40.0) / 255.0, t)
      : mix(base, vec3(40.0, 140.0, 255.0) / 255.0, -t);
  } else if (uView == 1) {
    col = base + min(s.w, 1.0) * vec3(220.0, 190.0, 140.0) / 255.0;
  } else {
    vec2 vel = s.xy / uVelScale;
    col = vec3(0.5 + vel.x * 40.0 / 255.0, 0.5 + vel.y * 40.0 / 255.0, 0.5);
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
