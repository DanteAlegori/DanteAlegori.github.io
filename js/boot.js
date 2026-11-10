(function (global) {
  'use strict';

  const X360 = global.X360 || (global.X360 = {});
  const utils = X360.utils;

  const RIBBON_COUNT = 6;
  const RIBBON_POINTS = 62;
  const TRAIL_SAMPLE = 0.02;
  const LAUNCH_DURATION = 1500;
  const FOCAL = 1000;

  const PALETTE = [
    [157, 255, 0],
    [16, 113, 16],
    [224, 255, 208],
    [124, 252, 0],
    [82, 176, 67],
    [240, 255, 232]
  ];

  const boot = {
    canvas: null,
    ctx: null,
    ribbons: [],
    w: 0,
    h: 0,
    cx: 0,
    cy: 0,
    time: 0,
    rafId: null,
    running: false,
    launchT: -1,
    collapsed: false,
    onCollapsed: null,
    sphereGlow: 0,
    beamAngle: 0,
    beamProgress: 0
  };

  function makeRibbon(index) {
    return {
      index: index,
      color: PALETTE[index % PALETTE.length],
      phase: (index / RIBBON_COUNT) * Math.PI * 2,
      speed: 0.85 + (index % 3) * 0.3,
      rx: 300 + (index % 4) * 70,
      ry: 120 + ((index + 2) % 3) * 40,
      rz: 300 + ((index + 1) % 4) * 60,
      amp: 48 + (index % 3) * 30,
      width: 30 - (index % 3) * 4,
      twistSpeed: 0.8 + (index % 3) * 0.35,
      twistFreq: 0.24 + (index % 2) * 0.12,
      tOffset: index * 1.9,
      head: { x: 0, y: 0, z: 0 },
      trail: [],
      sampleAcc: 0
    };
  }

  function seedTrail(r) {
    r.trail.length = 0;
    for (let i = 0; i < RIBBON_POINTS; i++) {
      r.trail.push(headPosition(r, -i * TRAIL_SAMPLE));
    }
  }

  function headPosition(r, t) {
    const a = r.phase + t * r.speed;
    const tt = t + r.tOffset;
    return {
      x: Math.cos(a) * r.rx + Math.sin(tt * 0.71 + r.phase) * r.amp,
      y: Math.sin(a * 1.24 + r.phase) * r.ry + Math.cos(tt * 0.93 + r.phase) * r.amp * 0.7,
      z: Math.sin(a * 1.9 + tt * 0.48 + r.phase) * r.rz
    };
  }

  function spiralPoint(r, age, p) {
    const shrink = 1 - easeInCubic(p);
    const spiral = p * 32 + r.phase + age * r.speed * (1 + p * 10);
    return {
      x: Math.cos(spiral) * r.rx * shrink,
      y: Math.sin(spiral * 1.17) * r.ry * shrink,
      z: Math.sin(spiral * 1.83 + r.phase) * r.rz * shrink * (1 - p * 0.7)
    };
  }

  function project(p) {
    const scale = FOCAL / Math.max(150, FOCAL + p.z);
    return {
      x: boot.cx + p.x * scale,
      y: boot.cy + p.y * scale,
      s: scale
    };
  }

  function cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }

  function normalize(v) {
    const len = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  function easeInCubic(t) { return t * t * t; }
  function easeOutCubic(t) { const u = 1 - t; return 1 - u * u * u; }

  function drawRibbon(r) {
    const ctx = boot.ctx;
    const pts = r.trail;
    if (pts.length < 3) return;

    const launch = boot.launchT >= 0 ? boot.launchT : 0;
    const keep = Math.max(4, Math.min(pts.length, Math.floor(RIBBON_POINTS * (1 - launch * 0.45))));
    const n = keep;

    const proj = new Array(n);
    for (let i = 0; i < n; i++) proj[i] = project(pts[i]);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < n - 1; i++) {
      const t0 = i / (n - 1);
      const t1 = (i + 1) / (n - 1);

      const p0 = proj[i];
      const p1 = proj[i + 1];

      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 2)];
      const tangent = normalize({ x: next.x - prev.x, y: next.y - prev.y, z: next.z - prev.z });

      const twist = Math.sin(i * r.twistFreq + boot.time * r.twistSpeed) * 0.62;
      const upRef = normalize({
        x: Math.cos(r.phase) * 0.7,
        y: 1,
        z: Math.sin(r.phase) * 0.7
      });
      const binormal = normalize(cross(tangent, upRef));

      const w0 = r.width * (0.1 + t0 * 0.9) * Math.cos(twist) * p0.s;
      const w1 = r.width * (0.1 + t1 * 0.9) * Math.cos(twist) * p1.s;

      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * w0;
      const ny = (dx / len) * w0;
      const nx1 = (-dy / len) * w1;
      const ny1 = (dx / len) * w1;

      const fade = Math.pow(t0, 1.7);
      const alpha = fade * (0.62 + 0.38 * (1 - launch * 0.4));
      if (alpha <= 0.008) continue;

      const cr = r.color[0];
      const cg = r.color[1];
      const cb = r.color[2];

      ctx.beginPath();
      ctx.moveTo(p0.x + nx, p0.y + ny);
      ctx.lineTo(p1.x + nx1, p1.y + ny1);
      ctx.lineTo(p1.x - nx1, p1.y - ny1);
      ctx.lineTo(p0.x - nx, p0.y - ny);
      ctx.closePath();
      ctx.fillStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (alpha * 0.3).toFixed(3) + ')';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(p0.x + nx * 0.3, p0.y + ny * 0.3);
      ctx.lineTo(p1.x + nx1 * 0.3, p1.y + ny1 * 0.3);
      ctx.lineTo(p1.x - nx1 * 0.3, p1.y - ny1 * 0.3);
      ctx.lineTo(p0.x - nx * 0.3, p0.y - ny * 0.3);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,' + (alpha * 0.7).toFixed(3) + ')';
      ctx.fill();
    }

    const hp = project(r.head);
    const glow = (0.55 + Math.sin(boot.time * 4 + r.phase) * 0.16) * (1 - launch * 0.55);
    if (glow > 0.02) {
      const gr = r.width * 1.7 * hp.s;
      const grad = ctx.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, gr);
      grad.addColorStop(0, 'rgba(255,255,255,' + (glow * 0.9).toFixed(3) + ')');
      grad.addColorStop(0.4, 'rgba(' + r.color[0] + ',' + r.color[1] + ',' + r.color[2] + ',' + (glow * 0.4).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, gr, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }


  function drawNexusSphere() {
    const ctx = boot.ctx;
    const g = boot.sphereGlow;
    if (g <= 0.001) return;

    const R = 92 * (0.55 + 0.45 * easeOutCubic(g));

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const halo = ctx.createRadialGradient(boot.cx, boot.cy, R * 0.7, boot.cx, boot.cy, R * 2.6);
    halo.addColorStop(0, 'rgba(157,255,0,' + (0.34 * g).toFixed(3) + ')');
    halo.addColorStop(0.4, 'rgba(16,113,16,' + (0.2 * g).toFixed(3) + ')');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(boot.cx, boot.cy, R * 2.6, 0, Math.PI * 2);
    ctx.fill();

    const body = ctx.createRadialGradient(
      boot.cx - R * 0.32, boot.cy - R * 0.38, R * 0.05,
      boot.cx, boot.cy, R
    );
    body.addColorStop(0, 'rgba(255,255,255,' + (0.98 * g).toFixed(3) + ')');
    body.addColorStop(0.22, 'rgba(236,255,230,' + (0.9 * g).toFixed(3) + ')');
    body.addColorStop(0.46, 'rgba(150,205,140,' + (0.62 * g).toFixed(3) + ')');
    body.addColorStop(0.68, 'rgba(28,96,26,' + (0.55 * g).toFixed(3) + ')');
    body.addColorStop(0.88, 'rgba(8,40,10,' + (0.62 * g).toFixed(3) + ')');
    body.addColorStop(1, 'rgba(2,16,4,' + (0.75 * g).toFixed(3) + ')');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(boot.cx, boot.cy, R, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(boot.cx, boot.cy, R, 0, Math.PI * 2);
    ctx.clip();
    const glass = ctx.createRadialGradient(
      boot.cx - R * 0.34, boot.cy - R * 0.42, 0,
      boot.cx - R * 0.34, boot.cy - R * 0.42, R * 0.55
    );
    glass.addColorStop(0, 'rgba(255,255,255,' + (0.92 * g).toFixed(3) + ')');
    glass.addColorStop(0.35, 'rgba(255,255,255,' + (0.28 * g).toFixed(3) + ')');
    glass.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.ellipse(boot.cx - R * 0.3, boot.cy - R * 0.36, R * 0.42, R * 0.26, -0.6, 0, Math.PI * 2);
    ctx.fill();

    if (boot.beamProgress > 0.001) {
      const bx = boot.cx + (boot.beamAngle % (Math.PI * 2)) * 0;
      const ang = boot.beamAngle;
      const len = R * 1.9;
      const beam = ctx.createLinearGradient(
        boot.cx - Math.cos(ang) * len, boot.cy - Math.sin(ang) * len,
        boot.cx + Math.cos(ang) * len, boot.cy + Math.sin(ang) * len
      );
      beam.addColorStop(0, 'rgba(157,255,0,0)');
      beam.addColorStop(0.45, 'rgba(157,255,0,' + (0.85 * g * boot.beamProgress).toFixed(3) + ')');
      beam.addColorStop(0.5, 'rgba(255,255,255,' + (0.95 * g * boot.beamProgress).toFixed(3) + ')');
      beam.addColorStop(0.55, 'rgba(157,255,0,' + (0.85 * g * boot.beamProgress).toFixed(3) + ')');
      beam.addColorStop(1, 'rgba(157,255,0,0)');
      ctx.strokeStyle = beam;
      ctx.lineWidth = Math.max(1.5, 7 * g * boot.beamProgress);
      ctx.shadowColor = 'rgba(157,255,0,.9)';
      ctx.shadowBlur = 26 * g * boot.beamProgress;
      ctx.beginPath();
      ctx.moveTo(boot.cx - Math.cos(ang) * len, boot.cy - Math.sin(ang) * len);
      ctx.lineTo(boot.cx + Math.cos(ang) * len, boot.cy + Math.sin(ang) * len);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    const shade = ctx.createLinearGradient(boot.cx, boot.cy - R, boot.cx, boot.cy + R);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(0.72, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,.42)');
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(boot.cx, boot.cy, R, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawCarvedX() {
    const ctx = boot.ctx;
    const g = boot.sphereGlow;
    if (g <= 0.01) return;

    const R = 92 * (0.55 + 0.45 * easeOutCubic(g));
    const s = R / 100;

    ctx.save();
    ctx.beginPath();
    ctx.arc(boot.cx, boot.cy, R * 0.995, 0, Math.PI * 2);
    ctx.clip();

    ctx.translate(boot.cx, boot.cy);
    ctx.scale(s, s);

    const blade = 'M47 51 C58 40 70 28 79 19 C85 13 91 20 86 27 C75 40 62 53 51 60 C45 64 40 54 47 51 Z';

    const drawBlades = (mode) => {
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.rotate((i * 90 * Math.PI) / 180);
        const p = new Path2D(blade);
        if (mode === 'shadow') {
          ctx.translate(1.6, 2.4);
          ctx.fillStyle = 'rgba(0,26,4,' + (0.72 * g).toFixed(3) + ')';
          ctx.fill(p);
        } else {
          ctx.strokeStyle = 'rgba(157,255,0,' + (0.85 * g).toFixed(3) + ')';
          ctx.lineWidth = 1.6;
          ctx.shadowColor = 'rgba(157,255,0,.95)';
          ctx.shadowBlur = 12;
          ctx.stroke(p);
          ctx.fillStyle = 'rgba(190,255,170,' + (0.16 * g).toFixed(3) + ')';
          ctx.fill(p);
          ctx.shadowBlur = 0;
        }
        ctx.restore();
      }
    };

    drawBlades('shadow');
    drawBlades('edge');

    ctx.restore();
  }

  const dust = [];

  function initDust() {
    dust.length = 0;
    const count = boot.w < 700 ? 90 : 180;
    for (let i = 0; i < count; i++) {
      dust.push({
        x: Math.random() * boot.w,
        y: Math.random() * boot.h,
        z: Math.random() * 700,
        size: 0.6 + Math.random() * 2,
        speed: 0.1 + Math.random() * 0.6,
        drift: (Math.random() - 0.5) * 0.3,
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  function drawDust(dt) {
    const ctx = boot.ctx;
    const boost = boot.launchT >= 0 ? 1 + boot.launchT * 8 : 1;
    for (let i = 0; i < dust.length; i++) {
      const d = dust[i];
      const scale = FOCAL / Math.max(150, FOCAL + d.z);

      d.z -= dt * 42 * boost * d.speed;
      if (d.z < -300) {
        d.z = 700;
        d.x = Math.random() * boot.w;
        d.y = Math.random() * boot.h;
      }
      d.x += dt * d.drift * boost;
      d.y -= dt * 6 * boost * d.speed;

      const px = boot.cx + (d.x - boot.cx) * scale;
      const py = boot.cy + (d.y - boot.cy) * scale;
      const alpha = Math.max(0, Math.min(1, (d.z + 300) / 1000)) * 0.7;

      ctx.beginPath();
      ctx.fillStyle = 'rgba(214,255,206,' + alpha.toFixed(3) + ')';
      ctx.arc(px, py, d.size * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame(now) {
    if (!boot.running) {
      boot.rafId = null;
      return;
    }
    const dt = boot.lastTime ? Math.min(0.05, (now - boot.lastTime) / 1000) : 0.016;
    boot.lastTime = now;

    const ctx = boot.ctx;
    if (!ctx) return;

    const speedMul = boot.launchT >= 0 ? 1 + boot.launchT * 11 : 1;
    boot.time += dt * speedMul;

    ctx.clearRect(0, 0, boot.w, boot.h);
    ctx.globalCompositeOperation = 'lighter';

    drawDust(dt);

    if (boot.launchT >= 0) {
      boot.launchT += (dt * 1000) / LAUNCH_DURATION;
      if (boot.launchT >= 1) {
        boot.launchT = 1;
        if (!boot.collapsed) {
          boot.collapsed = true;
          boot.sphereGlow = 1;
          if (typeof boot.onCollapsed === 'function') boot.onCollapsed();
        }
      }
    }

    boot.ribbons.forEach((r) => {
      if (boot.launchT >= 0) {
        const p = boot.launchT;
        const keep = Math.max(6, Math.floor(RIBBON_POINTS * (1 - p * 0.45)));
        const stride = TRAIL_SAMPLE * (1 + p * 4);
        for (let i = 0; i < keep; i++) {
          const pt = spiralPoint(r, i * stride, p);
          if (i < r.trail.length) r.trail[i] = pt;
          else r.trail.push(pt);
        }
        if (r.trail.length > keep) r.trail.length = keep;
        r.head = r.trail[0] || r.head;
      } else {
        r.head = headPosition(r, boot.time);

        r.sampleAcc += dt;
        let guard = 0;
        while (r.sampleAcc >= TRAIL_SAMPLE && guard < 6) {
          r.sampleAcc -= TRAIL_SAMPLE;
          guard++;
          r.trail.unshift({ x: r.head.x, y: r.head.y, z: r.head.z });
          if (r.trail.length > RIBBON_POINTS) r.trail.length = RIBBON_POINTS;
        }
        if (guard === 0 && r.sampleAcc > TRAIL_SAMPLE * 0.5) {
          r.trail.unshift({ x: r.head.x, y: r.head.y, z: r.head.z });
          if (r.trail.length > RIBBON_POINTS) r.trail.length = RIBBON_POINTS;
          r.sampleAcc = 0;
        }
      }
    });

    boot.ribbons
      .slice()
      .sort((a, b) => a.head.z - b.head.z)
      .forEach(drawRibbon);

    if (boot.sphereGlow > 0) {
      boot.sphereGlow = Math.min(1, boot.sphereGlow + dt * 1.6);
      boot.beamProgress = Math.min(1, boot.beamProgress + dt * 1.1);
      boot.beamAngle += dt * 0.9;
    }
    drawNexusSphere();
    drawCarvedX();

    boot.rafId = requestAnimationFrame(frame);
  }

  X360.Boot = {
    init(canvas, options) {
      const opts = options || {};
      boot.canvas = canvas;
      boot.ctx = canvas ? canvas.getContext('2d') : null;
      boot.onCollapsed = opts.onCollapsed || null;

      boot.ribbons = [];
      for (let i = 0; i < RIBBON_COUNT; i++) boot.ribbons.push(makeRibbon(i));

      this.resize();
      boot.ribbons.forEach(seedTrail);
      return this;
    },

    resize() {
      if (!boot.canvas) return;
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      boot.w = global.innerWidth;
      boot.h = global.innerHeight;
      boot.canvas.width = Math.floor(boot.w * dpr);
      boot.canvas.height = Math.floor(boot.h * dpr);
      if (boot.ctx) boot.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      boot.cx = boot.w / 2;
      boot.cy = boot.h * 0.40;
      initDust();
    },

    start() {
      if (boot.running) return;
      boot.running = true;
      boot.lastTime = 0;
      boot.rafId = requestAnimationFrame(frame);
    },

    stop() {
      boot.running = false;
      if (boot.rafId) cancelAnimationFrame(boot.rafId);
      boot.rafId = null;
      if (boot.ctx && boot.canvas) {
        boot.ctx.clearRect(0, 0, boot.w, boot.h);
      }
    },

    launch() {
      boot.launchT = 0;
      boot.collapsed = false;
    },

    reset() {
      boot.launchT = -1;
      boot.collapsed = false;
      boot.time = 0;
      boot.sphereGlow = 0;
      boot.beamAngle = 0;
      boot.beamProgress = 0;
      boot.ribbons.forEach(seedTrail);
    },

    isLaunching: () => boot.launchT >= 0,
    hasCollapsed: () => boot.collapsed,
    getSphereGlow: () => boot.sphereGlow
  };
})(window);
