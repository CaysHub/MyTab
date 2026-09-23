(() => {
  const canvas = document.getElementById('geometry-canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const linkDistance = 142;
  const mouseDistance = 180;
  let width = 0;
  let height = 0;
  let frameInterval = 1000 / 30;
  let particles = [];
  let ripples = [];
  let pointer = null;
  let frame = 0;
  let lastFrame = 0;

  function createParticles() {
    const count = Math.max(28, Math.min(100, Math.round(width * height / 12000)));
    const columns = Math.ceil(Math.sqrt(count * width / height));
    const rows = Math.ceil(count / columns);
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    particles = Array.from({ length: count }, (_, index) => {
      const angle = Math.random() * Math.PI * 2;
      const speed = .3 + Math.random() * .3;
      return {
        x: (index % columns + .2 + Math.random() * .6) * cellWidth,
        y: (Math.floor(index / columns) + .2 + Math.random() * .6) * cellHeight,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 1 + Math.random() * .55
      };
    });
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    const largeScreen = width * height > 2000000;
    frameInterval = 1000 / (largeScreen ? 24 : 30);
    const scale = Math.min(window.devicePixelRatio || 1, largeScreen ? 1 : 1.5);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    createParticles();
    draw(performance.now());
  }

  function moveParticles(step) {
    for (const particle of particles) {
      particle.x += particle.vx * step;
      particle.y += particle.vy * step;

      if (pointer) {
        const dx = pointer.x - particle.x;
        const dy = pointer.y - particle.y;
        const distance = Math.hypot(dx, dy);
        if (distance < mouseDistance && distance > 25) {
          const pull = (1 - distance / mouseDistance) * .008 * step;
          particle.x += dx * pull;
          particle.y += dy * pull;
        }
      }

      if (particle.x < 0 || particle.x > width) particle.vx *= -1;
      if (particle.y < 0 || particle.y > height) particle.vy *= -1;
      particle.x = Math.max(0, Math.min(width, particle.x));
      particle.y = Math.max(0, Math.min(height, particle.y));
    }
  }

  function line(a, b, opacity, color = '31, 43, 38') {
    ctx.strokeStyle = `rgba(${color}, ${opacity})`;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function rippleProgress(ripple, time) {
    return Math.min((time - ripple.start) / 1600, 1);
  }

  function drawNetwork() {
    // Nearby-cell lookup keeps line checks local as the viewport grows.
    const cells = new Map();
    const cellSize = linkDistance;
    for (let i = 0; i < particles.length; i++) {
      const particle = particles[i];
      const cellX = Math.floor(particle.x / cellSize);
      const cellY = Math.floor(particle.y / cellSize);
      const key = `${cellX},${cellY}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(i);
    }

    ctx.lineWidth = .8;
    for (let i = 0; i < particles.length; i++) {
      const particle = particles[i];
      const cellX = Math.floor(particle.x / cellSize);
      const cellY = Math.floor(particle.y / cellSize);
      for (let x = cellX - 1; x <= cellX + 1; x++) {
        for (let y = cellY - 1; y <= cellY + 1; y++) {
          for (const otherIndex of cells.get(`${x},${y}`) || []) {
            if (otherIndex <= i) continue;
            const other = particles[otherIndex];
            const dx = particle.x - other.x;
            const dy = particle.y - other.y;
            const distanceSquared = dx * dx + dy * dy;
            if (distanceSquared >= linkDistance * linkDistance) continue;
            const strength = 1 - Math.sqrt(distanceSquared) / linkDistance;
            line(particle, other, Math.pow(strength, 1.25) * .4);
          }
        }
      }

      if (pointer) {
        const dx = particle.x - pointer.x;
        const dy = particle.y - pointer.y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < mouseDistance * mouseDistance) {
          const strength = 1 - Math.sqrt(distanceSquared) / mouseDistance;
          line(particle, pointer, Math.pow(strength, 1.2) * .55, '25, 118, 91');
        }
      }
    }

    for (const particle of particles) {
      let influence = 0;
      if (pointer) {
        const distance = Math.hypot(particle.x - pointer.x, particle.y - pointer.y);
        influence = Math.max(0, 1 - distance / mouseDistance);
      }
      ctx.fillStyle = influence > 0
        ? `rgba(25, 118, 91, ${.55 + influence * .35})`
        : 'rgba(31, 43, 38, .58)';
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius + influence * .65, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawRipples(time) {
    for (const ripple of ripples) {
      const progress = rippleProgress(ripple, time);
      const radius = 2 + progress * 320;
      const fade = 1 - progress;
      const opacity = .85 * fade * fade;
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(25, 118, 91, ${opacity})`;
      ctx.lineWidth = .25 + fade * 1.75;
      ctx.stroke();
    }
    ripples = ripples.filter(ripple => time - ripple.start < 1600);
  }

  function draw(time) {
    ctx.clearRect(0, 0, width, height);
    drawNetwork();
    drawRipples(time);
  }

  function animate(time) {
    const elapsed = time - lastFrame;
    if (elapsed >= frameInterval) {
      lastFrame = time;
      moveParticles(Math.min(elapsed / frameInterval, 1.5));
      draw(time);
    }
    frame = requestAnimationFrame(animate);
  }

  function start() {
    if (document.hidden || frame) return;
    lastFrame = performance.now();
    frame = requestAnimationFrame(animate);
  }

  window.addEventListener('pointermove', event => {
    pointer = { x: event.clientX, y: event.clientY };
  }, { passive: true });
  window.addEventListener('pointerout', event => {
    if (event.relatedTarget) return;
    pointer = null;
  });
  window.addEventListener('pointerdown', event => {
    if (event.target.closest('a, button, input, select, textarea')) return;
    ripples.push({ x: event.clientX, y: event.clientY, start: performance.now() });
    if (ripples.length > 5) ripples.shift();
    start();
  });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else {
      start();
    }
  });

  resize();
  start();
})();
