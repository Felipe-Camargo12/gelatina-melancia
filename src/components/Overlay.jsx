import { useState } from 'react'
import { useStore } from '../store.js'
import { VARIETIES, VARIETY_KEYS } from '../jelly/varieties.js'

/*
 * Interface 2D sobre o canvas. O contêiner é pointer-events-none (o canvas
 * recebe os cliques); só os painéis interativos reativam os eventos.
 */

function HandIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[15px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 11V6a2 2 0 0 0-4 0" />
      <path d="M14 10V4a2 2 0 0 0-4 0v2" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  )
}

function KnifeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[15px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21l6.5-6.5" />
      <path d="M9.5 14.5L20 4c1.3 1.3 1.4 4.3-1.4 7.1L13 16.7z" />
    </svg>
  )
}

/** Número no formato brasileiro (vírgula decimal). */
const fmt = (n, digits) => n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })

const Label = ({ children, className = '' }) => (
  <p className={`font-sans text-[10.5px] font-medium uppercase tracking-[0.22em] text-muted ${className}`}>{children}</p>
)

function Slider({ label, value, onChange, left, right }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <Label>{label}</Label>
        <span className="font-mono text-[11px] text-ink">{fmt(value, 2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="range mt-2"
        aria-label={label}
      />
      <div className="mt-0.5 flex justify-between font-serif text-[11.5px] italic text-muted">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  )
}

function Check({ checked, onChange, children }) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 font-sans text-[12px] text-ink/80">
      <input type="checkbox" checked={checked} onChange={onChange} className="check" />
      {children}
    </label>
  )
}

const btn = 'h-9 border border-ink/25 font-sans text-[12.5px] text-ink transition-colors hover:bg-ink/[0.04] active:bg-ink/[0.08]'

function ControlPanel() {
  const tool = useStore((s) => s.tool)
  const variety = useStore((s) => s.variety)
  const firmness = useStore((s) => s.firmness)
  const damping = useStore((s) => s.damping)
  const slowMo = useStore((s) => s.slowMo)
  const showMesh = useStore((s) => s.showMesh)
  const paused = useStore((s) => s.paused)
  const a = useStore.getState()

  return (
    <aside className="pointer-events-auto border border-line/90 bg-paper/70 px-5 pb-5 pt-4 backdrop-blur-[2px]">
      <div className="flex items-baseline justify-between border-b border-line pb-3">
        <Label>O Espécime</Label>
        <span className="font-serif text-[13px] italic text-muted">fig. 9</span>
      </div>

      <div className="border-b border-line py-4">
        <Label>Ferramenta</Label>
        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          {[
            ['hand', 'Mão', <HandIcon key="h" />],
            ['knife', 'Faca', <KnifeIcon key="k" />],
          ].map(([key, name, icon]) => (
            <button
              key={key}
              onClick={() => a.setTool(key)}
              className={`flex h-9 items-center justify-center gap-2 border font-sans text-[12.5px] transition-colors ${
                tool === key ? 'border-ink bg-ink text-paper' : 'border-ink/25 text-ink hover:bg-ink/[0.04]'
              }`}
            >
              {icon}
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="border-b border-line py-4">
        <Label>Variedade</Label>
        <div className="mt-2.5 grid grid-cols-3 gap-1.5">
          {VARIETY_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => a.setVariety(key)}
              className={`border px-2 pb-1.5 pt-2 text-center transition-colors ${
                variety === key ? 'border-ink/40 bg-white/30' : 'border-transparent hover:border-ink/15'
              }`}
            >
              <span className="block h-[4px] bg-[#2f6a2c]" />
              <span className="block h-[2px] bg-[#f4efdc]" />
              <span className="block h-[15px]" style={{ background: VARIETIES[key].swatch }} />
              <span className="mt-1 block font-serif text-[12.5px] italic text-ink/75">{VARIETIES[key].label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 border-b border-line py-4">
        <Slider label="Firmeza" value={firmness} onChange={a.setFirmness} left="trêmula" right="firme" />
        <Slider label="Amortecimento interno" value={damping} onChange={a.setDamping} left="viva" right="xaroposa" />
      </div>

      <div className="space-y-3 pt-4">
        <div className="grid grid-cols-[1fr_auto] gap-1.5">
          <button onClick={a.nudge} className={btn}>
            Dar um peteleco
          </button>
          <button onClick={a.reset} className={`${btn} px-4`}>
            Reiniciar
          </button>
        </div>
        <div className="flex gap-5 py-0.5">
          <Check checked={slowMo} onChange={a.toggleSlowMo}>
            Velocidade ¼
          </Check>
          <Check checked={showMesh} onChange={a.toggleShowMesh}>
            Ver malha
          </Check>
        </div>
        <button onClick={a.togglePaused} className={`${btn} w-full`}>
          {paused ? 'Continuar' : 'Pausar'}
        </button>
      </div>
    </aside>
  )
}

function Stat({ label, value, unit, last }) {
  return (
    <div className={`px-3 py-2.5 first:pl-0 ${last ? '' : 'border-r border-line'}`}>
      <Label className="!text-[10px]">{label}</Label>
      <p className="mt-1 whitespace-nowrap font-mono text-[17px] text-ink">
        {value}
        {unit && <span className="ml-1 font-sans text-[10.5px] text-muted">{unit}</span>}
      </p>
    </div>
  )
}

function Stats() {
  const stats = useStore((s) => s.stats)
  const kinetic = fmt(stats.kinetic, stats.kinetic >= 100 ? 0 : 2)
  return (
    <div className="grid grid-cols-[auto_auto_auto_1fr] border-t border-line">
      <Stat label="Massa" value={`≈${fmt(stats.mass, 0)}`} unit="g" />
      <Stat label="Volume" value={fmt(stats.volume, 1)} unit="% do repouso" />
      <Stat label="Cinética" value={kinetic} unit="µJ" />
      <Stat label="Peças" value={stats.pieces} last />
    </div>
  )
}

const HINTS = {
  hand: [
    'Mão',
    'Agarre qualquer peça — ponta, canto, polpa ou casca — e puxe. Role a rodinha do mouse enquanto segura para torcê-la. Arraste a mesa vazia para girar a câmera.',
  ],
  knife: [
    'Faca',
    'Desenhe uma linha sobre a fatia — a faca se alinha a ela e corta quando você solta. Corte as peças de novo, do tamanho que quiser.',
  ],
}

function Inside() {
  const [open, setOpen] = useState(false)
  return (
    <div className="pointer-events-auto border border-line/90 bg-paper/80 backdrop-blur-[2px]">
      {open && (
        <div className="max-h-[46vh] space-y-2.5 overflow-y-auto border-b border-line px-5 py-4 font-serif text-[13.5px] leading-[1.45] text-ink/80">
          <p>
            Cada peça é um corpo rígido do <em>Rapier</em> cujo colisor é o seu casco convexo — cortes planos de uma fatia
            convexa continuam convexos. Uma peça que fica um instante sem sair do lugar adormece, para que o ruído de
            contato não a deixe tremendo sozinha.
          </p>
          <p>
            O balanço vem de quatro molas amortecidas por peça — cisalhamento, achatamento, torção e um campo local de
            puxão — forçadas pela aceleração do próprio corpo e aplicadas no shader de vértices, com as normais corrigidas
            pelo Jacobiano da deformação.
          </p>
          <p>
            A faca transforma o seu traço num plano vertical e faz uma subtração e uma interseção contra um semiespaço com
            o <em>three-bvh-csg</em>. A cor é uma textura sólida 3D nas coordenadas da fatia original, então cada face nova
            revela polpa, casca e sementes exatamente onde estavam.
          </p>
          <p className="font-sans text-[11px] not-italic text-muted">
            Teclas: H mão · K faca · N peteleco · R reiniciar · Espaço pausa
          </p>
        </div>
      )}
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-5 py-3.5">
        <Label className="!text-ink/80">Por dentro do experimento</Label>
        <span className="font-sans text-[15px] leading-none text-ink/70">{open ? '–' : '+'}</span>
      </button>
    </div>
  )
}

export function Overlay() {
  const tool = useStore((s) => s.tool)
  const paused = useStore((s) => s.paused)
  const [hintTitle, hint] = HINTS[tool]

  return (
    <div className="pointer-events-none absolute inset-0 z-10 text-ink">
      {/* Cabeçalho */}
      <header className="absolute left-6 top-6 md:left-12 md:top-11">
        <Label className="max-sm:tracking-[0.14em]">Estudos de Materiais / Nº 009</Label>
        <h1 className="mt-5 font-serif text-[52px] font-normal italic leading-[0.8] tracking-[-0.025em] md:mt-7 md:text-[72px] lg:text-[92px]">
          Gelatina
          <br />
          <span className="ml-[0.5em]">de melancia.</span>
        </h1>
        <p className="mt-5 hidden font-serif text-[16.5px] leading-[1.45] text-ink/75 md:block">
          Uma fatia de verão.
          <br />
          Um leve balançar.
          <br />
          Macia demais para dividir.
        </p>
      </header>

      {/* Selo do renderer */}
      <div className="absolute right-6 top-6 flex items-center gap-2 border border-line bg-paper/60 px-3 py-1.5 md:right-10 md:top-11">
        <span className={`size-[6px] rounded-full ${paused ? 'bg-amber-600' : 'bg-emerald-700'}`} />
        <span className="font-mono text-[10px] tracking-[0.18em] text-ink/80">
          <span className="hidden sm:inline">WEBGL2 · </span>
          {paused ? 'PAUSADO' : 'AO VIVO'}
        </span>
      </div>

      {/* Dica da ferramenta + estatísticas */}
      <footer className="absolute bottom-6 left-6 hidden w-[440px] md:bottom-10 md:left-12 md:block">
        <p className="mb-4 max-w-[380px] font-serif text-[15px] italic leading-[1.5] text-ink/85">
          <span className="mr-2 font-sans text-[10.5px] font-medium not-italic uppercase tracking-[0.2em] text-muted">
            {hintTitle}
          </span>
          {hint}
        </p>
        <Stats />
        <p className="mt-2 max-w-[440px] font-sans text-[10.5px] leading-[1.5] text-muted">
          Escala ilustrativa: 1 unidade da simulação ≈ 3 cm, goma a 1,3 g/cm³. Volume e energia são somados ao vivo sobre
          todas as peças.
        </p>
      </footer>

      {/* Painel de controles */}
      <div className="absolute bottom-24 right-4 top-auto w-[268px] md:bottom-auto md:right-10 md:top-[104px]">
        <ControlPanel />
      </div>

      <div className="absolute bottom-4 right-4 w-[268px] md:bottom-10 md:right-10 md:w-[320px]">
        <Inside />
      </div>
    </div>
  )
}
