import { BASE } from '../jelly/base.js'
import { SLICE } from '../jelly/constants.js'

let nextId = 1

/** Descritor de peça consumido por <JellyPiece>. */
export function makePiece({ geometry, meta, position, quaternion, linvel = [0, 0, 0], angvel = [0, 0, 0], kick = 0 }) {
  return { id: nextId++, geometry, meta, position, quaternion, linvel, angvel, kick }
}

// Orientação inicial: casca virada para a frente-esquerda, ponta para o fundo-direita.
const YAW = -2.5
export function createInitialPiece() {
  return makePiece({
    geometry: BASE.geometry,
    meta: BASE.meta,
    position: [0, SLICE.thickness / 2 + 0.9, 0], // cai da altura de 0.9 e balança ao pousar
    quaternion: [0, Math.sin(YAW / 2), 0, Math.cos(YAW / 2)],
  })
}
