# Gelatina de Melancia — Estudos de Materiais Nº 009

Fatia de melancia de gelatina interativa: balança quando você puxa, e a faca corta a malha em tempo real, quantas vezes você quiser.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # produção em dist/
```

Tecnologias: React 19 · three r186 · @react-three/fiber 9 · drei 10 · @react-three/rapier 2 · three-bvh-csg · zustand · Tailwind 4 · Vite 8.

## Estrutura

```
src/
├── App.jsx                  layout (celular: página rolável; md+: canvas em tela cheia), Canvas, atalhos de teclado
├── store.js                 zustand: estado da interface + lista de peças
├── components/
│   ├── Scene.jsx            luzes de estúdio, mapa de ambiente de Lightformers, chão/paredes, sombra de contato
│   ├── Simulation.jsx       laço do frame: forças da Mão → passo manual do Rapier → molas → repouso → uniforms → estatísticas
│   ├── JellyPiece.jsx       uma peça = RigidBody + ConvexHullCollider + malha de gelatina + malha em arame
│   ├── Knife.jsx            ferramenta Faca: traço, cutelo 3D, animação de corte
│   └── Overlay.jsx          interface 2D em pedaços: cabeçalho, dica + estatísticas, painéis ("Por dentro do experimento")
├── jelly/
│   ├── constants.js         dimensões da fatia, escala ilustrativa, limites
│   ├── geometry.js          malha estruturada da fatia (laje arredondada) + sementes 3D
│   ├── analyze.js           volume, centro de massa, casco convexo e colisor limpo
│   ├── material.js          MeshPhysicalMaterial + injeções GLSL (deformação e textura sólida)
│   ├── slicer.js            corte CSG por semiespaço (three-bvh-csg)
│   ├── varieties.js         paletas Carmim / Dourada / Rosada
│   └── base.js              fatia original + uniforms compartilhados
└── sim/
    ├── registry.js          peças vivas fora do React, Mão (agarrar), peteleco, estatísticas
    ├── wobble.js            molas amortecidas (cisalhamento, achatamento, torção, puxão) + volume deformado
    ├── rest.js              repouso: põe para dormir a peça que não sai do lugar
    ├── cutter.js            corte em duas fases: prepareCut (CSG) / commitCut (troca as peças)
    └── pieces.js            descritores de peça e fatia inicial
```

## Como funciona

- **Aparência**: `MeshPhysicalMaterial` com transmissão, absorção de Beer–Lambert, verniz (`clearcoat`) e índice de refração 1,36. A cor é uma *textura sólida 3D* calculada no espaço de repouso da fatia (polpa → faixa creme → casca listrada, mais sementes com uma pequena marcha de raios). Por isso toda face de corte nova já nasce com as camadas corretas. Por zona variam transmissão, absorção e rugosidade, e há um termo barato de espalhamento subsuperficial.
- **Efeito gelatina**: cada peça é um corpo rígido no Rapier. A deformação vem de 4 osciladores massa-mola por peça, forçados pela aceleração do próprio corpo (filtro passa-alta) e aplicados no shader de vértices. As normais são corrigidas pelo Jacobiano do campo de deslocamento. *Firmeza* controla a frequência natural e *Amortecimento interno* a razão de amortecimento.
- **Corte**: o traço vira um plano vertical. Cada peça atravessada vira duas via `SUBTRACTION` + `INTERSECTION` contra uma caixa-semiespaço com a face de corte subdividida (para a face nova também deformar). Todas as peças compartilham o referencial da fatia original, e cortes planos de um sólido convexo seguem convexos, então o casco convexo serve de colisor.
- **Colisor limpo**: o casco que sai do CSG tem as faces grandes picadas em dezenas de triângulos quase coplanares, com ruído e pontos quase duplicados. Com ele o Rapier apoiava a peça em 4 vértices vizinhos de um canto da face + um ponto de penetração fantasma, e ela ficava tremendo sozinha para sempre. `analyze.js` agrupa as faces por normal em planos e calcula os vértices do colisor pela interseção exata desses semiespaços: faces planas, metade dos vértices, e o colisor sobra no máximo ~0,01 u além da malha.
- **Repouso**: o Rapier só adormece um corpo depois de 2 s com a velocidade abaixo de um limiar, e um tremor residual do solver pode impedir isso. `sim/rest.js` olha a *pose média*: a peça que passa 0,4 s sem sair do lugar (1,2 cm / 2°) vai dormir, e acorda quando algo encosta nela ou pela Mão, pelo peteleco e pela faca.

## Onde estão as integrações pesadas (e o próximo passo)

| Tema | Arquivo | Próximo passo sugerido |
| --- | --- | --- |
| Corpo macio | `sim/wobble.js` | Trocar as molas por XPBD com tetraedros (restrições de aresta + volume), idealmente num shader de computação WebGPU; o corte passa a dividir tetraedros. |
| CSG | `jelly/slicer.js`, `sim/cutter.js` | Mover `prepareCut` para um Web Worker; hoje leva ~40–120 ms por peça e roda no instante em que você solta o mouse. |
| Iluminação | `components/Scene.jsx` | Trocar os Lightformers por um HDRI (`<Environment files=… />`) se quiser reflexos fotográficos. |

## Controles

Mão: arraste uma peça para puxar; enquanto segura, role a rodinha do mouse ou arraste um segundo dedo na tela para torcer a peça; arrastar a mesa vazia gira a câmera.
Faca: desenhe uma linha sobre a fatia e solte.
Atalhos: `H` mão · `K` faca · `N` peteleco · `R` reiniciar · `Espaço` pausa.

Observação: o three-bvh-csg imprime um aviso de depreciação do three-mesh-bvh (`maxLeafSize`) a cada corte; é interno da biblioteca e inofensivo.
