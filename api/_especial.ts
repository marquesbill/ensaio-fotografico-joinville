// Helper compartilhado (prefixo _ = não vira rota na Vercel).
// Token não-adivinhável do link público de um Especial: deriva do id via HMAC,
// então NÃO precisa de coluna nova nem de guardar token. admin-bookings gera o
// link (na criação); api/especial valida. Os dois usam o MESMO ADMIN_SECRET.
import { createHmac } from 'crypto';

const SECRET = process.env.ADMIN_SECRET || 'dev-secret-change-me';

export function especialToken(id: string): string {
  return createHmac('sha256', SECRET).update('especial:' + id).digest('hex').slice(0, 24);
}
