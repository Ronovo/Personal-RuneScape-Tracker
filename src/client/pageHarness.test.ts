/// <reference types="node" />
// Loads one of public/'s pages into jsdom and points the browser globals at it, so a page script can be imported
// and run against its own markup. It holds no tests; the .test name keeps it out of the browser build.
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const PUBLIC = new URL('../../../public/', import.meta.url);
const GLOBALS = [
  'window', 'document', 'location', 'history', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement',
  'HTMLInputElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLTextAreaElement', 'HTMLFormElement', 'Event',
  'KeyboardEvent', 'MouseEvent', 'CustomEvent', 'Node', 'getComputedStyle', 'requestAnimationFrame',
  'cancelAnimationFrame',
] as const;

export type Reply = { status?: number; body?: unknown; html?: string };
/** Keyed `"METHOD /path?query"`; a key without a query answers any query to that path. */
export type Route = Reply | ((body: unknown, url: URL) => Reply | Promise<Reply>);

export interface Page {
  window: JSDOM['window'];
  requests: { method: string; url: string; body: unknown }[];
  routes: Record<string, Route>;
  /** Navigations jsdom refused to make, such as `location.href = 'login.html'`. */
  navigations: string[];
  /**
   * What every `matchMedia` query on this page returns. `MOBILE_MQ` in chrome.js is made once per test file, from
   * the first page loaded, so only that page's list can cross the phone breakpoint.
   */
  media: EventTarget & { matches: boolean };
}

let runs = 0;

export function loadPage(
  file: string,
  { search = '', routes = {}, storage = {}, mobile = false }:
    { search?: string; routes?: Record<string, Route>; storage?: Record<string, string>; mobile?: boolean } = {},
): Page {
  const virtualConsole = new VirtualConsole();
  const navigations: string[] = [];
  virtualConsole.on('jsdomError', (error) => {
    if (error.message.includes('navigation')) navigations.push(error.message);
  });
  const dom = new JSDOM(readFileSync(new URL(file, PUBLIC), 'utf8'), {
    url: `http://tracker.test/${file}${search}`, pretendToBeVisual: true, virtualConsole,
  });
  const { window } = dom;
  const media = Object.assign(new window.EventTarget(), { matches: mobile });
  window.matchMedia = (() => media) as unknown as typeof window.matchMedia;
  for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
  for (const name of GLOBALS) {
    Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true });
  }

  const page: Page = { window, requests: [], routes: { ...routes }, navigations, media };
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(input, 'http://tracker.test/');
    const bare = url.origin === 'http://tracker.test' ? url.pathname : `${url.origin}${url.pathname}`;
    const path = `${bare}${url.search}`;
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    page.requests.push({ method, url: path, body });
    const route = page.routes[`${method} ${path}`] ?? page.routes[`${method} ${bare}`];
    if (!route) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    const reply = typeof route === 'function' ? await route(body, url) : route;
    if (reply.html !== undefined) {
      return new Response(reply.html, { status: reply.status ?? 200, headers: { 'Content-Type': 'text/html' } });
    }
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return page;
}

/** Runs a fresh copy of a page script against the loaded page, then lets its start-up requests finish. */
export async function runScript(page: Page, script: string): Promise<void> {
  await import(`${script}?run=${++runs}`);
  page.window.document.dispatchEvent(new page.window.Event('DOMContentLoaded'));
  await settle();
}

/** Lets pending promises and zero-delay timers run. */
export async function settle(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

export function byId<T extends HTMLElement = HTMLElement>(page: Page, id: string): T {
  const found = page.window.document.getElementById(id);
  if (!found) throw new Error(`#${id} is not on the page`);
  return found as T;
}

export function click(page: Page, id: string): void {
  byId(page, id).dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
}
