(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const root = document.documentElement;
  const TAU = Math.PI * 2;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIn = (t) => t * t * t;

  const C = {
    cyan: [92, 225, 255], amber: [255, 180, 84], mag: [255, 122, 184],
    green: [125, 255, 176], white: [255, 255, 255],
  };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  function trackPoint(cx, cy, phi, k, s) {
    if (Math.abs(k) < 1e-6) return [cx + Math.cos(phi) * s, cy + Math.sin(phi) * s];
    return [
      cx + (Math.sin(phi + k * s) - Math.sin(phi)) / k,
      cy - (Math.cos(phi + k * s) - Math.cos(phi)) / k,
    ];
  }

  function fitCanvas(canvas, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function makeStars(n, W, H) {
    const stars = [];
    for (let i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * W, y: Math.random() * H,
        r: 0.4 + Math.random() * 1.3,
        ph: Math.random() * TAU, sp: 0.4 + Math.random() * 0.8,
        base: 0.25 + Math.random() * 0.55,
      });
    }
    return stars;
  }
  function drawStars(ctx, stars, t) {
    for (const s of stars) {
      const a = s.base + Math.sin(t * s.sp + s.ph) * 0.25;
      ctx.fillStyle = `rgba(210,225,255,${clamp(a, 0, 1)})`;
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
  }

  /* ------------------------------------------------------------------
     LOADER: two bodies spiral in (inspiral), merge, and the page opens
     from the ripple, the way LIGO watches a chirp climb and cut off.
  ------------------------------------------------------------------ */
  const loader = $('#loader');
  const fx = $('#fx');
  let loaderRunning = false;

  function finishInstantly() {
    root.classList.add('ready');
    if (loader) loader.classList.add('done');
    if (fx) fx.classList.add('done');
    revealHero();
  }

  function runLoader(opts = {}) {
    if (loaderRunning) return;
    loaderRunning = true;

    loader.classList.remove('done');
    fx.classList.remove('done');
    loader.style.webkitMaskImage = loader.style.maskImage = 'none';
    root.classList.remove('ready');

    let W, H, cx, cy, ctx;
    const TILT = 0.32;
    let stars = [];
    function resize() {
      W = window.innerWidth; H = window.innerHeight;
      ctx = fitCanvas(fx, W, H);
      cx = W / 2; cy = H * 0.47;
      stars = makeStars(Math.min(160, Math.round((W * H) / 9000)), W, H);
    }
    resize();
    window.addEventListener('resize', resize);

    const R0 = Math.min(W * 0.3, H * 0.26, 300);
    const TRAIL = 46;
    const bodies = [
      { off: 0, col: C.cyan, trail: [] },
      { off: Math.PI, col: C.amber, trail: [] },
    ];

    let burst = [];
    let flash = 0;
    let phase = 'ramp'; // ramp -> collide -> burst
    let tPhase = 0;
    let progress = 0;
    let loaded = false;
    let skipped = false;
    let theta = 0;
    let omega = 0.9;
    let radius = R0;
    const MIN_MS = opts.fast ? 900 : 3400;
    const t0 = performance.now();
    let last = t0;
    let hudT = 0;

    Promise.all([
      document.readyState === 'complete' ? 1 : new Promise((r) => window.addEventListener('load', r, { once: true })),
      document.fonts && document.fonts.ready ? document.fonts.ready : 1,
    ]).then(() => { loaded = true; });

    const skip = () => { skipped = true; };
    loader.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip, { once: true });
    fx.style.pointerEvents = 'auto';
    fx.addEventListener('pointerdown', skip);

    const pos = (a, r) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r * TILT];

    function setHud(now) {
      if (now - hudT < 90) return;
      hudT = now;
      const f = phase === 'ramp' ? lerp(12, 210, easeIn(clamp(progress, 0, 1)))
        : lerp(210, 480, clamp(tPhase / 0.9, 0, 1));
      $('#hud-e').innerHTML = `f<sub>gw</sub> ${f.toFixed(0)} Hz`;
      $('#hud-p').textContent = `${Math.round(clamp(progress, 0, 1) * 100)}%`;
      $('#hud-s').textContent =
        phase === 'ramp' ? (progress < 0.3 ? 'detecting inspiral' : progress < 0.75 ? 'frequency climbing' : 'merger imminent')
        : phase === 'collide' ? 'merger' : 'ringdown';
    }

    function startBurst() {
      phase = 'burst'; tPhase = 0; flash = 1;
      root.classList.add('ready');
      revealHero();
      try { sessionStorage.setItem('sp-seen', '1'); } catch (e) {}
      const rings = 4;
      for (let i = 0; i < rings; i++) {
        burst.push({ delay: i * 0.08, life: 0.85, w: 2.2 - i * 0.3, col: i % 2 ? C.amber : C.cyan });
      }
      const n = Math.min(70, Math.round((W * H) / 16000));
      for (let i = 0; i < n; i++) {
        burst.push({
          spark: true, a: Math.random() * TAU, v: 60 + Math.random() * 220,
          life: 0.55 + Math.random() * 0.4, col: Math.random() < 0.5 ? C.white : C.green,
        });
      }
    }

    let revealR = 0;
    const maxR = Math.hypot(W, H) / 2 + 120;

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tPhase += dt;
      ctx.clearRect(0, 0, W, H);
      drawStars(ctx, stars, now / 1000);

      if (phase === 'ramp') {
        const elapsed = now - t0;
        const cap = loaded ? 1 : 0.88;
        const target = skipped ? 1 : Math.min(elapsed / MIN_MS, cap);
        progress += (target - progress) * (skipped ? 0.25 : 0.12);
        if (target >= 1 && progress > 0.985) { progress = 1; phase = 'collide'; tPhase = 0; }
        omega = lerp(0.9, 7.5, easeIn(clamp(progress, 0, 1)));
        radius = R0 * (1 - 0.55 * easeIn(clamp(progress, 0, 1)));
      } else if (phase === 'collide') {
        const dur = skipped ? 0.4 : 0.85;
        const u = clamp(tPhase / dur, 0, 1);
        radius = R0 * 0.45 * (1 - easeIn(u));
        omega += dt * 30;
        if (u >= 1) startBurst();
      }

      if (phase !== 'burst') {
        theta += omega * dt;
        ctx.globalCompositeOperation = 'lighter';
        for (const b of bodies) {
          const a = theta + b.off;
          const [x, y] = pos(a, radius);
          b.trail.push([x, y]);
          if (b.trail.length > TRAIL) b.trail.shift();
          ctx.beginPath();
          for (let i = 0; i < b.trail.length; i++) {
            const [tx, ty] = b.trail[i];
            const al = (i / b.trail.length) * 0.55;
            ctx.strokeStyle = rgba(b.col, al);
            ctx.lineWidth = 1 + (i / b.trail.length) * 2;
            if (i === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty);
          }
          ctx.stroke();
          const rad = phase === 'collide' ? 5 + (1 - radius / R0) * 3 : 4.5;
          const g = ctx.createRadialGradient(x, y, 0, x, y, rad * 3.2);
          g.addColorStop(0, rgba(b.col, 0.95)); g.addColorStop(1, rgba(b.col, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad * 3.2, 0, TAU); ctx.fill();
          ctx.fillStyle = rgba(C.white, 0.9);
          ctx.beginPath(); ctx.arc(x, y, rad * 0.55, 0, TAU); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        if (phase === 'collide') {
          const a = easeIn(clamp(tPhase / 0.85, 0, 1)) * 0.95;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 70);
          g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g; ctx.fillRect(cx - 70, cy - 70, 140, 140);
        }
      }

      if (phase === 'burst') {
        const u = clamp(tPhase / 1.25, 0, 1);
        revealR = easeOut(u) * maxR;
        const soft = 100;
        const m = `radial-gradient(circle at ${cx}px ${cy}px, transparent ${Math.max(0, revealR - soft)}px, #000 ${revealR + 2}px)`;
        loader.style.webkitMaskImage = loader.style.maskImage = m;

        ctx.globalCompositeOperation = 'lighter';
        let alive = 0;
        for (const p of burst) {
          const age = tPhase - (p.delay || 0);
          if (age < 0) { alive++; continue; }
          if (age > p.life) continue;
          alive++;
          const a = 1 - age / p.life;
          if (p.spark) {
            const s = p.v * age;
            const x = cx + Math.cos(p.a) * s, y = cy + Math.sin(p.a) * s * TILT;
            ctx.fillStyle = rgba(p.col, a * 0.8);
            ctx.fillRect(x - 1, y - 1, 2, 2);
          } else {
            const rr = easeOut(clamp(age / p.life, 0, 1)) * maxR * 0.9;
            ctx.strokeStyle = rgba(p.col, a * 0.5);
            ctx.lineWidth = p.w;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rr, rr * TILT, 0, 0, TAU);
            ctx.stroke();
          }
        }
        if (flash > 0.01) {
          const fr = 50 + easeOut(clamp(tPhase / 0.5, 0, 1)) * 300;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, fr);
          g.addColorStop(0, `rgba(255,255,255,${flash})`);
          g.addColorStop(0.35, `rgba(92,225,255,${flash * 0.3})`);
          g.addColorStop(1, 'rgba(92,225,255,0)');
          ctx.fillStyle = g; ctx.fillRect(cx - fr, cy - fr, fr * 2, fr * 2);
          flash *= 0.9;
        }
        ctx.globalCompositeOperation = 'source-over';

        if (u >= 1) return done();
      }

      setHud(now);
      requestAnimationFrame(frame);
    }

    function done() {
      loader.classList.add('done');
      fx.classList.add('done');
      fx.style.pointerEvents = 'none';
      window.removeEventListener('resize', resize);
      loader.removeEventListener('pointerdown', skip);
      fx.removeEventListener('pointerdown', skip);
      loaderRunning = false;
    }

    requestAnimationFrame((t) => { last = t; frame(t); });
  }

  /* ------------------------------------------------------------------
     HERO: a calm starfield with one slow, continuous orbiting pair —
     an echo of the loader's story, at rest rather than mid-collision.
  ------------------------------------------------------------------ */
  function initSky() {
    const canvas = $('#sky');
    const hero = $('#hero');
    if (!canvas) return;
    let W, H, ctx, cx, cy, R;
    let stars = [];
    let shooters = [];
    let raf = 0, visible = true, nextShooter = 4;
    let theta = 0;

    function resize() {
      const r = hero.getBoundingClientRect();
      W = r.width; H = r.height;
      ctx = fitCanvas(canvas, W, H);
      const narrow = W < 760;
      cx = narrow ? W * 0.5 : W * 0.74;
      cy = narrow ? H * 0.58 : H * 0.46;
      R = Math.min(narrow ? W * 0.4 : W * 0.16, H * 0.22, 160);
      stars = makeStars(Math.min(220, Math.round((W * H) / 6000)), W, H);
    }

    function maybeShooter(t) {
      if (t < nextShooter) return;
      nextShooter = t + 5 + Math.random() * 7;
      const y0 = Math.random() * H * 0.6;
      shooters.push({ x: Math.random() * W * 0.4, y: y0, vx: 320 + Math.random() * 120, vy: 90 + Math.random() * 40, life: 0.7, age: 0 });
    }

    function draw(t, dt) {
      ctx.clearRect(0, 0, W, H);
      drawStars(ctx, stars, t);

      shooters = shooters.filter((s) => s.age < s.life);
      ctx.globalCompositeOperation = 'lighter';
      for (const s of shooters) {
        s.age += dt;
        const a = 1 - s.age / s.life;
        const x = s.x + s.vx * s.age, y = s.y + s.vy * s.age;
        const tx = x - s.vx * 0.05, ty = y - s.vy * 0.05;
        ctx.strokeStyle = `rgba(255,255,255,${a * 0.7})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
      }

      theta += dt * 0.5;
      const TILT = 0.55;
      for (const [off, col] of [[0, C.cyan], [Math.PI, C.amber]]) {
        const a = theta + off;
        const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R * TILT;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
        g.addColorStop(0, rgba(col, 0.85)); g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 14, 0, TAU); ctx.fill();
        ctx.fillStyle = rgba(C.white, 0.85);
        ctx.beginPath(); ctx.arc(x, y, 2, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(150,185,255,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(cx, cy, R, R * TILT, 0, 0, TAU); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }

    let lastT = performance.now();
    function loop(now) {
      if (!visible) { raf = 0; return; }
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      maybeShooter(now / 1000);
      draw(now / 1000, dt);
      raf = requestAnimationFrame(loop);
    }
    function start() { if (!raf && !reduceMotion) { lastT = performance.now(); raf = requestAnimationFrame(loop); } }

    resize();
    window.addEventListener('resize', resize);
    if (reduceMotion) { draw(0, 0); return; }
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) start(); }, { threshold: 0 }).observe(hero);
    start();
  }

  /* ------------------------------------------------------------------
     ACCENTS: the DNA ticker in the hero, three small panels above
     Research (a collision event, a DNA helix, a training loop), and a
     retro pixel-art shuttle scene above Beyond.
  ------------------------------------------------------------------ */
  function initTicker() {
    const el = $('#ticker');
    if (!el) return;
    const bases = 'ACGT';
    let chunk = '';
    for (let i = 0; i < 420; i++) {
      const b = bases[(Math.random() * 4) | 0];
      chunk += `<span class="${b}">${b}</span>`;
    }
    el.innerHTML = chunk + chunk;
  }

  // Shared driver: sizes the canvas, calls setup() on resize, and runs
  // draw(ctx, W, H, t, dt) only while the canvas is on screen.
  function animate(canvas, setup, draw, staticT) {
    let W = 0, H = 0, ctx = null, raf = 0, visible = false, last = 0, t = 0;
    function resize() {
      const r = canvas.getBoundingClientRect();
      const w = Math.round(r.width) || 300, h = Math.round(r.height) || 150;
      if (ctx && w === W && h === H) return;
      W = w; H = h; t = 0;
      ctx = fitCanvas(canvas, W, H);
      setup(ctx, W, H);
      if (reduceMotion) {
        // advance to a representative moment, then leave it still
        for (let tt = 0; tt < staticT; tt += 1 / 30) draw(ctx, W, H, tt, 1 / 30);
      }
    }
    function loop(now) {
      if (!visible) { raf = 0; return; }
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now; t += dt;
      draw(ctx, W, H, t, dt);
      raf = requestAnimationFrame(loop);
    }
    resize();
    window.addEventListener('resize', resize);
    if (reduceMotion || !('IntersectionObserver' in window)) return;
    new IntersectionObserver((es) => {
      visible = es[0].isIntersecting;
      if (visible && !raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    }).observe(canvas);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* --- 1. Collision event display (end-on view of a detector) --------
     Each event: tracks leave the interaction point and only ever move
     outward. Charged tracks bend in the magnetic field (soft ones curl
     up inside the tracker), photons fly straight (dashed), and whatever
     reaches the calorimeter leaves an energy deposit. Then the next
     event comes in. */
  function initEventDisplay() {
    const canvas = $('#vgEvent');
    if (!canvas) return;
    let cx, cy, R, layers, calIn, calOut, nSeg, ev = null, gap = 0;
    let evNo = 18000 + ((Math.random() * 9000) | 0);
    const GROW = 0.9, HOLD = 2.3, FADE = 0.6, PAUSE = 0.35;

    function newEvent() {
      const tracks = [];
      const n = 4 + ((Math.random() * 5) | 0);
      const base = Math.random() * TAU;
      for (let i = 0; i < n; i++) {
        const charged = Math.random() < 0.8;
        const phi = base + (i / n) * TAU + (Math.random() - 0.5) * 0.9;
        const q = Math.random() < 0.5 ? -1 : 1;
        const pt = 0.25 + Math.pow(Math.random(), 1.6) * 2.6;
        const k = charged ? q / (R * 0.9 * pt) : 0;
        const maxS = charged ? Math.min(R * 2.4, Math.PI / Math.abs(k)) : R * 2;
        const pts = [], hits = [];
        let s = 0, li = 0, reached = false;
        while (s < maxS) {
          const [x, y] = trackPoint(cx, cy, phi, k, s);
          const r = Math.hypot(x - cx, y - cy);
          if (r >= calIn) { reached = true; break; }
          pts.push(x, y);
          if (li < layers.length && r >= layers[li]) { if (charged) hits.push(pts.length / 2 - 1); li++; }
          s += 1.5;
        }
        let dep = null;
        if (reached && pts.length >= 4) {
          const m = pts.length;
          const ang = Math.atan2(pts[m - 1] - cy, pts[m - 2] - cx);
          const seg = Math.round(((ang + TAU) % TAU) / TAU * nSeg) % nSeg;
          dep = { seg, e: charged ? 0.3 + Math.random() * 0.35 : 0.65 + Math.random() * 0.35 };
        }
        tracks.push({ pts, hits, charged, dep, col: !charged ? C.amber : (q < 0 ? C.cyan : C.mag) });
      }
      evNo += 1 + ((Math.random() * 60) | 0);
      return { t: 0, tracks };
    }

    function setup(ctx, W, H) {
      cx = W / 2; cy = H / 2 + 2;
      R = Math.min(W * 0.46, H * 0.44);
      layers = [0.16, 0.28, 0.4, 0.52, 0.64].map((f) => f * R);
      calIn = R * 0.76; calOut = R * 0.98;
      nSeg = 48;
      ev = newEvent(); gap = 0;
    }

    function draw(ctx, W, H, t, dt) {
      ctx.clearRect(0, 0, W, H);

      // detector: beam pipe, tracker layers, segmented calorimeter
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(150,185,255,0.13)';
      for (const r of layers) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(150,185,255,0.22)';
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.05, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, calIn, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, calOut, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(150,185,255,0.08)';
      ctx.beginPath();
      for (let i = 0; i < nSeg; i++) {
        const a = (i + 0.5) / nSeg * TAU;
        ctx.moveTo(cx + Math.cos(a) * calIn, cy + Math.sin(a) * calIn);
        ctx.lineTo(cx + Math.cos(a) * calOut, cy + Math.sin(a) * calOut);
      }
      ctx.stroke();

      // labels
      ctx.font = '9.5px ' + getComputedStyle(root).getPropertyValue('--mono');
      ctx.fillStyle = 'rgba(147,160,184,0.7)';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText('event ' + evNo, 10, 9);
      ctx.textAlign = 'right';
      ctx.fillText('e⁺e⁻  10.58 GeV', W - 10, 9);
      ctx.textAlign = 'left';

      if (!ev) return;
      if (gap > 0) { gap -= dt; if (gap <= 0) ev = newEvent(); return; }
      ev.t += dt;
      const et = ev.t;
      const fade = et < GROW + HOLD ? 1 : clamp(1 - (et - GROW - HOLD) / FADE, 0, 1);
      if (et > GROW + HOLD + FADE) { gap = PAUSE; return; }

      // flash at the interaction point
      if (et < 0.35) {
        const u = et / 0.35;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 4 + u * 14);
        g.addColorStop(0, `rgba(255,255,255,${0.8 * (1 - u)})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, 4 + u * 14, 0, TAU); ctx.fill();
      }

      const speed = (calIn * 1.02) / GROW; // px per second along the track
      ctx.globalCompositeOperation = 'lighter';
      for (const tr of ev.tracks) {
        const total = tr.pts.length / 2;
        const head = Math.min(total, Math.floor((et * speed) / 1.5));
        if (head < 2) continue;
        ctx.strokeStyle = rgba(tr.col, 0.85 * fade);
        ctx.lineWidth = tr.charged ? 1.3 : 1.1;
        ctx.setLineDash(tr.charged ? [] : [3, 3]);
        ctx.beginPath();
        for (let i = 0; i < head; i++) {
          const x = tr.pts[2 * i], y = tr.pts[2 * i + 1];
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        // tracker hits the track has already passed through
        ctx.fillStyle = `rgba(255,255,255,${0.75 * fade})`;
        for (const hi of tr.hits) if (hi < head) ctx.fillRect(tr.pts[2 * hi] - 1, tr.pts[2 * hi + 1] - 1, 2, 2);
        // leading edge while still travelling
        if (head < total) {
          ctx.fillStyle = `rgba(255,255,255,${0.9 * fade})`;
          ctx.fillRect(tr.pts[2 * (head - 1)] - 1, tr.pts[2 * (head - 1) + 1] - 1, 2.2, 2.2);
        } else if (tr.dep) {
          // energy deposit once the particle arrives
          const a0 = (tr.dep.seg - 0.5) / nSeg * TAU, a1 = (tr.dep.seg + 0.5) / nSeg * TAU;
          const rOut = calIn + (calOut - calIn) * tr.dep.e;
          ctx.fillStyle = rgba(C.amber, 0.55 * fade);
          ctx.beginPath();
          ctx.arc(cx, cy, calIn + 1, a0, a1);
          ctx.arc(cx, cy, rOut, a1, a0, true);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    animate(canvas, setup, draw, 1.6);
  }

  /* --- 2. DNA double helix, slowly turning ---------------------------
     ~10.5 base pairs per turn; each rung is coloured by its base and
     its complement, using the same colours as the hero ticker. */
  function initDna() {
    const canvas = $('#vgDna');
    if (!canvas) return;
    const col = { A: C.green, T: C.mag, C: C.cyan, G: C.amber };
    const comp = { A: 'T', T: 'A', C: 'G', G: 'C' };
    let seq = '';

    function setup() {
      seq = '';
      for (let i = 0; i < 200; i++) seq += 'ACGT'[(Math.random() * 4) | 0];
    }

    function draw(ctx, W, H, t) {
      ctx.clearRect(0, 0, W, H);
      const cy = H / 2, A = H * 0.3;
      const lambda = Math.max(110, Math.min(170, W * 0.45));
      const step = lambda / 10.5;
      const w = TAU / lambda;
      const rot = t * 1.1;
      const theta = (x) => w * x - rot;
      const pad = 14;

      // back halves of both backbones
      const strand = (off, front) => {
        for (let x = pad; x < W - pad; x += 3) {
          const th = theta(x) + off, th2 = theta(x + 3) + off;
          const z = Math.cos(th);
          if ((z >= 0) !== front) continue;
          const a = 0.25 + 0.6 * (z + 1) / 2;
          ctx.strokeStyle = `rgba(200,215,245,${a})`;
          ctx.lineWidth = 1 + 1.4 * (z + 1) / 2;
          ctx.beginPath();
          ctx.moveTo(x, cy + A * Math.sin(th));
          ctx.lineTo(x + 3, cy + A * Math.sin(th2));
          ctx.stroke();
        }
      };
      strand(0, false); strand(Math.PI, false);

      // base-pair rungs
      let i = 0;
      for (let x = pad + step / 2; x < W - pad; x += step, i++) {
        const th = theta(x);
        const y1 = cy + A * Math.sin(th), y2 = cy - A * Math.sin(th);
        const b = seq[i % seq.length], c = comp[b];
        const ym = (y1 + y2) / 2;
        const a = 0.35 + 0.35 * Math.abs(Math.cos(th));
        ctx.lineWidth = 2;
        ctx.strokeStyle = rgba(col[b], a);
        ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, ym); ctx.stroke();
        ctx.strokeStyle = rgba(col[c], a);
        ctx.beginPath(); ctx.moveTo(x, ym); ctx.lineTo(x, y2); ctx.stroke();
      }

      strand(0, true); strand(Math.PI, true);

      // fade the ends so the helix drifts in and out of view
      ctx.globalCompositeOperation = 'destination-in';
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.12, 'rgba(0,0,0,1)');
      g.addColorStop(0.88, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }

    animate(canvas, setup, draw, 0.6);
  }

  /* --- 3. A little computer typing out a training loop --------------- */
  function initCodeScreen() {
    const canvas = $('#vgCode');
    if (!canvas) return;
    const CODE = [
      'x = one_hot(seqs)   # (N, 4, L)',
      'model = SeqCNN()',
      'for epoch in range(12):',
      '    loss = step(model, x, y)',
      '    print(epoch, round(loss, 3))',
    ];
    const KW = /^(for|in|import|from|def|return)$/;
    const BI = /^(print|range|round)$/;
    let lines, phase, li, ch, timer, epoch, mono;

    function reset() {
      lines = []; phase = 'type'; li = 0; ch = 0; timer = 0.5; epoch = 0;
    }
    function setup() {
      mono = getComputedStyle(root).getPropertyValue('--mono');
      reset();
    }

    function drawCodeLine(ctx, text, x, y, cw) {
      const toks = text.match(/#.*$|\d+(?:\.\d+)?|[A-Za-z_]\w*|\s+|./g) || [];
      let cx = x;
      for (const tk of toks) {
        let c = '#cdd6ea';
        if (tk[0] === '#') c = 'rgba(147,160,184,0.6)';
        else if (/^\d/.test(tk)) c = rgba(C.amber, 0.95);
        else if (KW.test(tk)) c = rgba(C.mag, 0.95);
        else if (BI.test(tk)) c = rgba(C.cyan, 0.95);
        else if (!/\w/.test(tk)) c = 'rgba(147,160,184,0.9)';
        ctx.fillStyle = c;
        ctx.fillText(tk, cx, y);
        cx += tk.length * cw;
      }
    }

    function draw(ctx, W, H, t, dt) {
      // --- advance the "program"
      timer -= dt;
      while (timer <= 0) {
        if (phase === 'type') {
          if (!lines[li]) lines[li] = { text: '', out: false };
          ch++;
          lines[li].text = CODE[li].slice(0, ch);
          timer += CODE[li][ch - 1] === ' ' ? 0.012 : 0.022 + Math.random() * 0.025;
          if (ch >= CODE[li].length) {
            li++; ch = 0; timer += 0.25;
            if (li >= CODE.length) { phase = 'run'; timer += 0.5; }
          }
        } else if (phase === 'run') {
          const loss = 0.78 * Math.exp(-epoch / 3.6) + 0.17 + (Math.random() - 0.5) * 0.025;
          lines.push({ text: `${epoch} ${loss.toFixed(3)}`, out: true });
          epoch++;
          timer += 0.38;
          if (epoch >= 12) { phase = 'hold'; timer += 2.4; }
        } else {
          reset();
        }
      }

      // --- draw the monitor
      ctx.clearRect(0, 0, W, H);
      const mw = Math.min(W * 0.84, 380), mh = H * 0.74;
      const mx = (W - mw) / 2, my = H * 0.07;
      roundRect(ctx, mx, my, mw, mh, 9);
      ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fill();
      ctx.strokeStyle = 'rgba(150,185,255,0.32)'; ctx.lineWidth = 1; ctx.stroke();
      // stand
      ctx.fillStyle = 'rgba(150,185,255,0.18)';
      ctx.fillRect(W / 2 - 7, my + mh, 14, H * 0.08);
      roundRect(ctx, W / 2 - 34, my + mh + H * 0.08, 68, 5, 2.5);
      ctx.fill();
      // power light
      ctx.fillStyle = rgba(C.green, 0.8 + 0.2 * Math.sin(t * 3));
      ctx.fillRect(mx + mw - 12, my + mh - 6, 3, 2);

      // screen
      const sx = mx + 7, sy = my + 7, sw = mw - 14, sh = mh - 16;
      roundRect(ctx, sx, sy, sw, sh, 5);
      ctx.fillStyle = '#03060c'; ctx.fill();
      ctx.strokeStyle = 'rgba(92,225,255,0.14)'; ctx.stroke();

      const fs = clamp((sw - 16) / (33 * 0.61), 7, 11.5);
      ctx.font = `${fs}px ${mono}`;
      const cw = ctx.measureText('M').width;
      const lh = fs * 1.3;
      const cap = Math.max(1, Math.floor((sh - 10) / lh));
      const start = Math.max(0, lines.length - cap);
      ctx.save();
      roundRect(ctx, sx, sy, sw, sh, 5); ctx.clip();
      ctx.textBaseline = 'top';
      let y = sy + 6;
      for (let i = start; i < lines.length; i++) {
        const L = lines[i];
        if (L.out) { ctx.fillStyle = rgba(C.green, 0.85); ctx.fillText(L.text, sx + 8, y); }
        else drawCodeLine(ctx, L.text, sx + 8, y, cw);
        y += lh;
      }
      // cursor
      if (Math.floor(t * 2.2) % 2 === 0) {
        const cur = lines[lines.length - 1];
        let cxp = sx + 8, cyp = sy + 6;
        if (phase === 'type' && cur && !cur.out && ch > 0) {
          cxp += cur.text.length * cw; cyp += (lines.length - 1 - start) * lh;
        } else {
          cyp += Math.min(lines.length - start, cap - 1) * lh;
        }
        ctx.fillStyle = 'rgba(205,214,234,0.75)';
        ctx.fillRect(cxp, cyp + 1, cw * 0.8, fs);
      }
      // faint screen glare
      const g = ctx.createLinearGradient(sx, sy, sx, sy + sh);
      g.addColorStop(0, 'rgba(92,225,255,0.05)'); g.addColorStop(1, 'rgba(92,225,255,0)');
      ctx.fillStyle = g; ctx.fillRect(sx, sy, sw, sh);
      ctx.restore();
    }

    animate(canvas, setup, draw, 4.6);
  }

  /* --- 4. Retro pixel-art space shuttle: launch, then landing ---------
     Drawn on a tiny low-resolution canvas and scaled up without
     smoothing, so every "pixel" is a chunky block. */
  function initShuttle() {
    const canvas = $('#shuttleScene');
    if (!canvas) return;

    const PAL = {
      W: '#e8edf8', w: '#aab4c8', g: '#6b7894', d: '#3d475c', K: '#1a2030',
      O: '#e0823a', o: '#a8552a', B: '#5ce1ff', R: '#ff6b5c', Y: '#ffe08a',
    };
    // shuttle stack, nose up: booster | external tank | orbiter
    const STACK = [
      '....oo.......',
      '...oOOo......',
      '...OOOo......',
      '...OOOo......',
      '..wOOOo......',
      '.wWOOOo......',
      '.wWOOOo......',
      '.wWOOOoW.....',
      '.wWOOOoKW....',
      '.wWOOOoKWW...',
      '.wWOOOoKWBB..',
      '.wWOOOoKWWW..',
      '.wWOOOoKWWW..',
      '.wWOOOoKWWW..',
      '.wWOOOoKWWW..',
      '.wWOOOoKWWW..',
      '.wWOOOoKWWW..',
      '.wWOOOoKWWWW.',
      '.wWOOOoKWWWWW',
      '.wWOOOoKWWWWW',
      '.wWOOOoKWWWW.',
      '.wWOOOoKWWWW.',
      '.wWOOOoKWWW..',
      '.wWoOOoKWWW..',
      '.gg.oo.gdg...',
      '.gg....ggg...',
    ];
    // orbiter on its own, nose right, gliding in to land
    const ORBITER = [
      '..WW..............',
      '..WWW.............',
      '..WWWW............',
      '.gWWWWWWWWWWWWBB..',
      'gdWWWWWWWWWWWWWWWw',
      '.dggggggggggggggd.',
      '....dddddddddd....',
    ];
    // 3x5 pixel font
    const FONT = {
      '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
      '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001010010',
      '8': '111101111101111', '9': '111101111001111',
      A: '010101111101101', C: '111100100100111', D: '110101101101110', E: '111100110100111',
      F: '111100110100100', G: '111100101101111', H: '101101111101101', I: '111010010010111',
      K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101',
      O: '111101101101111', P: '111101111100100', R: '110101110101101', S: '111100111001111',
      T: '111010010010010', U: '101101101101111', W: '101101111111101', '-': '000000111000000',
      '+': '000010111010000', ' ': '000000000000000',
    };

    function makeSprite(rows) {
      const c = document.createElement('canvas');
      c.width = rows[0].length; c.height = rows.length;
      const x = c.getContext('2d');
      rows.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) {
          const p = PAL[row[i]];
          if (p) { x.fillStyle = p; x.fillRect(i, j, 1, 1); }
        }
      });
      return c;
    }
    const stackImg = makeSprite(STACK);
    const orbImg = makeSprite(ORBITER);

    let off, o, S, LW, LH, groundY, padX, towerX, rx0, rx1, stars, hills, smoke;
    const CYCLE = 15;

    function setup(ctx, W, H) {
      S = H >= 220 ? 4 : 3;
      LW = Math.ceil(W / S); LH = Math.ceil(H / S);
      off = document.createElement('canvas');
      off.width = LW; off.height = LH;
      o = off.getContext('2d');
      groundY = LH - 7;
      padX = Math.round(LW * 0.14) + 6;
      towerX = padX - 5;
      rx0 = Math.round(LW * 0.48); rx1 = LW - 5;
      stars = [];
      const n = Math.round((LW * groundY) / 95);
      for (let i = 0; i < n; i++) {
        stars.push({ x: (Math.random() * LW) | 0, y: (Math.random() * (groundY - 12)) | 0,
          ph: Math.random() * TAU, sp: 0.6 + Math.random() * 1.6, big: Math.random() < 0.12 });
      }
      hills = [];
      const a = Math.random() * 10, b = Math.random() * 10;
      for (let x = 0; x < LW; x++) {
        hills.push(Math.max(1, Math.round(4 + 2.5 * Math.sin(x * 0.045 + a) + 1.6 * Math.sin(x * 0.13 + b))));
      }
      smoke = [];
    }

    function px(x, y, c) { o.fillStyle = c; o.fillRect(x | 0, y | 0, 1, 1); }
    function disc(x, y, r, c, alpha) {
      o.globalAlpha = alpha; o.fillStyle = c;
      const ri = Math.ceil(r);
      for (let dy = -ri; dy <= ri; dy++) {
        const span = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)) + 0.35);
        if (span >= 0) o.fillRect(Math.round(x) - span, Math.round(y) + dy, span * 2 + 1, 1);
      }
      o.globalAlpha = 1;
    }
    function text(str, x, y, c) {
      o.fillStyle = c;
      for (let k = 0; k < str.length; k++) {
        const g = FONT[str[k]] || FONT[' '];
        for (let j = 0; j < 15; j++) if (g[j] === '1') o.fillRect(x + k * 4 + (j % 3), y + ((j / 3) | 0), 1, 1);
      }
    }
    const pad3 = (n) => String(Math.max(0, Math.round(n))).padStart(3, '0');
    function puff(x, y, vx, vy, r0, r1, life) {
      smoke.push({ x, y, vx, vy, r0, r1, life, age: 0 });
    }
    function flame(x, y, width, len) {
      // a flickering pixel plume hanging below (x..x+width-1, from y down)
      for (let j = 0; j < len; j++) {
        const u = j / len;
        const w = Math.max(1, Math.round(width * (1 - u * 0.6) + (Math.random() < 0.3 ? 1 : 0)));
        const c = u < 0.18 ? PAL.W : u < 0.5 ? PAL.Y : u < 0.8 ? PAL.O : PAL.R;
        const x0 = Math.round(x + (width - w) / 2 + (Math.random() < 0.2 ? (Math.random() < 0.5 ? -1 : 1) : 0));
        o.fillStyle = c; o.fillRect(x0, y + j, w, 1);
      }
    }

    function draw(ctx, W, H, t, dt) {
      const ct = t % CYCLE;

      // --- sky, stars, moon, hills, ground
      o.fillStyle = '#05070d'; o.fillRect(0, 0, LW, LH);
      o.fillStyle = '#070b16'; o.fillRect(0, Math.round(groundY * 0.55), LW, LH);
      o.fillStyle = '#0a1020'; o.fillRect(0, Math.round(groundY * 0.8), LW, LH);
      for (const s of stars) {
        const b = Math.sin(t * s.sp + s.ph);
        if (b < -0.55) continue;
        px(s.x, s.y, b > 0.6 ? '#e6eeff' : '#7d8aa6');
        if (s.big && b > 0.75) { px(s.x - 1, s.y, '#56627c'); px(s.x + 1, s.y, '#56627c'); px(s.x, s.y - 1, '#56627c'); px(s.x, s.y + 1, '#56627c'); }
      }
      const mx = Math.round(LW * 0.8), my = 20;
      disc(mx, my, 5, '#d9e1f0', 1);
      px(mx - 2, my - 1, '#aab4c8'); px(mx + 1, my + 2, '#aab4c8'); px(mx + 2, my - 2, '#aab4c8'); px(mx - 1, my + 3, '#aab4c8');
      for (let x = 0; x < LW; x++) { o.fillStyle = '#0e1628'; o.fillRect(x, groundY - hills[x], 1, hills[x]); }
      o.fillStyle = '#2a3550'; o.fillRect(0, groundY, LW, 1);
      o.fillStyle = '#131a29'; o.fillRect(0, groundY + 1, LW, LH);

      // runway strip with blinking edge lights
      o.fillStyle = '#3a465e'; o.fillRect(rx0, groundY, rx1 - rx0, 2);
      for (let x = rx0 + 2; x < rx1; x += 7) {
        o.fillStyle = '#c8d0e0'; o.fillRect(x, groundY + 1, 3, 1);
        if (Math.floor(t * 3 + x * 0.1) % 3 === 0) px(x, groundY - 1, PAL.Y);
      }

      // launch pad + tower
      o.fillStyle = PAL.d; o.fillRect(padX - 3, groundY - 2, 20, 2);
      const topY = groundY - 36;
      for (let y = topY; y < groundY - 2; y++) {
        px(towerX, y, PAL.g); px(towerX + 2, y, PAL.g);
        if (y % 3 === 0) px(towerX + 1, y, PAL.g);
      }
      o.fillStyle = PAL.g; o.fillRect(towerX - 1, topY - 1, 5, 1);
      if (Math.floor(t * 1.5) % 2 === 0) px(towerX + 1, topY - 2, PAL.R);

      // --- timeline
      const stackW = STACK[0].length, stackH = STACK.length;
      const baseX = towerX + 4, baseY = groundY - 2 - stackH;
      const IGN = 1.5, LIFT = 1.9, EXIT = 6.4;
      let hudL = '', hudR = '';

      if (ct < EXIT + 0.6) {
        // ascent
        const tau = Math.max(0, ct - LIFT);
        const acc = (2 * (baseY + stackH + 22)) / Math.pow(EXIT - LIFT, 2);
        const sy = baseY - 0.5 * acc * tau * tau;
        const sx = baseX + 0.5 * 1.1 * tau * tau;
        // access arm only while on the pad
        if (ct < LIFT) { o.fillStyle = PAL.g; o.fillRect(towerX + 3, baseY + 9, 1, 1); }
        // smoke
        if (ct >= IGN && ct < LIFT + 1.6) {
          for (let k = 0; k < 3; k++) {
            const dir = Math.random() < 0.5 ? -1 : 1;
            puff(baseX + 5 + dir * 3, groundY - 2, dir * (8 + Math.random() * 20), -Math.random() * 3, 1, 3 + Math.random() * 3, 2.6 + Math.random() * 1.8);
          }
        } else if (ct < IGN && Math.random() < 0.15) {
          puff(baseX + 3 + Math.random() * 6, groundY - 3, (Math.random() - 0.5) * 3, -2, 0.5, 1.5, 1.2);
        }
        if (ct >= LIFT && sy + stackH < LH + 20 && Math.random() < 0.9) {
          puff(sx + 3 + Math.random() * 4, sy + stackH + 6, (Math.random() - 0.5) * 2, 1 + Math.random() * 2, 1, 2 + Math.random() * 2, 2.2 + Math.random());
        }
        drawSmoke(dt);
        if (ct >= IGN) {
          const boost = ct < LIFT ? 0.5 : 1;
          flame(sx + 1, sy + stackH, 2, Math.round((5 + Math.random() * 4) * boost + 2));
          flame(sx + 7, sy + stackH, 3, Math.round((4 + Math.random() * 3) * boost + 1));
        }
        o.drawImage(stackImg, Math.round(sx), Math.round(sy));

        if (ct < IGN) { hudL = 'COUNTDOWN'; hudR = 'T-' + Math.max(1, Math.ceil(3 - ct * 2)); }
        else if (ct < LIFT) { hudL = 'IGNITION'; hudR = 'T-0'; }
        else if (ct < LIFT + 1.4) { hudL = 'LIFTOFF'; hudR = 'ALT ' + pad3(tau * tau * 4) + 'KM'; }
        else { hudL = 'ASCENT'; hudR = 'ALT ' + pad3(tau * tau * 4) + 'KM'; }
      } else {
        drawSmoke(dt);
        // approach, flare, touchdown, rollout
        const A0 = 7.4, TD = 11.4, STOP = 13.4;
        const ow = ORBITER[0].length, oh = ORBITER.length;
        const tdx = rx0 + 4;
        const gy = groundY - oh - 1;
        const roll = Math.min(70, rx1 - 22 - tdx);
        let ox, oy, gear = false, chute = 0;
        if (ct < A0) { ox = -ow - 10; oy = 4; }
        else if (ct < TD) {
          const u = (ct - A0) / (TD - A0);
          ox = lerp(-ow - 6, tdx, u);
          oy = lerp(2, gy, 1 - Math.pow(1 - u, 2.2));
          gear = u > 0.72;
        } else {
          const v = clamp((ct - TD) / (STOP - TD), 0, 1);
          ox = tdx + roll * (1 - Math.pow(1 - v, 2));
          oy = gy; gear = true;
          chute = clamp((ct - TD - 0.3) / 0.4, 0, 1) * (ct < STOP + 0.8 ? 1 : 0);
          if (ct - TD < 0.12) {
            puff(ox + 4, groundY - 1, -6, -1, 0.5, 2, 0.8);
            puff(ox + 13, groundY - 1, -6, -1, 0.5, 2, 0.8);
          }
        }
        ox = Math.round(ox); oy = Math.round(oy);
        if (chute > 0) {
          const len = Math.round(4 + chute * 5);
          o.fillStyle = PAL.w; o.fillRect(ox - len, oy + 4, len, 1);
          const cxp = ox - len - 2;
          o.fillStyle = PAL.R; o.fillRect(cxp - 1, oy + 1, 2, 7);
          o.fillStyle = PAL.W; o.fillRect(cxp - 2, oy + 2, 1, 5);
        }
        o.drawImage(orbImg, ox, oy);
        if (gear) {
          o.fillStyle = PAL.g;
          o.fillRect(ox + 4, oy + oh, 1, 1); o.fillRect(ox + 13, oy + oh, 1, 1);
          o.fillStyle = PAL.K;
          o.fillRect(ox + 3, oy + oh, 1, 1); o.fillRect(ox + 12, oy + oh, 1, 1);
        }
        if (ct < TD) { hudL = 'APPROACH'; hudR = 'SPD ' + pad3(lerp(380, 200, clamp((ct - A0) / (TD - A0), 0, 1))); }
        else if (ct < STOP) { hudL = 'TOUCHDOWN'; hudR = 'SPD ' + pad3(200 * (1 - clamp((ct - TD) / (STOP - TD), 0, 1))); }
        else { hudL = 'WHEELS STOP'; hudR = 'SPD 000'; }
      }

      o.fillStyle = '#2a3550'; o.fillRect(0, groundY, LW, 1);
      o.fillStyle = '#131a29'; o.fillRect(0, groundY + 1, LW, LH);
      o.fillStyle = '#3a465e'; o.fillRect(rx0, groundY, rx1 - rx0, 2);
      for (let x = rx0 + 2; x < rx1; x += 7) { o.fillStyle = '#c8d0e0'; o.fillRect(x, groundY + 1, 3, 1); }

      if (hudL) text(hudL, 4, 4, '#5ce1ff');
      if (hudR) text(hudR, LW - 4 - hudR.length * 4 + 1, 4, '#ffb454');

      // quick fade between loops, like a scene change
      const f = ct > CYCLE - 0.6 ? (ct - (CYCLE - 0.6)) / 0.6 : ct < 0.4 ? 1 - ct / 0.4 : 0;
      if (f > 0) { o.globalAlpha = clamp(f, 0, 1); o.fillStyle = '#05070d'; o.fillRect(0, 0, LW, LH); o.globalAlpha = 1; }
      if (ct > CYCLE - 0.1) smoke.length = 0;

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(off, 0, 0, LW * S, LH * S);
    }

    function drawSmoke(dt) {
      const shades = ['#dfe5f0', '#b4bdcf', '#8c97ad', '#66728a'];
      for (let i = smoke.length - 1; i >= 0; i--) {
        const p = smoke[i];
        p.age += dt;
        if (p.age >= p.life) { smoke.splice(i, 1); continue; }
        const u = p.age / p.life;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 1 - 1.2 * dt;
        const r = lerp(p.r0, p.r1, Math.sqrt(u));
        disc(p.x, p.y, r, shades[Math.min(3, (u * 4) | 0)], 0.9 * (1 - u * u));
      }
    }

    animate(canvas, setup, draw, 3.2);
  }

  /* ------------------------------------------------------------------
     misc UI
  ------------------------------------------------------------------ */
  let heroRevealed = false;
  function revealHero() {
    if (heroRevealed) return;
    heroRevealed = true;
    $$('.hero .reveal').forEach((el, i) => {
      el.style.setProperty('--d', `${0.15 + i * 0.09}s`);
      el.classList.add('in');
    });
  }

  function initReveal() {
    const items = $$('.reveal').filter((el) => !el.closest('.hero'));
    if (reduceMotion || !('IntersectionObserver' in window)) { items.forEach((el) => el.classList.add('in')); return; }
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    items.forEach((el) => io.observe(el));
  }

  function initNav() {
    const links = $$('.nav nav a');
    const secs = links.map((a) => $(a.getAttribute('href')));
    const timelines = $$('.timeline[data-timeline]');
    const onScroll = () => {
      const y = window.scrollY + 140;
      let cur = -1;
      secs.forEach((s, i) => { if (s && s.offsetTop <= y) cur = i; });
      links.forEach((a, i) => a.classList.toggle('active', i === cur));
      timelines.forEach((tl) => {
        const r = tl.getBoundingClientRect();
        const p = clamp((window.innerHeight * 0.65 - r.top) / r.height, 0, 1);
        tl.style.setProperty('--p', p.toFixed(3));
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ------------------------------------------------------------------ */
  function boot() {
    initReveal();
    initNav();
    initSky();
    initTicker();
    initEventDisplay();
    initDna();
    initCodeScreen();
    initShuttle();

    const noLoader = root.classList.contains('no-loader') || !loader;
    if (noLoader || reduceMotion) finishInstantly();
    else runLoader();

    const replay = $('#replay');
    if (replay) replay.addEventListener('click', () => {
      if (reduceMotion) return;
      root.classList.remove('no-loader');
      window.scrollTo({ top: 0 });
      heroRevealed = false;
      loader.style.display = 'block'; fx.style.display = 'block';
      runLoader({ fast: true });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
