import { buildSliceGeometry } from './geometry.js'
import { analyzeGeometry } from './analyze.js'
import { createSharedUniforms, applyVariety } from './material.js'

// A fatia original é construída uma vez e reaproveitada a cada Reiniciar.
export const BASE = buildSliceGeometry()
BASE.meta = analyzeGeometry(BASE.geometry)
BASE.geometry.userData.isBase = true

// Uniforms de cor/sementes compartilhados por todas as peças.
export const sharedUniforms = createSharedUniforms(BASE)
applyVariety(sharedUniforms, 'crimson')
