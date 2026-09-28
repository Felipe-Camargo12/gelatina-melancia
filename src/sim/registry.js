import * as THREE from 'three'
import { useStore } from '../store.js'
import { UNIT_CM3, UNIT_M, DENSITY_G_CM3 } from '../jelly/constants.js'
import { deformedVolume, isDeformed } from './wobble.js'

/*
 * Registro das peças vivas (fora do React). Cada <JellyPiece> se registra ao
 * montar com: corpo do Rapier, metadados da geometria, uniforms e estado das
 * molas. A simulação, a mão, a faca e as estatísticas leem daqui.
 */
export const registry = new Map()

export const ANGULAR_DAMPING = 0.35

// Estado da ferramenta Mão.
export const grab = {
  active: false,
  id: null,
  local: new THREE.Vector3(), // ponto agarrado no espaço local da peça
  plane: new THREE.Plane(), // plano de arraste (de frente para a câmera)
  ndc: new THREE.Vector2(), // ponteiro em NDC
  target: new THREE.Vector3(), // alvo no mundo
  twist: 0, // impulso de torção acumulado pela rodinha ou pelo segundo dedo (rad/s)
  pointerId: null, // ponteiro que agarrou (outro dedo na tela torce em vez de puxar)
}

const _q = new THREE.Quaternion()
const _dir = new THREE.Vector3()

export function beginGrab(entry, point, camera, ndc, pointerId) {
  const body = entry.body
  const t = body.translation()
  const r = body.rotation()
  _q.set(r.x, r.y, r.z, r.w).invert()
  grab.local.set(point.x - t.x, point.y - t.y, point.z - t.z).applyQuaternion(_q)
  camera.getWorldDirection(_dir).negate()
  grab.plane.setFromNormalAndCoplanarPoint(_dir, point)
  grab.ndc.copy(ndc)
  grab.target.copy(point)
  grab.twist = 0
  grab.active = true
  grab.id = entry.id
  grab.pointerId = pointerId

  entry.wobble.grabLocal.copy(grab.local)
  entry.wobble.grabRadius = THREE.MathUtils.clamp(entry.meta.radius * 0.7, 0.3, 0.9)
  body.setAngularDamping(3)
  body.wakeUp()
  useStore.getState().setGrabbing(true)
}

export function endGrab() {
  const entry = registry.get(grab.id)
  if (entry) {
    entry.wobble.Dtarget.set(0, 0, 0)
    entry.body.setAngularDamping(ANGULAR_DAMPING)
  }
  grab.active = false
  grab.id = null
  useStore.getState().setGrabbing(false)
}

/** "Dar um peteleco": um peteleco em cada peça + excitação direta das molas. */
export function nudgeAll() {
  for (const entry of registry.values()) {
    const body = entry.body
    const m = body.mass()
    const com = body.worldCom()
    const ang = Math.random() * Math.PI * 2
    const hx = Math.cos(ang)
    const hz = Math.sin(ang)
    body.applyImpulseAtPoint(
      { x: hx * 0.6 * m, y: 2.6 * m, z: hz * 0.6 * m },
      { x: com.x - hx * 0.2, y: com.y, z: com.z - hz * 0.2 },
      true,
    )
    entry.wobble.swayV.x += hx * 2.2
    entry.wobble.swayV.z += hz * 2.2
    entry.wobble.squashV -= 1.5
  }
}

// ----------------------------------------------------------------- estatísticas
const G_PER_U3 = UNIT_CM3 * DENSITY_G_CM3
const KG_PER_U3 = G_PER_U3 / 1000
const _w = new THREE.Vector3()
const _fq = new THREE.Quaternion()

/**
 * Massa, volume relativo (deformado ÷ repouso) e energia cinética em µJ
 * (translação + rotação dos corpos + energia interna aproximada das molas).
 */
export function computeStats() {
  let rest = 0
  let current = 0
  let ke = 0
  for (const entry of registry.values()) {
    const { body, meta, wobble: w } = entry
    rest += meta.volume
    current += isDeformed(entry) ? deformedVolume(entry) : meta.volume

    const mKg = meta.volume * KG_PER_U3
    const v = body.linvel()
    ke += 0.5 * mKg * (v.x * v.x + v.y * v.y + v.z * v.z) * UNIT_M * UNIT_M

    // rotação: ½ ωᵀIω no referencial principal de inércia
    const av = body.angvel()
    const I = body.principalInertia()
    const fr = body.principalInertiaLocalFrame()
    const r = body.rotation()
    _fq.set(r.x, r.y, r.z, r.w).multiply(_q.set(fr.x, fr.y, fr.z, fr.w)).invert()
    _w.set(av.x, av.y, av.z).applyQuaternion(_fq)
    const rot = I.x * _w.x * _w.x + I.y * _w.y * _w.y + I.z * _w.z * _w.z // densidade 1 → u⁵
    ke += 0.5 * rot * KG_PER_U3 * UNIT_M * UNIT_M

    // interna (aproximada): cada modo como uma massa efetiva oscilando
    const H = 2 * meta.radius
    const internal = (w.swayV.lengthSq() + w.squashV * w.squashV + w.twistV * w.twistV * meta.radius * meta.radius) * (H * H) / 12 + 0.15 * w.DV.lengthSq()
    ke += 0.5 * mKg * internal * UNIT_M * UNIT_M
  }
  return {
    mass: rest * G_PER_U3,
    volume: rest > 0 ? (100 * current) / rest : 100,
    kinetic: ke * 1e6,
    pieces: registry.size,
  }
}
