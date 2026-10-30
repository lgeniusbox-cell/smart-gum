/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatPad TV - Background Web Worker (OffscreenCanvas)
 * Renders layered parallax particles, soft drifting gradient lights, and theme ambiance
 * completely off the main thread to ensure 60 FPS on low-end TV hardware.
 */

let canvas = null;
let ctx = null;
let width = 0;
let height = 0;
let animationFrameId = null;
let isPaused = false;
let quality = 'high'; // 'high' | 'medium' | 'lite'
let theme = 'neutral'; // 'neutral' | 'child' | 'adult'
let screen = 'boot';

let particles = [];
let gradients = [];

const THEME_PALETTES = {
  neutral: {
    bg: '#07090e',
    accent1: 'rgba(0, 229, 255, 0.12)',
    accent2: 'rgba(163, 230, 53, 0.08)',
    particleColor: 'rgba(0, 229, 255, 0.45)',
    particleGlow: 'rgba(0, 229, 255, 0.2)'
  },
  child: {
    bg: '#090e1f',
    accent1: 'rgba(0, 240, 255, 0.16)',
    accent2: 'rgba(255, 234, 0, 0.14)',
    particleColor: 'rgba(255, 234, 0, 0.55)',
    particleGlow: 'rgba(0, 240, 255, 0.3)'
  },
  adult: {
    bg: '#04060a',
    accent1: 'rgba(0, 210, 255, 0.14)',
    accent2: 'rgba(166, 255, 0, 0.09)',
    particleColor: 'rgba(0, 229, 255, 0.4)',
    particleGlow: 'rgba(166, 255, 0, 0.18)'
  }
};

function initParticles() {
  particles = [];
  gradients = [];

  if (quality === 'lite') {
    return; // Lite mode uses pure static background
  }

  const count = quality === 'high' ? 36 : 16;
  const isChild = theme === 'child';

  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: isChild ? (Math.random() * 5 + 3) : (Math.random() * 3 + 1.5),
      vx: (Math.random() - 0.5) * (isChild ? 0.7 : 0.4),
      vy: (Math.random() - 0.5) * (isChild ? 0.7 : 0.4),
      layer: Math.floor(Math.random() * 3) + 1, // 1 to 3 parallax depth
      alpha: Math.random() * 0.6 + 0.2,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: 0.02 + Math.random() * 0.02
    });
  }

  // 2 large slow drifting light sweeps (radial glow spots)
  gradients.push(
    { x: width * 0.25, y: height * 0.3, radius: width * 0.35, vx: 0.15, vy: 0.1, colorIndex: 1 },
    { x: width * 0.75, y: height * 0.7, radius: width * 0.4, vx: -0.12, vy: -0.08, colorIndex: 2 }
  );
}

function render() {
  if (isPaused || !ctx || width === 0 || height === 0) {
    return;
  }

  const pal = THEME_PALETTES[theme] || THEME_PALETTES.neutral;

  // Base clear
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, width, height);

  if (quality !== 'lite') {
    // 1. Draw drifting light glows
    for (let i = 0; i < gradients.length; i++) {
      const g = gradients[i];
      g.x += g.vx;
      g.y += g.vy;
      if (g.x < 0 || g.x > width) g.vx *= -1;
      if (g.y < 0 || g.y > height) g.vy *= -1;

      const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.radius);
      const color = g.colorIndex === 1 ? pal.accent1 : pal.accent2;
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'transparent');

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }

    // 2. Draw drifting particles with 3 layers of parallax depth
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx * p.layer;
      p.y += p.vy * p.layer;
      p.pulse += p.pulseSpeed;

      // Wrap around edges seamlessly
      if (p.x < -20) p.x = width + 20;
      else if (p.x > width + 20) p.x = -20;
      if (p.y < -20) p.y = height + 20;
      else if (p.y > height + 20) p.y = -20;

      const dynamicAlpha = Math.max(0.1, p.alpha + Math.sin(p.pulse) * 0.2);

      ctx.save();
      ctx.globalAlpha = dynamicAlpha;
      ctx.fillStyle = pal.particleColor;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();

      // Soft glow aura for larger foreground particles
      if (p.layer === 3 && quality === 'high') {
        ctx.fillStyle = pal.particleGlow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // 3. Subtle TV vignette overlay
  const vignette = ctx.createRadialGradient(
    width / 2, height / 2, Math.min(width, height) * 0.45,
    width / 2, height / 2, Math.max(width, height) * 0.75
  );
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  animationFrameId = requestAnimationFrame(render);
}

self.onmessage = function (e) {
  const data = e.data;
  if (!data || !data.type) return;

  switch (data.type) {
    case 'INIT':
      canvas = data.canvas;
      ctx = canvas.getContext('2d', { alpha: false });
      width = data.width || 1920;
      height = data.height || 1080;
      quality = data.quality || 'high';
      theme = data.theme || 'neutral';
      screen = data.screen || 'boot';
      initParticles();
      render();
      break;

    case 'RESIZE':
      width = data.width;
      height = data.height;
      if (canvas) {
        canvas.width = width;
        canvas.height = height;
      }
      initParticles();
      break;

    case 'SET_THEME':
      theme = data.theme || 'neutral';
      initParticles();
      break;

    case 'SET_QUALITY':
      quality = data.quality || 'high';
      initParticles();
      break;

    case 'SET_SCREEN':
      screen = data.screen || 'main';
      break;

    case 'PAUSE':
      isPaused = true;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      break;

    case 'RESUME':
      if (isPaused) {
        isPaused = false;
        render();
      }
      break;
  }
};
