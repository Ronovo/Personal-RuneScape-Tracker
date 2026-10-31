/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byId, click, loadPage, runScript, settle, type Page, type Route } from './pageHarness.test.js';
import { MAX_SECURITY_ANSWER, SECURITY_QUESTIONS } from '../shared/securityQuestions.js';

const ROUTES: Record<string, Route> = {
  'GET /api/auth/status': { body: { mode: 'public', accounts: true, portfolio: true, portfolioUrl: 'http://portfolio.test' } },
  'GET http://portfolio.test/sso/me': { body: { username: 'Gambler' } },
  'POST /api/auth/bankrolls': { body: { bankrolls: {} } },
};
const SIGNED_IN = { body: { token: 'new-token', user: { id: 'u1', username: 'pilot', rsns: [] } } };

function submit(page: Page, id: string): Promise<void> {
  byId(page, id).dispatchEvent(new page.window.Event('submit', { cancelable: true }));
  return settle();
}

function fill(page: Page, values: Record<string, string>): void {
  for (const [id, value] of Object.entries(values)) byId<HTMLInputElement>(page, id).value = value;
}

function message(page: Page): { text: string | null; error: boolean; hidden: boolean } {
  const box = byId(page, 'accountMessage');
  return { text: box.textContent, error: box.classList.contains('error'), hidden: box.hidden };
}

async function open(file: string, routes: Record<string, Route> = {}, search = ''): Promise<Page> {
  const page = loadPage(file, { routes: { ...ROUTES, ...routes }, search });
  await runScript(page, './account.js');
  return page;
}

test('registering offers every security question and keeps answers to the limit', async () => {
  const page = await open('register.html');
  const options = [...byId<HTMLSelectElement>(page, 'registerQuestion').options].map((o) => o.textContent);
  assert.deepEqual(options, ['Pick a question', ...SECURITY_QUESTIONS]);
  assert.equal(byId<HTMLInputElement>(page, 'registerAnswer').maxLength, MAX_SECURITY_ANSWER);
  assert.equal(byId(page, 'portfolioLink').hidden, false);
  assert.equal(byId(page, 'pagePortfolioBtn').textContent, 'Log in as Gambler');
});

test('registering checks the passwords match, then signs in and goes home', async () => {
  const page = await open('register.html', { 'POST /api/auth/register': SIGNED_IN });
  fill(page, { registerUsername: '  pilot ', registerPassword: 'correct horse', registerConfirm: 'wrong horse',
    registerAnswer: 'Smith' });
  byId<HTMLSelectElement>(page, 'registerQuestion').selectedIndex = 1;
  await submit(page, 'registerForm');
  assert.deepEqual(message(page), { text: 'Passwords do not match', error: true, hidden: false });

  fill(page, { registerConfirm: 'correct horse' });
  await submit(page, 'registerForm');
  assert.deepEqual(page.requests.find((r) => r.url === '/api/auth/register')?.body,
    { username: 'pilot', password: 'correct horse', question: SECURITY_QUESTIONS[0], answer: 'Smith' });
  assert.equal(page.window.localStorage.getItem('osrs_api_token'), 'new-token');
  assert.equal(page.navigations.length, 1);
});

test('a server refusal is shown as the server wrote it', async () => {
  const page = await open('register.html', { 'POST /api/auth/register': { status: 400, body: { error: 'Username taken' } } });
  fill(page, { registerUsername: 'pilot', registerPassword: 'x', registerConfirm: 'x' });
  await submit(page, 'registerForm');
  assert.deepEqual(message(page), { text: 'Username taken', error: true, hidden: false });
});

test('logging in goes home, and a wrong password says so', async () => {
  let attempts = 0;
  const page = await open('login.html', {
    'POST /api/auth/login': () => (++attempts === 1
      ? { status: 401, body: { error: 'Invalid username or password' } }
      : SIGNED_IN),
  });
  fill(page, { loginUsername: ' pilot ', loginPassword: 'oops' });
  await submit(page, 'loginForm');
  assert.deepEqual(message(page), { text: 'Invalid username or password', error: true, hidden: false });
  await submit(page, 'loginForm');
  assert.deepEqual(page.requests.filter((r) => r.url === '/api/auth/login')[1]?.body, { username: 'pilot', password: 'oops' });
  assert.equal(page.navigations.length, 1);
});

test('the log in page offers portfolio login, named after the portfolio account, when the server has it', async () => {
  const page = await open('login.html');
  assert.equal(byId(page, 'portfolioLink').hidden, false);
  assert.equal(byId(page, 'pagePortfolioBtn').textContent, 'Log in as Gambler');
  click(page, 'pagePortfolioBtn');
  assert.equal(page.navigations.length, 1);
});

test('a failed portfolio login shows its reason once and takes it out of the address bar', async () => {
  const page = await open('login.html', {}, '?error=Your+portfolio+login+expired.+Try+again.');
  assert.deepEqual(message(page), { text: 'Your portfolio login expired. Try again.', error: true, hidden: false });
  assert.equal(page.window.location.search, '');
  assert.equal(byId(page, 'loginForm').hidden, false);
  click(page, 'forgotLink');
  assert.equal(message(page).hidden, true);
});

test('a forgotten password is reset in two steps, and Back reloads the log in page', async () => {
  const page = await open('login.html', {
    'POST /api/auth/reset-question': { body: { question: SECURITY_QUESTIONS[2] } },
    'POST /api/auth/reset-password': { body: { ok: true } },
  }, '?from=reset');
  click(page, 'forgotLink');
  assert.equal(byId(page, 'loginForm').hidden, true);
  assert.equal(byId(page, 'resetForm').hidden, false);
  assert.ok(byId(page, 'loginLinks').hasAttribute('hidden'));

  fill(page, { resetUsername: ' pilot ' });
  await submit(page, 'resetForm');
  assert.equal(byId(page, 'resetQuestion').textContent, SECURITY_QUESTIONS[2]);
  assert.equal(byId(page, 'resetAnswerField').hidden, false);
  assert.equal(byId<HTMLInputElement>(page, 'resetUsername').readOnly, true);
  assert.equal(byId(page, 'resetSubmitBtn').textContent, 'Reset password');

  fill(page, { resetAnswer: 'Smith', resetPassword: 'new password' });
  await submit(page, 'resetForm');
  assert.deepEqual(page.requests.find((r) => r.url === '/api/auth/reset-password')?.body,
    { username: 'pilot', answer: 'Smith', password: 'new password' });
  assert.equal(byId(page, 'loginForm').hidden, false);
  assert.deepEqual(message(page), { text: 'Password changed. Log in with your new password.', error: false, hidden: false });

  click(page, 'resetBackBtn');
  assert.equal(page.navigations.length, 1);
});

test('a reset for an account that does not exist says so', async () => {
  const page = await open('login.html', {
    'POST /api/auth/reset-question': { status: 404, body: { error: 'There is no account with that username' } },
  });
  click(page, 'forgotLink');
  fill(page, { resetUsername: 'ghost' });
  await submit(page, 'resetForm');
  assert.deepEqual(message(page), { text: 'There is no account with that username', error: true, hidden: false });
  assert.equal(byId(page, 'resetAnswerField').hidden, true);
});

test('the first portfolio login links an existing account', async () => {
  const page = await open('link.html', {
    'POST /api/auth/portfolio/pending': { body: { username: 'Gambler' } },
    'POST /api/auth/portfolio/link': SIGNED_IN,
  }, '?link=CODE');
  assert.equal(page.window.location.search, '');
  assert.equal(byId(page, 'linkName').textContent, 'Gambler');
  assert.equal(byId<HTMLInputElement>(page, 'linkUsername').value, 'Gambler');
  fill(page, { linkUsername: ' pilot ', linkPassword: 'correct horse' });
  await submit(page, 'linkForm');
  assert.deepEqual(page.requests.find((r) => r.url === '/api/auth/portfolio/link')?.body,
    { code: 'CODE', username: 'pilot', password: 'correct horse' });
  assert.equal(page.navigations.length, 1);
});

test('the first portfolio login can make a new account, and tries again after a failure', async () => {
  let attempts = 0;
  const page = await open('link.html', {
    'POST /api/auth/portfolio/pending': { body: { username: 'Gambler' } },
    'POST /api/auth/portfolio/new': () => (++attempts === 1 ? { status: 500, body: { error: 'Try again' } } : SIGNED_IN),
  }, '?link=CODE');
  const button = byId<HTMLButtonElement>(page, 'linkNewBtn');
  click(page, 'linkNewBtn');
  assert.equal(button.disabled, true);
  await settle();
  assert.equal(button.disabled, false);
  assert.deepEqual(message(page), { text: 'Try again', error: true, hidden: false });
  click(page, 'linkNewBtn');
  await settle();
  assert.equal(page.navigations.length, 1);
});

test('an expired portfolio login code hides the form and says to log in again', async () => {
  const page = await open('link.html', {
    'POST /api/auth/portfolio/pending': { status: 400, body: { error: 'Portfolio login expired.' } },
  }, '?link=OLD');
  assert.equal(byId(page, 'linkForm').hidden, true);
  assert.deepEqual(message(page), { text: 'Portfolio login expired.', error: true, hidden: false });
});

test('the link page opened without a code asks the server about an empty one and says what it answers', async () => {
  const page = await open('link.html', {
    'POST /api/auth/portfolio/pending': { status: 400, body: { error: 'Portfolio login expired.' } },
  });
  assert.deepEqual(page.requests.find((r) => r.url === '/api/auth/portfolio/pending')?.body, { code: '' });
  assert.equal(byId(page, 'linkForm').hidden, true);
  assert.deepEqual(message(page), { text: 'Portfolio login expired.', error: true, hidden: false });
});
