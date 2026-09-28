import * as THREE from 'three'
import { RIND, SEED_COUNT } from './constants.js'
import { VARIETIES } from './varieties.js'

/*
 * MATERIAL DA GELATINA
 * --------------------
 * Base: MeshPhysicalMaterial com transmissão (refração em tela + absorção de
 * Beer–Lambert via attenuationColor/Distance), clearcoat e IOR de gelatina.
 * Escolhemos o material físico nativo em vez do MeshTransmissionMaterial do
 * drei porque:
 *   1. o three faz UMA passada de transmissão para todas as peças (o MTM
 *      renderiza a cena de novo para cada instância — caro com 40 pedaços);
 *   2. o onBeforeCompile fica livre para injetarmos nossa deformação.
 *
 * Injeções via onBeforeCompile:
 *   VERTEX  — deformação de gelatina guiada por molas (ver sim/wobble.js). A
 *             normal é corrigida analiticamente: n' = (J⁻¹)ᵀ n, onde J é o
 *             Jacobiano do campo de deslocamento.
 *   FRAGMENT — textura sólida 3D no espaço de repouso: polpa, faixa creme,
 *             casca listrada e sementes (com um mini raymarch para enxergar
 *             sementes "suspensas" dentro do volume). Também variamos por zona a
 *             transmissão, a absorção e a rugosidade, e somamos um termo barato
 *             de subsurface scattering (translucência de fundo + wrap light).
 */

// ---------------------------------------------------------------- GLSL: vertex
const VERTEX_HEADER = /* glsl */ `
uniform vec3 uCenter;      // centro de massa (local)
uniform vec3 uUp;          // "para cima" do mundo, em coordenadas locais
uniform float uBottom;     // altura da base da peça ao longo de uUp (relativa ao centro)
uniform vec3 uSway;        // cisalhamento horizontal (deslocamento por unidade de altura)
uniform float uSquash;     // achatamento (+) / estiramento (-)
uniform float uTwist;      // torção em torno de uUp (rad por unidade de altura)
uniform vec3 uGrabPoint;   // ponto agarrado (local)
uniform vec3 uGrabDisp;    // deslocamento do ponto agarrado (local)
uniform float uGrabRadius; // raio do campo gaussiano do "puxão"

mat3 jOuter(vec3 a, vec3 b) { return mat3(a * b.x, a * b.y, a * b.z); }

// Deslocamento u(p) e Jacobiano J = I + du/dp — mantenha em sincronia com
// deformedVolume() em sim/wobble.js.
vec3 jellyDisplace(vec3 p, out mat3 J) {
  vec3 r = p - uCenter;
  float hgt = dot(r, uUp);
  float hb = hgt - uBottom;           // altura acima da base (a base não se mexe)
  J = mat3(1.0);

  vec3 u = uSway * hb;                // 1) sway: o topo atrasa em relação à base
  J += jOuter(uSway, uUp);

  u += uSquash * (0.5 * r + (uBottom - 1.5 * hgt) * uUp); // 2) squash ~ volume constante
  J += uSquash * (0.5 * mat3(1.0) - 1.5 * jOuter(uUp, uUp));

  vec3 c = cross(uUp, r);             // 3) twist
  mat3 cx = mat3(vec3(0.0, uUp.z, -uUp.y), vec3(-uUp.z, 0.0, uUp.x), vec3(uUp.y, -uUp.x, 0.0));
  u += uTwist * hb * c;
  J += uTwist * (jOuter(c, uUp) + hb * cx);

  vec3 g = p - uGrabPoint;            // 4) puxão local (gaussiana)
  float ir2 = 1.0 / (uGrabRadius * uGrabRadius);
  float w = exp(-dot(g, g) * ir2);
  u += uGrabDisp * w;
  J += jOuter(uGrabDisp, g * (-2.0 * w * ir2));

  return u;
}
`

// -------------------------------------------------------------- GLSL: fragment
const FRAGMENT_HEADER = /* glsl */ `
#define SEED_COUNT ${SEED_COUNT}
uniform vec3 uApex;          // centro da melancia (ponta da fatia), local
uniform float uMelonRadius;
uniform vec3 uFlesh;
uniform vec3 uFleshDeep;
uniform vec3 uAtten;
uniform vec3 uCream;
uniform vec3 uGreen;
uniform vec3 uGreenDark;
uniform vec3 uSeedDark;
uniform vec3 uSeedLight;
uniform vec4 uSeeds[SEED_COUNT];
uniform vec3 uKeyDir;        // direção da luz principal (mundo) para o SSS
uniform float uSSS;
varying vec3 vRest;
varying vec3 vLocalView;

float jHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float jNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(jHash(i + vec3(0.0, 0.0, 0.0)), jHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(jHash(i + vec3(0.0, 1.0, 0.0)), jHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(jHash(i + vec3(0.0, 0.0, 1.0)), jHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(jHash(i + vec3(0.0, 1.0, 1.0)), jHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}

// x = cobertura de semente (0..1), y = 1 se for semente branca.
// soft > 0 alarga a borda (sementes fundas parecem desfocadas).
vec2 jSeeds(vec3 p, float soft) {
  float cov = 0.0;
  float white = 0.0;
  for (int i = 0; i < SEED_COUNT; i++) {
    vec4 s = uSeeds[i];
    vec3 d = p - s.xyz;
    if (dot(d, d) > 0.04) continue;
    float sz = abs(s.w);
    vec2 radial = normalize(s.xz - uApex.xz);
    float a = dot(d.xz, radial) / (0.085 * sz);
    // gota: mais fina do lado que aponta para o centro da melancia
    float b = dot(d.xz, vec2(-radial.y, radial.x)) / (0.05 * sz * (1.0 + 0.3 * clamp(a, -1.0, 1.0)));
    float c = d.y / (0.032 * sz);
    float e = a * a + b * b + c * c;
    float k = 1.0 - smoothstep(0.5, 1.0 + soft, e);
    if (k > cov) { cov = k; white = step(s.w, 0.0); }
  }
  return vec2(cov, white);
}
`

const FRAGMENT_COLOR = /* glsl */ `
  // ---- camadas pela distância radial ao centro da melancia (espaço de repouso)
  vec2 jQ = vRest.xz - uApex.xz;
  float jR = length(jQ);
  float jAng = atan(jQ.y, jQ.x);
  float jN = jNoise(vRest * 5.0);
  float jCreamStart = uMelonRadius - ${RIND.cream.toFixed(3)};
  float jGreenStart = uMelonRadius - ${RIND.green.toFixed(3)};
  float jCream = smoothstep(jCreamStart - 0.08, jCreamStart + 0.05, jR + (jN - 0.5) * 0.05);
  float jGreenT = smoothstep(jGreenStart - 0.012, jGreenStart + 0.012, jR);

  // casca: listras verticais onduladas
  float jWave = jNoise(vec3(jAng * 9.0, vRest.y * 2.6, 3.1)) * 5.0 + jNoise(vRest * 11.0) * 1.2;
  float jStripe = smoothstep(-0.2, 0.3, sin(jAng * 34.0 + jWave));
  vec3 jGreenCol = mix(uGreenDark, uGreen, jStripe);

  // polpa: mais profunda no miolo + granulação leve
  vec3 jFleshCol = mix(uFleshDeep, uFlesh, clamp(smoothstep(0.3, 1.9, jR) * 0.7 + (jN - 0.5) * 0.35 + 0.15, 0.0, 1.0));
  vec3 jCol = mix(jFleshCol, uCream, jCream);
  jCol = mix(jCol, jGreenCol, jGreenT);

  // ---- sementes: pequeno raymarch ao longo da linha de visão, dentro do volume
  float jFleshMask = 1.0 - jCream;
  float jSeedA = 0.0;
  vec3 jSeedC = vec3(0.0);
  if (jFleshMask > 0.01) {
    vec3 jRd = normalize(-vLocalView);
    for (int k = 0; k < 7; k++) {
      float t = float(k) * 0.055;
      vec2 sd = jSeeds(vRest + jRd * t, t * 4.0);
      float a = sd.x * exp(-t * 3.8) * (1.0 - jSeedA);
      jSeedC += a * mix(uSeedDark, uSeedLight, sd.y);
      jSeedA += a;
    }
  }
  jSeedA *= jFleshMask;
  jSeedC *= jFleshMask;
  jCol = jCol * (1.0 - jSeedA) + jSeedC;
  diffuseColor.rgb = jCol;

  // ---- parâmetros ópticos por zona (usados mais adiante no shader)
  float jTrans = mix(0.9, 0.5, jCream);
  jTrans = mix(jTrans, 0.14, jGreenT);
  jTrans *= 1.0 - jSeedA * 0.9;
  vec3 jAttenCol = mix(uAtten, vec3(1.0, 0.96, 0.86), jCream);
  jAttenCol = mix(jAttenCol, uGreen, jGreenT);
  float jRough = mix(0.07, 0.14, jCream);
  jRough = mix(jRough, 0.3, jGreenT);
`

const FRAGMENT_SSS = /* glsl */ `
  {
    // Subsurface barato: luz vazando por trás (estilo Barré-Brisebois) + wrap.
    vec3 jL = normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz);
    vec3 jV = normalize(vViewPosition);
    float jBack = pow(clamp(dot(jV, -normalize(jL + normal * 0.5)), 0.0, 1.0), 2.5);
    float jWrap = clamp((dot(normal, jL) + 0.7) / 1.7, 0.0, 1.0);
    float jFleshAmt = (1.0 - jGreenT) * (1.0 - jSeedA);
    totalEmissiveRadiance += jCol * (jBack * 0.9 + jWrap * 0.35) * uSSS * jFleshAmt;
  }
`

const TRANSMISSION_PATCH = THREE.ShaderChunk.transmission_fragment.replace(
  'material.attenuationColor = attenuationColor;',
  /* glsl */ `material.attenuationColor = jAttenCol;
  material.transmission *= jTrans;
  // bordas rasantes atravessam mais gelatina → cor mais profunda
  material.thickness *= mix(1.9, 0.75, abs(dot(normal, normalize(vViewPosition))));`,
)

if (TRANSMISSION_PATCH === THREE.ShaderChunk.transmission_fragment) {
  console.warn('[melon-jelly] transmission_fragment mudou nesta versão do three — patch de transmissão não aplicado')
}

// --------------------------------------------------------------- uniforms
/** Uniforms compartilhados por todas as peças (cor, sementes, luz). */
export function createSharedUniforms(slice) {
  return {
    uApex: { value: slice.apex.clone() },
    uMelonRadius: { value: slice.outerRadius },
    uFlesh: { value: new THREE.Color() },
    uFleshDeep: { value: new THREE.Color() },
    uAtten: { value: new THREE.Color() },
    uCream: { value: new THREE.Color('#f4efdc') },
    uGreen: { value: new THREE.Color('#3f8a32') },
    uGreenDark: { value: new THREE.Color('#123a18') },
    uSeedDark: { value: new THREE.Color('#1c110b') },
    uSeedLight: { value: new THREE.Color('#efe4c8') },
    uSeeds: { value: slice.seeds },
    uKeyDir: { value: new THREE.Vector3(0.45, 0.8, 0.4).normalize() },
    uSSS: { value: 0.42 },
  }
}

const _target = new THREE.Color()
/** Aplica (ou interpola, com t < 1) a paleta de uma variedade. */
export function applyVariety(shared, key, t = 1) {
  const v = VARIETIES[key]
  shared.uFlesh.value.lerp(_target.set(v.flesh), t)
  shared.uFleshDeep.value.lerp(_target.set(v.fleshDeep), t)
  shared.uAtten.value.lerp(_target.set(v.atten), t)
}

/** Uniforms por peça — escritos a cada frame pela simulação (sim/wobble.js). */
export function createPieceUniforms() {
  return {
    uCenter: { value: new THREE.Vector3() },
    uUp: { value: new THREE.Vector3(0, 1, 0) },
    uBottom: { value: 0 },
    uSway: { value: new THREE.Vector3() },
    uSquash: { value: 0 },
    uTwist: { value: 0 },
    uGrabPoint: { value: new THREE.Vector3() },
    uGrabDisp: { value: new THREE.Vector3() },
    uGrabRadius: { value: 0.8 },
  }
}

// --------------------------------------------------------------- materiais
/**
 * Cria o par de materiais de uma peça: a gelatina e o wireframe do "Ver malha"
 * (que recebe a mesma deformação). O código do onBeforeCompile é idêntico
 * entre peças, então o three reaproveita o mesmo programa de shader; só os
 * objetos de uniform mudam.
 */
export function createPieceMaterials(shared) {
  const uniforms = createPieceUniforms()

  const material = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.1,
    metalness: 0,
    transmission: 1,
    thickness: 1.0,
    ior: 1.36,
    attenuationDistance: 0.85,
    clearcoat: 0.7,
    clearcoatRoughness: 0.06,
    specularIntensity: 1,
    envMapIntensity: 1,
    // empurra a profundidade um pouco para trás: o wireframe desenha por cima
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEADER}\nvarying vec3 vRest;\nvarying vec3 vLocalView;`)
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        mat3 jJ;
        vec3 jDisp = jellyDisplace(position, jJ);
        objectNormal = normalize(transpose(inverse(jJ)) * objectNormal);`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed += jDisp;
        vRest = position;
        // câmera no espaço local (corpos rígidos não têm escala → Rᵀ = R⁻¹)
        vec3 jCamLocal = transpose(mat3(modelMatrix)) * (cameraPosition - modelMatrix[3].xyz);
        vLocalView = jCamLocal - position;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEADER}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = jRough;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${FRAGMENT_SSS}`)
      .replace('#include <transmission_fragment>', TRANSMISSION_PATCH)
  }
  material.customProgramCacheKey = () => 'melon-jelly-physical'

  const wire = new THREE.MeshBasicMaterial({
    color: '#1b1a18',
    wireframe: true,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  })
  wire.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEADER}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n{ mat3 jJ; transformed += jellyDisplace(position, jJ); }`)
  }
  wire.customProgramCacheKey = () => 'melon-jelly-wire'

  return { material, wire, uniforms }
}
