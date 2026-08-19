/* Rendu WebGL et caméra orbitale.
   Deux programmes seulement : les faces (éclairage à trois sources fixes,
   rendu « atelier ») et les traits (arêtes, lignes de repère, grille). */
(function (root) {
  'use strict';
  const { M, V } = root.M3D;

  const VS_MESH = `
    attribute vec3 aPos; attribute vec3 aNor;
    uniform mat4 uMVP, uModel, uNrm;
    varying vec3 vN, vP;
    void main() {
      vN = mat3(uNrm) * aNor;
      vP = (uModel * vec4(aPos, 1.0)).xyz;
      gl_Position = uMVP * vec4(aPos, 1.0);
    }`;
  const FS_MESH = `
    precision mediump float;
    uniform vec3 uColor, uEye; uniform float uAlpha;
    varying vec3 vN, vP;
    void main() {
      vec3 n = normalize(vN);
      if (!gl_FrontFacing) n = -n;
      vec3 v = normalize(uEye - vP);
      float key  = max(dot(n, normalize(vec3(0.35, 0.45, 0.82))), 0.0);
      float fill = max(dot(n, normalize(vec3(-0.7, -0.2, 0.35))), 0.0) * 0.30;
      float back = max(dot(n, normalize(vec3(0.1, -0.8, -0.4))), 0.0) * 0.12;
      float rim  = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.18;
      vec3 c = uColor * (0.34 + 0.66 * key + fill + back) + vec3(rim);
      gl_FragColor = vec4(c, uAlpha);
    }`;
  const VS_LINE = `
    attribute vec3 aPos;
    uniform mat4 uMVP;
    void main() { gl_Position = uMVP * vec4(aPos, 1.0); }`;
  const FS_LINE = `
    precision mediump float;
    uniform vec3 uColor; uniform float uAlpha;
    void main() { gl_FragColor = vec4(uColor, uAlpha); }`;

  function compile(gl, vsSrc, fsSrc) {
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  function createView(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: true })
      || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error("WebGL n'est pas disponible dans ce navigateur.");

    const progMesh = compile(gl, VS_MESH, FS_MESH);
    const progLine = compile(gl, VS_LINE, FS_LINE);
    const loc = {
      mesh: {
        aPos: gl.getAttribLocation(progMesh, 'aPos'), aNor: gl.getAttribLocation(progMesh, 'aNor'),
        uMVP: gl.getUniformLocation(progMesh, 'uMVP'), uModel: gl.getUniformLocation(progMesh, 'uModel'),
        uNrm: gl.getUniformLocation(progMesh, 'uNrm'), uColor: gl.getUniformLocation(progMesh, 'uColor'),
        uAlpha: gl.getUniformLocation(progMesh, 'uAlpha'), uEye: gl.getUniformLocation(progMesh, 'uEye')
      },
      line: {
        aPos: gl.getAttribLocation(progLine, 'aPos'), uMVP: gl.getUniformLocation(progLine, 'uMVP'),
        uColor: gl.getUniformLocation(progLine, 'uColor'), uAlpha: gl.getUniformLocation(progLine, 'uAlpha')
      }
    };

    const cam = {
      target: [0, 0, 0], dist: 500, yaw: -0.9, pitch: 0.55,
      fov: 35 * Math.PI / 180, ortho: false, near: 1, far: 10000
    };

    const view = {
      gl, cam, canvas,
      background: [0.925, 0.933, 0.945],

      /* --- Ressources GPU --- */
      buffer(data) {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        return { buf: b, count: data.length / 3 };
      },
      dynamicBuffer() {
        return { buf: gl.createBuffer(), count: 0, dynamic: true };
      },
      update(bo, data) {
        gl.bindBuffer(gl.ARRAY_BUFFER, bo.buf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        bo.count = data.length / 3;
      },
      dispose(bo) { if (bo && bo.buf) gl.deleteBuffer(bo.buf); },

      /* --- Caméra --- */
      eye() {
        const cp = Math.cos(cam.pitch);
        return V.add(cam.target, V.mul([cp * Math.cos(cam.yaw), cp * Math.sin(cam.yaw), Math.sin(cam.pitch)], cam.dist));
      },
      aspect() { return canvas.width / Math.max(1, canvas.height); },
      viewMatrix() { return M.lookAt(view.eye(), cam.target, [0, 0, 1]); },
      projMatrix() {
        if (cam.ortho) {
          const h = cam.dist * Math.tan(cam.fov / 2), w = h * view.aspect();
          return M.ortho(-w, w, -h, h, -cam.far, cam.far);
        }
        /* Plans de coupe serrés autour de la distance d'observation : une plage
           trop large épuise la précision du tampon de profondeur et fait
           « transparaître » les arêtes de la face arrière des pièces. */
        const near = Math.max(cam.dist * 0.02, 1e-4);
        return M.perspective(cam.fov, view.aspect(), near, near + cam.dist * 20);
      },
      viewProj() { return M.mul(view.projMatrix(), view.viewMatrix()); },

      /* Rayon issu d'un point écran (coordonnées CSS). */
      ray(px, py) {
        const r = canvas.getBoundingClientRect();
        const x = (px / r.width) * 2 - 1, y = 1 - (py / r.height) * 2;
        const inv = M.invert(view.viewProj());
        const a = M.apply(inv, [x, y, -1]), b = M.apply(inv, [x, y, 1]);
        const o = cam.ortho ? a : view.eye();
        return { o, d: V.unit(V.sub(b, a)) };
      },
      /* Projection d'un point du monde vers l'écran (coordonnées CSS). */
      project(p) {
        const r = canvas.getBoundingClientRect();
        const c = M.apply(view.viewProj(), p);
        return [(c[0] * 0.5 + 0.5) * r.width, (0.5 - c[1] * 0.5) * r.height, c[2]];
      },
      /* Taille monde correspondant à 1 pixel, à la profondeur du point donné. */
      pixelSize(p) {
        const r = canvas.getBoundingClientRect();
        const d = cam.ortho ? cam.dist : Math.max(V.dist(view.eye(), p), 1e-3);
        return 2 * d * Math.tan(cam.fov / 2) / Math.max(r.height, 1);
      },

      frame(bbox, margin) {
        const c = [(bbox.min[0] + bbox.max[0]) / 2, (bbox.min[1] + bbox.max[1]) / 2, (bbox.min[2] + bbox.max[2]) / 2];
        const diag = V.dist(bbox.min, bbox.max) || 100;
        cam.target = c;
        cam.dist = (diag / 2) / Math.tan(cam.fov / 2) * (margin || 1.35);
      },

      resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
        const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      },

      /* --- Dessin --- */
      begin() {
        view.resize();
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(view.background[0], view.background[1], view.background[2], 1);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.CULL_FACE);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      },

      drawMesh(pos, nor, model, color, alpha) {
        const vp = view.viewProj();
        gl.useProgram(progMesh);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1.2, 1.5);          // laisse la place aux arêtes
        if (alpha < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
        gl.uniformMatrix4fv(loc.mesh.uMVP, false, M.mul(vp, model));
        gl.uniformMatrix4fv(loc.mesh.uModel, false, model);
        gl.uniformMatrix4fv(loc.mesh.uNrm, false, M.normalMatrix(model));
        gl.uniform3fv(loc.mesh.uColor, color);
        gl.uniform1f(loc.mesh.uAlpha, alpha);
        gl.uniform3fv(loc.mesh.uEye, view.eye());
        gl.bindBuffer(gl.ARRAY_BUFFER, pos.buf);
        gl.enableVertexAttribArray(loc.mesh.aPos);
        gl.vertexAttribPointer(loc.mesh.aPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, nor.buf);
        gl.enableVertexAttribArray(loc.mesh.aNor);
        gl.vertexAttribPointer(loc.mesh.aNor, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, pos.count);
        gl.disable(gl.POLYGON_OFFSET_FILL);
        if (alpha < 1) { gl.disable(gl.BLEND); gl.depthMask(true); }
      },

      drawLines(bo, model, color, alpha, onTop) {
        if (!bo || !bo.count) return;
        gl.useProgram(progLine);
        if (onTop) gl.disable(gl.DEPTH_TEST);
        if (alpha < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
        gl.uniformMatrix4fv(loc.line.uMVP, false, M.mul(view.viewProj(), model));
        gl.uniform3fv(loc.line.uColor, color);
        gl.uniform1f(loc.line.uAlpha, alpha === undefined ? 1 : alpha);
        gl.bindBuffer(gl.ARRAY_BUFFER, bo.buf);
        gl.enableVertexAttribArray(loc.line.aPos);
        gl.vertexAttribPointer(loc.line.aPos, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINES, 0, bo.count);
        if (alpha < 1) gl.disable(gl.BLEND);
        if (onTop) gl.enable(gl.DEPTH_TEST);
      }
    };
    return view;
  }

  root.View = { createView };
})(window.SWC = window.SWC || {});
