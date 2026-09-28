import { Suspense, useEffect } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { Scene } from './components/Scene.jsx'
import { Overlay } from './components/Overlay.jsx'
import { useStore } from './store.js'

function useShortcuts() {
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
      const s = useStore.getState()
      const actions = {
        h: () => s.setTool('hand'),
        k: () => s.setTool('knife'),
        n: s.nudge,
        r: s.reset,
        ' ': s.togglePaused,
      }
      const fn = actions[e.key.toLowerCase()]
      if (fn) {
        e.preventDefault()
        fn()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default function App() {
  const tool = useStore((s) => s.tool)
  useShortcuts()

  return (
    <div className="relative h-full w-full overflow-hidden bg-paper">
      <Canvas
        className="!absolute inset-0"
        dpr={[1, 2]}
        camera={{ position: [0.35, 5.7, 7.5], fov: 30, near: 0.1, far: 80 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          // Neutral (Khronos PBR Neutral) preserva a saturação do vermelho melhor que ACES.
          gl.toneMapping = THREE.NeutralToneMapping
          gl.toneMappingExposure = 1
        }}
        style={{ cursor: tool === 'knife' ? 'crosshair' : 'auto', touchAction: 'none' }}
      >
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
      <Overlay />
    </div>
  )
}
