import React, { useEffect, useRef } from 'react';

/**
 * A seamlessly-looping perspective grid behind the hero — the same
 * "wireframe terrain" mood as DigitalOcean's homepage background, drawn from
 * scratch in this site's own accent colour rather than reusing their asset.
 * Canvas rather than an actual video file: nothing to host, trivially small,
 * and it stays on-brand automatically if the accent colour ever changes.
 *
 * Three layers of motion, all reading as one scene: the grid lines drift
 * toward the viewer, small points travel down individual lanes like traffic
 * on a network, and the horizon glow breathes slowly. Purely decorative
 * (aria-hidden) and painted behind the hero copy — the text above it is what
 * has to stay legible, so everything fades out before the upper half.
 *
 * `signature` adds a second, larger motif reserved for the page that should
 * carry the most visual weight (usually the landing page) so every other
 * page isn't competing for the same amount of attention: a small hub node
 * with independent request-pulses converging into it from several
 * directions, and periodic "received" rings pulsing outward — a literal
 * picture of what the product does (many different workloads, one private
 * endpoint they all call), rather than a decorative motif tied to any
 * particular product name. Deliberately not brand-name-dependent so it
 * doesn't need reworking if the name changes. Node/hub positions use
 * `yFrac`, a fraction of the *whole canvas height* — the hero copy above
 * varies in height across pages and viewports, so everything here is
 * anchored well below the tallest CTA row (0.74+) with margin to spare.
 */
const V_LANES = 14;
const H_LINES = 12;
const PARTICLE_COUNT = 14;
const HUB = { xFrac: 0.5, yFrac: 0.94 };
const REQUEST_NODE_COUNT = 8;
const REQUEST_NODE_Y_MIN = 0.74;
const REQUEST_NODE_Y_MAX = 0.86;

const HeroCanvas = ({ signature = false }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return undefined;
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const accentRgb = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-primary-rgb')
      .trim() || '112, 137, 245';

    // Each particle rides one lane (a vertical convergence line) from the
    // horizon down to the viewer, at its own speed, then respawns on a
    // random lane — like packets moving through the grid.
    const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      lane: Math.random(),
      t: Math.random(),
      speed: 0.09 + Math.random() * 0.09,
    }));

    // Signature-only: a handful of request nodes, spread across the floor,
    // each firing its own pulse toward the hub on its own independent timer
    // — never in unison, since real requests don't arrive in unison either.
    const requestNodes = signature
      ? Array.from({ length: REQUEST_NODE_COUNT }, () => ({
          xFrac: 0.5 + (Math.random() * 2 - 1) * 0.44,
          yFrac: REQUEST_NODE_Y_MIN + Math.random() * (REQUEST_NODE_Y_MAX - REQUEST_NODE_Y_MIN),
          t: Math.random(),
          speed: 0.25 + Math.random() * 0.2,
          delay: Math.random() * 2.5,
        }))
      : [];

    let offset = 0;
    let clock = 0;
    let raf;

    const drawFrame = (dt) => {
      ctx.clearRect(0, 0, width, height);

      const horizonY = height * 0.6;
      const vanishX = width / 2;

      // Ambient glow at the horizon, breathing slowly
      const glowAlpha = 0.16 + Math.sin(clock * 0.6) * 0.035;
      const glow = ctx.createRadialGradient(vanishX, horizonY, 0, vanishX, horizonY, width * 0.44);
      glow.addColorStop(0, `rgba(${accentRgb}, ${glowAlpha.toFixed(3)})`);
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, horizonY - height * 0.3, width, height * 0.7);

      // Vertical lanes converging toward the horizon's centre
      ctx.lineWidth = 1;
      for (let i = 0; i <= V_LANES; i++) {
        const t = i / V_LANES;
        ctx.strokeStyle = `rgba(${accentRgb}, 0.2)`;
        ctx.beginPath();
        ctx.moveTo(vanishX, horizonY);
        ctx.lineTo(t * width, height);
        ctx.stroke();
      }

      // Horizontal lines, spaced with perspective, drifting toward the
      // viewer — the loop wraps with no visible seam because the leading
      // edge fades to the same near-zero alpha the far edge starts at.
      for (let i = 0; i < H_LINES; i++) {
        const p = ((i + offset) % H_LINES) / H_LINES;
        const y = horizonY + p * p * (height - horizonY);
        const alpha = 0.28 * (1 - p);
        if (alpha <= 0.004) continue;
        ctx.strokeStyle = `rgba(${accentRgb}, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Particles travelling down individual lanes
      particles.forEach((particle) => {
        particle.t += particle.speed * dt;
        if (particle.t > 1) {
          particle.t = 0;
          particle.lane = Math.random();
        }
        const eased = particle.t * particle.t;
        const laneX = particle.lane * width;
        const x = vanishX + eased * (laneX - vanishX);
        const y = horizonY + eased * (height - horizonY);
        // Fade in near the horizon, hold, fade out just before the viewer
        const fade = Math.min(particle.t / 0.18, 1, (1 - particle.t) / 0.12);
        const alpha = Math.max(fade, 0) * 0.85;
        if (alpha <= 0.01) return;
        const radius = 1 + eased * 2.2;
        const dot = ctx.createRadialGradient(x, y, 0, x, y, radius * 3);
        dot.addColorStop(0, `rgba(${accentRgb}, ${alpha.toFixed(3)})`);
        dot.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = dot;
        ctx.beginPath();
        ctx.arc(x, y, radius * 3, 0, Math.PI * 2);
        ctx.fill();
      });

      if (signature) {
        const hubX = HUB.xFrac * width;
        const hubY = HUB.yFrac * height;

        // The static wiring — a faint line from every request node to the
        // hub, so the topology reads even at the instant nothing is pulsing.
        requestNodes.forEach((node) => {
          ctx.beginPath();
          ctx.moveTo(node.xFrac * width, node.yFrac * height);
          ctx.lineTo(hubX, hubY);
          ctx.strokeStyle = `rgba(${accentRgb}, 0.14)`;
          ctx.lineWidth = 1;
          ctx.stroke();
        });

        // "Received" rings — two, half a cycle apart, expanding out from the
        // hub and fading as they grow, reading as a live endpoint rather
        // than a static dot.
        const RING_PERIOD = 2.6;
        [0, RING_PERIOD / 2].forEach((phaseOffset) => {
          const ringT = ((clock + phaseOffset) % RING_PERIOD) / RING_PERIOD;
          const ringRadius = 6 + ringT * 46;
          const ringAlpha = (1 - ringT) * 0.35;
          if (ringAlpha <= 0.01) return;
          ctx.beginPath();
          ctx.arc(hubX, hubY, ringRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${accentRgb}, ${ringAlpha.toFixed(3)})`;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        });

        // Request nodes themselves, each a small steady dot, plus its own
        // pulse travelling toward the hub on an independent timer — never
        // in lockstep, since real traffic never arrives all at once.
        requestNodes.forEach((node) => {
          const nx = node.xFrac * width;
          const ny = node.yFrac * height;
          ctx.beginPath();
          ctx.arc(nx, ny, 2.4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${accentRgb}, 0.4)`;
          ctx.fill();

          node.t += node.speed * dt;
          if (node.t > 1 + node.delay) node.t = -node.delay;
          const travel = Math.max(Math.min(node.t, 1), 0);
          if (node.t >= 0) {
            const eased = travel * travel * (3 - 2 * travel); // smoothstep
            const px = nx + (hubX - nx) * eased;
            const py = ny + (hubY - ny) * eased;
            const fade = Math.min(travel / 0.15, 1, (1 - travel) / 0.15);
            const alpha = Math.max(fade, 0) * 0.9;
            if (alpha > 0.01) {
              const dot = ctx.createRadialGradient(px, py, 0, px, py, 5);
              dot.addColorStop(0, `rgba(${accentRgb}, ${alpha.toFixed(3)})`);
              dot.addColorStop(1, 'rgba(0, 0, 0, 0)');
              ctx.fillStyle = dot;
              ctx.beginPath();
              ctx.arc(px, py, 5, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        });

        // The hub itself — a steady core plus a slow breathing glow, the
        // one thing every request node's pulse converges on.
        const hubGlowAlpha = 0.5 + Math.sin(clock * 1.4) * 0.08;
        const hubGlow = ctx.createRadialGradient(hubX, hubY, 0, hubX, hubY, 20);
        hubGlow.addColorStop(0, `rgba(${accentRgb}, ${hubGlowAlpha.toFixed(3)})`);
        hubGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = hubGlow;
        ctx.beginPath();
        ctx.arc(hubX, hubY, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(hubX, hubY, 3.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${accentRgb}, 0.95)`;
        ctx.fill();
      }
    };

    if (reduceMotion) {
      drawFrame(0);
      return () => window.removeEventListener('resize', resize);
    }

    let lastTime = performance.now();
    const animate = (now) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05); // seconds, clamped
      lastTime = now;
      offset += dt * 0.7;
      clock += dt;
      drawFrame(dt);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [signature]);

  return <canvas ref={canvasRef} className="absolute inset-0" aria-hidden="true" />;
};

export default HeroCanvas;
