import type { Entity } from '@forge/contracts';
import type { ReactNode, SVGProps } from 'react';

/** FORGE's own glyph set: 14px grid, square caps, 1.25 stroke. Deliberately not a stock icon pack. */
const G = ({ children, ...p }: SVGProps<SVGSVGElement> & { children: ReactNode }) => (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="square" {...p}>
    {children}
  </svg>
);

export const Glyph = {
  box: () => <G><path d="M2.5 4.5 7 2l4.5 2.5v5L7 12l-4.5-2.5z" /><path d="M2.5 4.5 7 7l4.5-2.5M7 7v5" /></G>,
  sphere: () => <G><circle cx="7" cy="7" r="4.6" /><path d="M2.4 7c1.4 1.4 7.8 1.4 9.2 0" /></G>,
  cylinder: () => <G><ellipse cx="7" cy="3.5" rx="4" ry="1.5" /><path d="M3 3.5v7c0 .8 1.8 1.5 4 1.5s4-.7 4-1.5v-7" /></G>,
  plane: () => <G><path d="M1.5 9 6 5.5h6.5L8 9z" /></G>,
  light: () => <G><circle cx="7" cy="6" r="2.6" /><path d="M5.6 10.5h2.8M7 1v1.2M2.2 6H1m12 0h-1.2M3.6 2.6l.8.8m6.4-.8-.8.8" /></G>,
  sun: () => <G><circle cx="7" cy="7" r="2.4" /><path d="M7 1v1.6M7 11.4V13M1 7h1.6m8.8 0H13M2.8 2.8l1.1 1.1m6.2 6.2 1.1 1.1m0-8.4-1.1 1.1M3.9 10.1l-1.1 1.1" /></G>,
  spot: () => <G><path d="M5 2h4l-.8 3H5.8z" /><path d="M5.8 5 2.5 12h9L8.2 5" strokeDasharray="1.5 1.5" /></G>,
  spawn: () => <G><path d="M7 12.5s-4-3.6-4-6.7a4 4 0 0 1 8 0c0 3.1-4 6.7-4 6.7z" /><path d="M7 4v3.5M5.3 5.8h3.4" /></G>,
  trigger: () => <G strokeDasharray="1.6 1.4"><rect x="2" y="2" width="10" height="10" /></G>,
  door: () => <G><path d="M3 12.5V1.5h8v11M1.5 12.5h11" /><path d="M8.6 7h.01" strokeWidth={2} /></G>,
  pickup: () => <G><path d="M7 1.8 12 7l-5 5.2L2 7z" /><path d="M7 4.6 9.4 7 7 9.4 4.6 7z" /></G>,
  group: () => <G><path d="M1.5 3.5h4l1.2 1.5h5.8v6.5h-11z" /></G>,
  terminal: () => <G><rect x="1.5" y="2.5" width="11" height="9" /><path d="m4 6 1.8 1.4L4 8.8M7.5 9h2.5" /></G>,
  eye: () => <G><path d="M1 7s2.4-4 6-4 6 4 6 4-2.4 4-6 4-6-4-6-4z" /><circle cx="7" cy="7" r="1.6" /></G>,
  eyeOff: () => <G><path d="M1 7s2.4-4 6-4 6 4 6 4-2.4 4-6 4-6-4-6-4zM2 12 12 2" /></G>,
  lock: () => <G><rect x="2.5" y="6.5" width="9" height="6" /><path d="M4.5 6.5V4.5a2.5 2.5 0 0 1 5 0v2" /></G>,
  unlock: () => <G><rect x="2.5" y="6.5" width="9" height="6" /><path d="M4.5 6.5V4.5a2.5 2.5 0 0 1 4.8-1" /></G>,
  plus: () => <G><path d="M7 2v10M2 7h10" /></G>,
  close: () => <G><path d="m3 3 8 8M11 3l-8 8" /></G>,
  play: () => <G><path d="M4 2.5v9l7.5-4.5z" /></G>,
  undo: () => <G><path d="M4.5 2 1.5 5l3 3" /><path d="M1.5 5h7a3.5 3.5 0 0 1 0 7H5" /></G>,
  redo: () => <G><path d="m9.5 2 3 3-3 3" /><path d="M12.5 5h-7a3.5 3.5 0 0 0 0 7H9" /></G>,
  frame: () => <G><path d="M1.5 4.5v-3h3m5 0h3v3m0 5v3h-3m-5 0h-3v-3" /><circle cx="7" cy="7" r="1.4" /></G>,
  move: () => <G><path d="M7 1v12M1 7h12M7 1 5.4 2.6M7 1l1.6 1.6M7 13l-1.6-1.6M7 13l1.6-1.6M1 7l1.6-1.6M1 7l1.6 1.6M13 7l-1.6-1.6M13 7l-1.6 1.6" /></G>,
  rotate: () => <G><path d="M11.6 5.2A5 5 0 1 0 12 8" /><path d="M12 2.2v3h-3" /></G>,
  scale: () => <G><rect x="1.5" y="6.5" width="6" height="6" /><path d="M7 1.5h5.5V7M12.5 1.5 8 6" /></G>,
  magnet: () => <G><path d="M3 2v5a4 4 0 0 0 8 0V2" /><path d="M3 4.5h2.4M8.6 4.5H11" /></G>,
  capture: () => <G><rect x="1.5" y="3.5" width="11" height="8" /><circle cx="7" cy="7.5" r="2.2" /><path d="M4.5 3.5 5.5 2h3l1 1.5" /></G>,
};

export function glyphFor(e: Entity): () => ReactNode {
  const c = e.components;
  if (c.spawnPoint) return Glyph.spawn;
  if (c.interactable?.verb === 'open' || e.tags.includes('door')) return Glyph.door;
  if (c.interactable?.verb === 'pickup') return Glyph.pickup;
  if (c.interactable?.verb === 'use') return Glyph.terminal;
  if (c.light && !c.mesh) {
    if (c.light.kind === 'directional' || c.light.kind === 'hemisphere') return Glyph.sun;
    if (c.light.kind === 'spot') return Glyph.spot;
    return Glyph.light;
  }
  if (c.collider?.isTrigger && !c.mesh) return Glyph.trigger;
  if (c.mesh) {
    if (c.mesh.shape === 'sphere' || c.mesh.shape === 'torus') return Glyph.sphere;
    if (c.mesh.shape === 'cylinder' || c.mesh.shape === 'capsule' || c.mesh.shape === 'cone') return Glyph.cylinder;
    if (c.mesh.shape === 'plane') return Glyph.plane;
    return Glyph.box;
  }
  return Glyph.group;
}
