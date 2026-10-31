// The Log in, Register and Link Your Account pages. All go back to the main page once signed in.

import { MAX_SECURITY_ANSWER, SECURITY_QUESTIONS } from '../shared/securityQuestions.js';
import { el, errorMessage, escapeHtml } from './format.js';
import { syncBankrolls } from './identity.js';
import {
  linkPortfolioAccount, loadAuthStatus, loginAccount, newPortfolioAccount, portfolioPending, registerAccount,
  resetPassword, resetQuestion, wirePortfolioButton,
} from './auth.js';

function fieldValue(id: string): string {
  /* c8 ignore next - every field it reads is on the account page */
  return el<HTMLInputElement | HTMLSelectElement | null>(id)?.value ?? '';
}

function showMessage(text: string, isError = false): void {
  const message = el<HTMLElement | null>('accountMessage');
  /* c8 ignore next - the account page always has its message line */
  if (!message) return;
  message.hidden = !text;
  message.textContent = text;
  message.classList.toggle('error', isError);
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
  el<HTMLElement | null>('loginLinks')?.toggleAttribute('hidden', id !== 'loginForm');
  showMessage('');
}

function onSubmit(id: string, handler: () => Promise<void>, fallback: string): void {
  el<HTMLFormElement | null>(id)?.addEventListener('submit', (e) => {
    e.preventDefault();
    void handler().catch((err: unknown) => showMessage(errorMessage(err, fallback), true));
  });
}

async function finishSignIn(): Promise<void> {
  await syncBankrolls();
  location.href = 'index.html';
}

function wireRegister(portfolio: boolean, portfolioUrl: string | undefined): void {
  onSubmit('registerForm', async () => {
    if (fieldValue('registerPassword') !== fieldValue('registerConfirm')) {
      throw new Error('Passwords do not match');
    }
    await registerAccount(fieldValue('registerUsername').trim(), fieldValue('registerPassword'),
      fieldValue('registerQuestion'), fieldValue('registerAnswer'));
    await finishSignIn();
  }, 'Registration failed');

  const portfolioBtn = el<HTMLElement | null>('pagePortfolioBtn');
  if (portfolio && portfolioBtn) {
    el('portfolioLink').hidden = false;
    wirePortfolioButton(portfolioBtn, portfolioUrl);
  }
}

// Reset takes two steps: the username brings up its security question, then
// the answer and a new password change it.
function wireLogin(): void {
  onSubmit('loginForm', async () => {
    await loginAccount(fieldValue('loginUsername').trim(), fieldValue('loginPassword'));
    await finishSignIn();
  }, 'Log in failed');

  el<HTMLElement | null>('forgotLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    showForm('resetForm');
  });
  el<HTMLElement | null>('resetBackBtn')?.addEventListener('click', () => {
    location.href = 'login.html';
  });

  const answerField = el('resetAnswerField');
  onSubmit('resetForm', async () => {
    const username = fieldValue('resetUsername').trim();
    if (answerField.hidden) {
      const question = el('resetQuestion');
      question.textContent = await resetQuestion(username);
      for (const field of [question, answerField, el('resetPasswordField')]) field.hidden = false;
      el<HTMLInputElement>('resetUsername').readOnly = true;
      el('resetSubmitBtn').textContent = 'Reset password';
      el<HTMLElement | null>('resetAnswer')?.focus();
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
    el('linkName').textContent = name;
    el<HTMLInputElement>('linkUsername').value = name;
  } catch (err) {
    showForm('');
    showMessage(errorMessage(err, 'Log in with your portfolio account again.'), true);
    return;
  }
  onSubmit('linkForm', async () => {
    await linkPortfolioAccount(code, fieldValue('linkUsername').trim(), fieldValue('linkPassword'));
    await finishSignIn();
  }, 'Linking failed');
  const newButton = el<HTMLButtonElement | null>('linkNewBtn');
  newButton?.addEventListener('click', () => {
    newButton.disabled = true;
    void newPortfolioAccount(code)
      .then(finishSignIn)
      .catch((err: unknown) => {
        newButton.disabled = false;
        showMessage(errorMessage(err, 'Could not make the account'), true);
      });
  });
  el<HTMLElement | null>('linkPassword')?.focus();
}

async function mountAccountPage(): Promise<void> {
  const status = await loadAuthStatus();
  if (!status.accounts) {
    for (const form of document.querySelectorAll<HTMLFormElement>('.account-form')) form.hidden = true;
    el<HTMLElement | null>('loginLinks')?.toggleAttribute('hidden', true);
    showMessage('Accounts are not turned on for this server.');
    return;
  }
  fillSecurityFields();
  if (el<HTMLElement | null>('registerForm')) wireRegister(Boolean(status.portfolio), status.portfolioUrl);
  if (el<HTMLElement | null>('loginForm')) wireLogin();
  if (el<HTMLElement | null>('linkForm')) await wireLinkPage();
}

document.addEventListener('DOMContentLoaded', () => {
  void mountAccountPage();
});
