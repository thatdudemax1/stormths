// ---------------------------------------------------------------
// GPU atmosphere simulation
// Vertical cross-section: y = 0 is the ground, +v means upward.
// ---------------------------------------------------------------
import {
  PRESETS, BASE_W, DT, BUOYANCY, COOLING, GROUND_HEAT, T_MAX, T_VIS,
  SMOKE_DECAY, STRAT_TROPO, STRAT_STRATO, TROPOPAUSE,
  QS0, QS_ALT, QS_TEMP, COND_RATE, LATENT, LOADING, RH_GROUND, RH_TOP, EVAP,
  BRUSH, FORCE, HEAT, SMOKE, MOIST
} from './config.js';
import {
  VS, FS_HEADER, FS_AIR, FS_WATER, FS_ADVECT, FS_INIT_WATER,
  FS_DIVERGENCE, FS_JACOBI, FS_GRADIENT, FS_RENDER
} from './shaders.js';
import {
  compileShader, makeProgram, makeTarget, makePair, deleteTarget, clearTarget
} from './graphics-utils.js';

export class Simulation {
  constructor(gl, hasFloat) {
    this.gl = gl;
    this.forceHalf = !hasFloat;
    this.frame = 0;
    this.targets = null;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VS);
    const prog = (body) => makeProgram(gl, vs, FS_HEADER + body);
    this.P = {
      air:        prog(FS_AIR),
      water:      prog(FS_WATER),
      advect:     prog(FS_ADVECT),
      initWater:  prog(FS_INIT_WATER),
      divergence: prog(FS_DIVERGENCE),
      jacobi:     prog(FS_JACOBI),
      gradient:   prog(FS_GRADIENT),
      render:     prog(FS_RENDER),
    };
  }

  // Create all textures for a quality level
  build(level) {
    const gl = this.gl;
    this.destroy();

    const preset = PRESETS[level];
    const half = preset.half || this.forceHalf;
    const { w, h } = preset;

    const air = makePair(gl, w, h, 4, half);
    const water = makePair(gl, w, h, 4, half);
    const pressure = makePair(gl, w, h, 1, half);
    const div = makeTarget(gl, w, h, 1, half);

    if (!air || !water || !pressure || !div) {
      for (const pair of [air, water, pressure]) {
        if (pair) { deleteTarget(gl, pair.read); deleteTarget(gl, pair.write); }
      }
      deleteTarget(gl, div);
      if (!half) {            // 32F not renderable here: retry with 16F
        this.forceHalf = true;
        return this.build(level);
      }
      throw new Error('Could not create simulation textures.');
    }

    gl.canvas.width = w;
    gl.canvas.height = h;

    const bytesPerChannel = half ? 2 : 4;
    const simBytes = w * h * 19 * bytesPerChannel;
    const screenBytes = w * h * 4 * 2;

    this.level = level;
    this.preset = preset;
    this.w = w;
    this.h = h;
    this.half = half;
    this.k = w / BASE_W;   // resolution scale factor
    this.memMB = (simBytes + screenBytes) / (1024 * 1024);
    this.builtAt = performance.now();
    this.targets = { air, water, pressure, div };
    this.reset();
  }

  destroy() {
    if (!this.targets) return;
    const gl = this.gl;
    const { air, water, pressure, div } = this.targets;
    for (const pair of [air, water, pressure]) {
      deleteTarget(gl, pair.read);
      deleteTarget(gl, pair.write);
    }
    deleteTarget(gl, div);
    this.targets = null;
  }

  reset() {
    const gl = this.gl;
    const { air, water, pressure, div } = this.targets;
    clearTarget(gl, air.read); clearTarget(gl, air.write);
    clearTarget(gl, pressure.read); clearTarget(gl, pressure.write);
    clearTarget(gl, div);

    // Fill the atmosphere with its initial humidity profile
    const pr = this.use(this.P.initWater);
    this.setMoisture(pr);
    this.drawTo(water.read);
    this.drawTo(water.write);
  }

  // --- pass helpers ---
  use(prog) {
    this.gl.useProgram(prog.p);
    this.gl.uniform2i(prog.loc('uSize'), this.w, this.h);
    return prog;
  }

  bindTex(prog, name, target, unit) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, target.tex);
    gl.uniform1i(prog.loc(name), unit);
  }

  drawTo(target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, this.w, this.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  setMoisture(pr) {
    const gl = this.gl;
    gl.uniform1f(pr.loc('uQs0'), QS0);
    gl.uniform1f(pr.loc('uQsAlt'), QS_ALT);
    gl.uniform1f(pr.loc('uQsTemp'), QS_TEMP);
    gl.uniform1f(pr.loc('uCondRate'), COND_RATE);
    gl.uniform1f(pr.loc('uRhGround'), RH_GROUND);
    gl.uniform1f(pr.loc('uRhTop'), RH_TOP);
  }

  setBrush(pr, input) {
    const gl = this.gl;
    gl.uniform1i(pr.loc('uMode'), input.mode);
    gl.uniform2f(pr.loc('uMouse'), input.x, input.y);
    gl.uniform1f(pr.loc('uRadius'), BRUSH * this.k);
  }

  // input = { mode, x, y, dx, dy, heating }
  // mode: 0 none, 1 heat, 2 cool, 3 smoke, 4 push air only, 5 moisture
  step(input) {
    const gl = this.gl;
    const { air, water, pressure, div } = this.targets;
    const k = this.k;
    const heatRows = Math.max(3, Math.round(this.h * 0.05)); // heated ground layer

    // 1. Air physics (reads old air + old water)
    let pr = this.use(this.P.air);
    this.bindTex(pr, 'uAir', air.read, 0);
    this.bindTex(pr, 'uWater', water.read, 1);
    this.setMoisture(pr);
    this.setBrush(pr, input);
    gl.uniform1f(pr.loc('uDt'), DT);
    gl.uniform1f(pr.loc('uBuoy'), BUOYANCY * k);
    gl.uniform1f(pr.loc('uGroundHeat'), GROUND_HEAT);
    gl.uniform1f(pr.loc('uTMax'), T_MAX);
    gl.uniform1f(pr.loc('uHeatRows'), heatRows);
    gl.uniform1f(pr.loc('uLatent'), LATENT);
    gl.uniform1f(pr.loc('uLoading'), LOADING);
    gl.uniform1f(pr.loc('uStratTropo'), STRAT_TROPO);
    gl.uniform1f(pr.loc('uStratStrato'), STRAT_STRATO);
    gl.uniform1f(pr.loc('uTropopause'), TROPOPAUSE);
    gl.uniform1i(pr.loc('uHeating'), input.heating ? 1 : 0);
    gl.uniform1i(pr.loc('uFrame'), this.frame);
    gl.uniform2f(pr.loc('uMouseDelta'), input.dx, input.dy);
    gl.uniform1f(pr.loc('uForce'), FORCE);
    gl.uniform1f(pr.loc('uHeatAmt'), HEAT);
    this.drawTo(air.write);

    // 2. Water physics (also reads the OLD air, so both passes agree)
    pr = this.use(this.P.water);
    this.bindTex(pr, 'uAir', air.read, 0);
    this.bindTex(pr, 'uWater', water.read, 1);
    this.setMoisture(pr);
    this.setBrush(pr, input);
    gl.uniform1f(pr.loc('uDt'), DT);
    gl.uniform1f(pr.loc('uEvap'), EVAP);
    gl.uniform1f(pr.loc('uHeatRows'), heatRows);
    gl.uniform1f(pr.loc('uSmokeAmt'), SMOKE);
    gl.uniform1f(pr.loc('uMoistAmt'), MOIST);
    this.drawTo(water.write);

    air.swap();
    water.swap();

    // 3. Advection: water first (uses current wind), then air
    pr = this.use(this.P.advect);
    gl.uniform1f(pr.loc('uDt'), DT);
    gl.uniform1f(pr.loc('uKeep'), 1 - COOLING * DT);
    gl.uniform1f(pr.loc('uSmokeDecay'), SMOKE_DECAY);
    gl.uniform1f(pr.loc('uTMax'), T_MAX);

    this.bindTex(pr, 'uVel', air.read, 0);
    this.bindTex(pr, 'uSrc', water.read, 1);
    gl.uniform1i(pr.loc('uKind'), 1);
    this.drawTo(water.write);
    water.swap();

    this.bindTex(pr, 'uVel', air.read, 0);
    this.bindTex(pr, 'uSrc', air.read, 1);
    gl.uniform1i(pr.loc('uKind'), 0);
    this.drawTo(air.write);
    air.swap();

    // 4. Projection: divergence -> pressure -> gradient subtraction
    pr = this.use(this.P.divergence);
    this.bindTex(pr, 'uAir', air.read, 0);
    this.drawTo(div);

    pr = this.use(this.P.jacobi);
    for (let i = 0; i < this.preset.iters; i++) {
      this.bindTex(pr, 'uP', pressure.read, 0);
      this.bindTex(pr, 'uDiv', div, 1);
      this.drawTo(pressure.write);
      pressure.swap();
    }

    pr = this.use(this.P.gradient);
    this.bindTex(pr, 'uAir', air.read, 0);
    this.bindTex(pr, 'uP', pressure.read, 1);
    this.drawTo(air.write);
    air.swap();

    this.frame++;
  }

  render(view) {
    const gl = this.gl;
    const pr = this.use(this.P.render);
    this.bindTex(pr, 'uAir', this.targets.air.read, 0);
    this.bindTex(pr, 'uWater', this.targets.water.read, 1);
    this.setMoisture(pr);
    gl.uniform1i(pr.loc('uView'), view);
    gl.uniform1f(pr.loc('uTVis'), T_VIS);
    gl.uniform1f(pr.loc('uVelScale'), this.k);
    this.drawTo(null);
  }
}
