import * as THREE from 'three'
import { ConvexHull } from 'three/addons/math/ConvexHull.js'

/*
 * Análise de uma peça: volume, centro de massa, pontos do casco convexo (para
 * achar a "base" da peça a cada frame e testar o traço da faca), pontos do
 * collider do Rapier e raio.
 *
 * Obs.: o three-bvh-csg pode adicionar um índice à geometria quando ela vira
 * Brush, então todo laço aqui trata geometria indexada e não indexada.
 */

// Faces do casco cujas normais diferem até este ângulo viram um único plano no collider.
const PLANE_MERGE_ANGLE = THREE.MathUtils.degToRad(4)

export function triangleCount(geometry) {
  return geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3
}

/** Volume assinado (soma de tetraedros com a origem) de um array de posições. */
export function signedVolume(pos, index) {
  let v6 = 0
  const tris = index ? index.length / 3 : pos.length / 9
  for (let t = 0; t < tris; t++) {
    const a = (index ? index[3 * t] : 3 * t) * 3
    const b = (index ? index[3 * t + 1] : 3 * t + 1) * 3
    const c = (index ? index[3 * t + 2] : 3 * t + 2) * 3
    v6 +=
      pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) -
      pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) +
      pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])
  }
  return v6 / 6
}

export function analyzeGeometry(geometry) {
  const pos = geometry.attributes.position.array
  const index = geometry.index ? geometry.index.array : null
  const tris = triangleCount(geometry)

  let v6 = 0
  const com = new THREE.Vector3()
  for (let t = 0; t < tris; t++) {
    const a = (index ? index[3 * t] : 3 * t) * 3
    const b = (index ? index[3 * t + 1] : 3 * t + 1) * 3
    const c = (index ? index[3 * t + 2] : 3 * t + 2) * 3
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2]
    const bx = pos[b], by = pos[b + 1], bz = pos[b + 2]
    const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2]
    const d = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
    v6 += d
    com.x += d * (ax + bx + cx)
    com.y += d * (ay + by + cy)
    com.z += d * (az + bz + cz)
  }
  const volume = v6 / 6
  if (Math.abs(v6) > 1e-12) com.divideScalar(4 * v6)

  // Pontos únicos → casco convexo (cortes planos de um sólido convexo seguem
  // convexos, então o casco é o collider exato da peça).
  const seen = new Set()
  const unique = []
  for (let i = 0; i < pos.length; i += 3) {
    const key = `${Math.round(pos[i] * 1e4)},${Math.round(pos[i + 1] * 1e4)},${Math.round(pos[i + 2] * 1e4)}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]))
  }

  let hullPoints = unique
  let colliderPoints = null
  try {
    const hull = new ConvexHull().setFromPoints(unique)
    const set = new Set()
    for (const face of hull.faces) {
      let e = face.edge
      do {
        set.add(e.head().point)
        e = e.next
      } while (e !== face.edge)
    }
    if (set.size >= 4) {
      hullPoints = [...set]
      colliderPoints = cleanCollider(hull, hullPoints, com)
    }
  } catch {
    // conjunto degenerado — usa todos os pontos
  }

  let radius = 0
  for (const p of hullPoints) radius = Math.max(radius, p.distanceTo(com))
  const hull = toArray(hullPoints)
  const collider = colliderPoints ? toArray(colliderPoints) : hull

  return { volume, com, hull, collider, radius, triangles: tris }
}

function toArray(points) {
  const out = new Float32Array(points.length * 3)
  points.forEach((p, i) => p.toArray(out, 3 * i))
  return out
}

/*
 * COLLIDER "LIMPO"
 * ----------------
 * O casco que sai do CSG tem faces grandes (a base plana, a face de corte)
 * picadas em dezenas de triângulos quase coplanares, com ruído numérico e
 * pontos quase duplicados. Com ele o Rapier gera o contato com o chão usando
 * só 4 vértices vizinhos de um pedacinho da face de apoio + um ponto de
 * penetração fantasma, e a peça fica balançando sozinha para sempre, mesmo
 * parada e deitada (e o volume do collider chega a errar 20% da malha).
 *
 * Aqui as faces do casco são agrupadas por normal em planos de suporte (normal
 * média ponderada pela área, deslocamento = ponto mais externo naquela
 * direção) e os vértices do collider saem da interseção exata desses
 * semiespaços, calculada pelo casco do conjunto dual. Resultado: faces
 * exatamente planas, sem lascas nem pontos repetidos, e um collider que contém
 * a peça inteira (nas partes curvas ele sobra no máximo alguns décimos de mm).
 */
function cleanCollider(hull, hullPoints, center) {
  const cosMerge = Math.cos(PLANE_MERGE_ANGLE)
  const faces = hull.faces.map((f) => ({ normal: f.normal, area: f.area })).sort((a, b) => b.area - a.area)
  const groups = []
  for (const face of faces) {
    let best = null
    let bestDot = cosMerge
    for (const g of groups) {
      const d = g.seed.dot(face.normal)
      if (d > bestDot) {
        bestDot = d
        best = g
      }
    }
    if (best) best.sum.addScaledVector(face.normal, face.area)
    else groups.push({ seed: face.normal, sum: face.normal.clone().multiplyScalar(face.area) })
  }

  // Plano n·x ≤ d relativo ao centro → ponto dual n / (d − n·c).
  const dual = []
  for (const g of groups) {
    const n = g.sum.normalize()
    let d = -Infinity
    for (const p of hullPoints) d = Math.max(d, n.dot(p))
    const gap = d - n.dot(center)
    if (!(gap > 1e-6)) return null // centro encostado numa face (peça degenerada)
    dual.push(n.clone().divideScalar(gap))
  }

  // Cada face do casco dual é um vértice do poliedro primal.
  const out = []
  for (const f of new ConvexHull().setFromPoints(dual).faces) {
    const v = f.normal.clone().divideScalar(f.constant).add(center)
    if (!out.some((u) => u.distanceToSquared(v) < 1e-12)) out.push(v)
  }

  // Sanidade: o collider não pode espichar para longe da peça.
  let maxR = 0
  let hullR = 0
  for (const v of out) maxR = Math.max(maxR, v.distanceTo(center))
  for (const p of hullPoints) hullR = Math.max(hullR, p.distanceTo(center))
  return out.length >= 4 && maxR < hullR + 0.05 ? out : null
}
