import * as THREE from 'three'
import { signedVolume } from '../jelly/analyze.js'

/*
 * WOBBLE — "soft body" simplificado
 * ---------------------------------
 * Cada peça é um corpo rígido no Rapier (colisões, empilhamento, atrito) e a
 * gelatinosidade vem de 4 modos de deformação, cada um um oscilador
 * massa-mola amortecido integrado aqui na CPU e aplicado no vertex shader:
 *
 *   sway   — cisalhamento horizontal; forçado pela aceleração horizontal do corpo
 *   squash — achatamento/estiramento; forçado pela aceleração vertical (pousos!)
 *   twist  — torção em torno do eixo vertical; forçado pela aceleração angular
 *   D      — puxão local gaussiano; segue o cursor enquanto a peça é agarrada e
 *            volta vibrando quando você solta
 *
 * A aceleração passa por um filtro passa-alta: queda livre (aceleração
 * constante) não deforma, só mudanças bruscas (impactos, arrancos).
 *
 * Firmeza               → frequência natural ω (trêmula ≈ 1 Hz … firme ≈ 7 Hz)
 * Amortecimento interno → razão de amortecimento ζ (viva ≈ 0,03 … xaroposa ≈ 0,93)
 *
 * PARA EVOLUIR PARA UM SOFT BODY DE VERDADE: troque este módulo por um XPBD
 * com tetraedros (tetraedralize a malha — ex.: TetGen offline ou uma grade
 * voxel — e resolva restrições de aresta + volume por tetra, idealmente num
 * compute shader WebGPU). O corte vira então "dividir tetraedros pelo plano".
 * A interface com o resto do app continua: registry + uniforms/posições.
 */

const UP = new THREE.Vector3(0, 1, 0)
const _q = new THREE.Quaternion()

const GAIN_SWAY = 1.5
const GAIN_SQUASH = 0.5
const GAIN_TWIST = 0.8
const MAX_ACC = 600
const HP_TAU = 0.12 // constante de tempo do passa-alta (s)

export function createWobble() {
  return {
    sway: new THREE.Vector3(),
    swayV: new THREE.Vector3(),
    squash: 0,
    squashV: 0,
    twist: 0,
    twistV: 0,
    D: new THREE.Vector3(),
    DV: new THREE.Vector3(),
    Dtarget: new THREE.Vector3(),
    grabLocal: new THREE.Vector3(),
    grabRadius: 0.8,
    prevLin: new THREE.Vector3(),
    prevAng: 0,
    accLP: new THREE.Vector3(),
    angLP: 0,
    primed: false,
  }
}

export function springParams(firmness, damping) {
  const omega = 7 + 38 * Math.pow(firmness, 1.1)
  const zeta = 0.03 + 0.9 * Math.pow(damping, 1.4)
  return { omega, k: omega * omega, c: 2 * zeta * omega, firmness }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export function stepWobble(entry, dt, sp) {
  const w = entry.wobble
  const lv = entry.body.linvel()
  const av = entry.body.angvel()
  if (!w.primed) {
    w.prevLin.set(lv.x, lv.y, lv.z)
    w.prevAng = av.y
    w.primed = true
  }

  // Aceleração do corpo por diferença finita, limitada e filtrada (passa-alta).
  // Corpo dormindo não acelera: o salto da velocidade para zero ao adormecer
  // não pode chacoalhar a gelatina.
  const invDt = entry.body.isSleeping() ? 0 : 1 / dt
  let ax = (lv.x - w.prevLin.x) * invDt
  let ay = (lv.y - w.prevLin.y) * invDt
  let az = (lv.z - w.prevLin.z) * invDt
  const mag = Math.hypot(ax, ay, az)
  if (mag > MAX_ACC) {
    const s = MAX_ACC / mag
    ax *= s
    ay *= s
    az *= s
  }
  let alpha = clamp((av.y - w.prevAng) * invDt, -300, 300)
  w.prevLin.set(lv.x, lv.y, lv.z)
  w.prevAng = av.y

  const lp = 1 - Math.exp(-dt / HP_TAU)
  w.accLP.x += (ax - w.accLP.x) * lp
  w.accLP.y += (ay - w.accLP.y) * lp
  w.accLP.z += (az - w.accLP.z) * lp
  w.angLP += (alpha - w.angLP) * lp
  ax -= w.accLP.x
  ay -= w.accLP.y
  az -= w.accLP.z
  alpha -= w.angLP

  // Euler semi-implícito com subpassos (ω·h ≤ 0.15 → estável e preciso).
  const { k, c } = sp
  const n = Math.max(1, Math.ceil((dt * sp.omega) / 0.15))
  const h = dt / n
  for (let i = 0; i < n; i++) {
    w.swayV.x += (-k * w.sway.x - c * w.swayV.x - GAIN_SWAY * ax) * h
    w.swayV.z += (-k * w.sway.z - c * w.swayV.z - GAIN_SWAY * az) * h
    w.sway.x += w.swayV.x * h
    w.sway.z += w.swayV.z * h

    w.squashV += (-k * w.squash - c * w.squashV + GAIN_SQUASH * ay) * h
    w.squash += w.squashV * h

    w.twistV += (-k * w.twist - c * w.twistV - GAIN_TWIST * alpha) * h
    w.twist += w.twistV * h

    w.DV.x += (k * (w.Dtarget.x - w.D.x) - c * w.DV.x) * h
    w.DV.y += (k * (w.Dtarget.y - w.D.y) - c * w.DV.y) * h
    w.DV.z += (k * (w.Dtarget.z - w.D.z) - c * w.DV.z) * h
    w.D.addScaledVector(w.DV, h)
  }

  w.sway.y = 0
  w.swayV.y = 0
  if (w.sway.length() > 0.45) w.sway.setLength(0.45)
  w.squash = clamp(w.squash, -0.22, 0.3)
  w.twist = clamp(w.twist, -0.6, 0.6)
  if (w.D.length() > 0.9) w.D.setLength(0.9)
}

/** Converte o estado das molas (mundo) em uniforms locais da peça. */
export function writeUniforms(entry) {
  const w = entry.wobble
  const u = entry.uniforms
  const r = entry.body.rotation()
  _q.set(r.x, r.y, r.z, r.w).invert()

  const U = u.uUp.value.copy(UP).applyQuaternion(_q)
  const com = entry.meta.com
  const hull = entry.meta.hull
  let minH = Infinity
  for (let i = 0; i < hull.length; i += 3) {
    const hh = (hull[i] - com.x) * U.x + (hull[i + 1] - com.y) * U.y + (hull[i + 2] - com.z) * U.z
    if (hh < minH) minH = hh
  }
  u.uBottom.value = minH
  u.uCenter.value.copy(com)
  u.uSway.value.copy(w.sway).applyQuaternion(_q)
  u.uSquash.value = w.squash
  u.uTwist.value = w.twist
  u.uGrabPoint.value.copy(w.grabLocal)
  u.uGrabDisp.value.copy(w.D).applyQuaternion(_q)
  u.uGrabRadius.value = w.grabRadius
}

export function isDeformed(entry) {
  const w = entry.wobble
  return w.sway.lengthSq() + w.squash * w.squash + w.twist * w.twist + w.D.lengthSq() > 1e-8
}

/**
 * Volume da peça deformada: aplica na CPU o MESMO campo do vertex shader
 * (jellyDisplace em jelly/material.js) e soma os tetraedros.
 */
export function deformedVolume(entry) {
  const g = entry.geometry
  const pos = g.attributes.position.array
  const index = g.index ? g.index.array : null
  if (!entry.scratch || entry.scratch.length !== pos.length) entry.scratch = new Float32Array(pos.length)
  const out = entry.scratch
  const u = entry.uniforms
  const C = u.uCenter.value
  const U = u.uUp.value
  const b = u.uBottom.value
  const S = u.uSway.value
  const q = u.uSquash.value
  const tw = u.uTwist.value
  const G = u.uGrabPoint.value
  const D = u.uGrabDisp.value
  const ir2 = 1 / (u.uGrabRadius.value * u.uGrabRadius.value)
  for (let i = 0; i < pos.length; i += 3) {
    const px = pos[i], py = pos[i + 1], pz = pos[i + 2]
    const rx = px - C.x, ry = py - C.y, rz = pz - C.z
    const hgt = rx * U.x + ry * U.y + rz * U.z
    const hb = hgt - b
    const sq = b - 1.5 * hgt
    const cx = U.y * rz - U.z * ry, cy = U.z * rx - U.x * rz, cz = U.x * ry - U.y * rx
    const gx = px - G.x, gy = py - G.y, gz = pz - G.z
    const wg = Math.exp(-(gx * gx + gy * gy + gz * gz) * ir2)
    out[i] = px + S.x * hb + q * (0.5 * rx + sq * U.x) + tw * hb * cx + D.x * wg
    out[i + 1] = py + S.y * hb + q * (0.5 * ry + sq * U.y) + tw * hb * cy + D.y * wg
    out[i + 2] = pz + S.z * hb + q * (0.5 * rz + sq * U.z) + tw * hb * cz + D.z * wg
  }
  return signedVolume(out, index)
}
