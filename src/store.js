import { create } from 'zustand'
import { createInitialPiece } from './sim/pieces.js'
import { nudgeAll, endGrab, grab } from './sim/registry.js'

/*
 * Estado da UI + lista de peças. As peças ficam aqui (geometria incluída)
 * porque o React precisa montar/desmontar um <JellyPiece> por pedaço. O estado
 * "quente" da física (corpos, molas) vive fora do React, em sim/registry.js.
 */
export const useStore = create((set, get) => ({
  tool: 'hand', // 'hand' | 'knife'
  variety: 'crimson',
  firmness: 0.4,
  damping: 0.45,
  slowMo: false,
  showMesh: false,
  paused: false,
  grabbing: false,

  pieces: [createInitialPiece()],
  stats: { mass: 0, volume: 100, kinetic: 0, pieces: 1 },

  setTool: (tool) => {
    if (grab.active) endGrab()
    set({ tool })
  },
  setVariety: (variety) => set({ variety }),
  setFirmness: (firmness) => set({ firmness }),
  setDamping: (damping) => set({ damping }),
  toggleSlowMo: () => set((s) => ({ slowMo: !s.slowMo })),
  toggleShowMesh: () => set((s) => ({ showMesh: !s.showMesh })),
  togglePaused: () => set((s) => ({ paused: !s.paused })),
  setGrabbing: (grabbing) => set({ grabbing }),
  setStats: (stats) => set({ stats }),

  nudge: () => {
    if (get().paused) set({ paused: false })
    nudgeAll()
  },
  reset: () => {
    if (grab.active) endGrab()
    set({ pieces: [createInitialPiece()] })
  },
  replacePieces: (removedIds, added) =>
    set((s) => ({ pieces: [...s.pieces.filter((p) => !removedIds.has(p.id)), ...added] })),
}))
