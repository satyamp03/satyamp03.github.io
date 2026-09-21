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

  /* A charged particle in a uniform magnetic field follows a circular arc.
     phi = launch angle, k = signed curvature (1/radius), s = arc length travelled. */
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

  /* ------------------------------------------------------------------
     LOADER: two counter-rotating beams ramp up, collide, burst open.
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

    let W, H, cx, cy, R, ctx;
    const TILT = 0.36;
    function resize() {
      W = window.innerWidth; H = window.innerHeight;
      ctx = fitCanvas(fx, W, H);
      cx = W / 2; cy = H * 0.47;
      R = Math.min(W * 0.42, H * 0.34, 420);
    }
    resize();
    window.addEventListener('resize', resize);

    // beams: bunches of particles
    const BUNCHES = 6, PER = 16;
    const beams = [
      { dir: +1, col: C.cyan, ps: [] },
      { dir: -1, col: C.amber, ps: [] },
    ];
    beams.forEach((b, bi) => {
      for (let i = 0; i < BUNCHES; i++) {
        const centre = (i / BUNCHES) * TAU + (bi ? Math.PI / BUNCHES : 0);
        for (let j = 0; j < PER; j++) {
          b.ps.push({
            th: centre + (Math.random() - 0.5) * 0.16,
            dr: (Math.random() - 0.5) * 9,
            sz: 0.8 + Math.random() * 1.1,
          });
        }
      }
    });

    let burst = [];
    let flash = 0;
    let phase = 'ramp'; // ramp -> collide -> burst
    let tPhase = 0;
    let progress = 0;
    let loaded = false;
    let skipped = false;
    let omega = 0.5;
    let radScale = 1;
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

    const pos = (th, r) => {
      const x = cx + Math.cos(th) * r;
      const y = cy + Math.sin(th) * r * TILT;
      return [x, y, 0.5 + 0.5 * Math.sin(th)]; // depth: 1 = front (lower half)
    };

    function drawRing(alpha) {
      ctx.lineWidth = 1;
      for (const [rs, a] of [[1.0, 0.35], [1.09, 0.14], [0.91, 0.14]]) {
        ctx.strokeStyle = `rgba(150,185,255,${a * alpha})`;
        ctx.beginPath();
        ctx.ellipse(cx, cy, R * rs * radScale, R * rs * radScale * TILT, 0, 0, TAU);
        ctx.stroke();
      }
      // magnet segments
      ctx.fillStyle = `rgba(150,185,255,${0.5 * alpha})`;
      for (let i = 0; i < 24; i++) {
        const [x, y] = pos((i / 24) * TAU, R * 1.09 * radScale);
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }

    function setHud(now) {
      if (now - hudT < 90) return;
      hudT = now;
      const e = lerp(0.45, 6.8, clamp(progress, 0, 1));
      $('#hud-e').innerHTML = `E<sub>beam</sub> ${e.toFixed(2)} TeV`;
      $('#hud-p').textContent = `${Math.round(clamp(progress, 0, 1) * 100)}%`;
      $('#hud-s').textContent =
        phase === 'ramp' ? (progress < 0.35 ? 'injecting beams' : progress < 0.8 ? 'ramping energy' : 'beams squeezed · stable')
        : phase === 'collide' ? 'collision imminent' : 'collision';
    }

    function startBurst() {
      phase = 'burst'; tPhase = 0; flash = 1;
      root.classList.add('ready');
      revealHero();
      try { sessionStorage.setItem('sp-seen', '1'); } catch (e) {}
      const n = Math.min(300, Math.round((W * H) / 3800));
      const cols = [C.cyan, C.cyan, C.amber, C.mag, C.white, C.green];
      for (let i = 0; i < n; i++) {
        const rr = 25 + Math.random() * 380;
        burst.push({
          phi: Math.random() * TAU,
          k: (Math.random() < 0.5 ? -1 : 1) / rr,
          v: 500 + Math.random() * 1500,
          life: 1.0 + Math.random() * 0.9,
          col: cols[(Math.random() * cols.length) | 0],
          w: 0.8 + Math.random() * 1.3,
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
      ctx.globalCompositeOperation = 'source-over';

      if (phase === 'ramp') {
        const elapsed = now - t0;
        const cap = loaded ? 1 : 0.88;
        const target = skipped ? 1 : Math.min(elapsed / MIN_MS, cap);
        progress += (target - progress) * (skipped ? 0.25 : 0.12);
        if (target >= 1 && progress > 0.985) { progress = 1; phase = 'collide'; tPhase = 0; }
        omega = lerp(0.55, 11, easeIn(clamp(progress, 0, 1)));
      } else if (phase === 'collide') {
        const dur = skipped ? 0.45 : 0.95;
        const u = clamp(tPhase / dur, 0, 1);
        radScale = 1 - easeIn(u) * 0.995;
        omega += dt * 26;
        if (u >= 1) startBurst();
      }

      // beams
      if (phase !== 'burst') {
        drawRing(1 - (phase === 'collide' ? clamp(tPhase / 0.8, 0, 1) * 0.7 : 0));
        ctx.globalCompositeOperation = 'lighter';
        for (const b of beams) {
          for (const p of b.ps) {
            p.th += b.dir * omega * dt;
            const r = (R + p.dr) * radScale;
            const [x, y, d] = pos(p.th, r);
            const trail = Math.min(0.5, omega * 0.028);
            const [x0, y0] = pos(p.th - b.dir * trail, r);
            const a = 0.35 + 0.65 * d;
            ctx.strokeStyle = rgba(b.col, a * 0.85);
            ctx.lineWidth = p.sz * (0.7 + d * 0.9);
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
            ctx.fillStyle = rgba(b.col, a);
            ctx.beginPath(); ctx.arc(x, y, p.sz * (0.8 + d * 0.9), 0, TAU); ctx.fill();
          }
        }
        ctx.globalCompositeOperation = 'source-over';
        // hot spot at centre while collide
        if (phase === 'collide') {
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60);
          const a = easeIn(clamp(tPhase / 0.95, 0, 1)) * 0.9;
          g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g; ctx.fillRect(cx - 60, cy - 60, 120, 120);
        }
      }

      // burst + reveal
      if (phase === 'burst') {
        const u = clamp(tPhase / 1.15, 0, 1);
        revealR = easeOut(u) * maxR;
        const soft = 90;
        const m = `radial-gradient(circle at ${cx}px ${cy}px, transparent ${Math.max(0, revealR - soft)}px, #000 ${revealR + 2}px)`;
        loader.style.webkitMaskImage = loader.style.maskImage = m;

        ctx.globalCompositeOperation = 'lighter';
        let alive = 0;
        for (const p of burst) {
          const age = tPhase;
          if (age > p.life) continue;
          alive++;
          const s = p.v * (1 - Math.exp(-age * 2.2)) / 2.2 * 1.0;
          const a = 1 - age / p.life;
          const N = 14, tail = Math.min(s, 120);
          ctx.strokeStyle = rgba(p.col, a * 0.9);
          ctx.lineWidth = p.w;
          ctx.beginPath();
          for (let i = 0; i <= N; i++) {
            const ss = s - (tail * (N - i)) / N;
            const [x, y] = trackPoint(cx, cy, p.phi, p.k, Math.max(0, ss));
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
        }
        if (flash > 0.01) {
          const fr = 40 + easeOut(clamp(tPhase / 0.5, 0, 1)) * 320;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, fr);
          g.addColorStop(0, `rgba(255,255,255,${flash})`);
          g.addColorStop(0.35, `rgba(92,225,255,${flash * 0.35})`);
          g.addColorStop(1, 'rgba(92,225,255,0)');
          ctx.fillStyle = g; ctx.fillRect(cx - fr, cy - fr, fr * 2, fr * 2);
          flash *= 0.9;
        }
        ctx.globalCompositeOperation = 'source-over';

        if (u >= 1 && alive === 0) return done();
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
     HERO: a slowly repeating collision "event display"
  ------------------------------------------------------------------ */
  function initEventDisplay() {
    const canvas = $('#event');
    const hero = $('#hero');
    if (!canvas) return;
    let W, H, ctx, cx, cy, Rd;
    let events = [];
    let raf = 0, visible = true, tStart = 0;

    function resize() {
      const r = hero.getBoundingClientRect();
      W = r.width; H = r.height;
      ctx = fitCanvas(canvas, W, H);
      const narrow = W < 760;
      cx = narrow ? W * 0.5 : W * 0.72;
      cy = narrow ? H * 0.55 : H * 0.46;
      Rd = Math.min(narrow ? W * 0.55 : W * 0.34, H * 0.5);
      draw(performance.now());
    }

    function newEvent(now) {
      const n = 26 + ((Math.random() * 18) | 0);
      const tr = [];
      const cols = [C.cyan, C.cyan, C.cyan, C.amber, C.mag, C.green];
      for (let i = 0; i < n; i++) {
        const pt = Math.random();
        const rr = 18 + Math.pow(pt, 1.8) * Rd * 2.2; // radius of curvature (momentum)
        tr.push({
          phi: Math.random() * TAU,
          k: (Math.random() < 0.5 ? -1 : 1) / rr,
          L: Rd * (0.55 + Math.random() * 0.45),
          col: cols[(Math.random() * cols.length) | 0],
          w: 0.8 + Math.random() * 0.9,
        });
      }
      events.push({ t0: now, tr, jx: (Math.random() - 0.5) * 6, jy: (Math.random() - 0.5) * 6 });
    }

    function drawDetector() {
      ctx.lineWidth = 1;
      for (const [f, a] of [[0.25, 0.10], [0.5, 0.09], [0.75, 0.08], [1.0, 0.16], [1.18, 0.10]]) {
        ctx.strokeStyle = `rgba(150,185,255,${a})`;
        ctx.beginPath(); ctx.arc(cx, cy, Rd * f, 0, TAU); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(150,185,255,0.07)';
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        ctx.moveTo(cx + Math.cos(a) * Rd * 1.0, cy + Math.sin(a) * Rd * 1.0);
        ctx.lineTo(cx + Math.cos(a) * Rd * 1.18, cy + Math.sin(a) * Rd * 1.18);
      }
      ctx.stroke();
    }

    const GROW = 1.6, HOLD = 1.6, FADE = 2.2, PERIOD = 3.6;

    function draw(now) {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      drawDetector();
      ctx.globalCompositeOperation = 'lighter';
      events = events.filter((e) => (now - e.t0) / 1000 < GROW + HOLD + FADE);
      for (const e of events) {
        const age = (now - e.t0) / 1000;
        const g = easeOut(clamp(age / GROW, 0, 1));
        const a = age < GROW + HOLD ? 1 : 1 - (age - GROW - HOLD) / FADE;
        for (const p of e.tr) {
          const s = p.L * g;
          ctx.strokeStyle = rgba(p.col, 0.6 * a);
          ctx.lineWidth = p.w;
          ctx.beginPath();
          const N = 28;
          for (let i = 0; i <= N; i++) {
            const [x, y] = trackPoint(cx + e.jx, cy + e.jy, p.phi, p.k, (s * i) / N);
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
          if (g > 0.98) { // calorimeter hit
            const [x, y] = trackPoint(cx + e.jx, cy + e.jy, p.phi, p.k, s);
            ctx.fillStyle = rgba(p.col, 0.8 * a);
            ctx.fillRect(x - 2, y - 2, 4, 4);
          }
        }
        // vertex glow
        const vg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 26);
        vg.addColorStop(0, `rgba(255,255,255,${0.5 * a})`); vg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = vg; ctx.fillRect(cx - 26, cy - 26, 52, 52);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function loop(now) {
      if (!visible) { raf = 0; return; }
      if (!events.length || now - events[events.length - 1].t0 > PERIOD * 1000) newEvent(now);
      draw(now);
      raf = requestAnimationFrame(loop);
    }
    function start() { if (!raf && !reduceMotion) raf = requestAnimationFrame(loop); }

    resize();
    window.addEventListener('resize', resize);
    if (reduceMotion) { newEvent(performance.now() - 2000); draw(performance.now()); return; }
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) start(); }, { threshold: 0 }).observe(hero);
    start();
  }

  /* ------------------------------------------------------------------
     misc UI
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
    // duplicated so translateX(-50%) loops seamlessly
    el.innerHTML = chunk + chunk;
  }

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
    const onScroll = () => {
      const y = window.scrollY + 140;
      let cur = -1;
      secs.forEach((s, i) => { if (s && s.offsetTop <= y) cur = i; });
      links.forEach((a, i) => a.classList.toggle('active', i === cur));
      const tl = $('#timeline');
      if (tl) {
        const r = tl.getBoundingClientRect();
        const p = clamp((window.innerHeight * 0.65 - r.top) / r.height, 0, 1);
        tl.style.setProperty('--p', p.toFixed(3));
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ------------------------------------------------------------------ */
  function boot() {
    initTicker();
    initReveal();
    initNav();
    initEventDisplay();

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
