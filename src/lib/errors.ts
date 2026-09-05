// Every upstream call in this app throws a plain Error tagged with an HTTP
// statusCode. That tag isn't part of the Error type, so whoever catches it
// deals in `unknown` (per strict TS catch-clause typing) and uses these
// helpers to get it back out.
//
// One caller matters: jsonErrors() in app.ts, the error middleware every
// route rejection and every middleware throw funnels into. What separates a
// message a client may see from one it may not is whether we wrote it, not
// what status it carries - so isHttpError() is the check jsonErrors makes.
// A tagged error is an authored sentence aimed at whoever made the request,
// including the 501s that tell a deployer they never set JWT_SECRET and the
// 502s that name the upstream that is down. Anything untagged is a crash whose
// message is a filesystem path or a parser internal, and is never sent.

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
