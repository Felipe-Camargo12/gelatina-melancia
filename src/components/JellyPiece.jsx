import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { RigidBody, ConvexHullCollider } from '@react-three/rapier'
import { useStore } from '../store.js'
import { sharedUniforms } from '../jelly/base.js'
import { createPieceMaterials } from '../jelly/material.js'
import { registry, grab, beginGrab, ANGULAR_DAMPING } from '../sim/registry.js'
import { createWobble } from '../sim/wobble.js'
import { createRest } from '../sim/rest.js'

/*
 * Uma peça de gelatina = corpo rígido do Rapier (collider = casco convexo
 * "limpo", ver jelly/analyze.js) + malha com o material jelly + wireframe opcional.
 *
 * A geometria está no referencial da fatia original, então o corpo nasce na
 * pose da peça-mãe e o Rapier calcula sozinho o centro de massa real.
 */
export function JellyPiece({ piece }) {
  const bodyRef = useRef(null)
  const showMesh = useStore((s) => s.showMesh)
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const { material, wire, uniforms } = useMemo(() => createPieceMaterials(sharedUniforms), [])

  useEffect(() => {
    const wobble = createWobble()
    wobble.squashV = piece.kick * 2.5 // a lâmina "aperta" as metades recém-cortadas
    registry.set(piece.id, {
      id: piece.id,
      body: bodyRef.current,
      geometry: piece.geometry,
      meta: piece.meta,
      uniforms,
      wobble,
      rest: createRest(),
      scratch: null,
    })
    return () => {
      registry.delete(piece.id)
      if (grab.id === piece.id) {
        grab.active = false
        grab.id = null
        useStore.getState().setGrabbing(false)
      }
    }
  }, [piece, uniforms])

  useEffect(
    () => () => {
      material.dispose()
      wire.dispose()
      if (!piece.geometry.userData.isBase) piece.geometry.dispose()
    },
    [material, wire, piece.geometry],
  )

  const onPointerDown = (e) => {
    // Um segundo dedo sobre uma peça não agarra outra: ele torce a que já está na mão.
    if (e.button !== 0 || grab.active || useStore.getState().tool !== 'hand' || useStore.getState().paused) return
    e.stopPropagation()
    const entry = registry.get(piece.id)
    if (!entry) return
    beginGrab(entry, e.point, camera, e.pointer, e.nativeEvent.pointerId)
    gl.domElement.style.cursor = 'grabbing'
  }
  const onPointerOver = (e) => {
    e.stopPropagation()
    if (useStore.getState().tool === 'hand' && !grab.active) gl.domElement.style.cursor = 'grab'
  }
  const onPointerOut = () => {
    if (useStore.getState().tool === 'hand' && !grab.active) gl.domElement.style.cursor = ''
  }

  return (
    <RigidBody
      ref={bodyRef}
      colliders={false}
      position={piece.position}
      quaternion={piece.quaternion}
      linearVelocity={piece.linvel}
      angularVelocity={piece.angvel}
      linearDamping={0.05}
      angularDamping={ANGULAR_DAMPING}
    >
      <ConvexHullCollider args={[piece.meta.collider]} density={1} friction={0.75} restitution={0.12} />
      <mesh
        geometry={piece.geometry}
        material={material}
        frustumCulled={false} // a deformação pode sair da bounding sphere
        onPointerDown={onPointerDown}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
      />
      <mesh geometry={piece.geometry} material={wire} visible={showMesh} frustumCulled={false} raycast={() => null} />
    </RigidBody>
  )
}
