'use strict';

const http = require('http');
const { openPath } = require('./open-file');
const flow = require('./onboarding-flow');
const { methodIdsForFlow } = require('./auth-methods');
const { INTER_FONT_FACE_CSS } = require('./inter-fonts');
const { SHAKERS_MARK_WHITE_SVG, SHAKERS_WORDMARK_SVG } = require('./brand-svg');

const DEFAULT_TIMEOUT_MS = 180000;
const MAX_BODY_BYTES = 64 * 1024;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

const FONT_STACK = '"Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const COPY = {
  en: {
    signin: 'Sign in', create: 'Create account', welcome: 'Welcome to Shakers. Create your talent account to get started.',
    email: 'Email', password: 'Password', repeat: 'Repeat password', first: 'First name', last: 'Last name',
    newsletter: 'I want to receive content about the future of work',
    hint: 'Your password stays on this machine. It is never sent to the chat.',
    done: 'You are signed in.', doneSub: 'You can close this tab and return to your AI app.',
    chooseTitleLogin: 'How do you want to sign in?', chooseTitleRegister: 'How do you want to create your account?',
    continueGoogle: 'Continue with Google', continueLinkedin: 'Continue with LinkedIn', continueEmail: 'Email and password', continueEmailRegister: 'Continue with email',
    socialOpening: (name) => `Opening sign-in with ${name}…`,
    socialOpeningSub: 'A sign-in window just opened. Finish there and come back to your AI app, it will carry on.',
    existing: 'You already have a Shakers account with this email. Sign in with your password or with Google.',
    errors: {
      'password-mismatch': 'Passwords do not match.', 'weak-password': 'The password needs at least 8 characters.',
      'missing-fields': 'Fill in every field.', 'invalid-credentials': 'Wrong email or password.',
      'legal-not-shown': 'Something went wrong. Start again from the first screen.', other: 'Something went wrong. Try again in a moment.',
    },
  },
  es: {
    signin: 'Iniciar sesión', create: 'Crear cuenta', welcome: 'Bienvenido a Shakers. Crea tu cuenta de talento para empezar.',
    email: 'Email', password: 'Contraseña', repeat: 'Repite la contraseña', first: 'Nombre', last: 'Apellidos',
    newsletter: 'Quiero recibir contenido sobre el futuro del trabajo',
    hint: 'Tu contraseña se queda en este equipo. Nunca se envía al chat.',
    done: 'Sesión iniciada.', doneSub: 'Puedes cerrar esta pestaña y volver a tu app de IA.',
    chooseTitleLogin: '¿Cómo quieres iniciar sesión?', chooseTitleRegister: '¿Cómo quieres crear tu cuenta?',
    continueGoogle: 'Continuar con Google', continueLinkedin: 'Continuar con LinkedIn', continueEmail: 'Email y contraseña', continueEmailRegister: 'Continuar con email',
    socialOpening: (name) => `Abriendo el acceso con ${name}…`,
    socialOpeningSub: 'Se acaba de abrir una ventana para terminar el acceso. Cuando acabes, vuelve a tu app de IA y seguirá por su cuenta.',
    existing: 'Ya tienes una cuenta en Shakers con este email. Entra con tu contraseña o con Google.',
    errors: {
      'password-mismatch': 'Las contraseñas no coinciden.', 'weak-password': 'La contraseña necesita al menos 8 caracteres.',
      'missing-fields': 'Rellena todos los campos.', 'invalid-credentials': 'Email o contraseña incorrectos.',
      'legal-not-shown': 'Algo ha fallado. Empieza otra vez desde la primera pantalla.', other: 'Algo ha fallado. Inténtalo de nuevo en un momento.',
    },
  },
  it: {
    signin: 'Accedi', create: 'Crea account', welcome: 'Benvenuto in Shakers. Crea il tuo account talent per iniziare.',
    email: 'Email', password: 'Password', repeat: 'Ripeti la password', first: 'Nome', last: 'Cognome',
    newsletter: 'Voglio ricevere contenuti sul futuro del lavoro',
    hint: 'La tua password resta su questo computer. Non viene mai inviata alla chat.',
    done: 'Accesso effettuato.', doneSub: 'Puoi chiudere questa scheda e tornare alla tua app di IA.',
    chooseTitleLogin: 'Come vuoi accedere?', chooseTitleRegister: 'Come vuoi creare il tuo account?',
    continueGoogle: 'Continua con Google', continueLinkedin: 'Continua con LinkedIn', continueEmail: 'Email e password', continueEmailRegister: 'Continua con email',
    socialOpening: (name) => `Apertura dell’accesso con ${name}…`,
    socialOpeningSub: 'Si è appena aperta una finestra per completare l’accesso. Quando hai finito, torna alla tua app di IA: continuerà da sola.',
    existing: 'Hai già un account Shakers con questa email. Accedi con la tua password o con Google.',
    errors: {
      'password-mismatch': 'Le password non coincidono.', 'weak-password': 'La password deve avere almeno 8 caratteri.',
      'missing-fields': 'Compila tutti i campi.', 'invalid-credentials': 'Email o password errate.',
      'legal-not-shown': 'Qualcosa è andato storto. Ricomincia dalla prima schermata.', other: 'Qualcosa è andato storto. Riprova tra un momento.',
    },
  },
  pt: {
    signin: 'Iniciar sessão', create: 'Criar conta', welcome: 'Bem-vindo à Shakers. Crie a sua conta de talento para começar.',
    email: 'Email', password: 'Palavra-passe', repeat: 'Repita a palavra-passe', first: 'Nome', last: 'Apelidos',
    newsletter: 'Quero receber conteúdos sobre o futuro do trabalho',
    hint: 'A sua palavra-passe fica neste computador. Nunca é enviada para o chat.',
    done: 'Sessão iniciada.', doneSub: 'Pode fechar este separador e voltar à sua app de IA.',
    chooseTitleLogin: 'Como quer iniciar sessão?', chooseTitleRegister: 'Como quer criar a sua conta?',
    continueGoogle: 'Continuar com Google', continueLinkedin: 'Continuar com LinkedIn', continueEmail: 'Email e palavra-passe', continueEmailRegister: 'Continuar com email',
    socialOpening: (name) => `A abrir o acesso com ${name}…`,
    socialOpeningSub: 'Acabou de abrir-se uma janela para terminar o acesso. Quando acabar, volte à sua app de IA, que continua sozinha.',
    existing: 'Já tem uma conta na Shakers com este email. Entre com a sua palavra-passe ou com Google.',
    errors: {
      'password-mismatch': 'As palavras-passe não coincidem.', 'weak-password': 'A palavra-passe precisa de pelo menos 8 caracteres.',
      'missing-fields': 'Preencha todos os campos.', 'invalid-credentials': 'Email ou palavra-passe incorretos.',
      'legal-not-shown': 'Algo correu mal. Comece de novo a partir do primeiro ecrã.', other: 'Algo correu mal. Tente novamente dentro de momentos.',
    },
  },
};

function copy(lang) {
  return COPY[String(lang || 'en').toLowerCase().split('-')[0]] || COPY.en;
}

// Internal reasons never reach the talent: each maps to a sentence in their language.
function errorText(c, reason) {
  return reason ? c.errors[reason] || c.errors.other : '';
}

// The web sign-up's legal block (new-sign-up legal-links.ts and authStep.legalText), copy and links verbatim; the newsletter label is its emailAuthForm one.
const LEGAL_BASE_URL = 'https://www.shakersworks.com';
const LEGAL_PREFIXES = { es: '', en: 'en/', pt: 'pt/', it: 'it/' };
const LEGAL_TEXT = {
  es: (terms, privacy) => `Al continuar, aceptas los ${terms('Términos')} y la ${privacy('Política de Privacidad')}.`,
  en: (terms, privacy) => `By continuing, you accept the ${terms('Terms')} and the ${privacy('Privacy Policy')}.`,
  it: (terms, privacy) => `Continuando, accetti i ${terms('Termini')} e l'${privacy('Informativa sulla privacy')}.`,
  pt: (terms, privacy) => `Ao continuar, aceita os ${terms('Termos')} e a ${privacy('Política de Privacidade')}.`,
};

function legalLinks(lang) {
  const code = String(lang || 'en').toLowerCase().split('-')[0];
  const prefix = code in LEGAL_PREFIXES ? LEGAL_PREFIXES[code] : 'en/';
  return { terms: `${LEGAL_BASE_URL}/${prefix}condiciones-generales`, privacy: `${LEGAL_BASE_URL}/${prefix}politica-de-privacidad` };
}

function legalHtml(lang) {
  const code = String(lang || 'en').toLowerCase().split('-')[0];
  const links = legalLinks(lang);
  const link = (href) => (label) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  return `<p class="legal">${(LEGAL_TEXT[code] || LEGAL_TEXT.en)(link(links.terms), link(links.privacy))}</p>`;
}

function header() {
  return `<div class="brand"><span class="appicon">${SHAKERS_MARK_WHITE_SVG}</span></div>`;
}

function panel(text) {
  return `<div class="panel"><div class="pbrand">${SHAKERS_MARK_WHITE_SVG}${SHAKERS_WORDMARK_SVG}</div><p>${text}</p></div>`;
}

function styles() {
  return `<style>${INTER_FONT_FACE_CSS}`
    + `:root{--background:#ffffff;--foreground:#18181b;--primary:#05342c;--primary-foreground:#fafafa;`
    + `--secondary:#e2f2f0;--secondary-foreground:#0b5a4c;--muted-foreground:#3f3f46;--accent:#e2f2f0;--accent-foreground:#08473c;`
    + `--input:#d4d4d8;--border:#e4e4e7;--ring:#0e7d69;--destructive:#e11d48;--radius:0.625rem;--radius-md:calc(var(--radius) - 2px);`
    + `--shadow-xs:0 1px 3px 0px rgb(0 0 0 / .05)}`
    + `*{box-sizing:border-box}`
    + `body{font-family:${FONT_STACK};margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fafafa;color:var(--foreground);padding:1.5rem;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}`
    + `.card{width:100%;max-width:26rem;background:var(--background);border:1px solid var(--border);border-radius:var(--radius);box-shadow:0 10px 30px rgb(3 33 28 / .08);overflow:hidden}`
    + `.body{padding:2rem}`
    + `.brand{display:flex;align-items:center;gap:.6rem;margin:0 0 1.25rem}`
    + `.appicon{display:inline-flex;align-items:center;justify-content:center;width:2.5rem;height:2.5rem;border-radius:.7rem;background:var(--primary);flex:0 0 auto}`
    + `.appicon .mk{height:1.35rem;width:auto;display:block}`
    + `.panel{background:var(--primary);color:var(--primary-foreground);padding:1.75rem 2rem}`
    + `.pbrand{display:flex;align-items:center;gap:.7rem;margin:0 0 .75rem}`
    + `.pbrand .mk{height:1.5rem;width:auto;display:block}`
    + `.pbrand .wm{height:1.05rem;width:auto;display:block;color:var(--primary-foreground)}`
    + `.panel p{margin:0;font-size:.9rem;color:#cfe6e2;line-height:1.45}`
    + `h1{font-size:1.15rem;font-weight:600;color:var(--foreground);margin:0 0 1rem;letter-spacing:-.01em}`
    + `label{display:block;margin:.85rem 0 .35rem;font-size:.875rem;font-weight:500;color:var(--foreground);line-height:1}`
    + `label.chk{display:flex;align-items:center;gap:.5rem;font-weight:400}`
    + `input,select{height:2.25rem;width:100%;min-width:0;padding:.25rem .75rem;border:1px solid var(--input);border-radius:var(--radius-md);font-size:.875rem;font-family:inherit;line-height:1.25rem;color:var(--foreground);background:var(--background);box-shadow:var(--shadow-xs);outline:none;transition:color .15s,box-shadow .15s,border-color .15s}`
    + `input::placeholder{color:var(--muted-foreground)}`
    + `input:focus-visible,select:focus-visible{border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 50%,transparent)}`
    + `input[type=checkbox]{height:auto;width:auto;box-shadow:none;accent-color:var(--primary)}`
    + `button{margin-top:1.4rem;display:inline-flex;align-items:center;justify-content:center;gap:.5rem;width:100%;height:2.25rem;padding:.5rem 1rem;border:1px solid var(--primary);border-radius:var(--radius-md);background:var(--primary);color:var(--primary-foreground);font-size:.875rem;font-weight:500;font-family:inherit;cursor:pointer;transition:background .15s,box-shadow .15s}`
    + `button:hover{background:color-mix(in oklab,var(--primary) 90%,transparent)}`
    + `button:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 50%,transparent)}`
    + `button:disabled{opacity:.5;pointer-events:none}`
    + `.err{background:color-mix(in oklab,var(--destructive) 12%,transparent);color:var(--destructive);padding:.6rem .7rem;border-radius:var(--radius-md);margin:0 0 .75rem;font-size:.875rem}`
    + `.hint{color:var(--muted-foreground);font-size:.8rem;margin:.9rem 0 0;line-height:1.45}`
    + `.actions{display:flex;flex-direction:column;gap:.6rem;margin-top:1.25rem}`
    + `.mbtn{display:inline-flex;align-items:center;justify-content:center;gap:.6rem;width:100%;height:2.5rem;padding:.5rem 1rem;border-radius:var(--radius-md);font-size:.9rem;font-weight:500;font-family:inherit;text-decoration:none;cursor:pointer;border:1px solid transparent;transition:background .15s,border-color .15s,box-shadow .15s}`
    + `.mbtn:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 50%,transparent)}`
    + `.mbtn.primary{background:var(--primary);color:var(--primary-foreground);border-color:var(--primary)}`
    + `.mbtn.primary:hover{background:color-mix(in oklab,var(--primary) 90%,transparent)}`
    + `.mbtn.secondary{background:var(--background);color:var(--foreground);border-color:var(--border);box-shadow:var(--shadow-xs)}`
    + `.mbtn.secondary:hover{background:var(--accent);color:var(--accent-foreground)}`
    + `.mbtn .g{width:18px;height:18px;flex:0 0 auto}`
    + `.legal{margin:1rem 0 0;text-align:center;font-size:.75rem;line-height:1rem;color:var(--muted-foreground)}`
    + `.legal a{font-weight:600;color:var(--secondary-foreground);text-decoration:none}.legal a:hover{text-decoration:underline}`
    + `label.news{display:flex;align-items:flex-start;gap:.5rem;margin:1rem 0 0;font-weight:400;line-height:1.25rem}</style>`;
}

function page(title, { banner = '', inner = '' } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>`
    + `${styles()}</head><body><main class="card">${banner}<div class="body">${header()}${inner}</div></main></body></html>`;
}

function errorBanner(text) {
  return text ? `<div class="err">${esc(text)}</div>` : '';
}

function loginFormHtml(lang, { error } = {}) {
  const c = copy(lang);
  return page(`Shakers · ${c.signin}`, {
    inner: `<h1>${c.signin}</h1>${errorBanner(errorText(c, error))}`
      + `<form method="post" action="/submit">`
      + `<label>${c.email}</label><input name="email" type="email" required autofocus>`
      + `<label>${c.password}</label><input name="password" type="password" required>`
      + `<button type="submit">${c.signin}</button>`
      + `<p class="hint">${c.hint}</p>`
      + `</form>`,
  });
}

// Identity the AI did not know is asked here, never in the chat: only the missing fields render.
function missingIdentityInputs(c, missing = {}) {
  return (missing.email ? `<label>${c.email}</label><input name="email" type="email" required autocomplete="email">` : '')
    + (missing.name ? `<label>${c.first}</label><input name="name" required autocomplete="given-name">` : '')
    + (missing.lastName ? `<label>${c.last}</label><input name="lastName" required autocomplete="family-name">` : '');
}

function registerFormHtml(lang, { error, missing } = {}) {
  const c = copy(lang);
  return page(`Shakers · ${c.create}`, {
    banner: panel(c.welcome),
    inner: `<h1>${c.create}</h1>${errorBanner(errorText(c, error))}`
      + `<form method="post" action="/submit">`
      + missingIdentityInputs(c, missing).replace('required', 'required autofocus')
      + `<label>${c.password}</label><input name="password" type="password" required minlength="8"${missing && (missing.email || missing.name || missing.lastName) ? '' : ' autofocus'}>`
      + `<label>${c.repeat}</label><input name="passwordConfirm" type="password" required minlength="8">`
      + `<label class="news"><input type="checkbox" name="newsletterConsent"> ${c.newsletter}</label>`
      + `<input type="hidden" name="legal" value="1">`
      + `<button type="submit">${c.create}</button>`
      + `<p class="hint">${c.hint}</p>`
      + `</form>`
      + legalHtml(lang)
      + `<script>(function(){document.forms[0].addEventListener('submit',function(e){var f=this;if(f.password.value!==f.passwordConfirm.value){e.preventDefault();alert(${JSON.stringify(c.errors['password-mismatch'])});}});})();</script>`,
  });
}

function formHtml(mode, lang, opts) {
  return mode === 'register' ? registerFormHtml(lang, opts) : loginFormHtml(lang, opts);
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function missingIdentity(registerFields = {}) {
  return { email: !trimmed(registerFields.email), name: !trimmed(registerFields.name), lastName: !trimmed(registerFields.lastName) };
}

const GOOGLE_G = '<svg class="g" viewBox="0 0 48 48" aria-hidden="true">'
  + '<path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.2 13.3 17.6 9.5 24 9.5z"/>'
  + '<path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.6c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7c4.3-4 6.3-9.8 6.3-17.4z"/>'
  + '<path fill="#FBBC05" d="M10.4 28.3c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8l-7.8-6.1C.9 15.9 0 19.8 0 23.5s.9 7.6 2.6 10.9l7.8-6.1z"/>'
  + '<path fill="#34A853" d="M24 47c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.6 2.3-6.4 0-11.8-3.8-13.6-9.8l-7.8 6.1C6.5 41.6 14.6 47 24 47z"/></svg>';

const LINKEDIN_IN = '<svg class="g" viewBox="0 0 24 24" aria-hidden="true">'
  + '<path fill="#0A66C2" d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.26 2.37 4.26 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>';

// Each window offers these methods, in this order. The sign-up window has no LinkedIn: only Google carries the claim code there.
const WINDOW_METHODS = { login: ['google', 'linkedin', 'email'], register: ['google', 'email'] };

// The method-choice screen (talents-ai-score) — the FIRST screen of the loopback form when more than one method is offered for this flow.
function methodChoiceHtml(mode, lang, methods) {
  const c = copy(lang);
  const title = mode === 'register' ? c.chooseTitleRegister : c.chooseTitleLogin;
  const emailLabel = mode === 'register' ? c.continueEmailRegister : c.continueEmail;
  const register = mode === 'register';
  const buttons = WINDOW_METHODS[mode].filter((id) => methods.includes(id)).map((id) => {
    if (id === 'google') return `<a class="mbtn primary" href="/google${register ? '?legal=1' : ''}">${GOOGLE_G}${c.continueGoogle}</a>`;
    if (id === 'linkedin') return `<a class="mbtn secondary" href="/linkedin">${LINKEDIN_IN}${c.continueLinkedin}</a>`;
    return `<a class="mbtn secondary" href="/email">${emailLabel}</a>`;
  }).join('');
  return page(`Shakers · ${title}`, {
    inner: `<h1>${title}</h1><div class="actions">${buttons}</div><p class="hint">${c.hint}</p>${register ? legalHtml(lang) : ''}`,
  });
}

// The sign-up window learns the account exists only after the talent submits: it then asks them to sign in instead of creating one.
function existingAccountHtml(lang, { email, error } = {}) {
  const c = copy(lang);
  return page(`Shakers · ${c.signin}`, {
    inner: `<h1>${c.signin}</h1>${errorBanner(error ? errorText(c, error) : c.existing)}`
      + `<form method="post" action="/submit"><input type="hidden" name="intent" value="login">`
      + `<label>${c.email}</label><input name="email" type="email" required value="${esc(email || '')}">`
      + `<label>${c.password}</label><input name="password" type="password" required autofocus>`
      + `<button type="submit">${c.signin}</button>`
      + `</form>`
      + `<div class="actions"><a class="mbtn secondary" href="/google?legal=1">${GOOGLE_G}${c.continueGoogle}</a></div>`
      + `<p class="hint">${c.hint}</p>`,
  });
}

function socialHandoffHtml(lang, provider) {
  const c = copy(lang);
  const name = provider === 'linkedin' ? 'LinkedIn' : 'Google';
  return page('Shakers', { inner: `<h1>${c.socialOpening(name)}</h1><p>${c.socialOpeningSub}</p>` });
}

function successHtml(lang) {
  const c = copy(lang);
  return page('Shakers', { inner: `<h1>${c.done}</h1><p>${c.doneSub}</p>` });
}

function parseBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    let aborted = false;
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) { aborted = true; req.destroy(); }
    });
    req.on('end', () => {
      if (aborted) return resolve({});
      const params = new URLSearchParams(raw);
      const out = {};
      for (const [k, v] of params) out[k] = v;
      resolve(out);
    });
    req.on('error', () => resolve({}));
  });
}

async function doAuth(mode, body, deps, lang, registerFields = {}) {
  const password = typeof body.password === 'string' ? body.password : '';

  if (mode === 'register' && body.intent === 'login') {
    const email = trimmed(body.email);
    if (!email || !password) return { ok: false, reason: 'missing-fields', existing: true, email };
    const sess = await flow.establishSessionFromCredentials(deps, { email, password });
    return sess.ok ? { ok: true, email, accountExists: true } : { ok: false, reason: 'invalid-credentials', existing: true, email };
  }

  if (mode === 'register') {
    // Only the form that shows the legal block posts legal=1: no account without it.
    if (body.legal !== '1') return { ok: false, reason: 'legal-not-shown' };
    if (!password) return { ok: false, reason: 'missing-fields' };
    if (password !== (body.passwordConfirm || '')) return { ok: false, reason: 'password-mismatch' };
    const email = trimmed(registerFields.email) || trimmed(body.email);
    const name = trimmed(registerFields.name) || trimmed(body.name);
    const lastName = trimmed(registerFields.lastName) || trimmed(body.lastName);
    if (!email || !name || !lastName) return { ok: false, reason: 'missing-fields' };
    // Read at submit time: the MCP sign-up may swap its claim code while the window is open.
    const claimCode = typeof registerFields.claimCode === 'function' ? registerFields.claimCode() : registerFields.claimCode;
    const su = await flow.signUp(deps, {
      name,
      lastName,
      email,
      password,
      preferredLanguage: registerFields.preferredLanguage || lang,
      newsletterConsent: registerFields.newsletterConsent === true || body.newsletterConsent === 'on',
      freelanceType: registerFields.freelanceType,
      freelanceIntent: registerFields.freelanceIntent,
      claimCode: claimCode || null,
    });
    if (!su.ok) return { ok: false, reason: su.reason };
    const sess = await flow.establishSessionFromCredentials(deps, { email, password });
    // An existing account with another password: the talent signs in to it instead.
    if (!sess.ok && su.accountExists === true) return { ok: false, reason: null, existing: true, email };
    if (!sess.ok) return { ok: false, reason: sess.reason };
    const out = { ok: true, email, accountExists: su.accountExists === true };
    if (claimCode) out.claimed = su.claimed === true;
    return out;
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!email || !password) return { ok: false, reason: 'missing-fields' };
  const sess = await flow.establishSessionFromCredentials(deps, { email, password });
  return sess.ok ? { ok: true, email } : { ok: false, reason: sess.reason };
}

// `onGoogle` (MCP sign-up) returns the provider URL to redirect to; without it Google hands back to the caller for the device flow.
function runLoopbackAuth(
  { mode = 'login', deps = null, lang = 'en', method = null, registerFields = null } = {},
  { openBrowser = openPath, timeoutMs = DEFAULT_TIMEOUT_MS, onUrl = null, onGoogle = null } = {},
) {
  const formOpts = mode === 'register' ? { missing: missingIdentity(registerFields || {}) } : {};
  const resolvedDeps = deps || flow.makeDeps();
  const methods = methodIdsForFlow(mode);
  const showMethodScreen = !method && methods.length > 1;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { server.close(); } catch { /* already closing */ }
      resolve(result);
    };

    const server = http.createServer(async (req, res) => {
      let url;
      try {
        url = new URL(req.url, 'http://127.0.0.1');
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(showMethodScreen ? methodChoiceHtml(mode, lang, methods) : formHtml(mode, lang, formOpts));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/email') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(formHtml(mode, lang, formOpts));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/google' && mode === 'register' && url.searchParams.get('legal') !== '1') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(methodChoiceHtml(mode, lang, methods));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/google' && methods.includes('google') && typeof onGoogle === 'function') {
        const target = await onGoogle();
        if (!target || !target.ok || !target.url) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(formHtml(mode, lang, { ...formOpts, error: (target && target.reason) || 'google-unavailable' }));
          return;
        }
        res.writeHead(302, { Location: target.url });
        res.end();
        finish({ ok: true, viaSocial: true, provider: 'google' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/google' && methods.includes('google')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(socialHandoffHtml(lang, 'google'));
        finish({ ok: true, viaSocial: true, provider: 'google' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/linkedin' && methods.includes('linkedin') && WINDOW_METHODS[mode].includes('linkedin')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(socialHandoffHtml(lang, 'linkedin'));
        finish({ ok: true, viaSocial: true, provider: 'linkedin' });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/submit') {
        const body = await parseBody(req);
        const outcome = await doAuth(mode, body, resolvedDeps, lang, registerFields || {});
        if (outcome.ok) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(successHtml(lang));
          finish(outcome);
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(outcome.existing
            ? existingAccountHtml(lang, { email: outcome.email, error: outcome.reason })
            : formHtml(mode, lang, { ...formOpts, error: outcome.reason }));
        }
        return;
      }
      res.writeHead(404).end();
    });

    const timer = setTimeout(() => finish({ ok: false, reason: 'browser-timeout' }), timeoutMs);
    if (timer.unref) timer.unref();
    server.on('error', () => finish({ ok: false, reason: 'local-error' }));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const formUrl = `http://127.0.0.1:${port}/`;
      if (typeof onUrl === 'function') onUrl(formUrl);
      try { openBrowser(formUrl); } catch { /* headless: the onUrl fallback covers it */ }
    });
  });
}

module.exports = { runLoopbackAuth, doAuth, loginFormHtml, registerFormHtml, existingAccountHtml, methodChoiceHtml, socialHandoffHtml, DEFAULT_TIMEOUT_MS };
