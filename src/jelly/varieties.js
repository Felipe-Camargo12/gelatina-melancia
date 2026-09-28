// Paletas de cada variedade. Cores em sRGB (hex); o three converte para o
// espaço linear quando viram THREE.Color.
export const VARIETIES = {
  crimson: {
    label: 'Carmim',
    flesh: '#ff5c4c', // polpa perto da casca
    fleshDeep: '#e8252a', // polpa no miolo
    atten: '#ff9c91', // cor de absorção (Beer–Lambert) dentro do volume
    swatch: '#e2383b',
    shadow: '#6e2a26', // sombra de contato tingida pela luz que atravessa a gelatina
  },
  golden: {
    label: 'Dourada',
    flesh: '#ffc83a',
    fleshDeep: '#ffa412',
    atten: '#ffdc8a',
    swatch: '#efa126',
    shadow: '#6e4b18',
  },
  rose: {
    label: 'Rosada',
    flesh: '#ff97a8',
    fleshDeep: '#f2627d',
    atten: '#ffbac6',
    swatch: '#ee8497',
    shadow: '#70343f',
  },
}

export const VARIETY_KEYS = Object.keys(VARIETIES)
