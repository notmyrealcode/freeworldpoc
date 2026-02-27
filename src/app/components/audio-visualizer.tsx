"use client";

import { useRef, useEffect, useCallback } from "react";

interface AudioVisualizerProps {
  voiceStatus: "listening" | "processing" | "speaking";
  getFrequencyData: (() => Uint8Array | null) | null;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const SIDES_TRIANGLE = 3;
const SIDES_CIRCLE = 64;
const BASE_RADIUS = 60;
const CANVAS_SIZE = 200;
const LERP_FACTOR = 0.05;

const COLOR_GREEN = { r: 34, g: 197, b: 94, a: 0.6 };
const COLOR_BLUE = { r: 59, g: 130, b: 246, a: 0.6 };
const COLOR_AMBER = { r: 245, g: 158, b: 11, a: 0.5 };

interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

function lerpColor(from: RGBA, to: RGBA, t: number): RGBA {
  return {
    r: lerp(from.r, to.r, t),
    g: lerp(from.g, to.g, t),
    b: lerp(from.b, to.b, t),
    a: lerp(from.a, to.a, t),
  };
}

function rgbaString(c: RGBA): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${c.a.toFixed(3)})`;
}

function shadowColorForStatus(c: RGBA): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, 0.8)`;
}

function getTargetColor(status: "listening" | "processing" | "speaking"): RGBA {
  switch (status) {
    case "listening":
      return COLOR_GREEN;
    case "speaking":
      return COLOR_BLUE;
    case "processing":
      return COLOR_AMBER;
  }
}

function getTargetSides(
  status: "listening" | "processing" | "speaking",
  currentSides: number
): number {
  switch (status) {
    case "listening":
      return SIDES_TRIANGLE;
    case "speaking":
      return SIDES_CIRCLE;
    case "processing":
      return currentSides;
  }
}

export function AudioVisualizer({
  voiceStatus,
  getFrequencyData,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);

  // Animation state stored in refs to avoid re-renders
  const stateRef = useRef({
    currentSides: voiceStatus === "speaking" ? SIDES_CIRCLE : SIDES_TRIANGLE,
    currentRadius: BASE_RADIUS,
    currentRotation: 0,
    currentColor: getTargetColor(voiceStatus),
    currentShadowBlur: 20,
    startTime: performance.now(),
  });

  const voiceStatusRef = useRef(voiceStatus);
  voiceStatusRef.current = voiceStatus;

  const getFrequencyDataRef = useRef(getFrequencyData);
  getFrequencyDataRef.current = getFrequencyData;

  const drawPolygon = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      radius: number,
      sides: number,
      rotation: number,
      color: RGBA,
      shadowBlur: number
    ) => {
      ctx.save();

      ctx.shadowBlur = shadowBlur;
      ctx.shadowColor = shadowColorForStatus(color);
      ctx.fillStyle = rgbaString(color);

      ctx.beginPath();

      // For non-integer side counts, we render floor(sides) full segments
      // and interpolate the last partial vertex for smooth morphing
      const fullSides = Math.floor(sides);
      const fractional = sides - fullSides;
      const totalVertices = fractional > 0.01 ? fullSides + 1 : fullSides;

      for (let i = 0; i <= totalVertices; i++) {
        let angle: number;
        if (i < fullSides) {
          angle = (i / sides) * Math.PI * 2 + rotation;
        } else if (fractional > 0.01 && i === fullSides) {
          // Partial vertex: interpolate between the last full vertex angle
          // and what would be the closing angle
          angle = (fullSides / sides) * Math.PI * 2 + rotation;
        } else {
          break;
        }

        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.closePath();
      ctx.fill();

      ctx.restore();
    },
    []
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_SIZE * dpr;
    canvas.height = CANVAS_SIZE * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);

    const state = stateRef.current;
    state.startTime = performance.now();

    const animate = () => {
      const now = performance.now();
      const elapsed = (now - state.startTime) / 1000; // seconds

      const status = voiceStatusRef.current;
      const freqFn = getFrequencyDataRef.current;

      // Clear canvas
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Reset the transform and reapply DPR scaling since clearRect doesn't
      // affect it, but shadowBlur etc. persist across frames
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // --- Determine targets ---
      const targetSides = getTargetSides(status, state.currentSides);
      const targetColor = getTargetColor(status);

      // --- Lerp sides ---
      state.currentSides = lerp(state.currentSides, targetSides, LERP_FACTOR);
      // Clamp to avoid floating point drift below 3 or above 64
      state.currentSides = Math.max(
        SIDES_TRIANGLE,
        Math.min(SIDES_CIRCLE, state.currentSides)
      );

      // --- Lerp color ---
      state.currentColor = lerpColor(
        state.currentColor,
        targetColor,
        LERP_FACTOR
      );

      // --- Compute radius ---
      let targetRadius = BASE_RADIUS;
      let targetShadowBlur = 20;

      if (status === "listening") {
        // Gentle breathing: oscillate radius with sin
        const breathe = Math.sin(elapsed * 1.5) * 5;
        targetRadius = BASE_RADIUS + breathe;
        targetShadowBlur = 20;

        // Slow continuous rotation
        state.currentRotation += 0.008;
      } else if (status === "speaking") {
        // Radius driven by audio frequency data
        let avgEnergy = 0;
        if (freqFn) {
          try {
            const data = freqFn();
            if (data && data.length > 0) {
              let sum = 0;
              const bins = Math.min(data.length, 16);
              for (let i = 0; i < bins; i++) {
                sum += data[i];
              }
              avgEnergy = sum / bins;
            }
          } catch {
            // getFrequencyData may not be ready yet
            avgEnergy = 0;
          }
        }

        targetRadius = BASE_RADIUS + (avgEnergy / 255) * 30;
        targetShadowBlur = 10 + (avgEnergy / 255) * 30;

        // No rotation for circle (it's rotationally symmetric)
        // But slowly reduce rotation offset if coming from triangle
        state.currentRotation = lerp(state.currentRotation, 0, 0.02);
      } else {
        // Processing: very subtle pulse, hold shape
        const subtlePulse = Math.sin(elapsed * 2) * 2;
        targetRadius = BASE_RADIUS + subtlePulse;
        targetShadowBlur = 15;

        // Freeze rotation (don't change it)
      }

      // --- Lerp radius and shadow for smoothness ---
      state.currentRadius = lerp(state.currentRadius, targetRadius, 0.1);
      state.currentShadowBlur = lerp(
        state.currentShadowBlur,
        targetShadowBlur,
        0.1
      );

      // --- Draw ---
      const cx = CANVAS_SIZE / 2;
      const cy = CANVAS_SIZE / 2;

      drawPolygon(
        ctx,
        cx,
        cy,
        state.currentRadius,
        state.currentSides,
        state.currentRotation,
        state.currentColor,
        state.currentShadowBlur
      );

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [drawPolygon]);

  return (
    <canvas
      ref={canvasRef}
      className="w-[200px] h-[200px]"
      style={{ background: "transparent" }}
    />
  );
}
