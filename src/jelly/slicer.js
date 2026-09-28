import * as THREE from 'three'
import { Brush, Evaluator, SUBTRACTION, INTERSECTION } from 'three-bvh-csg'
import { analyzeGeometry } from './analyze.js'
import { MIN_PIECE_VOLUME } from './constants.js'

/*
 * CORTE (CSG)
 * -----------
 * Usamos o three-bvh-csg diretamente (é o motor por trás do @react-three/csg).
 * O wrapper declarativo do @react-three/csg foi feito para árvores JSX
 * estáticas (<Geometry><Base/><Subtraction/></Geometry>); aqui o corte é
 * imperativo, em tempo real e encadeado sem limite, então chamar o Evaluator
 * direto é mais simples e mais rápido.
 *
 * Um plano vira um "semiespaço": uma caixa cuja face +Z fica exatamente sobre
 * o plano. Numa única passada:
 *   SUBTRACTION  (peça − caixa) → metade do lado +n
 *   INTERSECTION (peça ∩ caixa) → metade do lado −n
 *
 * A face de corte da caixa é SUBDIVIDIDA em grade. Sem isso a face nova seria
 * triangulada só pela borda (triângulos longos, sem vértices internos) e não
 * conseguiria dobrar quando a gelatina balança no vertex shader.
 */

const evaluator = new Evaluator()
evaluator.attributes = ['position', 'normal']
evaluator.useGroups = false

const Z = new THREE.Vector3(0, 0, 1)
const CELL = 0.085 // tamanho da célula da grade na face de corte

/**
 * Divide `geometry` (espaço local da peça) pelo plano (normal `n`, ponto `p`,
 * ambos locais). Retorna [ladoPositivo, ladoNegativo] com seus metadados, ou
 * null se o plano não gera duas peças válidas.
 */
export function splitGeometry(geometry, meta, n, p) {
  const size = meta.radius * 2 + 0.6
  const segs = Math.min(72, Math.ceil(size / CELL))
  const boxGeometry = new THREE.BoxGeometry(size, size, size, segs, segs, 1)
  boxGeometry.deleteAttribute('uv')

  const a = new Brush(geometry)
  a.updateMatrixWorld()

  const b = new Brush(boxGeometry)
  b.quaternion.setFromUnitVectors(Z, n)
  // Centraliza a caixa na projeção do centro da peça sobre o plano e recua
  // meia caixa: a face +Z fica sobre o plano, o resto no lado −n.
  const d = meta.com.clone().sub(p).dot(n)
  b.position.copy(meta.com).addScaledVector(n, -d).addScaledVector(n, -size / 2)
  b.updateMatrixWorld()

  let results
  try {
    results = evaluator.evaluate(a, b, [SUBTRACTION, INTERSECTION], [new Brush(), new Brush()])
  } catch (err) {
    console.warn('[melon-jelly] CSG falhou, corte ignorado', err)
    return null
  } finally {
    boxGeometry.dispose()
  }

  const parts = results.map((brush) => {
    const g = brush.geometry
    return { geometry: g, meta: g.attributes.position.count >= 12 ? analyzeGeometry(g) : null }
  })

  if (parts.some((part) => !part.meta || part.meta.volume < MIN_PIECE_VOLUME)) {
    parts.forEach((part) => part.geometry.dispose())
    return null
  }
  return parts
}
