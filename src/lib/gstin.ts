/** GSTIN validation: 15 characters, valid state code, PAN-like body, and the mod-36 check character. */
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

export function gstinCheckChar(first14: string): string {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const p = CH.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(p / 36) + (p % 36)
  }
  return CH[(36 - (sum % 36)) % 36]
}

export function isValidGstin(g: string): boolean {
  return SHAPE.test(g) && gstinCheckChar(g.slice(0, 14)) === g[14]
}

/** State code embedded in a GSTIN. */
export const gstinState = (g: string) => g.slice(0, 2)
