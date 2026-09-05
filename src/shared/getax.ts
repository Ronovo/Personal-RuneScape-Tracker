// GE tax math, identical on both sides of the wire. The server knows which
// items are tax-exempt (isTaxExempt in prices.ts) and passes the result in;
// the client gets the exempt flag from the row the server already built.
//
// Jagex floors the 2%, then caps it at 5m gp. Exempt items and any sale that
// floors to 0 (under 50 gp) pay nothing.

export const GE_TAX_RATE = 0.02;
export const GE_TAX_CAP = 5_000_000;

export function geTax(price: number | null | undefined, taxExempt = false): number {
  if (!price || taxExempt) return 0;
  return Math.min(Math.floor(price * GE_TAX_RATE), GE_TAX_CAP);
}
