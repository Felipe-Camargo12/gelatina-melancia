import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Line, RoundedBox } from '@react-three/drei'
import { useStore } from '../store.js'
import { prepareCut, commitCut } from '../sim/cutter.js'
import { SLICE } from '../jelly/constants.js'

/*
 * Ferramenta Faca
 *   aim  — arrastando: linha tracejada no topo da fatia + cutelo pairando acima
 *   drop — soltou: o CSG é pré-calculado e a lâmina desce; ao atravessar a
 *          gelatina as peças são trocadas pelas metades (commitCut)
 *   lift — a lâmina sobe e some
 */

const CUT_Y = SLICE.thickness // plano onde o ponteiro é projetado (≈ topo da fatia pousada)
const HOVER = CUT_Y + 0.55 // altura do fio da lâmina enquanto mira
const BOTTOM = -0.03
const BLADE_L = 2.6
const BLADE_H = 0.8

function useBladeGeometry() {
  return useMemo(() => {
    const L = BLADE_L
    const H = BLADE_H
    const s = new THREE.Shape()
    s.moveTo(0, 0)
    s.lineTo(L * 0.8, 0)
    s.quadraticCurveTo(L * 0.97, 0.02, L, H * 0.42) // fio sobe na ponta
    s.lineTo(L * 0.985, H)
    s.lineTo(0, H)
    s.lineTo(0, 0)
    const g = new THREE.ExtrudeGeometry(s, {
      depth: 0.03,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.008,
      bevelSegments: 2,
      curveSegments: 16,
    })
    g.translate(-L / 2, 0, -0.015)
    // gradiente vertical: fio claro, lombada escura (tinge os reflexos do metal)
    const pos = g.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const light = new THREE.Color('#f6f7f9')
    const dark = new THREE.Color('#8d949d')
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.smoothstep(pos.getY(i), 0.02, H * 0.9)
      c.copy(light).lerp(dark, t)
      colors.set([c.r, c.g, c.b], i * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return g
  }, [])
}

function KnifeModel() {
  const blade = useBladeGeometry()
  const handleX = -BLADE_L / 2 - 0.62
  return (
    <group>
      <mesh geometry={blade}>
        <meshStandardMaterial vertexColors metalness={0.75} roughness={0.3} envMapIntensity={1.8} />
      </mesh>
      {/* virola */}
      <mesh position={[-BLADE_L / 2 - 0.05, BLADE_H - 0.13, 0]}>
        <boxGeometry args={[0.1, 0.24, 0.07]} />
        <meshStandardMaterial color="#b9bcc0" metalness={1} roughness={0.35} />
      </mesh>
      {/* cabo de madeira + rebites */}
      <RoundedBox args={[1.14, 0.24, 0.11]} radius={0.05} smoothness={4} position={[handleX, BLADE_H - 0.13, 0]}>
        <meshStandardMaterial color="#3b2217" roughness={0.55} />
      </RoundedBox>
      {[-0.36, 0, 0.36].map((x) => (
        <group key={x} position={[handleX + x, BLADE_H - 0.13, 0]}>
          {[1, -1].map((side) => (
            <mesh key={side} position={[0, 0, side * 0.056]} rotation-x={Math.PI / 2}>
              <cylinderGeometry args={[0.028, 0.028, 0.012, 16]} />
              <meshStandardMaterial color="#e8e3d6" metalness={0.8} roughness={0.3} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

const easeIn = (t) => t * t * t
const easeOut = (t) => 1 - Math.pow(1 - t, 3)

export function KnifeTool() {
  const tool = useStore((s) => s.tool)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const knife = useRef(null)
  const line = useRef(null)
  const st = useRef({ phase: 'idle', t: 0, a: new THREE.Vector3(), b: new THREE.Vector3(), jobs: null, cut: false })

  useEffect(() => {
    if (tool !== 'knife') return
    const el = gl.domElement
    const s = st.current
    const raycaster = new THREE.Raycaster()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CUT_Y)
    const ndc = new THREE.Vector2()
    const project = (e, out) => {
      const r = el.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      return raycaster.ray.intersectPlane(plane, out)
    }
    const onDown = (e) => {
      if (e.button !== 0 || s.phase !== 'idle') return
      if (!project(e, s.a)) return
      s.b.copy(s.a)
      s.phase = 'aim'
      s.t = 0
    }
    const onMove = (e) => {
      if (s.phase === 'aim') project(e, s.b)
    }
    const onUp = () => {
      if (s.phase !== 'aim') return
      if (s.a.distanceTo(s.b) < 0.25) {
        s.phase = 'idle'
        return
      }
      s.jobs = prepareCut(s.a, s.b) // CSG pesado acontece aqui, antes da animação
      s.cut = false
      s.phase = 'drop'
      s.t = 0
    }
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (s.phase === 'aim') s.phase = 'idle'
    }
  }, [tool, gl, camera])

  const _mid = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, delta) => {
    const s = st.current
    const k = knife.current
    const l = line.current
    if (!k || !l) return
    if (s.phase === 'idle') {
      k.visible = false
      l.visible = false
      return
    }
    s.t += delta

    const dx = s.b.x - s.a.x
    const dz = s.b.z - s.a.z
    const len = Math.hypot(dx, dz)
    _mid.addVectors(s.a, s.b).multiplyScalar(0.5)
    if (len > 1e-4) k.rotation.set(0, Math.atan2(-dz, dx), 0) // +X local → direção do traço

    let y = HOVER
    let scale = 1
    if (s.phase === 'aim') {
      scale = 0.85 + 0.15 * easeOut(Math.min(s.t / 0.15, 1))
      l.geometry.setPositions([s.a.x, CUT_Y + 0.004, s.a.z, s.b.x, CUT_Y + 0.004, s.b.z])
      l.computeLineDistances()
      l.visible = len > 0.05
    } else if (s.phase === 'drop') {
      const p = Math.min(s.t / 0.13, 1)
      y = HOVER + (BOTTOM - HOVER) * easeIn(p)
      if (!s.cut && y < SLICE.thickness * 0.5) {
        s.cut = true
        if (s.jobs?.length) commitCut(s.jobs)
        s.jobs = null
      }
      if (p >= 1 && s.t > 0.2) {
        s.phase = 'lift'
        s.t = 0
      }
    } else if (s.phase === 'lift') {
      l.visible = false
      const p = Math.min(s.t / 0.28, 1)
      y = BOTTOM + (HOVER + 0.8 - BOTTOM) * easeOut(p)
      scale = 1 - 0.15 * p
      if (p >= 1) s.phase = 'idle'
    }
    k.position.set(_mid.x, y, _mid.z)
    k.scale.setScalar(scale)
    k.visible = true
  })

  return (
    <>
      <Line
        ref={line}
        points={[
          [0, 0, 0],
          [1, 0, 0],
        ]}
        color="#1b1a18"
        lineWidth={1.4}
        dashed
        dashSize={0.05}
        gapSize={0.045}
        depthTest={false}
        transparent
        renderOrder={10}
        visible={false}
      />
      <group ref={knife} visible={false}>
        <KnifeModel />
      </group>
    </>
  )
}
