/**
 * Validação e máscara de telefone/WhatsApp brasileiro.
 *
 * Usado nos formulários de captura de lead (hero/footer) pra impedir
 * cadastro com número inválido. Regras:
 *  - DDD precisa ser um dos 67 DDDs reais do Brasil.
 *  - Celular: 11 dígitos, 3º dígito = 9.
 *  - Fixo:    10 dígitos, 3º dígito entre 2 e 5.
 *  - Rejeita sequências repetidas (ex: 11 99999-9999).
 */

// DDDs válidos (mesmo conjunto do backend DDD_TO_STATE).
const VALID_DDD = new Set([
  '11','12','13','14','15','16','17','18','19','21','22','24','27','28',
  '31','32','33','34','35','37','38','41','42','43','44','45','46','47','48','49',
  '51','53','54','55','61','62','63','64','65','66','67','68','69',
  '71','73','74','75','77','79','81','82','83','84','85','86','87','88','89',
  '91','92','93','94','95','96','97','98','99',
]);

/** Extrai só os dígitos, removendo o código de país 55 quando presente. */
export function phoneDigits(value: string): string {
  let d = (value || '').replace(/\D/g, '');
  // Tira o 55 (código do Brasil) se o número ficou com 12/13 dígitos.
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  return d;
}

/** Valida número de WhatsApp/telefone brasileiro. */
export function isValidPhoneBR(value: string): boolean {
  const d = phoneDigits(value);
  if (d.length !== 10 && d.length !== 11) return false;

  const ddd = d.slice(0, 2);
  if (!VALID_DDD.has(ddd)) return false;

  const rest = d.slice(2);                 // 8 (fixo) ou 9 (celular) dígitos
  // Rejeita todos os dígitos iguais no número (ex: 999999999).
  if (/^(\d)\1+$/.test(rest)) return false;

  if (d.length === 11) {
    // Celular: precisa começar com 9.
    return rest[0] === '9';
  }
  // Fixo: começa com 2–5.
  return /^[2-5]/.test(rest);
}

/**
 * Máscara progressiva pra digitação: (XX) XXXXX-XXXX (celular)
 * ou (XX) XXXX-XXXX (fixo). Cap em 11 dígitos.
 */
export function formatPhoneBR(value: string): string {
  // phoneDigits remove o 55 (código do país) em números colados tipo +55 47...
  const d = phoneDigits(value).slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2)  return `(${d}`;
  if (d.length <= 6)  return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
