// auth.js — WhatsApp sign-in, isolated so the provider stays swappable.
//
// Flow: enter your WhatsApp number → POST /auth/whatsapp → the Worker returns an
// HMAC-signed session token we keep in localStorage and hand to presence.js.
// Keyless and free; the number is both your identity and your contact link.

import { API_BASE } from '../config.js';

const TOKEN_KEY = 'thermals.token';
const PHONE_KEY = 'thermals.authPhone';

export function getToken() { return localStorage.getItem(TOKEN_KEY) || null; }
export function getAuthedPhone() { return localStorage.getItem(PHONE_KEY) || null; }
export function isSignedIn() { return !!getToken(); }
export function signOut() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(PHONE_KEY); }

// Sign in with a WhatsApp number. Persists the token + phone, returns the token.
//
// If the backend isn't reachable yet (Worker not deployed, or API_BASE still the
// placeholder) we sign in *locally* so the app is usable on each device on its
// own. You won't see other pilots until the Worker is live — that's the only
// thing a real backend adds here.
export async function signIn(phone) {
  if (!/^\+?[1-9]\d{6,15}$/.test(String(phone).replace(/[\s-]/g, ''))) {
    throw new Error('Enter a valid WhatsApp number');
  }
  let res;
  try {
    res = await fetch(`${API_BASE}/auth/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
  } catch {
    return localSignIn(phone);            // backend unreachable → local-only
  }
  if (!res.ok) throw new Error((await safeMsg(res)) || 'Could not sign in');
  const data = await res.json();
  if (!data.token) throw new Error('No token returned');
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(PHONE_KEY, phone);
  return data.token;
}

function localSignIn(phone) {
  const token = 'local.' + String(phone).replace(/[^\d]/g, '');
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(PHONE_KEY, phone);
  return token;
}

// True when the active session is a local-only (no-backend) sign-in.
export function isLocalSession() { return (getToken() || '').startsWith('local.'); }

async function safeMsg(res) {
  try { const j = await res.json(); return j.error || j.message; } catch { return null; }
}
