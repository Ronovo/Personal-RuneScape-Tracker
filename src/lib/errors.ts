// Errors this app throws on purpose carry an HTTP statusCode, and their message may be sent to
// the client. jsonErrors() in app.ts uses isHttpError() to tell them from crashes, whose message
// (a filesystem path or a parser internal) is never sent.

interface HttpError extends Error {
  statusCode: number;
}

export function httpError(message: string, statusCode: number): HttpError {
  return Object.assign(new Error(message), { statusCode });
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof Error && typeof (err as { statusCode?: unknown }).statusCode === 'number';
}

export function errorStatus(err: unknown): number {
  return isHttpError(err) ? err.statusCode : 500;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}
