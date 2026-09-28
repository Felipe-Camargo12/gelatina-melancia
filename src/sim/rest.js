import * as THREE from 'three'
import { grab } from './registry.js'

/*
 * REPOUSO — põe para dormir a peça que não sai do lugar
 * -----------------------------------------------------
 * O Rapier só adormece um corpo depois de 2 s com a VELOCIDADE abaixo de um
 * limiar. Uma peça apoiada pode ficar presa num tremor do solver de contato
 * (5–15 Hz, ~1 rad/s, alguns graus de amplitude em torno de uma pose fixa):
 * ela nunca atinge o limiar, nunca dorme, e as molas do balanço transformam
 * esse ruído num tremor visível da gelatina, sem ninguém tocar nela.
 *
 * Aqui o critério é a POSE MÉDIA (a pose filtrada com constante de tempo
 * SMOOTH_TIME, que corta o tremor): se ela passou REST_TIME segundos sem se
 * afastar mais que REST_DISTANCE / REST_ANGLE da referência, a peça está
 * parada de fato, seja qual for a velocidade que o solver informa. Ela dorme
 * num frame em que a pose instantânea está na média (para não congelar
 * inclinada no meio de uma oscilação) ou, no máximo, SETTLE_TIMEOUT depois.
 * Um movimento de verdade renova a referência. A peça acorda sozinha quando
 * algo encosta nela, ou pela Mão, pelo peteleco e pela faca.
 */

const SMOOTH_TIME = 0.15 // s
const REST_DISTANCE = 0.012 // u (~2 px na câmera padrão)
const REST_ANGLE = THREE.MathUtils.degToRad(2)
const REST_TIME = 0.4 // s
const SETTLE_DISTANCE = 0.003 // u
const SETTLE_ANGLE = THREE.MathUtils.degToRad(0.5)
const SETTLE_TIMEOUT = 1 // s

const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()

export function createRest() {
  return {
    mean: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() },
    ref: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() },
    time: 0,
    primed: false,
  }
}

const copyPose = (dst, src) => {
  dst.position.copy(src.position)
  dst.quaternion.copy(src.quaternion)
}

export function stepRest(entry, dt) {
  const body = entry.body
  const rest = entry.rest
  if (body.isSleeping() || (grab.active && grab.id === entry.id)) {
    rest.primed = false
    return
  }
  const t = body.translation()
  const r = body.rotation()
  _p.set(t.x, t.y, t.z)
  _q.set(r.x, r.y, r.z, r.w)
  const { mean, ref } = rest
  if (!rest.primed) {
    mean.position.copy(_p)
    mean.quaternion.copy(_q)
    copyPose(ref, mean)
    rest.time = 0
    rest.primed = true
    return
  }

  const k = 1 - Math.exp(-dt / SMOOTH_TIME)
  mean.position.lerp(_p, k)
  mean.quaternion.slerp(_q, k)
  if (ref.position.distanceTo(mean.position) > REST_DISTANCE || ref.quaternion.angleTo(mean.quaternion) > REST_ANGLE) {
    copyPose(ref, mean)
    rest.time = 0
    return
  }

  rest.time += dt
  if (rest.time < REST_TIME) return
  const settled = mean.position.distanceTo(_p) < SETTLE_DISTANCE && mean.quaternion.angleTo(_q) < SETTLE_ANGLE
  if (settled || rest.time >= REST_TIME + SETTLE_TIMEOUT) body.sleep()
}
