# Melon Jelly — Material Studies No. 009

Fatia de melancia de gelatina interativa: balança quando você puxa, e a faca corta a malha em tempo real, quantas vezes você quiser.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # produção em dist/
```

Stack: React 19 · three r186 · @react-three/fiber 9 · drei 10 · @react-three/rapier 2 · three-bvh-csg · zustand · Tailwind 4 · Vite 8.

## Estrutura

```
src/
├── App.jsx                  Canvas (câmera, tone mapping) + Overlay + atalhos de teclado
├── store.js                 zustand: estado da UI + lista de peças
├── components/
│   ├── Scene.jsx            luzes de estúdio, env map de Lightformers, chão/paredes, sombra de contato
│   ├── Simulation.jsx       laço do frame: forças da Mão → step manual do Rapier → molas → uniforms → stats
│   ├── JellyPiece.jsx       uma peça = RigidBody + ConvexHullCollider + malha jelly + wireframe
│   ├── Knife.jsx            ferramenta Faca: traço, cutelo 3D, animação de corte
│   └── Overlay.jsx          interface 2D (título, stats, painel de controles, "Inside the experiment")
├── jelly/
│   ├── constants.js         dimensões da fatia, escala ilustrativa, limites
│   ├── geometry.js          malha estruturada da fatia (laje arredondada) + sementes 3D
│   ├── analyze.js           volume, centro de massa, casco convexo
│   ├── material.js          MeshPhysicalMaterial + injeções GLSL (deformação e textura sólida)
│   ├── slicer.js            corte CSG por semiespaço (three-bvh-csg)
│   ├── varieties.js         paletas Crimson / Golden / Rosé
│   └── base.js              fatia original + uniforms compartilhados
└── sim/
    ├── registry.js          peças vivas fora do React, Mão (grab), nudge, estatísticas
    ├── wobble.js            molas amortecidas (sway, squash, twist, puxão) + volume deformado
    ├── cutter.js            corte em duas fases: prepareCut (CSG) / commitCut (troca as peças)
    └── pieces.js            descritores de peça e fatia inicial
```

## Como funciona

- **Aparência**: `MeshPhysicalMaterial` com transmissão, absorção de Beer–Lambert, clearcoat e IOR 1,36. A cor é uma *textura sólida 3D* calculada no espaço de repouso da fatia (polpa → faixa creme → casca listrada, mais sementes com um mini raymarch). Por isso toda face de corte nova já nasce com as camadas corretas. Por zona variam transmissão, absorção e rugosidade, e há um termo barato de subsurface scattering.
- **Efeito gelatina**: cada peça é um corpo rígido no Rapier. A deformação vem de 4 osciladores massa-mola por peça, forçados pela aceleração do próprio corpo (filtro passa-alta) e aplicados no vertex shader. As normais são corrigidas pelo Jacobiano do campo de deslocamento. *Firmness* controla a frequência natural e *Internal damping* a razão de amortecimento.
- **Corte**: o traço vira um plano vertical. Cada peça atravessada vira duas via `SUBTRACTION` + `INTERSECTION` contra uma caixa-semiespaço com a face de corte subdividida (para a face nova também deformar). Todas as peças compartilham o referencial da fatia original, e cortes planos de um sólido convexo seguem convexos, então o casco convexo é o collider exato.

## Onde estão as integrações pesadas (e o próximo passo)

| Tema | Arquivo | Próximo passo sugerido |
| --- | --- | --- |
| Soft body | `sim/wobble.js` | Trocar as molas por XPBD com tetraedros (restrições de aresta + volume), idealmente em compute shader WebGPU; o corte passa a dividir tetraedros. |
| CSG | `jelly/slicer.js`, `sim/cutter.js` | Mover `prepareCut` para um Web Worker; hoje leva ~40–120 ms por peça e roda no instante em que você solta o mouse. |
| Iluminação | `components/Scene.jsx` | Trocar os Lightformers por um HDRI (`<Environment files=… />`) se quiser reflexos fotográficos. |

## Controles

Mão: arraste uma peça para puxar; scroll enquanto segura torce a peça; arrastar a mesa vazia orbita a câmera.
Faca: desenhe uma linha sobre a fatia e solte.
Atalhos: `H` mão · `K` faca · `N` nudge · `R` reset · `Espaço` pausa.

Observação: o three-bvh-csg imprime um aviso de depreciação do three-mesh-bvh (`maxLeafSize`) a cada corte; é interno da biblioteca e inofensivo.
