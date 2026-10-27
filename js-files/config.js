// ---------------------------------------------------------------
// Quality presets and physics constants
// ---------------------------------------------------------------

// Memory per cell = 11 channels (state x2, pressure x2, divergence).
export const PRESETS = [
  { name: 'Low',    w: 192,  h: 96,  half: true,  iters: 30 },
  { name: 'Medium', w: 512,  h: 256, half: false, iters: 40 },
  { name: 'High',   w: 1024, h: 512, half: false, iters: 50 },
  { name: 'Ultra',  w: 1600, h: 800, half: false, iters: 60 },
];

export const DEFAULT_LEVEL = 1; // Medium

// Physics constants (tuned at BASE_W, scaled with resolution)
export const BASE_W = 160;
export const DT = 0.1;
export const BUOYANCY = 0.4;     // upward acceleration per unit of temperature anomaly
export const COOLING = 0.02;     // relaxation of anomalies back to ambient
export const GROUND_HEAT = 1.0;  // heating rate of the ground (sun on the surface)
export const T_MAX = 10;         // clamp for temperature anomaly
export const T_VIS = 4;          // anomaly that maps to full color
export const SMOKE_DECAY = 0.999;

// Mouse brush
export const BRUSH = 4;
export const FORCE = 6;
export const HEAT = 0.6;
export const SMOKE = 1.0;

// Automatic quality
export const MIN_FPS = 30;
export const WARMUP_MS = 2000;
