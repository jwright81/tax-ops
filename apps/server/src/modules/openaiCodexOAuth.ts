import crypto from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';
import { env } from '../config/env.js';
import { getAiProviderById, updateAiProvider } from './aiProviders.js';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CALLBACK_PORT = 1455;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/auth/callback`;
const SCOPE = 'openid profile email offline_access';

const openAiCodexModels = [
  'o4-mini',
  'o3',
  'o3-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-5.3-codex',
] as const;

type PendingState = {
  providerId: number;
  codeVerifier: string;
  state: string;
  createdAt: number;
};

let callbackServer: http.Server | null = null;
let pendingState: PendingState | null = null;

function base64UrlEncode(buffer: Buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateCodeVerifier() {
  return base64UrlEncode(crypto.randomBytes(32));
}

function generateCodeChallenge(verifier: string) {
  return base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
}

function encryptToken(token: string) {
  const key = crypto.createHash('sha256').update(env.SESSION_SECRET).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptToken(token: string) {
  const raw = Buffer.from(token, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const key = crypto.createHash('sha256').update(env.SESSION_SECRET).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

async function exchangeCodeForTokens(code: string, codeVerifier: string) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${await response.text()}`);
  }

  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
}

async function refreshAccessToken(refreshToken: string) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed (${response.status}): ${await response.text()}`);
  }

  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
}

export function getOpenAiCodexModelOptions() {
  return [...openAiCodexModels];
}

export async function startOpenAiCodexOAuth(providerId: number) {
  const provider = await getAiProviderById(providerId);
  if (!provider) throw new Error('Provider not found');
  if (provider.kind !== 'openai') throw new Error('Provider is not OpenAI');

  if (callbackServer) {
    try {
      callbackServer.close();
    } catch {
      // ignore
    }
    callbackServer = null;
    pendingState = null;
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString('hex');
  pendingState = { providerId, codeVerifier, state, createdAt: Date.now() };

  await updateAiProvider(providerId, {
    status: 'configured',
    config: {
      ...(provider.config ?? {}),
      oauthPending: true,
      oauthConfiguredAt: new Date().toISOString(),
      baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
    },
    availableModels: getOpenAiCodexModelOptions(),
    lastError: null,
  });

  callbackServer = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', REDIRECT_URI);
    if (reqUrl.pathname !== '/auth/callback') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const code = reqUrl.searchParams.get('code');
    const receivedState = reqUrl.searchParams.get('state');

    if (!pendingState || receivedState !== pendingState.state || !code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<html><body><h2>Authentication failed</h2><p>Invalid state or missing code.</p></body></html>');
      return;
    }

    try {
      const tokenData = await exchangeCodeForTokens(code, pendingState.codeVerifier);
      const expiresAt = Math.floor(Date.now() / 1000) + (tokenData.expires_in || 3600);

      await updateAiProvider(pendingState.providerId, {
        status: 'connected',
        availableModels: getOpenAiCodexModelOptions(),
        lastError: null,
        lastConnectedAt: new Date().toISOString(),
        config: {
          ...(provider.config ?? {}),
          oauthPending: false,
          oauthConfiguredAt: new Date().toISOString(),
          accessToken: encryptToken(tokenData.access_token),
          refreshToken: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null,
          expiresAt,
          baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
          authMode: 'codex-oauth',
        },
      });

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><body>
        <h2 style="color: green; font-family: sans-serif;">Connected to OpenAI</h2>
        <p style="font-family: sans-serif;">You can close this window and return to tax-ops.</p>
        <script>setTimeout(() => window.close(), 1500)</script>
      </body></html>`);
    } catch (error) {
      await updateAiProvider(pendingState.providerId, {
        status: 'error',
        lastError: error instanceof Error ? error.message : 'OAuth token exchange failed',
      }).catch(() => undefined);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><body>
        <h2 style="color: red; font-family: sans-serif;">Authentication failed</h2>
        <p style="font-family: sans-serif;">${error instanceof Error ? error.message : 'Unknown error'}</p>
      </body></html>`);
    } finally {
      pendingState = null;
      setTimeout(() => {
        if (callbackServer) {
          try {
            callbackServer.close();
          } catch {
            // ignore
          }
          callbackServer = null;
        }
      }, 1000);
    }
  });

  await new Promise<void>((resolve, reject) => {
    callbackServer!.once('error', reject);
    callbackServer!.listen(CALLBACK_PORT, '127.0.0.1', () => resolve());
  });

  const authUrl =
    `${AUTHORIZE_URL}?` +
    new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'pi',
    }).toString();

  return {
    authorizationUrl: authUrl,
    redirectUri: REDIRECT_URI,
    callbackPort: CALLBACK_PORT,
  };
}

export async function getValidOpenAiCodexAccessToken(providerId: number) {
  const provider = await getAiProviderById(providerId);
  if (!provider || provider.kind !== 'openai') return null;
  const config = (provider.config ?? {}) as Record<string, unknown>;
  const encryptedAccessToken = typeof config.accessToken === 'string' ? config.accessToken : null;
  const encryptedRefreshToken = typeof config.refreshToken === 'string' ? config.refreshToken : null;
  const expiresAt = Number(config.expiresAt ?? 0);

  if (!encryptedAccessToken) return null;

  const now = Math.floor(Date.now() / 1000);
  if (expiresAt > 0 && now >= expiresAt - 300 && encryptedRefreshToken) {
    const refreshed = await refreshAccessToken(decryptToken(encryptedRefreshToken));
    const nextExpiresAt = Math.floor(Date.now() / 1000) + (refreshed.expires_in || 3600);
    await updateAiProvider(providerId, {
      status: 'connected',
      lastError: null,
      lastConnectedAt: new Date().toISOString(),
      config: {
        accessToken: encryptToken(refreshed.access_token),
        refreshToken: refreshed.refresh_token ? encryptToken(refreshed.refresh_token) : encryptedRefreshToken,
        expiresAt: nextExpiresAt,
        authMode: 'codex-oauth',
        baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
      },
    });
    return refreshed.access_token;
  }

  return decryptToken(encryptedAccessToken);
}

export function extractChatGptAccountId(token: string) {
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('Invalid JWT format');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
  const authClaim = payload['https://api.openai.com/auth'];
  if (!authClaim?.chatgpt_account_id) {
    throw new Error('No chatgpt_account_id in token payload');
  }
  return authClaim.chatgpt_account_id as string;
}

export async function disconnectOpenAiCodexOAuth(providerId: number) {
  const provider = await getAiProviderById(providerId);
  if (!provider || provider.kind !== 'openai') return null;
  return updateAiProvider(providerId, {
    status: 'configured',
    lastError: null,
    config: {
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      oauthPending: false,
      authMode: 'codex-oauth',
      baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
    },
  });
}
