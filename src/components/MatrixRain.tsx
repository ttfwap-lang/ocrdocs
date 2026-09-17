/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Purely decorative background. Renders random glyphs falling down a canvas —
 * classic "matrix rain." This component receives no props, reads no
 * application state, and calls no API. It must never be used to display
 * anything that could be mistaken for real telemetry, logs, or extraction
 * output — see this project's history of exactly that mistake with fabricated
 * "live" UI. It is decoration, full stop, and is marked aria-hidden.
 */

import React, { useEffect, useRef } from 'react';

const GLYPHS = 'アイウエオカキクケコサシスセソ01アイウエオ$#@%&アイウエオ0123456789'.split('');

export const MatrixRain: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const fontSize = 15;
    let columns = Math.floor(width / fontSize);
    let drops = new Array(columns).fill(0).map(() => Math.floor((Math.random() * height) / fontSize));

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      columns = Math.floor(width / fontSize);
      drops = new Array(columns).fill(0).map(() => Math.floor((Math.random() * height) / fontSize));
    };
    window.addEventListener('resize', handleResize);

    let frameId: number;
    let lastTime = 0;
    const frameInterval = 55; // ms between steps — keeps it decorative, not distracting

    const tick = (time: number) => {
      frameId = requestAnimationFrame(tick);
      if (time - lastTime < frameInterval) return;
      lastTime = time;

      ctx.fillStyle = 'rgba(3, 4, 5, 0.09)';
      ctx.fillRect(0, 0, width, height);

      ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
      for (let i = 0; i < drops.length; i++) {
        const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;

        ctx.fillStyle = 'rgba(0, 255, 65, 0.85)';
        ctx.fillText(glyph, x, y);

        if (y > height && Math.random() > 0.975) {
          drops[i] = 0;
        } else {
          drops[i]++;
        }
      }
    };
    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 z-0 pointer-events-none opacity-[0.12]"
    />
  );
};
