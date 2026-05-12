"use client";

import { useEffect, useRef } from "react";

export function FuturisticBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let particles: Particle[] = [];
    let gridLines: GridLine[] = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initParticles();
      initGrid();
    };

    interface Particle {
      x: number;
      y: number;
      size: number;
      speedX: number;
      speedY: number;
      opacity: number;
      hue: number;
    }

    interface GridLine {
      y: number;
      speed: number;
      opacity: number;
    }

    function initParticles() {
      if (!canvas) return;
      particles = [];
      const particleCount = Math.floor((canvas.width * canvas.height) / 8000);
      for (let i = 0; i < particleCount; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: Math.random() * 3 + 1,
          speedX: (Math.random() - 0.5) * 0.5,
          speedY: (Math.random() - 0.5) * 0.5,
          opacity: Math.random() * 0.6 + 0.3,
          hue: Math.random() > 0.5 ? 195 : 260, // Cyan or purple
        });
      }
    }

    function initGrid() {
      if (!canvas) return;
      gridLines = [];
      const lineCount = Math.floor(canvas.height / 80);
      for (let i = 0; i < lineCount; i++) {
        gridLines.push({
          y: (i / lineCount) * canvas.height,
          speed: 0.2 + Math.random() * 0.3,
          opacity: 0.06 + Math.random() * 0.08,
        });
      }
    }

    function drawGrid() {
      if (!canvas || !ctx) return;
      // Horizontal grid lines with glow
      gridLines.forEach((line) => {
        ctx.beginPath();
        ctx.strokeStyle = `hsla(195, 100%, 60%, ${line.opacity})`;
        ctx.lineWidth = 1;
        ctx.moveTo(0, line.y);
        ctx.lineTo(canvas.width, line.y);
        ctx.stroke();

        // Update position
        line.y += line.speed;
        if (line.y > canvas.height) {
          line.y = 0;
        }
      });

      // Vertical grid lines (static)
      const verticalSpacing = 100;
      for (let x = 0; x < canvas.width; x += verticalSpacing) {
        ctx.beginPath();
        ctx.strokeStyle = `hsla(260, 80%, 50%, 0.06)`;
        ctx.lineWidth = 1;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
    }

    function drawParticles() {
      if (!canvas || !ctx) return;
      particles.forEach((p) => {
        // Draw glow
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 6);
        gradient.addColorStop(0, `hsla(${p.hue}, 100%, 70%, ${p.opacity})`);
        gradient.addColorStop(1, `hsla(${p.hue}, 100%, 50%, 0)`);
        
        ctx.beginPath();
        ctx.fillStyle = gradient;
        ctx.arc(p.x, p.y, p.size * 6, 0, Math.PI * 2);
        ctx.fill();

        // Draw core
        ctx.beginPath();
        ctx.fillStyle = `hsla(${p.hue}, 100%, 80%, ${p.opacity + 0.3})`;
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

        // Update position
        p.x += p.speedX;
        p.y += p.speedY;

        // Wrap around edges
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
      });
    }

    function drawConnections() {
      if (!ctx) return;
      const connectionDistance = 150;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < connectionDistance) {
            const opacity = (1 - distance / connectionDistance) * 0.25;
            ctx.beginPath();
            ctx.strokeStyle = `hsla(195, 100%, 60%, ${opacity})`;
            ctx.lineWidth = 0.5;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }
    }

    function drawCornerAccents() {
      if (!canvas || !ctx) return;
      // Top-left corner accent
      const gradient1 = ctx.createRadialGradient(0, 0, 0, 0, 0, 400);
      gradient1.addColorStop(0, "hsla(195, 100%, 50%, 0.15)");
      gradient1.addColorStop(0.5, "hsla(195, 100%, 50%, 0.05)");
      gradient1.addColorStop(1, "transparent");
      ctx.fillStyle = gradient1;
      ctx.fillRect(0, 0, 400, 400);

      // Bottom-right corner accent
      const gradient2 = ctx.createRadialGradient(
        canvas.width,
        canvas.height,
        0,
        canvas.width,
        canvas.height,
        400
      );
      gradient2.addColorStop(0, "hsla(260, 100%, 50%, 0.12)");
      gradient2.addColorStop(0.5, "hsla(260, 100%, 50%, 0.04)");
      gradient2.addColorStop(1, "transparent");
      ctx.fillStyle = gradient2;
      ctx.fillRect(canvas.width - 400, canvas.height - 400, 400, 400);
      
      // Top-right subtle accent
      const gradient3 = ctx.createRadialGradient(canvas.width, 0, 0, canvas.width, 0, 250);
      gradient3.addColorStop(0, "hsla(320, 100%, 50%, 0.08)");
      gradient3.addColorStop(1, "transparent");
      ctx.fillStyle = gradient3;
      ctx.fillRect(canvas.width - 250, 0, 250, 250);
    }

    function animate() {
      if (!canvas || !ctx) return;
      // Clear with slight trail effect
      ctx.fillStyle = "hsla(280, 50%, 4%, 0.95)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      drawGrid();
      drawConnections();
      drawParticles();
      drawCornerAccents();

      animationId = requestAnimationFrame(animate);
    }

    resize();
    window.addEventListener("resize", resize);
    animate();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 -z-10 pointer-events-none"
      aria-hidden="true"
    />
  );
}
