// ---------------------------------------------------------------
// GLSL shaders
// Air texture   (A): R = u, G = v, B = temperature anomaly (K), A = unused
// Water texture (B): R = vapor, G = cloud water, B = smoke, A = unused
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

// Moisture physics (shared by several passes)
uniform float uQs0, uQsAlt, uQsTemp, uCondRate;
uniform float uRhGround, uRhTop;

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

float heightOf(ivec2 p) {
  return (float(p.y) + 0.5) / float(uSize.y);
}

// Saturation vapor amount: drops with height (colder air),
// rises with the local temperature anomaly (Clausius-Clapeyron).
float qsat(float y, float T) {
  return uQs0 * exp(-uQsAlt * y + uQsTemp * T);
}

// Initial vapor profile: humid near the ground, dry aloft
float initialVapor(float y) {
  return qsat(y, 0.0) * mix(uRhGround, uRhTop, y);
}

// Water turning into cloud (> 0) or cloud evaporating (< 0) this step
float phaseChange(vec4 air, vec4 water, float y) {
  float d = (water.x - qsat(y, air.z)) * uCondRate;
  if (d < 0.0) d = max(d, -water.y);
  return d;
}
`;

// Air physics: buoyancy, stability, latent heat, ground heating, mouse
export const FS_AIR = `
uniform sampler2D uAir, uWater;
uniform float uDt, uBuoy, uGroundHeat, uTMax, uHeatRows;
uniform float uLatent, uLoading, uStratTropo, uStratStrato, uTropopause;
uniform int uHeating, uFrame, uMode;
uniform vec2 uMouse, uMouseDelta;
uniform float uRadius, uForce, uHeatAmt;

float hash(uint x) {
  x ^= x >> 16; x *= 0x7feb352dU;
  x ^= x >> 15; x *= 0x846ca68bU;
  x ^= x >> 16;
  return float(x) / 4294967295.0;
}

// Smooth 1D value noise: some patches of ground heat up more than others
float noise1(float x) {
  float i = floor(x);
  float f = smoothstep(0.0, 1.0, x - i);
  return mix(hash(uint(i)), hash(uint(i) + 1u), f);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uAir, p, 0);
  vec4 w = texelFetch(uWater, p, 0);
  float y = heightOf(p);

  // Latent heat: condensation warms the air, evaporation cools it
  a.z += uLatent * phaseChange(a, w, y);

  // Buoyancy: warm air rises, cold air and cloud water weight pull down
  a.y += uDt * uBuoy * (a.z - uLoading * w.y);

  // Stable background: rising air cools relative to its surroundings,
  // much faster above the tropopause (this is what makes anvils)
  float strat = mix(uStratTropo, uStratStrato,
                    smoothstep(uTropopause - 0.03, uTropopause + 0.03, y));
  a.z -= uDt * a.y / float(uSize.y) * strat;

  // Uneven solar heating of the ground
  if (uHeating == 1 && p.y >= 1 && float(p.y) <= uHeatRows) {
    // Fixed hot spots (terrain) plus a little flicker
    float patches = noise1(float(p.x) / float(uSize.x) * 12.0 + 7.0);
    float flicker = hash(uint(p.x) * 1973u + uint(uFrame) * 9277u);
    a.z += uDt * uGroundHeat * (0.2 + 1.4 * patches + 0.4 * flicker) / uHeatRows;
  }

  // Mouse brush
  if (uMode > 0) {
    float d = distance(vec2(p) + 0.5, uMouse);
    if (d < uRadius) {
      float fall = 1.0 - d / uRadius;
      a.xy += uMouseDelta * uForce * fall;
      if (uMode == 1)      a.z += uHeatAmt * fall;
      else if (uMode == 2) a.z -= uHeatAmt * fall;
    }
  }

  a.z = clamp(a.z, -uTMax, uTMax);
  outColor = a;
}`;

// Water physics: condensation / evaporation, surface moisture, mouse
export const FS_WATER = `
uniform sampler2D uAir, uWater;
uniform float uDt, uEvap, uHeatRows;
uniform int uMode;
uniform vec2 uMouse;
uniform float uRadius, uSmokeAmt, uMoistAmt;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uAir, p, 0);
  vec4 w = texelFetch(uWater, p, 0);
  float y = heightOf(p);

  float dq = phaseChange(a, w, y);
  w.x -= dq;
  w.y += dq;

  // Moist ground keeps feeding vapor into the lowest layer
  if (float(p.y) <= uHeatRows) {
    float target = qsat(y, a.z) * uRhGround;
    w.x += uDt * uEvap * max(target - w.x, 0.0);
  }

  // Mouse brush
  if (uMode == 3 || uMode == 5) {
    float d = distance(vec2(p) + 0.5, uMouse);
    if (d < uRadius) {
      float fall = 1.0 - d / uRadius;
      if (uMode == 3) w.z = min(w.z + uSmokeAmt * fall, 2.0);
      else            w.x += uMoistAmt * fall;
    }
  }

  w.xy = max(w.xy, 0.0);
  outColor = w;
}`;

// Semi-Lagrangian advection. uKind: 0 = air texture, 1 = water texture
export const FS_ADVECT = `
uniform sampler2D uVel, uSrc;
uniform float uDt, uKeep, uSmokeDecay, uTMax;
uniform int uKind;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 vel = texelFetch(uVel, p, 0).xy;
  vec4 s = bilerp(uSrc, vec2(p) - uDt * vel);
  if (uKind == 0) {
    s.z = clamp(s.z * uKeep, -uTMax, uTMax);
  } else {
    s.xy = max(s.xy, 0.0);
    s.z *= uSmokeDecay;
  }
  outColor = s;
}`;

// Initial water state (vapor profile, no clouds)
export const FS_INIT_WATER = `
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  outColor = vec4(initialVapor(heightOf(p)), 0.0, 0.0, 0.0);
}`;

// Divergence (walls reflect the normal velocity)
export const FS_DIVERGENCE = `
uniform sampler2D uAir;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 c = texelFetch(uAir, p, 0).xy;
  float uL = p.x > 0            ? fetch(uAir, p - ivec2(1, 0)).x : -c.x;
  float uR = p.x < uSize.x - 1  ? fetch(uAir, p + ivec2(1, 0)).x : -c.x;
  float vB = p.y > 0            ? fetch(uAir, p - ivec2(0, 1)).y : -c.y;
  float vT = p.y < uSize.y - 1  ? fetch(uAir, p + ivec2(0, 1)).y : -c.y;
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
uniform sampler2D uAir, uP;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uAir, p, 0);
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

// Display. Views: 0 clouds, 1 temperature, 2 humidity, 3 smoke, 4 velocity
export const FS_RENDER = `
uniform sampler2D uAir, uWater;
uniform int uView;
uniform float uTVis, uVelScale;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uAir, p, 0);
  vec4 w = texelFetch(uWater, p, 0);
  float y = heightOf(p);
  vec3 sky = mix(vec3(0.42, 0.62, 0.86), vec3(0.12, 0.25, 0.55), y);
  vec3 col;

  if (uView == 0) {
    // Cloud water as white, thick clouds get a grey base
    float cover = 1.0 - exp(-w.y * 40.0);
    float shade = 0.97 - 0.4 * smoothstep(0.05, 0.5, w.y);
    col = mix(sky, vec3(shade), cover);
    col = mix(col, vec3(0.35, 0.33, 0.30), min(w.z, 1.0) * 0.8);
  } else if (uView == 1) {
    float t = clamp(a.z / uTVis, -1.0, 1.0);
    vec3 base = vec3(0.35);
    col = t >= 0.0
      ? mix(base, vec3(1.0, 0.35, 0.15), t)
      : mix(base, vec3(0.15, 0.55, 1.0), -t);
    col = mix(col, vec3(1.0), (1.0 - exp(-w.y * 60.0)) * 0.35);
  } else if (uView == 2) {
    // Relative humidity: brown = dry, green = humid, white = saturated
    float rh = clamp(w.x / qsat(y, a.z), 0.0, 1.0);
    col = rh < 0.7
      ? mix(vec3(0.45, 0.30, 0.15), vec3(0.15, 0.6, 0.3), rh / 0.7)
      : mix(vec3(0.15, 0.6, 0.3), vec3(0.95), (rh - 0.7) / 0.3);
  } else if (uView == 3) {
    col = sky + min(w.z, 1.0) * vec3(0.86, 0.75, 0.55);
  } else {
    vec2 vel = a.xy / uVelScale;
    col = vec3(0.5 + vel.x * 0.16, 0.5 + vel.y * 0.16, 0.5);
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
