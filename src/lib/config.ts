/** Accounts, API tokens and portfolio login all need JWT_SECRET; without it the server runs open on the LAN. */
export function jwtAuthConfigured(): boolean {
  return Boolean(process.env.JWT_SECRET?.trim());
}
