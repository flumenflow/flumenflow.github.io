// Flumen website: live shallow-water hero, schematic physics panels, GPU bars, agent replay.
(() => {
  "use strict";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- nav, reveal, counters, bibtex ----------
  const nav = document.querySelector(".nav");
  addEventListener("scroll", () => nav.classList.toggle("scrolled", scrollY > 8), { passive: true });

  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { e.target.classList.add("on"); e.target.dispatchEvent(new Event("shown")); io.unobserve(e.target); }
  }, { threshold: 0.15 });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

  const cio = new IntersectionObserver((es) => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      const el = e.target, end = parseFloat(el.dataset.count), dec = +(el.dataset.dec || 0), t0 = performance.now();
      const tick = (t) => {
        const f = reduce ? 1 : Math.min(1, (t - t0) / 1400), v = end * (1 - Math.pow(1 - f, 3));
        el.textContent = v.toFixed(dec);
        if (f < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      cio.unobserve(el);
    }
  }, { threshold: 0.6 });
  document.querySelectorAll("[data-count]").forEach((el) => cio.observe(el));

  const copyBib = document.getElementById("copyBib");
  copyBib.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(document.getElementById("bib").textContent); copyBib.textContent = "Copied"; }
    catch { copyBib.textContent = "Select the text below"; }
    setTimeout(() => (copyBib.textContent = "Copy BibTeX"), 1800);
  });

  // canvas helper: size the backing store to the CSS box
  function fit(cv) {
    const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { w, h, d };
  }
  // run a draw loop only while the canvas is on screen
  function loop(cv, draw) {
    let vis = false, raf = 0;
    const step = (t) => { draw(t); if (vis) raf = requestAnimationFrame(step); };
    new IntersectionObserver(([e]) => {
      vis = e.isIntersecting;
      if (vis && !raf) raf = requestAnimationFrame(step);
      if (!vis) { cancelAnimationFrame(raf); raf = 0; }
    }).observe(cv);
  }

  // depth colour ramp (matches .ramp in the CSS)
  const RAMP = [[159, 227, 255], [56, 168, 232], [21, 101, 192], [10, 42, 107]];
  function depthColour(h) {
    const f = Math.min(1, h / 2) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, f | 0), u = f - i;
    const a = RAMP[i], b = RAMP[i + 1];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  }

  // ---------- hero: 2D shallow-water model ----------
  // First-order finite volumes: HLL fluxes with the hydrostatic reconstruction of Audusse et al. (2004),
  // point-implicit Manning friction, walls on three sides and an open east side (free outflow or a sea level).
  const sim = (() => {
    const cv = document.getElementById("sim"), ctx = cv.getContext("2d");
    const NX = 180, NY = 110, N = NX * NY, DX = 4, G = 9.81, MANN = 0.03, DRY = 1e-4, BLD = 7;
    const z = new Float64Array(N), h = new Float64Array(N), hu = new Float64Array(N), hv = new Float64Array(N);
    const dh = new Float64Array(N), du = new Float64Array(N), dv = new Float64Array(N);
    const bld = new Uint8Array(N), shade = new Float32Array(N);
    const off = document.createElement("canvas"); off.width = NX; off.height = NY;
    const octx = off.getContext("2d"), img = octx.createImageData(NX, NY);
    const blocks = [];

    // terrain: a town on a slope falling east, with a shallow trough along its middle
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const x = (i + 0.5) * DX, y = (j + 0.5) * DX, yc = (y - NY * DX / 2) / (NY * DX / 2);
      z[j * NX + i] = 3.2 - 0.0062 * x + 0.9 * yc * yc + 0.04 * Math.sin(x / 37) * Math.cos(y / 29);
    }
    for (let bi = 0; bi < 12; bi++) for (let bj = 0; bj < 9; bj++) {
      if (rnd() < 0.16) continue; // a park or a square
      const i0 = 46 + bi * 11, j0 = 6 + bj * 11, wi = 6 + (rnd() * 3 | 0), wj = 6 + (rnd() * 3 | 0);
      if (i0 + wi >= NX - 3 || j0 + wj >= NY - 3) continue;
      blocks.push([i0, j0, wi, wj]);
      for (let j = j0; j < j0 + wj; j++) for (let i = i0; i < i0 + wi; i++) { bld[j * NX + i] = 1; z[j * NX + i] += BLD; }
    }
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i, zx = z[k + (i < NX - 1 ? 1 : 0)] - z[k - (i > 0 ? 1 : 0)], zy = z[k + (j < NY - 1 ? NX : 0)] - z[k - (j > 0 ? NX : 0)];
      shade[k] = bld[k] ? 1 : Math.max(0.55, Math.min(1.15, 0.86 - 1.6 * (zx - zy)));
    }

    const SCEN = [
      { name: "Dam break", T: 260, init: () => { for (let j = 0; j < NY; j++) for (let i = 0; i < 26; i++) { const k = j * NX + i; h[k] = Math.max(0, 5.6 - z[k]); } } },
      { name: "Cloudburst, 1 mm/s (exaggerated)", T: 300, rain: (t) => (t < 160 ? 1e-3 : 0) },
      { name: "Storm surge from the east", T: 300, sea: (t) => -1.4 + 2.9 * Math.min(1, t / 170) - 0.3 * Math.max(0, (t - 220) / 80) }
    ];
    let sc = 0, t = 0, vol0 = 0, added = 0, outflow = 0;
    function reset(s) {
      sc = s; t = 0; added = 0; outflow = 0;
      h.fill(0); hu.fill(0); hv.fill(0);
      if (SCEN[sc].init) SCEN[sc].init();
      vol0 = volume();
      stageEl.textContent = SCEN[sc].name;
    }
    function volume() { let v = 0; for (let k = 0; k < N; k++) v += h[k]; return v * DX * DX; }

    // HLL flux in the normal direction; out = [mass, normal momentum, tangential momentum]
    const F = [0, 0, 0];
    function hll(hl, ul, vl, hr, ur, vr) {
      if (hl < DRY && hr < DRY) { F[0] = F[1] = F[2] = 0; return; }
      const cl = Math.sqrt(G * hl), cr = Math.sqrt(G * hr);
      const sl = Math.min(ul - cl, ur - cr), sr = Math.max(ul + cl, ur + cr);
      const fl0 = hl * ul, fl1 = hl * ul * ul + 0.5 * G * hl * hl, fl2 = hl * ul * vl;
      const fr0 = hr * ur, fr1 = hr * ur * ur + 0.5 * G * hr * hr, fr2 = hr * ur * vr;
      if (sl >= 0) { F[0] = fl0; F[1] = fl1; F[2] = fl2; return; }
      if (sr <= 0) { F[0] = fr0; F[1] = fr1; F[2] = fr2; return; }
      const q = 1 / (sr - sl);
      F[0] = (sr * fl0 - sl * fr0 + sl * sr * (hr - hl)) * q;
      F[1] = (sr * fl1 - sl * fr1 + sl * sr * (hr * ur - hl * ul)) * q;
      F[2] = (sr * fl2 - sl * fr2 + sl * sr * (hr * vr - hl * vl)) * q;
    }
    const vel = (k) => (h[k] > DRY ? [hu[k] / h[k], hv[k] / h[k]] : [0, 0]);

    // one face between cells a (low side) and b (high side); dir 0 = x, 1 = y
    function face(a, b, dir) {
      const za = z[a], zb = z[b], zf = Math.max(za, zb);
      const ha = Math.max(0, h[a] + za - zf), hb = Math.max(0, h[b] + zb - zf);
      const [ua, va] = vel(a), [ub, vb] = vel(b);
      if (dir === 0) hll(ha, ua, va, hb, ub, vb); else hll(ha, va, ua, hb, vb, ub);
      const pa = 0.5 * G * (h[a] * h[a] - ha * ha), pb = 0.5 * G * (h[b] * h[b] - hb * hb);
      dh[a] -= F[0]; dh[b] += F[0];
      if (dir === 0) { du[a] -= F[1] + pa; du[b] += F[1] + pb; dv[a] -= F[2]; dv[b] += F[2]; }
      else { dv[a] -= F[1] + pa; dv[b] += F[1] + pb; du[a] -= F[2]; du[b] += F[2]; }
    }

    function step(maxDt) {
      let smax = 1e-6;
      for (let k = 0; k < N; k++) if (h[k] > DRY) {
        const c = Math.sqrt(G * h[k]);
        smax = Math.max(smax, Math.abs(hu[k] / h[k]) + c, Math.abs(hv[k] / h[k]) + c);
      }
      const dt = Math.min(maxDt, 0.4 * DX / smax), s = SCEN[sc];
      dh.fill(0); du.fill(0); dv.fill(0);
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX - 1; i++) face(j * NX + i, j * NX + i + 1, 0);
      for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX; i++) face(j * NX + i, (j + 1) * NX + i, 1);
      for (let j = 0; j < NY; j++) {
        // closed west, south and north sides: pressure only
        let k = j * NX; du[k] += 0.5 * G * h[k] * h[k];
        // east side: free outflow, or a sea level held in a ghost cell
        k = j * NX + NX - 1;
        const [u, v] = vel(k);
        if (s.sea) { const hg = Math.max(0, s.sea(t) - z[k]); hll(h[k], u, v, hg, u, v); }
        else hll(h[k], Math.max(0, u), v, h[k], Math.max(0, u), v);
        dh[k] -= F[0]; du[k] -= F[1]; dv[k] -= F[2]; outflow += F[0] * dt * DX;
      }
      for (let i = 0; i < NX; i++) {
        let k = i; dv[k] += 0.5 * G * h[k] * h[k];
        k = (NY - 1) * NX + i; dv[k] -= 0.5 * G * h[k] * h[k];
      }
      const r = dt / DX, rain = s.rain ? s.rain(t) : 0, nf = G * MANN * MANN * dt;
      for (let k = 0; k < N; k++) {
        let hn = h[k] + r * dh[k];
        if (rain && !bld[k]) { hn += rain * dt; added += rain * dt * DX * DX; }
        if (hn <= DRY) { h[k] = Math.max(0, hn); hu[k] = hv[k] = 0; continue; }
        let qx = hu[k] + r * du[k], qy = hv[k] + r * dv[k];
        const sp = Math.hypot(qx, qy) / hn, fr = 1 / (1 + nf * sp / Math.pow(hn, 4 / 3));
        h[k] = hn; hu[k] = qx * fr; hv[k] = qy * fr;
      }
      t += dt;
      return dt;
    }

    function pour(px, py) {
      const ci = px * NX | 0, cj = py * NY | 0;
      for (let j = cj - 3; j <= cj + 3; j++) for (let i = ci - 3; i <= ci + 3; i++) {
        if (i < 0 || j < 0 || i >= NX || j >= NY || (i - ci) ** 2 + (j - cj) ** 2 > 9) continue;
        const k = j * NX + i; if (bld[k]) continue;
        h[k] += 0.06; added += 0.06 * DX * DX;
      }
    }
    let pouring = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    cv.addEventListener("pointerdown", (e) => { pouring = pos(e); cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", (e) => { if (pouring) pouring = pos(e); });
    addEventListener("pointerup", () => (pouring = null));

    const stageEl = document.getElementById("simStage"), timeEl = document.getElementById("simTime");
    const areaEl = document.getElementById("simArea"), massEl = document.getElementById("simMass");
    document.getElementById("simNext").addEventListener("click", () => reset((sc + 1) % SCEN.length));

    const drops = Array.from({ length: 90 }, () => [Math.random(), Math.random()]);
    let frame = 0;
    function render() {
      const { w, h: H, d } = fit(cv), px = img.data;
      for (let k = 0; k < N; k++) {
        const s = shade[k], o = k * 4;
        let r, g, b;
        if (bld[k]) { r = 196; g = 200; b = 206; }
        else { const e = Math.max(0, Math.min(1, (z[k] + 1.5) / 5)); r = (120 + 60 * e) * s; g = (138 + 40 * e) * s; b = (104 + 30 * e) * s; }
        const hk = h[k];
        if (hk > 0.004 && !bld[k]) {
          const c = depthColour(hk), a = Math.min(0.92, 0.35 + hk * 2.2), sp = Math.hypot(hu[k], hv[k]) / hk;
          const foam = Math.min(0.5, Math.max(0, sp - 2.5) * 0.12);
          r = r * (1 - a) + c[0] * a; g = g * (1 - a) + c[1] * a; b = b * (1 - a) + c[2] * a;
          r += (255 - r) * foam; g += (255 - g) * foam; b += (255 - b) * foam;
        }
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, w, H);
      // buildings as crisp blocks with a soft shadow
      const sx = w / NX, sy = H / NY;
      for (const [i0, j0, wi, wj] of blocks) {
        ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fillRect((i0 + 0.5) * sx, (j0 + 0.6) * sy, wi * sx, wj * sy);
        ctx.fillStyle = "#cfd5dc"; ctx.fillRect(i0 * sx, j0 * sy, wi * sx, wj * sy);
        ctx.fillStyle = "#e9edf1"; ctx.fillRect(i0 * sx, j0 * sy, wi * sx, 2 * d);
      }
      const s = SCEN[sc];
      if (s.rain && s.rain(t) > 0) {
        ctx.strokeStyle = "rgba(220,240,255,.55)"; ctx.lineWidth = d;
        ctx.beginPath();
        for (const p of drops) { p[1] = (p[1] + 0.018) % 1; p[0] = (p[0] + 0.002) % 1; ctx.moveTo(p[0] * w, p[1] * H); ctx.lineTo(p[0] * w - 3 * d, p[1] * H + 11 * d); }
        ctx.stroke();
      }
      if (s.sea) {
        ctx.fillStyle = "rgba(8,14,22,.7)"; ctx.font = `500 ${11 * d}px JetBrains Mono, monospace`;
        const lvl = s.sea(t), txt = `sea ${lvl >= 0 ? "+" : ""}${lvl.toFixed(2)} m`, tw = ctx.measureText(txt).width;
        ctx.fillRect(w - tw - 22 * d, H - 30 * d, tw + 14 * d, 20 * d);
        ctx.fillStyle = "#6cc3ff"; ctx.fillText(txt, w - tw - 15 * d, H - 16 * d);
      }
      if (++frame % 8 === 0) {
        let wet = 0; for (let k = 0; k < N; k++) if (h[k] > 0.1 && !bld[k]) wet++;
        const v = volume(), expect = vol0 + added - outflow;
        timeEl.textContent = `t = ${t.toFixed(0)} s`;
        areaEl.textContent = `flooded ${(wet * DX * DX / 1e4).toFixed(2)} ha`;
        massEl.textContent = `mass error ${expect > 1 ? (100 * (v - expect) / expect).toExponential(1) : "0"} %`;
      }
    }

    reset(0);
    loop(cv, () => {
      if (pouring) pour(pouring[0], pouring[1]);
      let left = reduce ? 0 : 0.11; // simulated seconds per frame (~6.5x real time)
      for (let n = 0; left > 1e-9 && n < 12; n++) left -= step(left);
      if (t >= SCEN[sc].T) reset((sc + 1) % SCEN.length);
      render();
    });
    return { reset };
  })();

  // ---------- 1D-2D river cross-section (schematic) ----------
  (() => {
    const cv = document.getElementById("river"), ctx = cv.getContext("2d");
    let fp = 0, last = 0;
    // ground across the section in units of x 0..1, z 0..1 (z up)
    // ground across the section, x 0..1, z up: low left bank (0.50), high right bank (0.72)
    const P = [[0, 0.36], [0.37, 0.4], [0.4, 0.5], [0.45, 0.16], [0.55, 0.16], [0.6, 0.72], [0.63, 0.62], [1, 0.59]];
    const ground = (x) => { for (let i = 1; i < P.length; i++) if (x <= P[i][0]) { const [x0, z0] = P[i - 1], [x1, z1] = P[i]; return z0 + (z1 - z0) * (x - x0) / (x1 - x0); } return P[P.length - 1][1]; };
    const crestL = 0.5;
    loop(cv, (tm) => {
      const { w, h, d } = fit(cv), dt = Math.min(0.05, (tm - last) / 1000 || 0); last = tm;
      const ph = (tm / 1000 % 14) / 14, stage = 0.3 + 0.32 * Math.pow(Math.sin(Math.PI * ph), 2.2);
      const X = (x) => x * w, Y = (zz) => h * (1.02 - zz * 1.25);
      // floodplain level: weir flow in when the river is above the bank, back out when it falls below the floodplain
      const crest = crestL;
      let q = 0;
      if (stage > crest && stage > fp) q = 0.9 * Math.pow(stage - Math.max(crest, fp), 1.5);
      else if (fp > crest && fp > stage) q = -0.5 * Math.pow(fp - Math.max(crest, stage), 1.5);
      fp = Math.max(0, fp + q * dt * 6);
      fp = Math.max(0, fp - dt * 0.012); // slow drainage of the floodplain between floods
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0d1520"; ctx.fillRect(0, 0, w, h);
      // water as flat surfaces; the ground drawn next covers what lies below it
      if (fp > 0.36) { ctx.fillStyle = "rgba(56,168,232,.75)"; ctx.fillRect(0, Y(fp), X(0.4), h); }
      ctx.fillStyle = "rgba(21,101,192,.9)";
      const lo = 0.4; ctx.fillRect(X(lo), Y(stage), X(0.6) - X(lo), h);
      // ground
      ctx.fillStyle = "#3b4a3a"; ctx.beginPath(); ctx.moveTo(0, h);
      for (let x = 0; x <= 1.0001; x += 0.002) ctx.lineTo(X(x), Y(ground(x)));
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#7f9a6e"; ctx.lineWidth = 2 * d; ctx.beginPath();
      for (let x = 0; x <= 1.0001; x += 0.002) (x ? ctx.lineTo : ctx.moveTo).call(ctx, X(x), Y(ground(x)));
      ctx.stroke();
      // 2D cells on the floodplain, 1D section box on the channel
      ctx.strokeStyle = "rgba(255,255,255,.14)"; ctx.lineWidth = d;
      for (let x = 0.02; x < 0.38; x += 0.045) { ctx.beginPath(); ctx.moveTo(X(x), Y(ground(x)) + 4 * d); ctx.lineTo(X(x), Y(ground(x)) - 8 * d); ctx.stroke(); }
      for (let x = 0.66; x < 1; x += 0.045) { ctx.beginPath(); ctx.moveTo(X(x), Y(ground(x)) + 4 * d); ctx.lineTo(X(x), Y(ground(x)) - 8 * d); ctx.stroke(); }
      ctx.setLineDash([5 * d, 4 * d]); ctx.strokeStyle = "rgba(242,163,58,.8)";
      ctx.strokeRect(X(0.4), Y(0.76), X(0.2), Y(0.12) - Y(0.76)); ctx.setLineDash([]);
      // weir arrows
      if (Math.abs(q) > 0.004) {
        const dir = q > 0 ? -1 : 1, yA = Y(Math.max(stage, fp)) - 12 * d, x0 = X(0.4);
        ctx.strokeStyle = ctx.fillStyle = "#f2a33a"; ctx.lineWidth = 2.5 * d;
        ctx.beginPath(); ctx.moveTo(x0 - dir * 18 * d, yA); ctx.lineTo(x0 + dir * 18 * d, yA); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x0 + dir * 24 * d, yA); ctx.lineTo(x0 + dir * 14 * d, yA - 6 * d); ctx.lineTo(x0 + dir * 14 * d, yA + 6 * d); ctx.fill();
      }
      ctx.font = `500 ${11 * d}px JetBrains Mono, monospace`; ctx.fillStyle = "#a7b6c6";
      ctx.fillText("2D floodplain cells", X(0.03), Y(0.46));
      ctx.fillText("2D cells", X(0.8), Y(0.68));
      ctx.fillStyle = "#f2a33a"; ctx.fillText("1D river section", X(0.4), Y(0.76) - 6 * d);
      ctx.fillStyle = "#6cc3ff";
      ctx.fillText(q > 0.004 ? "bank weir: river → floodplain" : q < -0.004 ? "bank weir: floodplain → river" : "in bank", X(0.03), h - 12 * d);
    });
  })();

  // ---------- 3D estuary salt wedge (schematic) ----------
  (() => {
    const cv = document.getElementById("estuary"), ctx = cv.getContext("2d"), NL = 12;
    const bed = (x) => -1 + 0.55 * x + 0.06 * Math.sin(9 * x) * x; // depth falls upstream (x 0 sea → 1 river)
    const pts = Array.from({ length: 70 }, () => [Math.random(), Math.random()]);
    let cell = null;
    loop(cv, (tm) => {
      const { w, h, d } = fit(cv), t = tm / 1000, om = (2 * Math.PI) / 9;
      const top = 0.16 * h, depth = 0.7 * h;
      const eta = (x) => 0.03 * Math.sin(om * t - 2.2 * x);
      const Y = (zz) => top + (-zz) * depth;
      const toe = 0.42 + 0.1 * Math.sin(om * t - 0.8);
      ctx.fillStyle = "#0d1520"; ctx.fillRect(0, 0, w, h);
      const nx = 120, nz = 24;
      for (let ix = 0; ix < nx; ix++) {
        const x0 = ix / nx, x1 = (ix + 1) / nx, xm = (x0 + x1) / 2, e = eta(xm), b = bed(xm);
        for (let iz = 0; iz < nz; iz++) {
          const s0 = iz / nz, s1 = (iz + 1) / nz, sm = (s0 + s1) / 2; // s = 0 bed, 1 surface
          const xw = toe + 0.28 * (1 - sm) * (1 - sm) - 0.12 * sm;
          const S = 32 / (1 + Math.exp((xm - xw) / 0.035));
          const f = S / 32;
          ctx.fillStyle = `rgb(${(159 - 120 * f) | 0},${(227 - 150 * f) | 0},${(255 - 120 * f) | 0})`;
          const za = b + s0 * (e - b), zb = b + s1 * (e - b);
          ctx.fillRect(Math.floor(x0 * w), Y(zb), Math.ceil(w / nx) + 1, Y(za) - Y(zb) + 1);
        }
      }
      // sigma layers
      ctx.strokeStyle = "rgba(255,255,255,.22)"; ctx.lineWidth = d;
      for (let l = 1; l < NL; l++) {
        ctx.beginPath();
        for (let x = 0; x <= 1.0001; x += 0.01) { const b = bed(x), zz = b + (l / NL) * (eta(x) - b); (x ? ctx.lineTo : ctx.moveTo).call(ctx, x * w, Y(zz)); }
        ctx.stroke();
      }
      // drifting tracers: upper water out to sea, lower water in under it
      ctx.fillStyle = "rgba(255,255,255,.85)";
      for (const p of pts) {
        const xw = toe + 0.28 * (1 - p[1]) * (1 - p[1]);
        const u = p[1] > 0.5 ? -0.0016 : (p[0] < xw ? 0.0011 : -0.0005);
        p[0] += u + 0.0012 * Math.cos(om * t);
        if (p[0] < 0 || p[0] > 1) { p[0] = Math.random(); p[1] = Math.random(); }
        const b = bed(p[0]), zz = b + p[1] * (eta(p[0]) - b);
        ctx.beginPath(); ctx.arc(p[0] * w, Y(zz), 1.6 * d, 0, 7); ctx.fill();
      }
      // bed
      ctx.fillStyle = "#4a3f33"; ctx.beginPath(); ctx.moveTo(0, h);
      for (let x = 0; x <= 1.0001; x += 0.01) ctx.lineTo(x * w, Y(bed(x)));
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
      ctx.font = `500 ${11 * d}px JetBrains Mono, monospace`;
      ctx.fillStyle = "#e8f0f8"; ctx.fillText("sea 32 PSU  ⇄ tide", 10 * d, top - 14 * d);
      const tx = "river ← 0 PSU"; ctx.fillText(tx, w - ctx.measureText(tx).width - 10 * d, top - 14 * d);
      // salinity bar
      const gx = w - 130 * d, gy = h - 20 * d, gr = ctx.createLinearGradient(gx, 0, gx + 90 * d, 0);
      gr.addColorStop(0, "rgb(159,227,255)"); gr.addColorStop(1, "rgb(39,77,135)");
      ctx.fillStyle = gr; ctx.fillRect(gx, gy, 90 * d, 7 * d);
      ctx.fillStyle = "#a7b6c6"; ctx.fillText("0", gx - 12 * d, gy + 7 * d); ctx.fillText("32", gx + 95 * d, gy + 7 * d);
    });
  })();

  // ---------- short waves: hydrostatic vs non-hydrostatic ----------
  (() => {
    const cv = document.getElementById("waves"), ctx = cv.getContext("2d");
    const kh = [0.5, 1, 2], hyd = [-3.9, -12.7, -30.6], nh = [-0.9, -2.4, -1.8];
    let grow = 0, shownAt = 0;
    cv.closest(".reveal").addEventListener("shown", () => (shownAt = performance.now()));
    loop(cv, (tm) => {
      const { w, h, d } = fit(cv), t = tm / 1000;
      if (shownAt) grow = reduce ? 1 : Math.min(1, (tm - shownAt) / 1500);
      ctx.fillStyle = "#0d1520"; ctx.fillRect(0, 0, w, h);
      // top: two wave trains at kh = 2; the hydrostatic one runs sqrt(kh / tanh kh) = 1.44 times faster
      const ratio = Math.sqrt(2 / Math.tanh(2)), L = w / 3.2, k = (2 * Math.PI) / L;
      const draw = (y0, c, col, lab) => {
        ctx.strokeStyle = col; ctx.lineWidth = 2.2 * d; ctx.beginPath();
        for (let x = 0; x <= w; x += 2) { const y = y0 - 10 * d * Math.sin(k * x - c * t * 2.2); (x ? ctx.lineTo : ctx.moveTo).call(ctx, x, y); }
        ctx.stroke(); ctx.fillStyle = col; ctx.font = `500 ${11 * d}px JetBrains Mono, monospace`; ctx.fillText(lab, 10 * d, y0 - 18 * d);
      };
      draw(0.16 * h, 1, "#38c6e8", "non-hydrostatic ≈ theory");
      draw(0.36 * h, ratio, "#ef6b5b", "hydrostatic: 1.44× too fast at kh = 2");
      // bottom: period error bars
      const base = 0.52 * h, bh = 0.4 * h, x0 = 60 * d, gw = (w - x0 - 20 * d) / 3, scale = bh / 32;
      ctx.strokeStyle = "rgba(255,255,255,.2)"; ctx.lineWidth = d; ctx.beginPath(); ctx.moveTo(x0, base); ctx.lineTo(w - 20 * d, base); ctx.stroke();
      ctx.fillStyle = "#74859a"; ctx.font = `${10 * d}px JetBrains Mono, monospace`;
      ctx.fillText("period", 6 * d, base + 12 * d); ctx.fillText("error %", 6 * d, base + 25 * d);
      for (let i = 0; i < 3; i++) {
        const gx = x0 + i * gw + gw * 0.18, bw = gw * 0.28;
        const a = -hyd[i] * scale * grow, b = -nh[i] * scale * grow;
        ctx.fillStyle = "#ef6b5b"; ctx.fillRect(gx, base, bw, a);
        ctx.fillStyle = "#38c6e8"; ctx.fillRect(gx + bw + 4 * d, base, bw, Math.max(b, d));
        ctx.fillStyle = "#e8f0f8"; ctx.fillText(hyd[i].toFixed(1), gx, base + a + 13 * d);
        ctx.fillText(nh[i].toFixed(1), gx + bw + 4 * d, base + b + 13 * d);
        ctx.fillStyle = "#a7b6c6"; ctx.fillText(`kh ${kh[i]}`, gx + bw * 0.4, base - 6 * d);
      }
    });
  })();

  // ---------- GPU bars ----------
  (() => {
    const rows = [
      ["Rain on a town, 4 m cells, 67k cells, 1 h", 10.5, 0.5, "19.5×"],
      ["River flood, 1D-2D valley template", 44, 1.9, "23×"],
      ["Estuary 3D, 12 layers, 48 h", 546, 13, "42×"]
    ];
    const box = document.getElementById("gpuBars");
    box.innerHTML = rows.map(([n, c, g, x]) => `<div class="bar-row"><h4>${n}<em>${x}</em></h4>
      <div class="bar"><span class="lab">CPU</span><span class="track"><span class="fill cpu" data-w="100"></span></span><span class="val">${c} s</span></div>
      <div class="bar"><span class="lab">GPU</span><span class="track"><span class="fill gpu" data-w="${Math.max(0.8, (100 * g) / c)}"></span></span><span class="val">${g} s</span></div></div>`).join("");
    box.addEventListener("shown", () => box.querySelectorAll(".fill").forEach((f, i) => setTimeout(() => (f.style.width = f.dataset.w + "%"), i * 120)));
  })();

  // ---------- agent replay ----------
  (() => {
    const TOOLS = "list_templates create_model get_model validate import_dem set_terrain generate_mesh set_roughness add_land_use_class set_land_use set_infiltration set_rainfall apply_design_storm set_initial_water set_boundary_condition add_river set_river_section get_river_profile set_3d set_scalar set_wind set_heat_exchange get_vertical_profile get_stratification get_cross_section add_source add_gauge set_run set_compute run_simulation get_run_status cancel_run list_scenarios get_max_depth get_flood_extent get_timeseries_at_point get_runoff_summary check_mass_balance compare_scenarios show_picture export_map calibrate_against_observations predict_flood_fast".split(" ");
    const tb = document.getElementById("tools");
    tb.innerHTML = TOOLS.map((n) => `<span data-t="${n}">${n}</span>`).join("");
    const SCRIPT = [
      ["u", "> Flood map for this town DEM under a 24-hour, 150 mm SCS type II storm. Use 2 m cells and the GPU.\n\n"],
      ["t", "import_dem", '{"file": "town_dem.tif", "cell_m": 2}'],
      ["t", "set_land_use", '{"raster": "landuse.tif", "codes": [[1, 0], [2, 1], [3, 2]]}'],
      ["t", "set_infiltration", '{"class": "grass", "kind": "scs_cn", "cn": 74}'],
      ["t", "apply_design_storm", '{"method": "scs_type2", "duration_h": 24, "total_mm": 150}'],
      ["t", "set_boundary_condition", '{"name": "outfall", "side": "east", "kind": "free"}'],
      ["t", "set_run", '{"duration_h": 26, "order": 2, "engine": "gpu"}'],
      ["t", "validate", "{}"],
      ["t", "run_simulation", '{"scenario": "T150"}'],
      ["t", "check_mass_balance", '{"scenario": "T150"}'],
      ["t", "get_flood_extent", '{"scenario": "T150", "depth_m": 0.1, "file": "T150_extent.geojson"}'],
      ["a", "\nThe run passed its mass-balance check, so I wrote the flooded area deeper than 0.1 m to T150_extent.geojson and listed the five largest flooded zones with their depths.\n"]
    ];
    const pre = document.getElementById("replay");
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    let html = "", started = false;
    const sleep = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));
    const show = (extra = "") => (pre.innerHTML = html + extra + '<span class="cur"></span>');
    async function type(cls, text, speed) {
      let s = "";
      for (const ch of text) { s += ch; show(`<span class="${cls}">${esc(s)}</span>`); await sleep(speed); }
      html += `<span class="${cls}">${esc(s)}</span>`;
    }
    async function run() {
      for (;;) {
        html = ""; tb.querySelectorAll(".hit").forEach((e) => e.classList.remove("hit"));
        for (const [k, a, b] of SCRIPT) {
          if (k === "t") {
            tb.querySelector(`[data-t="${a}"]`).classList.add("hit");
            await type("t", `● ${a}`, 14); await type("r", ` ${b}\n`, 4);
            await sleep(a === "run_simulation" ? 1400 : 380);
            html += `<span class="r">  ⎿ ok\n</span>`; show();
          } else await type(k, a, k === "u" ? 22 : 12);
        }
        await sleep(6000);
      }
    }
    new IntersectionObserver(([e], o) => { if (e.isIntersecting && !started) { started = true; o.disconnect(); run(); } }, { threshold: 0.3 }).observe(pre);
    show();
  })();
})();
