import { useFrame } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier'
import { useStore } from '../store.js'
import { Simulation } from './Simulation.jsx'
import { JellyPiece } from './JellyPiece.jsx'
import { KnifeTool } from './Knife.jsx'
import { sharedUniforms } from '../jelly/base.js'
import { applyVariety } from '../jelly/material.js'
import { VARIETIES } from '../jelly/varieties.js'
import { GRAVITY, PAPER } from '../jelly/constants.js'

/*
 * Iluminação de estúdio. O env map é gerado na hora a partir de Lightformers
 * (softboxes retangulares), sem baixar HDRI — os reflexos longos e brilhantes
 * na gelatina vêm deles. Para usar um HDRI real troque por:
 *   <Environment files="/studio.hdr" environmentIntensity={0.8} />
 */
function StudioLights() {
  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight position={[3.5, 7, 3.2]} intensity={1.6} color="#fff5e8" />
      <directionalLight position={[-5, 3, -3]} intensity={0.45} color="#e4ecff" />
      <Environment resolution={256} frames={1} environmentIntensity={0.9}>
        <color attach="background" args={['#4a4744']} />
        <Lightformer form="rect" intensity={3} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[9, 9, 1]} />
        <Lightformer form="rect" intensity={5} position={[-5, 2.2, 1.5]} rotation-y={Math.PI / 2} scale={[2.2, 7, 1]} />
        <Lightformer form="rect" intensity={2.5} position={[5, 2, -1]} rotation-y={-Math.PI / 2} scale={[2.2, 7, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[0, 2, -6]} scale={[12, 3, 1]} />
        <Lightformer form="rect" intensity={2.2} color="#fff1dc" position={[2, 4, 6]} scale={[4, 2.5, 1]} />
      </Environment>
    </>
  )
}

/** Chão e paredes invisíveis (as peças não fogem do enquadramento). */
function Ground() {
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider args={[30, 1, 30]} position={[0, -1, 0]} friction={1} restitution={0.1} />
      <CuboidCollider args={[0.5, 4, 8]} position={[-5.8, 4, 0]} />
      <CuboidCollider args={[0.5, 4, 8]} position={[5.8, 4, 0]} />
      <CuboidCollider args={[8, 4, 0.5]} position={[0, 4, -4.6]} />
      <CuboidCollider args={[8, 4, 0.5]} position={[0, 4, 4.2]} />
    </RigidBody>
  )
}

/** Transição suave de cor ao trocar de variedade. */
function VarietyBlend() {
  useFrame((_, delta) => applyVariety(sharedUniforms, useStore.getState().variety, 1 - Math.exp(-delta * 8)))
  return null
}

export function Scene() {
  const tool = useStore((s) => s.tool)
  const grabbing = useStore((s) => s.grabbing)
  const pieces = useStore((s) => s.pieces)
  const variety = useStore((s) => s.variety)

  return (
    <>
      <color attach="background" args={[PAPER]} />
      <OrbitControls
        makeDefault
        enabled={!grabbing}
        enableRotate={tool === 'hand'}
        enablePan={false}
        enableDamping
        target={[0.35, 0.3, 0]}
        minDistance={5.5}
        maxDistance={13}
        minPolarAngle={0.3}
        maxPolarAngle={1.2}
      />
      <StudioLights />
      <VarietyBlend />

      <Physics paused timeStep="vary" gravity={[0, GRAVITY, 0]}>
        <Simulation />
        <Ground />
        {pieces.map((piece) => (
          <JellyPiece key={piece.id} piece={piece} />
        ))}
      </Physics>

      <KnifeTool />

      {/* Sombra de contato tingida pela cor da variedade (luz filtrada pela gelatina).
          O plano fica um pouco ABAIXO do chão: a câmera ortográfica do ContactShadows
          mora no plano e olha para cima — se estiver dentro das peças apoiadas em y = 0,
          só enxerga faces traseiras e a sombra some. */}
      <ContactShadows
        position={[0, -0.02, 0]}
        scale={16}
        resolution={1024}
        far={2.4}
        blur={2.6}
        opacity={0.6}
        color={VARIETIES[variety].shadow}
      />
    </>
  )
}
