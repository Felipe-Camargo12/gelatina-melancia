import { Suspense, useEffect } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { Scene } from './components/Scene.jsx'
import { Header, Footer, Panels } from './components/Overlay.jsx'
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

  // Celular: página rolável (cabeçalho → canvas 3:4 → dica/estatísticas → painéis).
  // md+: canvas em tela cheia com a interface posicionada por cima.
  return (
    <div className="flex min-h-full w-full flex-col bg-paper md:relative md:block md:h-full md:overflow-hidden">
      <Header />
      <div className="relative aspect-[3/4] max-h-[75svh] w-full border-y border-line md:absolute md:inset-0 md:aspect-auto md:max-h-none md:border-0">
        <Canvas
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
      </div>
      <Footer />
      <Panels />
    </div>
  )
}
