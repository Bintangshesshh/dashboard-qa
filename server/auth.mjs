import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { authorized, fail } from './validation.mjs';

const scrypt = promisify(scryptCallback);
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export const SESSION_COOKIE = 'qa_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') fail('Email is required');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email address');
  return email;
}

export function normalizeName(value) {
  if (typeof value !== 'string') fail('Name is required');
  const name = value.trim();
  if (!name || name.length > 100) fail('Name must contain 1–100 characters');
  return name;
}

export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 200) {
    fail('Password must contain 8–200 characters');
  }
  return value;
}

export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  try {
    const [algorithm, n, r, p, salt, expected] = encoded.split('$');
    if (algorithm !== 'scrypt' || !salt || !expected) return false;
    const expectedBuffer = Buffer.from(expected, 'base64url');
    const actual = await scrypt(password, Buffer.from(salt, 'base64url'), expectedBuffer.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
  } catch {
    return false;
  }
}

export function readCookie(header, name = SESSION_COOKIE) {
  if (typeof header !== 'string') return '';
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

export function cookieOptions(secure) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(secure),
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

export function setSessionCookie(res, token, secure) {
  res.cookie(SESSION_COOKIE, token, cookieOptions(secure));
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function issueSession(store, userId, secure) {
  const token = randomToken();
  const csrfToken = randomToken(24);
  const now = Date.now();
  await store.cleanupSessions(new Date(now).toISOString());
  await store.createSession({
    tokenHash: hashSessionToken(token),
    userId,
    csrfToken,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  });
  return { token, csrfToken, secure: Boolean(secure) };
}

export async function authenticateRequest(req, store) {
  const token = readCookie(req.headers?.cookie);
  if (!token || token.length > 512) return null;
  const tokenHash = hashSessionToken(token);
  const session = await store.getSession(tokenHash);
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= Date.now()) {
    await store.deleteSession(tokenHash);
    return null;
  }
  return { ...session, tokenHash, token };
}

export function csrfValid(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  return authorized(req.headers['x-csrf-token'], req.session?.csrfToken);
}

export function sameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
