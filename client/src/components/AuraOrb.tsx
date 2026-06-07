import { useEffect, useRef } from "react";
import { useDraggable } from "../hooks/useDraggable";

interface Props {
  accent: string;
  level: number;        // 0..1 — current audio amplitude
  speaking: boolean;    // bot is currently speaking
  listening: boolean;   // user is currently speaking
  connected: boolean;
  preparing?: boolean;  // connected, but agent hasn't spoken its first audio yet
  onTap?: () => void;   // single tap (no drag) — e.g. start/end session
  size?: "sm" | "lg";
}

/**
 * Aurora-style audio orb. Multiple layered gradient blobs slowly counter-rotate
 * to create an organic, cloud-like feel. When audio is flowing, the orb pulses
 * with the level and emits expanding wave rings; sparkle particles drift
 * around it constantly.
 *
 * Drag to reposition. Single click = onTap. Double-click = recenter.
 */
export default function AuraOrb({
  accent,
  level,
  speaking,
  listening,
  connected,
  preparing = false,
  onTap,
  size = "lg",
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const downAtRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const { pos, dragging, reset, dragHandlers } = useDraggable("aura.orbPos", {
    x: 0,
    y: 0,
  });

  // Smooth audio amplitude → CSS var so the orb pulses but doesn't jitter.
  const smoothed = useRef(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      smoothed.current = smoothed.current * 0.82 + level * 0.18;
      const el = ref.current;
      if (el) {
        const v = speaking ? smoothed.current : 0;
        el.style.setProperty("--bot-level", String(v));
        el.style.setProperty(
          "--listen",
          listening ? String(0.4 + smoothed.current * 0.6) : "0"
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [level, speaking, listening]);

  // Distinguish a tap from a drag — short distance & short duration.
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    downAtRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    dragHandlers.onPointerDown(e);
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragHandlers.onPointerUp(e);
    const start = downAtRef.current;
    downAtRef.current = null;
    if (!start || !onTap) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dt = Date.now() - start.t;
    if (Math.hypot(dx, dy) < 6 && dt < 250) {
      onTap();
    }
  };

  return (
    <div
      ref={ref}
      className={[
        "aura",
        `aura--${size}`,
        connected ? "aura--connected" : "",
        preparing ? "aura--preparing" : "",
        speaking ? "aura--speaking" : "",
        listening ? "aura--listening" : "",
        dragging ? "aura--dragging" : "",
      ].join(" ")}
      style={{
        ["--accent" as string]: accent,
        transform: `translate(${pos.x}px, ${pos.y}px)`,
        cursor: dragging ? "grabbing" : "pointer",
        touchAction: "none",
      }}
      onDoubleClick={reset}
      title="Tap to talk · Drag to move · Double-click to recenter"
      {...dragHandlers}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      {/* Soft outer halo */}
      <div className="aura__halo" />

      {/* Three counter-rotating gradient blobs build the aurora cloud */}
      <div className="aura__blob aura__blob--1" />
      <div className="aura__blob aura__blob--2" />
      <div className="aura__blob aura__blob--3" />

      {/* Glassy core */}
      <div className="aura__core" />
      <div className="aura__core-shine" />

      {/* Expanding wave rings while speaking */}
      <div className="aura__wave aura__wave--a" />
      <div className="aura__wave aura__wave--b" />

      {/* Rotating arc while the agent warms up (preparing) */}
      <div className="aura__prepare-ring" />

      {/* Listener ring while user talks */}
      <div className="aura__listen-ring" />

      {/* Drifting sparkles */}
      <div className="aura__sparkles">
        {Array.from({ length: 12 }).map((_, i) => (
          <span key={i} className={`aura__spark aura__spark--${i % 6}`} />
        ))}
      </div>
    </div>
  );
}
