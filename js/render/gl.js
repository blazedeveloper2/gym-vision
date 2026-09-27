/**
 * WebGL2 stage: draws the analyzed video frame, the body outline and the
 * body-part colouring in one full-screen pass.
 *
 * It shares its WebGL context with MediaPipe (the pose task is created with
 * this canvas), so the segmentation mask never leaves the GPU: we sample
 * MediaPipe's mask texture directly. Drawing the same frame MediaPipe just
 * analyzed keeps the skeleton glued to the body with zero lag.
 */

import { MAX_PARTS } from '../body/parts.js';

export { MAX_PARTS };

const VS = `#version 300 es
out vec2 v_uv;
void main() {
  // Full-screen triangle; v_uv is (0,0) at the top-left and (1,1) at the bottom-right.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_video;
uniform highp sampler2D u_mask;
uniform bool u_hasMask;
uniform bool u_maskFlipY;
uniform bool u_mirror;
uniform vec2 u_size;          // frame size in px
uniform float u_px;           // frame px per CSS px (keeps lines a constant on-screen width)
uniform float u_dim;          // 0 = full video, 1 = black
uniform bool u_outline;
uniform vec3 u_outlineColor;
uniform bool u_fill;          // tint the whole body (for a silhouette look)
uniform int u_count;          // body parts
uniform vec4 u_seg[${MAX_PARTS}];     // capsule a.xy, b.xy (frame px)
uniform float u_rad[${MAX_PARTS}];    // capsule radius (px), < 0 = hidden
uniform vec3 u_col[${MAX_PARTS}];
uniform int u_highlight;      // part to emphasise (-1 = none)

float maskAt(vec2 p) {
  // Manual bilinear sampling: works for float masks without linear-filter support.
  ivec2 size = textureSize(u_mask, 0);
  vec2 q = p * vec2(size) / u_size - 0.5;
  if (u_maskFlipY) q.y = float(size.y) - 1.0 - q.y;
  ivec2 i = ivec2(floor(q));
  vec2 f = fract(q);
  ivec2 m = size - 1;
  float a = texelFetch(u_mask, clamp(i, ivec2(0), m), 0).r;
  float b = texelFetch(u_mask, clamp(i + ivec2(1, 0), ivec2(0), m), 0).r;
  float c = texelFetch(u_mask, clamp(i + ivec2(0, 1), ivec2(0), m), 0).r;
  float d = texelFetch(u_mask, clamp(i + ivec2(1, 1), ivec2(0), m), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 uv = v_uv;
  if (u_mirror) uv.x = 1.0 - uv.x;
  vec3 color = texture(u_video, uv).rgb * (1.0 - u_dim);
  vec2 p = uv * u_size;

  if (u_hasMask) {
    float m = maskAt(p);
    float inside = smoothstep(0.35, 0.65, m);

    if (u_count > 0 && inside > 0.0) {
      float best = 1e9;
      float second = 1e9;
      int bi = -1;
      for (int k = 0; k < ${MAX_PARTS}; k++) {
        if (k >= u_count) break;
        if (u_rad[k] < 0.0) continue;
        vec2 a = u_seg[k].xy;
        vec2 ba = u_seg[k].zw - a;
        vec2 pa = p - a;
        float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-3), 0.0, 1.0);
        float d = length(pa - ba * h) - u_rad[k];
        if (d < best) { second = best; best = d; bi = k; }
        else if (d < second) { second = d; }
      }
      if (bi >= 0) {
        vec3 pc = u_col[bi];
        float strength = (bi == u_highlight) ? 0.75 : (u_highlight >= 0 ? 0.25 : 0.5);
        color = mix(color, pc, strength * inside);
        // Thin dark seams where two parts meet.
        float seam = 1.0 - smoothstep(0.0, 1.6 * u_px, second - best);
        color = mix(color, vec3(0.03, 0.04, 0.06), seam * 0.65 * inside);
      }
    } else if (u_fill) {
      color = mix(color, u_outlineColor, 0.22 * inside);
    }

    if (u_outline) {
      // Distance to the 0.5 iso-line from the mask gradient → a crisp line of
      // constant on-screen width, plus a soft outer glow.
      float step = max(1.0, u_size.x / float(textureSize(u_mask, 0).x));
      float gx = maskAt(p + vec2(step, 0.0)) - maskAt(p - vec2(step, 0.0));
      float gy = maskAt(p + vec2(0.0, step)) - maskAt(p - vec2(0.0, step));
      float g = length(vec2(gx, gy)) / (2.0 * step);
      float dist = abs(m - 0.5) / max(g, 1e-4);
      float halfW = 1.5 * u_px;
      float line = 1.0 - smoothstep(halfW - 0.8 * u_px, halfW + 0.8 * u_px, dist);
      float glow = m < 0.5 ? exp(-dist / (7.0 * u_px)) * 0.55 : 0.0;
      color = mix(color, u_outlineColor, clamp(max(line, glow), 0.0, 1.0));
    }
  }
  outColor = vec4(color, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed');
  return s;
}

export class GLStage {
  /** Throws if WebGL2 isn't available. */
  constructor(canvas) {
    this.canvas = canvas;
    // First getContext call wins, so these attributes apply to MediaPipe too.
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      desynchronized: true,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link failed');
    this.prog = prog;
    this.vao = gl.createVertexArray();
    this.videoTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.u = {};
    for (const name of ['u_video', 'u_mask', 'u_hasMask', 'u_maskFlipY', 'u_mirror', 'u_size', 'u_px', 'u_dim', 'u_outline', 'u_outlineColor', 'u_fill', 'u_count', 'u_seg', 'u_rad', 'u_col', 'u_highlight']) {
      this.u[name] = gl.getUniformLocation(prog, name);
    }
    this.segs = new Float32Array(MAX_PARTS * 4);
    this.rads = new Float32Array(MAX_PARTS);
    this.cols = new Float32Array(MAX_PARTS * 3);
    this.maskFlipY = false;
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /**
   * @param o.video   HTMLVideoElement (the frame just analyzed)
   * @param o.mask    MPMask or null
   * @param o.parts   { count, segs, rads, cols } or null
   */
  render({ video, mask = null, mirror = false, dim = 0, outline = false, outlineColor = [0.78, 1, 0.24], fill = false, parts = null, highlight = -1, px = 1 }) {
    if (this.lost) return false;
    const gl = this.gl;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return false;
    this.resize(w, h);

    // Our state changes are local; restore what MediaPipe may rely on.
    const flipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    const premul = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premul);

    let maskTex = null;
    if (mask) {
      try {
        maskTex = mask.getAsWebGLTexture();
      } catch (err) {
        maskTex = null;
      }
    }
    if (maskTex) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      // Float textures aren't filterable everywhere; we sample with texelFetch.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);

    const u = this.u;
    gl.uniform1i(u.u_video, 0);
    gl.uniform1i(u.u_mask, 1);
    gl.uniform1i(u.u_hasMask, maskTex ? 1 : 0);
    gl.uniform1i(u.u_maskFlipY, this.maskFlipY ? 1 : 0);
    gl.uniform1i(u.u_mirror, mirror ? 1 : 0);
    gl.uniform2f(u.u_size, w, h);
    gl.uniform1f(u.u_px, px);
    gl.uniform1f(u.u_dim, dim);
    gl.uniform1i(u.u_outline, outline ? 1 : 0);
    gl.uniform3f(u.u_outlineColor, outlineColor[0], outlineColor[1], outlineColor[2]);
    gl.uniform1i(u.u_fill, fill ? 1 : 0);
    gl.uniform1i(u.u_highlight, highlight);
    const count = parts ? Math.min(parts.count, MAX_PARTS) : 0;
    gl.uniform1i(u.u_count, count);
    if (count) {
      gl.uniform4fv(u.u_seg, parts.segs);
      gl.uniform1fv(u.u_rad, parts.rads);
      gl.uniform3fv(u.u_col, parts.cols);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Leave a neutral state behind for MediaPipe's next run.
    gl.bindVertexArray(null);
    gl.useProgram(null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return true;
  }
}
