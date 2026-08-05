// Aperçu 3D minimal en WebGL : éclairage directionnel, rotation à la souris,
// molette pour zoomer. Pas de dépendance externe.

const VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat4 uProj;
uniform mat4 uView;
varying vec3 vNormal;
varying vec3 vPos;
void main() {
  vNormal = aNormal;
  vPos = aPos;
  gl_Position = uProj * uView * vec4(aPos, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vPos;
uniform vec3 uColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 l1 = normalize(vec3(0.5, 0.8, 0.9));
  vec3 l2 = normalize(vec3(-0.6, -0.3, 0.4));
  float d = max(dot(n, l1), 0.0) * 0.75 + max(dot(n, l2), 0.0) * 0.25 + 0.22;
  gl_FragColor = vec4(uColor * d, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ]);
}

/** Matrice vue : orbite (yaw, pitch) à distance `dist` autour de `center`. */
function orbitView(yaw, pitch, dist, center) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  // Base de la caméra
  const fx = cp * sy, fy = sp, fz = cp * cy;       // direction caméra -> cible inversée
  const rx = cy, ry = 0, rz = -sy;                 // droite
  const ux = -sp * sy, uy = cp, uz = -sp * cy;     // haut
  const ex = center.x + fx * dist;
  const ey = center.y + fy * dist;
  const ez = center.z + fz * dist;
  return new Float32Array([
    rx, ux, fx, 0,
    ry, uy, fy, 0,
    rz, uz, fz, 0,
    -(rx * ex + ry * ey + rz * ez),
    -(ux * ex + uy * ey + uz * ez),
    -(fx * ex + fy * ey + fz * ez),
    1,
  ]);
}

export function createViewer(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
  if (!gl) return null;

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);

  const posBuf = gl.createBuffer();
  const normBuf = gl.createBuffer();
  const aPos = gl.getAttribLocation(program, 'aPos');
  const aNormal = gl.getAttribLocation(program, 'aNormal');
  const uProj = gl.getUniformLocation(program, 'uProj');
  const uView = gl.getUniformLocation(program, 'uView');
  const uColor = gl.getUniformLocation(program, 'uColor');

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  const view = {
    yaw: 0.7, pitch: 0.5, dist: 4, center: { x: 0, y: 0, z: 0 },
    count: 0, radius: 1, wireframe: false,
  };

  function setMesh(mesh) {
    const tris = mesh.triangles;
    const pos = new Float32Array(tris.length * 9);
    const nrm = new Float32Array(tris.length * 9);
    let o = 0;
    let min = { x: Infinity, y: Infinity, z: Infinity };
    let max = { x: -Infinity, y: -Infinity, z: -Infinity };

    for (const [i, j, k] of tris) {
      const a = mesh.vertices[i];
      const b = mesh.vertices[j];
      const c = mesh.vertices[k];
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
      const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;

      for (const p of [a, b, c]) {
        pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z;
        nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz;
        o += 3;
        min.x = Math.min(min.x, p.x); max.x = Math.max(max.x, p.x);
        min.y = Math.min(min.y, p.y); max.y = Math.max(max.y, p.y);
        min.z = Math.min(min.z, p.z); max.z = Math.max(max.z, p.z);
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, nrm, gl.STATIC_DRAW);

    view.count = tris.length * 3;
    view.center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
    view.radius = Math.max(1e-3, Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2);
    view.dist = view.radius * 2.8;
    render();
  }

  function render() {
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.043, 0.071, 0.125, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!view.count) return;

    gl.uniformMatrix4fv(uProj, false, perspective(0.9, canvas.width / canvas.height, view.radius * 0.02, view.radius * 40));
    gl.uniformMatrix4fv(uView, false, orbitView(view.yaw, view.pitch, view.dist, view.center));
    gl.uniform3f(uColor, 0.42, 0.72, 0.92);

    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.enableVertexAttribArray(aNormal);
    gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(view.wireframe ? gl.LINES : gl.TRIANGLES, 0, view.count);
  }

  // --- Contrôles ------------------------------------------------------------
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    view.yaw -= (e.clientX - drag.x) * 0.01;
    view.pitch = Math.max(-1.5, Math.min(1.5, view.pitch + (e.clientY - drag.y) * 0.01));
    drag = { x: e.clientX, y: e.clientY };
    render();
  });
  const stop = () => { drag = null; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.dist = Math.max(view.radius * 0.4, Math.min(view.radius * 20, view.dist * (1 + Math.sign(e.deltaY) * 0.12)));
    render();
  }, { passive: false });

  window.addEventListener('resize', render);

  return {
    setMesh,
    render,
    setWireframe(on) { view.wireframe = on; render(); },
    setAngles(yaw, pitch) { view.yaw = yaw; view.pitch = pitch; render(); },
    canvas,
  };
}
