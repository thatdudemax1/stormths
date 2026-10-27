// ---------------------------------------------------------------
// GPU atmosphere simulation
// Vertical cross-section: y = 0 is the ground, +v means upward.
// ---------------------------------------------------------------
import {
  PRESETS, BASE_W, DT, BUOYANCY, COOLING, GROUND_HEAT, T_MAX, T_VIS,
  SMOKE_DECAY, BRUSH, FORCE, HEAT, SMOKE
} from './config.js';
import {
  VS, FS_HEADER, FS_FORCES, FS_ADVECT, FS_DIVERGENCE,
  FS_JACOBI, FS_GRADIENT, FS_RENDER
} from './shaders.js';
import {
  compileShader, makeProgram, makeTarget, makePair, deleteTarget, clearTarget
} from './gl-utils.js';

export class Simulation {
  constructor(gl, hasFloat) {
    this.gl = gl;
    this.forceHalf = !hasFloat;
    this.frame = 0;
    this.targets = null;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VS);
    const prog = (body) => makeProgram(gl, vs, FS_HEADER + body);
    this.P = {
      forces:     prog(FS_FORCES),
      advect:     prog(FS_ADVECT),
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

    const state = makePair(gl, w, h, 4, half);
    const pressure = makePair(gl, w, h, 1, half);
    const div = makeTarget(gl, w, h, 1, half);

    if (!state || !pressure || !div) {
      if (state) { deleteTarget(gl, state.read); deleteTarget(gl, state.write); }
      if (pressure) { deleteTarget(gl, pressure.read); deleteTarget(gl, pressure.write); }
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
    const simBytes = w * h * 11 * bytesPerChannel;
    const screenBytes = w * h * 4 * 2;

    this.level = level;
    this.preset = preset;
    this.w = w;
    this.h = h;
    this.half = half;
    this.k = w / BASE_W;   // resolution scale factor
    this.memMB = (simBytes + screenBytes) / (1024 * 1024);
    this.builtAt = performance.now();
    this.targets = { state, pressure, div };
  }

  destroy() {
    if (!this.targets) return;
    const gl = this.gl;
    const { state, pressure, div } = this.targets;
    deleteTarget(gl, state.read); deleteTarget(gl, state.write);
    deleteTarget(gl, pressure.read); deleteTarget(gl, pressure.write);
    deleteTarget(gl, div);
    this.targets = null;
  }

  reset() {
    const gl = this.gl;
    const { state, pressure, div } = this.targets;
    clearTarget(gl, state.read); clearTarget(gl, state.write);
    clearTarget(gl, pressure.read); clearTarget(gl, pressure.write);
    clearTarget(gl, div);
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

  // input = { mode, x, y, dx, dy, heating }
  // mode: 0 none, 1 heat, 2 cool, 3 smoke, 4 push air only
  step(input) {
    const gl = this.gl;
    const { state, pressure, div } = this.targets;
    const k = this.k;

    // 1. Forces
    let pr = this.use(this.P.forces);
    this.bindTex(pr, 'uState', state.read, 0);
    gl.uniform1f(pr.loc('uDt'), DT);
    gl.uniform1f(pr.loc('uBuoy'), BUOYANCY * k);
    gl.uniform1f(pr.loc('uGroundHeat'), GROUND_HEAT);
    gl.uniform1f(pr.loc('uTMax'), T_MAX);
    gl.uniform1f(pr.loc('uHeatRows'), Math.max(1, Math.round(k)));
    gl.uniform1i(pr.loc('uHeating'), input.heating ? 1 : 0);
    gl.uniform1i(pr.loc('uFrame'), this.frame);
    gl.uniform1i(pr.loc('uMode'), input.mode);
    gl.uniform2f(pr.loc('uMouse'), input.x, input.y);
    gl.uniform2f(pr.loc('uMouseDelta'), input.dx, input.dy);
    gl.uniform1f(pr.loc('uRadius'), BRUSH * k);
    gl.uniform1f(pr.loc('uForce'), FORCE);
    gl.uniform1f(pr.loc('uHeatAmt'), HEAT);
    gl.uniform1f(pr.loc('uSmokeAmt'), SMOKE);
    this.drawTo(state.write);
    state.swap();

    // 2. Advection
    pr = this.use(this.P.advect);
    this.bindTex(pr, 'uState', state.read, 0);
    gl.uniform1f(pr.loc('uDt'), DT);
    gl.uniform1f(pr.loc('uKeep'), 1 - COOLING * DT);
    gl.uniform1f(pr.loc('uSmokeDecay'), SMOKE_DECAY);
    gl.uniform1f(pr.loc('uTMax'), T_MAX);
    this.drawTo(state.write);
    state.swap();

    // 3. Projection: divergence -> pressure -> gradient subtraction
    pr = this.use(this.P.divergence);
    this.bindTex(pr, 'uState', state.read, 0);
    this.drawTo(div);

    pr = this.use(this.P.jacobi);
    for (let i = 0; i < this.preset.iters; i++) {
      this.bindTex(pr, 'uP', pressure.read, 0);
      this.bindTex(pr, 'uDiv', div, 1);
      this.drawTo(pressure.write);
      pressure.swap();
    }

    pr = this.use(this.P.gradient);
    this.bindTex(pr, 'uState', state.read, 0);
    this.bindTex(pr, 'uP', pressure.read, 1);
    this.drawTo(state.write);
    state.swap();

    this.frame++;
  }

  render(view) {
    const gl = this.gl;
    const pr = this.use(this.P.render);
    this.bindTex(pr, 'uState', this.targets.state.read, 0);
    gl.uniform1i(pr.loc('uView'), view);
    gl.uniform1f(pr.loc('uTVis'), T_VIS);
    gl.uniform1f(pr.loc('uVelScale'), this.k);
    this.drawTo(null);
  }
}
