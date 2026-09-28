import * as THREE from 'three'

// ---------------------------------------------------------------------------
// Dimensões da fatia (unidades de simulação). 1 unidade ≈ 3 cm na escala
// ilustrativa usada pelas estatísticas do painel.
// ---------------------------------------------------------------------------
export const SLICE = {
  radius: 2.35, // raio externo da melancia (a casca fica em r = radius)
  angle: THREE.MathUtils.degToRad(56), // abertura da cunha
  thickness: 0.64, // espessura (eixo Y)
  edgeRadius: 0.17, // arredondamento das arestas (raio da "esfera" de Minkowski)
  apexFillet: 0.05, // arredondamento extra da ponta
  cornerFillet: 0.12, // arredondamento extra dos cantos da casca
}

// Camadas da casca, medidas a partir do raio externo.
export const RIND = {
  green: 0.11, // espessura da casca verde
  cream: 0.3, // início da faixa branca/creme (radius - cream)
}

export const SEED_COUNT = 30

// Escala ilustrativa das estatísticas.
export const UNIT_M = 0.03 // 1 unidade = 3 cm
export const UNIT_CM3 = 3 ** 3 // cm³ por unidade³
export const DENSITY_G_CM3 = 1.3 // "goma" a 1.3 g/cm³

export const GRAVITY = -18 // mais lento que 9.81 m/s² na escala real — legível na tela
export const MAX_PIECES = 48
export const MIN_PIECE_VOLUME = 0.0015 // u³ (~0.08 g) — abaixo disso o corte é ignorado

export const PAPER = '#e4e1db'
