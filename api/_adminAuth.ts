import { createHmac } from 'crypto';

const SECRET   = process.env.ADMIN_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = 8 * 60 * 60 * 1000; // 8 h

const USERS: Record<string, string> = {
  andre:  '145414',
  andré:  '145414',
  mari:   '234237',
};

export function validateCredentials(user: string, pass: string): string | null {
  const key = user.toLowerCase().trim();
  // normalize "andré" / "andre"
  const stored = USERS[key] ?? USERS[key.normalize('NFD').replace(/\p{Diacritic}/gu, '')];
  if (stored && stored === pass) {
    return (key === 'andre' || key === 'andré') ? 'andré' : key;
  }
  return null;
}

export function createToken(user: string): string {
  const iat     = Date.now();
  const payload = Buffer.from(JSON.stringify({ user, iat })).toString('base64url');
  const sig     = createHmac('sha256', SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyToken(authHeader?: string): { user: string; iat: number } | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const dot = token.lastIndexOf('.');
    if (dot === -1) return null;
    const payload = token.slice(0, dot);
    const sig     = token.slice(dot + 1);
    const expected = createHmac('sha256', SECRET).update(payload).digest('hex');
    if (expected !== sig) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { user: string; iat: number };
    if (Date.now() - data.iat > TOKEN_TTL) return null;
    return data;
  } catch {
    return null;
  }
}
