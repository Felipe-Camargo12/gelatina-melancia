import * as THREE from 'three'
import { SLICE, SEED_COUNT } from './constants.js'

/*
 * Geometria da fatia
 * ------------------
 * A fatia é uma "laje arredondada": a soma de Minkowski de um prisma fino
 * (a cunha com cantos levemente arredondados, o "núcleo") com uma esfera de
 * raio `edgeRadius`. Em vez de usar ExtrudeGeometry (cujas tampas são
 * trianguladas só com vértices da borda — impossível de deformar), montamos
 * uma malha estruturada:
 *
 *   polo superior → anéis da tampa → arco superior → parede → arco inferior
 *   → anéis da tampa inferior → polo inferior
 *
 * Cada "linha" do perfil percorre o contorno inteiro (N amostras), então a
 * superfície toda tem densidade parecida e é fechada (two-manifold), o que é
 * exigido pelo CSG.
 *
 * Todas as peças compartilham ESTE referencial local: depois de um corte, as
 * duas metades continuam no mesmo espaço da fatia original. Com isso a posição
 * local de um vértice é também a sua "posição de repouso" na melancia — o
 * shader usa isso para colorir casca/polpa/sementes como uma textura sólida 3D,
 * e toda face de corte nova revela as camadas corretas automaticamente.
 */

function sampleArc(out, cx, cy, r, a0, a1, spacing, min) {
  const n = Math.max(min, Math.ceil((Math.abs(a1 - a0) * r) / spacing))
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    const nx = Math.cos(a)
    const ny = Math.sin(a)
    out.push({ x: cx + nx * r, y: cy + ny * r, nx, ny })
  }
}

function sampleLine(out, x0, y0, x1, y1, nx, ny, spacing, min) {
  const n = Math.max(min, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / spacing))
  for (let i = 0; i < n; i++) {
    const t = i / n
    out.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, nx, ny })
  }
}

/**
 * Contorno 2D do núcleo (anti-horário), com a ponta na origem e a bissetriz em +X.
 * Cada amostra carrega a normal externa analítica — contínua porque todos os
 * trechos são tangentes entre si.
 */
function coreOutline(opts, spacing) {
  const { radius, angle, edgeRadius, apexFillet: ra, cornerFillet: ro } = opts
  const Rc = radius - edgeRadius
  const a = angle / 2
  const sa = Math.sin(a)
  const ca = Math.cos(a)

  // Filete da ponta: centro na bissetriz, tangente às duas arestas retas.
  const apexCx = ra / sa
  const dt = ra / Math.tan(a)
  const tLow = { x: dt * ca, y: -dt * sa }
  const tUp = { x: dt * ca, y: dt * sa }

  // Filetes dos cantos da casca: tangentes à aresta reta e internamente ao arco.
  const dC = Rc - ro
  const phiC = a - Math.asin(ro / dC)
  const coLow = { x: dC * Math.cos(phiC), y: -dC * Math.sin(phiC) }
  const coUp = { x: coLow.x, y: -coLow.y }
  const nLow = { x: -sa, y: -ca } // normal externa da aresta inferior
  const nUp = { x: -sa, y: ca }
  const L1 = { x: coLow.x + ro * nLow.x, y: coLow.y + ro * nLow.y }
  const U1 = { x: coUp.x + ro * nUp.x, y: coUp.y + ro * nUp.y }

  const pts = []
  sampleLine(pts, tLow.x, tLow.y, L1.x, L1.y, nLow.x, nLow.y, spacing, 4)
  sampleArc(pts, coLow.x, coLow.y, ro, -Math.PI / 2 - a, -phiC, spacing, 8)
  sampleArc(pts, 0, 0, Rc, -phiC, phiC, spacing, 16)
  sampleArc(pts, coUp.x, coUp.y, ro, phiC, Math.PI / 2 + a, spacing, 8)
  sampleLine(pts, U1.x, U1.y, tUp.x, tUp.y, nUp.x, nUp.y, spacing, 4)
  sampleArc(pts, apexCx, 0, ra, Math.PI / 2 + a, (3 * Math.PI) / 2 - a, spacing, 8)
  return pts
}

/** Gerador pseudoaleatório determinístico (as sementes são sempre as mesmas). */
function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Sementes em 3D (espaço de repouso). xyz = centro, w = escala (negativo =
 * semente branca/imatura). Ficam em fileiras na polpa, acima e abaixo do plano
 * médio — as próximas da superfície aparecem nítidas, as fundas borradas.
 */
function makeSeeds(opts) {
  const rand = mulberry32(9)
  const a = opts.angle / 2
  const rows = [
    { f: 0.5, n: 8 },
    { f: 0.62, n: 10 },
    { f: 0.74, n: 12 },
  ]
  const seeds = []
  for (const { f, n } of rows) {
    const r = f * opts.radius
    const span = a - 0.2 / r // margem angular longe das faces retas
    for (let i = 0; i < n; i++) {
      const ang = -span + (2 * span * (i + 0.3 + rand() * 0.4)) / n
      const rr = r + (rand() - 0.5) * 0.12
      const side = rand() < 0.5 ? 1 : -1
      const y = side * (0.08 + rand() * 0.17)
      const size = 0.85 + rand() * 0.35
      const white = rand() < 0.14
      seeds.push(new THREE.Vector4(Math.cos(ang) * rr, y, -Math.sin(ang) * rr, white ? -size * 0.75 : size))
    }
  }
  while (seeds.length < SEED_COUNT) seeds.push(new THREE.Vector4(1e3, 1e3, 1e3, 1)) // padding fora da peça
  return seeds.slice(0, SEED_COUNT)
}

/**
 * Constrói a fatia. Retorna a geometria (indexada, position + normal) já
 * centralizada no centro de massa, a posição da ponta (= centro da melancia)
 * e as sementes, ambas no mesmo referencial local.
 */
export function buildSliceGeometry(opts = SLICE) {
  const { thickness, edgeRadius: rho } = opts
  const h = thickness / 2

  // 2D (x, y) → 3D (x, z = -y): mantém o sentido anti-horário visto de cima.
  const C = coreOutline(opts, 0.045).map((p) => ({ x: p.x, z: -p.y, nx: p.nx, nz: -p.ny }))
  const N = C.length

  // Centroide do polígono do núcleo — centro do leque das tampas.
  let A = 0
  let fx = 0
  let fz = 0
  for (let i = 0; i < N; i++) {
    const p = C[i]
    const q = C[(i + 1) % N]
    const cr = p.x * q.z - q.x * p.z
    A += cr
    fx += (p.x + q.x) * cr
    fz += (p.z + q.z) * cr
  }
  fx /= 3 * A
  fz /= 3 * A

  // Linhas do perfil.
  const K = 12 // anéis por tampa
  const ARC = 7 // segmentos por arco arredondado
  const WALL = 2 // segmentos da parede vertical
  const rows = []
  for (let k = 1; k <= K; k++) rows.push({ cap: true, s: k / K, y: h })
  for (let j = 1; j <= ARC; j++) {
    const phi = (Math.PI / 2) * (1 - j / ARC)
    rows.push({ off: rho * Math.cos(phi), y: h - rho + rho * Math.sin(phi) })
  }
  for (let w = 1; w <= WALL; w++) rows.push({ off: rho, y: h - rho - (w / WALL) * 2 * (h - rho) })
  for (let j = 1; j <= ARC; j++) {
    const phi = (-Math.PI / 2) * (j / ARC)
    rows.push({ off: rho * Math.cos(phi), y: -(h - rho) + rho * Math.sin(phi) })
  }
  for (let k = K - 1; k >= 1; k--) rows.push({ cap: true, s: k / K, y: -h })

  const R = rows.length
  const positions = new Float32Array((R * N + 2) * 3)
  let o = 0
  const push = (x, y, z) => {
    positions[o++] = x
    positions[o++] = y
    positions[o++] = z
  }
  push(fx, h, fz) // polo superior (índice 0)
  for (const row of rows) {
    for (let i = 0; i < N; i++) {
      const c = C[i]
      if (row.cap) push(fx + row.s * (c.x - fx), row.y, fz + row.s * (c.z - fz))
      else push(c.x + row.off * c.nx, row.y, c.z + row.off * c.nz)
    }
  }
  push(fx, -h, fz) // polo inferior
  const bottom = R * N + 1

  const idx = []
  const v = (r, i) => 1 + r * N + (i % N)
  for (let i = 0; i < N; i++) idx.push(0, v(0, i), v(0, i + 1))
  for (let r = 0; r < R - 1; r++) {
    for (let i = 0; i < N; i++) {
      const a0 = v(r, i)
      const a1 = v(r, i + 1)
      const b0 = v(r + 1, i)
      const b1 = v(r + 1, i + 1)
      idx.push(a0, b0, b1, a0, b1, a1)
    }
  }
  for (let i = 0; i < N; i++) idx.push(v(R - 1, i), bottom, v(R - 1, i + 1))

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(idx)

  // Centraliza no centro de massa (a ponta sai da origem).
  const com = volumeCentroid(geometry)
  geometry.translate(-com.x, -com.y, -com.z)
  geometry.computeVertexNormals()

  const apex = new THREE.Vector3(-com.x, -com.y, -com.z)
  const seeds = makeSeeds(opts).map((s) => (s.x > 100 ? s : new THREE.Vector4(s.x - com.x, s.y - com.y, s.z - com.z, s.w)))
  return { geometry, apex, seeds, outerRadius: opts.radius }
}

function volumeCentroid(geometry) {
  const pos = geometry.attributes.position.array
  const index = geometry.index.array
  let vol = 0
  const c = new THREE.Vector3()
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3
    const b = index[t + 1] * 3
    const d = index[t + 2] * 3
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2]
    const bx = pos[b], by = pos[b + 1], bz = pos[b + 2]
    const cx = pos[d], cy = pos[d + 1], cz = pos[d + 2]
    const v6 = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
    vol += v6
    c.x += v6 * (ax + bx + cx)
    c.y += v6 * (ay + by + cy)
    c.z += v6 * (az + bz + cz)
  }
  return c.divideScalar(4 * vol)
}
