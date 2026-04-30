import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { getAiProviderById, updateAiProvider } from './aiProviders.js';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const SCOPE = 'openid profile email offline_access';
const CALLBACK_PATH = '/api/ai/openai/callback';

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

const pendingStates = new Map<string, PendingState>();

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

function getRedirectUri() {
  const base = env.APP_URL.replace(/\/$/, '');
  return `${base}${CALLBACK_PATH}`;
}

function buildSuccessHtml() {
  return `<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 24px;">
    <h2 style="color: green;">Connected to OpenAI</h2>
    <p>You can close this window and return to tax-ops.</p>
    <script>
      try { window.opener?.postMessage({ source: 'tax-ops-openai-oauth', status: 'success' }, '*'); } catch {}
      setTimeout(() => window.close(), 1200)
    </script>
  </body></html>`;
}

function buildErrorHtml(message: string) {
  const safe = message.replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char] || char));
  return `<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 24px;">
    <h2 style="color: red;">Authentication failed</h2>
    <p>${safe}</p>
    <script>
      try { window.opener?.postMessage({ source: 'tax-ops-openai-oauth', status: 'error', message: ${JSON.stringify(message)} }, '*'); } catch {}
    </script>
  </body></html>`;
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
      redirect_uri: getRedirectUri(),
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

function pruneExpiredPendingStates() {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [state, pending] of pendingStates.entries()) {
    if (pending.createdAt < cutoff) pendingStates.delete(state);
  }
}

export function getOpenAiCodexModelOptions() {
  return [...openAiCodexModels];
}

export async function startOpenAiCodexOAuth(providerId: number) {
  const provider = await getAiProviderById(providerId);
  if (!provider) throw new Error('Provider not found');
  if (provider.kind !== 'openai') throw new Error('Provider is not OpenAI');

  pruneExpiredPendingStates();

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, { providerId, codeVerifier, state, createdAt: Date.now() });

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

  const redirectUri = getRedirectUri();
  const authUrl =
    `${AUTHORIZE_URL}?` +
    new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
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
    redirectUri,
  };
}

export async function handleOpenAiCodexOAuthCallback(input: { code: string | null; state: string | null }) {
  const { code, state } = input;
  if (!state || !code) {
    return {
      statusCode: 400,
      html: buildErrorHtml('Invalid state or missing code.'),
    };
  }

  pruneExpiredPendingStates();
  const pendingState = pendingStates.get(state);
  if (!pendingState) {
    return {
      statusCode: 400,
      html: buildErrorHtml('OAuth session expired or was not found. Start the connection flow again.'),
    };
  }

  pendingStates.delete(state);
  const provider = await getAiProviderById(pendingState.providerId);
  if (!provider || provider.kind !== 'openai') {
    return {
      statusCode: 404,
      html: buildErrorHtml('Provider not found for this OAuth flow.'),
    };
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

    return {
      statusCode: 200,
      html: buildSuccessHtml(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth token exchange failed';
    await updateAiProvider(pendingState.providerId, {
      status: 'error',
      lastError: message,
      config: {
        oauthPending: false,
      },
    }).catch(() => undefined);

    return {
      statusCode: 500,
      html: buildErrorHtml(message),
    };
  }
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
