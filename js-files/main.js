// ---------------------------------------------------------------
// Stormths - entry point: input, main loop, automatic quality
// ---------------------------------------------------------------
import { PRESETS, DEFAULT_LEVEL, MIN_FPS, WARMUP_MS } from './config.js';
import { createContext } from './gl-utils.js';
import { Simulation } from './simulation.js';

const canvas = document.getElementById('c');
const statsEl = document.getElementById('stats');
const errEl = document.getElementById('err');

function showError(e) {
  errEl.textContent = 'Error: ' + (e && e.message ? e.message : e);
  console.error(e);
}

let sim;
try {
  const { gl, hasFloat } = createContext(canvas);
  sim = new Simulation(gl, hasFloat);
} catch (e) {
  showError(e);
  throw e;
}

// ---------------------------------------------------------------
// Input
// ---------------------------------------------------------------
const mouse = { x: 0, y: 0, px: 0, py: 0, buttons: 0, shift: false };

function toGrid(e) {
  const r = canvas.getBoundingClientRect();
  return [
    (e.clientX - r.left) / r.width * sim.w,
    (1 - (e.clientY - r.top) / r.height) * sim.h,
  ];
}

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  e.preventDefault();
  [mouse.x, mouse.y] = toGrid(e);
  mouse.px = mouse.x; mouse.py = mouse.y;
  mouse.buttons = e.buttons; mouse.shift = e.shiftKey;
});
canvas.addEventListener('mousemove', e => {
  [mouse.x, mouse.y] = toGrid(e);
  mouse.buttons = e.buttons; mouse.shift = e.shiftKey;
});
window.addEventListener('mouseup', e => { mouse.buttons = e.buttons; });

const VIEWS = ['temperature', 'smoke', 'velocity'];
let view = 0;
let heating = false;
let manualQuality = false;
let autoNote = '';

window.addEventListener('keydown', e => {
  const key = e.key.toLowerCase();
  if (key === 'v') view = (view + 1) % VIEWS.length;
  if (key === 'h') heating = !heating;
  if (key === 'r') sim.reset();
  if (key >= '1' && key <= '4') {
    manualQuality = true;
    autoNote = '';
    sim.build(Number(key) - 1);
  }
});

function readInput() {
  let mode = 0;
  if (mouse.buttons) {
    if (mouse.shift) mode = 3;
    else if (mouse.buttons & 1) mode = 1;
    else if (mouse.buttons & 2) mode = 2;
    else mode = 4; // push air only
  }
  const dx = mouse.buttons ? mouse.x - mouse.px : 0;
  const dy = mouse.buttons ? mouse.y - mouse.py : 0;
  mouse.px = mouse.x; mouse.py = mouse.y;
  return { mode, x: mouse.x, y: mouse.y, dx, dy, heating };
}

// ---------------------------------------------------------------
// Startup quality (?q=0..3 forces a preset)
// ---------------------------------------------------------------
let startLevel = DEFAULT_LEVEL;
const params = new URLSearchParams(location.search);
if (params.has('q')) {
  const q = Number(params.get('q'));
  if (q >= 0 && q < PRESETS.length) {
    startLevel = q;
    manualQuality = true;
  }
}

try {
  sim.build(startLevel);
} catch (e) {
  showError(e);
  throw e;
}

// ---------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------
let fpsFrames = 0;
let fpsLast = performance.now();

function updateStats(now) {
  const fps = fpsFrames * 1000 / (now - fpsLast);
  fpsFrames = 0;
  fpsLast = now;

  // Drop quality if this computer can't keep up
  if (!manualQuality && now - sim.builtAt > WARMUP_MS &&
      fps < MIN_FPS && sim.level > 0) {
    sim.build(sim.level - 1);
    autoNote = ' | Auto-lowered quality';
  }

  statsEl.textContent =
    `${sim.preset.name} ${sim.w}x${sim.h} (${sim.half ? '16' : '32'}-bit) | ` +
    `GPU ~${sim.memMB.toFixed(1)} MB | ${fps.toFixed(0)} FPS | ` +
    `View: ${VIEWS[view]} | Ground heating: ${heating ? 'ON' : 'OFF'}` + autoNote;
}

function loop(now) {
  try {
    sim.step(readInput());
    sim.render(view);
  } catch (e) {
    showError(e);
    return; // stop the loop on errors
  }
  fpsFrames++;
  if (now - fpsLast > 1000) updateStats(now);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
