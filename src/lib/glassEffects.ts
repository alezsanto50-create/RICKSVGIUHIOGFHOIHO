import type React from 'react';

/**
 * Updates CSS custom properties (--mx, --my) on interactive Apple Liquid Glass
 * containers so specular light tracks mouse movement and finger touches smoothly.
 */
export function handleGlassPointerMove(e: React.PointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  el.style.setProperty('--mx', `${x}px`);
  el.style.setProperty('--my', `${y}px`);
}
