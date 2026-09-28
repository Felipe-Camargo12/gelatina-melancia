import * as THREE from 'three'
import { registry, grab, endGrab } from './registry.js'
import { makePiece } from './pieces.js'
import { splitGeometry } from '../jelly/slicer.js'
import { MAX_PIECES } from '../jelly/constants.js'
import { useStore } from '../store.js'

/*
 * Faca: o traço desenhado vira um plano VERTICAL (contém o eixo Y) — como
 * uma faca de verdade descendo sobre a mesa.
 *
 * O CSG é caro (~40–120 ms por peça), então fazemos em duas fases:
 *   prepareCut() — ao soltar o mouse: testa quais peças o segmento atravessa e
 *                  já calcula as metades no espaço local de cada peça.
 *   commitCut()  — quando a lâmina chega na gelatina: troca cada peça pelas
 *                  metades, na pose ATUAL do corpo (a geometria está no espaço
 *                  local, então elas nascem exatamente onde a peça estava).
 *
 * PRÓXIMO PASSO DE PERFORMANCE: mover prepareCut para um Web Worker (o
 * three-bvh-csg traz utilitários em three-bvh-csg/src/workers) e transferir os
 * buffers de volta — a faca desce enquanto o worker calcula.
 */

const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _w = new THREE.Vector3()

export function prepareCut(a, b) {
  const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z)
  const len = dir.length()
  if (len < 0.2) return []
  dir.divideScalar(len)
  const n = new THREE.Vector3(-dir.z, 0, dir.x) // normal horizontal do plano

  const jobs = []
  let count = useStore.getState().pieces.length
  for (const entry of registry.values()) {
    if (count >= MAX_PIECES) break
    const t = entry.body.translation()
    const r = entry.body.rotation()
    _p.set(t.x, t.y, t.z)
    _q.set(r.x, r.y, r.z, r.w)

    // O segmento atravessa a peça? (pontos do casco dos dois lados do plano e
    // sobreposição com o trecho desenhado ao longo da linha)
    const hull = entry.meta.hull
    let minD = Infinity, maxD = -Infinity, minT = Infinity, maxT = -Infinity
    for (let i = 0; i < hull.length; i += 3) {
      _w.set(hull[i], hull[i + 1], hull[i + 2]).applyQuaternion(_q).add(_p).sub(a)
      const d = _w.x * n.x + _w.z * n.z
      const tt = _w.x * dir.x + _w.z * dir.z
      if (d < minD) minD = d
      if (d > maxD) maxD = d
      if (tt < minT) minT = tt
      if (tt > maxT) maxT = tt
    }
    if (minD > -0.02 || maxD < 0.02) continue
    if (maxT < -0.05 || minT > len + 0.05) continue

    // Plano → espaço local da peça.
    _q.invert()
    const nLocal = n.clone().applyQuaternion(_q)
    const pLocal = a.clone().sub(_p).applyQuaternion(_q)
    const parts = splitGeometry(entry.geometry, entry.meta, nLocal, pLocal)
    if (!parts) continue
    jobs.push({ id: entry.id, parts, n: n.clone() })
    count += 1
  }
  return jobs
}

export function commitCut(jobs) {
  const removed = new Set()
  const added = []
  for (const job of jobs) {
    const entry = registry.get(job.id)
    if (!entry) {
      // a peça sumiu no meio do caminho (Reset) — descarta
      job.parts.forEach((part) => part.geometry.dispose())
      continue
    }
    if (grab.active && grab.id === job.id) endGrab()
    const body = entry.body
    const t = body.translation()
    const r = body.rotation()
    const lv = body.linvel()
    const av = body.angvel()
    job.parts.forEach((part, i) => {
      const s = i === 0 ? 1 : -1 // parts[0] fica do lado +n
      added.push(
        makePiece({
          geometry: part.geometry,
          meta: part.meta,
          position: [t.x, t.y, t.z],
          quaternion: [r.x, r.y, r.z, r.w],
          // a lâmina afasta as metades e dá um pulinho para vencer o atrito
          linvel: [lv.x + job.n.x * s * 0.8, lv.y + 0.7, lv.z + job.n.z * s * 0.8],
          angvel: [av.x + job.n.z * s * 0.5, av.y, av.z - job.n.x * s * 0.5],
          kick: 1,
        }),
      )
    })
    removed.add(job.id)
  }
  if (removed.size) useStore.getState().replacePieces(removed, added)
  return removed.size
}
