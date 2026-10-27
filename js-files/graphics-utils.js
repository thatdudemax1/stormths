// ---------------------------------------------------------------
// WebGL2 helpers: context, shaders, programs, render targets
// ---------------------------------------------------------------

export function createContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false, depth: false, stencil: false, alpha: false
  });
  if (!gl) throw new Error('WebGL2 is not supported by this browser or GPU.');

  const hasFloat = !!gl.getExtension('EXT_color_buffer_float');
  const hasHalf = hasFloat || !!gl.getExtension('EXT_color_buffer_half_float');
  if (!hasHalf) throw new Error('This GPU cannot render to float textures.');

  // Fullscreen triangle uses gl_VertexID only, but a VAO must be bound
  gl.bindVertexArray(gl.createVertexArray());
  return { gl, hasFloat };
}

export function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('Shader compile error:\n' + gl.getShaderInfoLog(s));
  }
  return s;
}

export function makeProgram(gl, vsShader, fsSource) {
  const p = gl.createProgram();
  gl.attachShader(p, vsShader);
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Program link error:\n' + gl.getProgramInfoLog(p));
  }
  const cache = {};
  return {
    p,
    loc(name) {
      if (!(name in cache)) cache[name] = gl.getUniformLocation(p, name);
      return cache[name];
    }
  };
}

// A texture + framebuffer pair. Returns null if this GPU can't render to it.
export function makeTarget(gl, w, h, channels, half) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const internal = channels === 4
    ? (half ? gl.RGBA16F : gl.RGBA32F)
    : (half ? gl.R16F : gl.R32F);
  const format = channels === 4 ? gl.RGBA : gl.RED;
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format,
                half ? gl.HALF_FLOAT : gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  if (!ok) {
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fb);
    return null;
  }
  return { tex, fb };
}

// Two targets for ping-pong (read from one, write to the other)
export function makePair(gl, w, h, channels, half) {
  const a = makeTarget(gl, w, h, channels, half);
  const b = makeTarget(gl, w, h, channels, half);
  if (!a || !b) {
    deleteTarget(gl, a);
    deleteTarget(gl, b);
    return null;
  }
  return {
    read: a,
    write: b,
    swap() { const t = this.read; this.read = this.write; this.write = t; }
  };
}

export function deleteTarget(gl, t) {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fb);
}

export function clearTarget(gl, t) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
