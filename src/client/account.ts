// The Log in, Register and Link Your Account pages. All go back to the main page once signed in.

import { MAX_SECURITY_ANSWER, SECURITY_QUESTIONS } from '../shared/securityQuestions.js';
import { escapeHtml } from './format.js';
import { syncBankrolls } from './identity.js';
import {
  linkPortfolioAccount, loadAuthStatus, loginAccount, newPortfolioAccount, portfolioPending, registerAccount,
  resetPassword, resetQuestion, saveSecurityQuestion, wirePortfolioButton,
} from './auth.js';

function element<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function fieldValue(id: string): string {
  return element<HTMLInputElement | HTMLSelectElement>(id)?.value ?? '';
}

function showMessage(text: string, isError = false): void {
  const el = element('accountMessage');
  if (!el) return;
  el.hidden = !text;
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function fillSecurityFields(): void {
  const options = SECURITY_QUESTIONS.map((q) => `<option>${escapeHtml(q)}</option>`).join('');
  for (const select of document.querySelectorAll<HTMLSelectElement>('.question-select')) {
    select.innerHTML = `<option value="">Pick a question</option>${options}`;
  }
  for (const input of document.querySelectorAll<HTMLInputElement>('.answer-input')) {
    input.maxLength = MAX_SECURITY_ANSWER;
  }
}

// Only one of a page's forms shows at a time.
function showForm(id: string): void {
  for (const form of document.querySelectorAll<HTMLFormElement>('.account-form')) {
    form.hidden = form.id !== id;
  }
  element('loginLinks')?.toggleAttribute('hidden', id !== 'loginForm');
  showMessage('');
}

function onSubmit(id: string, handler: () => Promise<void>, fallback: string): void {
  element<HTMLFormElement>(id)?.addEventListener('submit', (e) => {
    e.preventDefault();
    void handler().catch((err: unknown) => showMessage(errorText(err, fallback), true));
  });
}

async function finishSignIn(needsSecurityQuestion: boolean): Promise<void> {
  await syncBankrolls();
  if (needsSecurityQuestion) {
    showForm('securityForm');
    return;
  }
  location.href = 'index.html';
}

function wireRegister(portfolio: boolean, portfolioUrl: string | undefined): void {
  onSubmit('registerForm', async () => {
    if (fieldValue('registerPassword') !== fieldValue('registerConfirm')) {
      throw new Error('Passwords do not match');
    }
    await registerAccount(fieldValue('registerUsername').trim(), fieldValue('registerPassword'),
      fieldValue('registerQuestion'), fieldValue('registerAnswer'));
    await finishSignIn(false);
  }, 'Registration failed');

  const portfolioBtn = element('pagePortfolioBtn');
  if (portfolio && portfolioBtn) {
    element('portfolioLink')!.hidden = false;
    wirePortfolioButton(portfolioBtn, portfolioUrl);
  }
}

// Reset takes two steps: the username brings up its security question, then
// the answer and a new password change it.
function wireLogin(): void {
  onSubmit('loginForm', async () => {
    const result = await loginAccount(fieldValue('loginUsername').trim(), fieldValue('loginPassword'));
    await finishSignIn(result.needsSecurityQuestion);
  }, 'Log in failed');

  element('forgotLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    showForm('resetForm');
  });
  element('resetBackBtn')?.addEventListener('click', () => {
    location.href = 'login.html';
  });

  const answerField = element('resetAnswerField')!;
  onSubmit('resetForm', async () => {
    const username = fieldValue('resetUsername').trim();
    if (answerField.hidden) {
      const question = element('resetQuestion')!;
      question.textContent = await resetQuestion(username);
      for (const el of [question, answerField, element('resetPasswordField')!]) el.hidden = false;
      element<HTMLInputElement>('resetUsername')!.readOnly = true;
      element('resetSubmitBtn')!.textContent = 'Reset password';
      element('resetAnswer')?.focus();
      return;
    }
    await resetPassword(username, fieldValue('resetAnswer'), fieldValue('resetPassword'));
    showForm('loginForm');
    showMessage('Password changed. Log in with your new password.');
  }, 'Reset failed');
}

// The first portfolio login: link a tracker account the player already has,
// or make a new one. The code comes out of the address bar straight away so a
// reload or a shared link can't replay it.
async function wireLinkPage(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const code = params.get('link') ?? '';
  history.replaceState(null, '', location.pathname);
  try {
    const name = await portfolioPending(code);
    element('linkName')!.textContent = name;
    element<HTMLInputElement>('linkUsername')!.value = name;
  } catch (err) {
    showForm('');
    showMessage(errorText(err, 'Log in with your portfolio account again.'), true);
    return;
  }
  onSubmit('linkForm', async () => {
    const result = await linkPortfolioAccount(code, fieldValue('linkUsername').trim(), fieldValue('linkPassword'));
    await finishSignIn(result.needsSecurityQuestion);
  }, 'Linking failed');
  element('linkNewBtn')?.addEventListener('click', () => {
    void newPortfolioAccount(code)
      .then(() => finishSignIn(false))
      .catch((err: unknown) => showMessage(errorText(err, 'Could not make the account'), true));
  });
  element('linkPassword')?.focus();
}

async function mountAccountPage(): Promise<void> {
  const status = await loadAuthStatus();
  if (!status.accounts) {
    for (const form of document.querySelectorAll<HTMLFormElement>('.account-form')) form.hidden = true;
    element('loginLinks')?.toggleAttribute('hidden', true);
    showMessage('Accounts are not turned on for this server.');
    return;
  }
  fillSecurityFields();
  if (element('registerForm')) wireRegister(Boolean(status.portfolio), status.portfolioUrl);
  if (element('loginForm')) wireLogin();
  if (element('linkForm')) await wireLinkPage();
  onSubmit('securityForm', async () => {
    await saveSecurityQuestion(fieldValue('securityQuestion'), fieldValue('securityAnswer'));
    location.href = 'index.html';
  }, 'Could not save');
}

document.addEventListener('DOMContentLoaded', () => {
  void mountAccountPage();
});
