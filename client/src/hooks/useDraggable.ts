import { useCallback, useEffect, useRef, useState } from "react";

interface Pos {
  x: number;
  y: number;
}

/**
 * Makes an element draggable via mouse / touch. Position is persisted to
 * localStorage under `storageKey` so the user's chosen spot survives reloads.
 *
 * Returns the live position and a `dragHandlers` object you spread onto the
 * element you want to act as a drag handle (typically the same element you
 * position absolutely).
 */
export function useDraggable(storageKey: string, initial?: Pos) {
  const [pos, setPos] = useState<Pos>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw) as Pos;
    } catch { /* ignore */ }
    return initial ?? { x: 0, y: 0 };
  });
  const [dragging, setDragging] = useState(false);

  const offsetRef = useRef<Pos>({ x: 0, y: 0 });

  // Persist debounced via rAF — avoids hammering localStorage during a drag.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(pos));
      } catch { /* quota / private mode */ }
    });
    return () => cancelAnimationFrame(id);
  }, [pos, storageKey]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only start a drag from the primary button (left click) / single touch.
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    offsetRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    setDragging(true);
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    e.preventDefault();
    const next = {
      x: e.clientX - offsetRef.current.x,
      y: e.clientY - offsetRef.current.y,
    };
    // Keep at least 60px of the element on-screen so you can always grab it back.
    const margin = 60;
    next.x = Math.max(-window.innerWidth / 2 + margin,
      Math.min(window.innerWidth / 2 - margin, next.x));
    next.y = Math.max(-window.innerHeight / 2 + margin,
      Math.min(window.innerHeight / 2 - margin, next.y));
    setPos(next);
  }, [dragging]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  }, [dragging]);

  const reset = useCallback(() => setPos({ x: 0, y: 0 }), []);

  return {
    pos,
    dragging,
    reset,
    dragHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
