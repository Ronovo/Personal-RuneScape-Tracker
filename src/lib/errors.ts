// Every upstream call in this app throws a plain Error tagged with an HTTP
// statusCode, then each Express route reads err.statusCode ?? 500. That
// tag isn't part of the Error type, so route handlers deal in `unknown`
// (per strict TS catch-clause typing) and use these helpers to get it back out.

interface HttpError extends Error {
  statusCode: number;
}

export function httpError(message: string, statusCode: number): HttpError {
  return Object.assign(new Error(message), { statusCode });
}

function isHttpError(err: unknown): err is HttpError {
  return err instanceof Error && typeof (err as { statusCode?: unknown }).statusCode === 'number';
}

export function errorStatus(err: unknown): number {
  return isHttpError(err) ? err.statusCode : 500;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}
