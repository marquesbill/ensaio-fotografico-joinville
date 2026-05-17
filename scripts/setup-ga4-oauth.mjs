#!/usr/bin/env node
/**
 * setup-ga4-oauth.mjs — Roda LOCALMENTE 1 única vez.
 *
 * Abre o browser, te leva pro consent screen do Google, captura o refresh
 * token e imprime no terminal. Você copia o token e cola no Vercel env vars.
 *
 * Como usar:
 *   1. Criar OAuth Client no GCP (Web app) com redirect URI:
 *      http://localhost:8765/oauth-callback
 *   2. Anotar Client ID e Client Secret
 *   3. Setar variáveis e rodar:
 *      GA4_OAUTH_CLIENT_ID="..." GA4_OAUTH_CLIENT_SECRET="..." \
 *        node scripts/setup-ga4-oauth.mjs
 *   4. Browser abre, você faz login Google e aprova.
 *   5. Refresh token aparece no terminal — copie e cole no Vercel.
 */

import { createServer } from 'http';
import { exec } from 'child_process';
import { OAuth2Client } from 'google-auth-library';

const PORT = 8765;
const REDIRECT_URI = `http://localhost:${PORT}/oauth-callback`;
const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

const clientId     = process.env.GA4_OAUTH_CLIENT_ID;
const clientSecret = process.env.GA4_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('\n❌ Faltam env vars:');
  console.error('   GA4_OAUTH_CLIENT_ID="..." \\');
  console.error('   GA4_OAUTH_CLIENT_SECRET="..." \\');
  console.error('   node scripts/setup-ga4-oauth.mjs\n');
  process.exit(1);
}

const oauth2 = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',   // refresh token
  prompt: 'consent',        // força mostrar consent + dar refresh token mesmo se já aprovado
  scope: SCOPES,
});

// Servidor local que recebe o callback
const server = createServer(async (req, res) => {
  if (!req.url?.startsWith('/oauth-callback')) {
    res.writeHead(404); res.end('Not found'); return;
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code  = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<h1>Erro: ${error}</h1>`);
    console.error(`\n❌ Erro OAuth: ${error}\n`);
    server.close(); process.exit(1);
    return;
  }
  if (!code) {
    res.writeHead(400); res.end('Missing code'); return;
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end('<h1>Erro: refresh_token não retornado</h1><p>Tente revogar acesso em myaccount.google.com/permissions e refazer.</p>');
      console.error('\n❌ Google não retornou refresh_token.');
      console.error('   Vá em https://myaccount.google.com/permissions, revogue o app, e rode de novo.\n');
      server.close(); process.exit(1);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <html><body style="font-family:system-ui;max-width:600px;margin:60px auto;padding:20px;background:#0f0a1f;color:#fff;">
        <h1 style="color:#c084fc">✅ Conectado!</h1>
        <p>Token capturado. Volte ao terminal pra copiar e adicionar no Vercel.</p>
        <p style="color:#a0a0a0;font-size:14px;">Pode fechar essa aba.</p>
      </body></html>
    `);

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  ✅ SUCESSO — copie e adicione no Vercel:                  ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log('  GA4_OAUTH_CLIENT_ID =');
    console.log(`    ${clientId}\n`);
    console.log('  GA4_OAUTH_CLIENT_SECRET =');
    console.log(`    ${clientSecret}\n`);
    console.log('  GA4_OAUTH_REFRESH_TOKEN =');
    console.log(`    ${refreshToken}\n`);
    console.log('  GA4_PROPERTY_ID =');
    console.log('    494185724\n');
    console.log('Vercel → Project Settings → Environment Variables → adicionar as 4');
    console.log('acima em Production, Preview e Development. Depois trigger redeploy.\n');

    server.close();
    setTimeout(() => process.exit(0), 500);
  } catch (e) {
    res.writeHead(500); res.end('Erro ao trocar code por token');
    console.error('\n❌ Erro ao trocar code por token:', e?.message || e);
    server.close(); process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`\n🔐 Aguardando autorização em http://localhost:${PORT}`);
  console.log(`🌐 Abrindo browser...\n`);
  console.log(`   Se não abrir, cole essa URL manualmente:\n   ${authUrl}\n`);

  // Tenta abrir o browser (macOS, Linux, Windows)
  const cmd = process.platform === 'darwin' ? 'open' :
              process.platform === 'win32'  ? 'start' : 'xdg-open';
  exec(`${cmd} "${authUrl}"`);
});

// Timeout de 5min
setTimeout(() => {
  console.error('\n⏰ Timeout — 5min sem callback. Tente de novo.\n');
  server.close(); process.exit(1);
}, 5 * 60 * 1000);
