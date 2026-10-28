// ---------------------------------------------------------------
// Quality presets and physics constants
// ---------------------------------------------------------------

// Memory per cell = 19 channels:
// air state x2 (4), water state x2 (4), pressure x2 (1), divergence (1)
export const PRESETS = [
  { name: 'Low',    w: 192,  h: 96,  half: true,  iters: 30 },
  { name: 'Medium', w: 512,  h: 256, half: false, iters: 40 },
  { name: 'High',   w: 1024, h: 512, half: false, iters: 50 },
  { name: 'Ultra',  w: 1600, h: 800, half: false, iters: 60 },
];

export const DEFAULT_LEVEL = 1; // Medium

// Physics constants (tuned at BASE_W, scaled with resolution)
// Temperature unit ~ 1 K, domain height ~ 12 km.
export const BASE_W = 160;
export const DT = 0.1;
export const BUOYANCY = 0.05;    // upward acceleration per K of temperature anomaly
export const COOLING = 0.005;    // slow radiative relaxation of anomalies
export const GROUND_HEAT = 6.0;  // heating rate of the ground (sun on the surface)
export const T_MAX = 40;         // clamp for temperature anomaly
export const T_VIS = 6;          // anomaly that maps to full color
export const SMOKE_DECAY = 0.999;

// Atmosphere stability: background potential temperature increase
// across the whole domain height (K). Low value = troposphere, high = stratosphere.
export const STRAT_TROPO = 40;
export const STRAT_STRATO = 250;
export const TROPOPAUSE = 0.8;   // tropopause height (fraction of domain)

// Moisture
export const QS0 = 1.0;          // saturation vapor at the ground (1.0 ~ 20 g/kg)
export const QS_ALT = 4.5;       // how fast saturation drops with height
export const QS_TEMP = 0.07;     // Clausius-Clapeyron: +7% per K
export const COND_RATE = 0.5;    // fraction of supersaturation condensed per step
export const LATENT = 50;        // K of warming per unit of condensed water
export const LOADING = 10;       // weight of cloud water (K-equivalent per unit)
export const RH_GROUND = 0.75;   // initial relative humidity near the ground
export const RH_TOP = 0.25;      // initial relative humidity at the top
export const EVAP = 0.05;        // surface evaporation rate

// Mouse brush
export const BRUSH = 4;
export const FORCE = 6;
export const HEAT = 1.5;
export const SMOKE = 1.0;
export const MOIST = 0.05;

// Automatic quality
export const MIN_FPS = 30;
export const WARMUP_MS = 2000;
