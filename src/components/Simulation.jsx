import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { useStore } from '../store.js'
import { registry, grab, endGrab, computeStats } from '../sim/registry.js'
import { springParams, stepWobble, writeUniforms } from '../sim/wobble.js'
import { stepRest } from '../sim/rest.js'
import { GRAVITY } from '../jelly/constants.js'

/*
 * Laço principal da simulação. O <Physics> fica `paused` e nós mesmos
 * chamamos step(): assim controlamos câmera lenta (Velocidade ¼), pausa e a ordem
 * exata de cada frame:
 *
 *   1. forças da Mão (mola ponteiro → ponto agarrado), por subpasso
 *   2. step do Rapier (subpassos de ≤ 1/120 s)
 *   3. molas do balanço (sim/wobble.js), forçadas pela aceleração resultante dos corpos
 *   4. repouso: peças que não saem do lugar vão dormir (sim/rest.js)
 *   5. uniforms de deformação → shader
 *   6. estatísticas (~8 Hz) → painel
 */

const SUBSTEP = 1 / 120
const GRAB_K = 38 // rigidez da mola do cursor (por unidade de massa) — macia: a gelatina estica antes de seguir
const GRAB_C = 8.5 // amortecimento (ζ ≈ 0.7)
const GRAB_GRAVITY_COMP = 0.35 // fração da gravidade compensada enquanto segura

const _q = new THREE.Quaternion()
const _P = new THREE.Vector3()
const _delta = new THREE.Vector3()

export function Simulation() {
  const { step } = useRapier()
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const statsClock = useRef(0)

  // Ponteiro/rodinha globais enquanto uma peça está agarrada (o cursor pode
  // sair do canvas e passar por cima do painel sem soltar a peça). Só o
  // ponteiro que agarrou puxa e solta; um segundo dedo na tela torce a peça.
  useEffect(() => {
    const el = gl.domElement
    const twisters = new Map() // pointerId → último clientX dos dedos extras
    const onDown = (e) => {
      if (grab.active && e.pointerId !== grab.pointerId) twisters.set(e.pointerId, e.clientX)
    }
    const onMove = (e) => {
      if (!grab.active) return
      if (e.pointerId === grab.pointerId) {
        const r = el.getBoundingClientRect()
        grab.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      } else if (twisters.has(e.pointerId)) {
        grab.twist += (e.clientX - twisters.get(e.pointerId)) * 0.02 // segundo dedo → torce a peça
        twisters.set(e.pointerId, e.clientX)
      }
    }
    const onUp = (e) => {
      twisters.delete(e.pointerId)
      if (grab.active && e.pointerId === grab.pointerId) endGrab()
    }
    const onWheel = (e) => {
      if (!grab.active) return
      e.preventDefault()
      grab.twist += -e.deltaY * 0.012 // rodinha enquanto segura → torce a peça
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('wheel', onWheel)
    }
  }, [gl])

  const applyGrab = (h, firmness) => {
    if (!grab.active) return
    const entry = registry.get(grab.id)
    if (!entry) return endGrab()

    raycaster.setFromCamera(grab.ndc, camera)
    if (!raycaster.ray.intersectPlane(grab.plane, grab.target)) return
    grab.target.y = Math.max(grab.target.y, 0.12)
    const horiz = Math.hypot(grab.target.x, grab.target.z)
    if (horiz > 4.5) {
      grab.target.x *= 4.5 / horiz
      grab.target.z *= 4.5 / horiz
    }

    const body = entry.body
    const t = body.translation()
    const r = body.rotation()
    _P.copy(grab.local).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(t)

    // velocidade do ponto agarrado: v + ω × (P − centro de massa)
    const lv = body.linvel()
    const av = body.angvel()
    const com = body.worldCom()
    const rx = _P.x - com.x, ry = _P.y - com.y, rz = _P.z - com.z
    const vx = lv.x + (av.y * rz - av.z * ry)
    const vy = lv.y + (av.z * rx - av.x * rz)
    const vz = lv.z + (av.x * ry - av.y * rx)

    _delta.subVectors(grab.target, _P)
    const m = body.mass() * h
    body.applyImpulseAtPoint(
      {
        x: m * (GRAB_K * _delta.x - GRAB_C * vx),
        y: m * (GRAB_K * _delta.y - GRAB_C * vy - GRAVITY * GRAB_GRAVITY_COMP),
        z: m * (GRAB_K * _delta.z - GRAB_C * vz),
      },
      _P,
      true,
    )
    if (grab.twist !== 0) {
      const inertia = body.mass() * 0.35 * entry.meta.radius * entry.meta.radius
      body.applyTorqueImpulse({ x: 0, y: grab.twist * inertia, z: 0 }, true)
      grab.twist = 0
    }

    // O atraso entre cursor e ponto agarrado estica a gelatina (mais mole = estica mais).
    const gain = THREE.MathUtils.lerp(2.0, 0.8, firmness)
    const maxStretch = THREE.MathUtils.lerp(0.7, 0.3, firmness)
    entry.wobble.Dtarget.copy(_delta).multiplyScalar(gain).clampLength(0, maxStretch)
  }

  useFrame((_, delta) => {
    const { paused, slowMo, firmness, damping } = useStore.getState()
    const dt = Math.min(delta, 1 / 30) * (slowMo ? 0.25 : 1)

    if (!paused && dt > 0) {
      const n = Math.max(1, Math.ceil(dt / SUBSTEP))
      const h = dt / n
      for (let i = 0; i < n; i++) {
        applyGrab(h, firmness)
        step(h)
      }
      const sp = springParams(firmness, damping)
      for (const entry of registry.values()) {
        stepWobble(entry, dt, sp)
        stepRest(entry, dt)
      }
    }
    for (const entry of registry.values()) writeUniforms(entry)

    statsClock.current += delta
    if (statsClock.current > 0.12) {
      statsClock.current = 0
      useStore.getState().setStats(computeStats())
    }
  }, -2)

  return null
}
