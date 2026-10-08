'use strict';

const { toSignupLanguage } = require('./signup-copy');

// The talent's language: the welcome fixes it from their first message and every later sign-up text keeps it.
let fixed = null;

function fixSignupLanguage(code) {
  fixed = toSignupLanguage(code);
  return fixed;
}

function signupLanguage(fallback = 'en') {
  return fixed || toSignupLanguage(fallback) || 'en';
}

function resetSignupLanguage() {
  fixed = null;
}

module.exports = { fixSignupLanguage, signupLanguage, resetSignupLanguage };
