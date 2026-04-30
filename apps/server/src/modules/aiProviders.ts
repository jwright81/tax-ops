import { pool } from '../db/pool.js';

export type AiProviderKind = 'openai' | 'lmstudio' | 'ollama';
export type AiProviderStatus = 'unconfigured' | 'configured' | 'connected' | 'error';

function parseJson<T>(value: unknown): T | null {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function maskConfig(kind: AiProviderKind, config: Record<string, unknown> | null) {
  if (!config) return null;
  if (kind === 'openai') {
    return {
      baseUrl: config.baseUrl ?? null,
      hasAccessToken: Boolean(config.accessToken),
      hasRefreshToken: Boolean(config.refreshToken),
      oauthConfiguredAt: config.oauthConfiguredAt ?? null,
    };
  }
  return config;
}

function mapProvider(row: any) {
  const config = parseJson<Record<string, unknown>>(row.config_json);
  return {
    id: row.id,
    providerKey: row.provider_key,
    kind: row.kind as AiProviderKind,
    displayName: row.display_name,
    status: row.status as AiProviderStatus,
    isDefault: Boolean(row.is_default),
    isFallback: Boolean(row.is_fallback),
    configuredModel: row.configured_model,
    lastError: row.last_error,
    lastConnectedAt: row.last_connected_at ? new Date(row.last_connected_at).toISOString() : null,
    availableModels: parseJson<string[]>(row.available_models_json) ?? [],
    config: maskConfig(row.kind as AiProviderKind, config),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listAiProviders() {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, provider_key, kind, display_name, status, is_default, is_fallback, configured_model, last_error, last_connected_at, available_models_json, config_json, created_at, updated_at
       FROM ai_providers
       ORDER BY created_at ASC`,
    );
    return (Array.isArray(rows) ? rows : []).map(mapProvider);
  } finally {
    conn.release();
  }
}

export async function getAiProviderById(providerId: number) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, provider_key, kind, display_name, status, is_default, is_fallback, configured_model, last_error, last_connected_at, available_models_json, config_json, created_at, updated_at
       FROM ai_providers
       WHERE id = ? LIMIT 1`,
      [providerId],
    );
    return Array.isArray(rows) && rows[0] ? mapProvider(rows[0]) : null;
  } finally {
    conn.release();
  }
}

async function getAiProviderRowById(providerId: number) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query('SELECT * FROM ai_providers WHERE id = ? LIMIT 1', [providerId]);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } finally {
    conn.release();
  }
}

export async function getAiProviderRawConfig(providerId: number) {
  const row = await getAiProviderRowById(providerId);
  return parseJson<Record<string, unknown>>(row?.config_json) ?? {};
}

export async function createAiProvider(input: {
  kind: AiProviderKind;
  displayName: string;
  config?: Record<string, unknown> | null;
}) {
  const conn = await pool.getConnection();
  try {
    const providerKey = `${input.kind}-${Date.now()}`;
    const result = await conn.query(
      `INSERT INTO ai_providers (provider_key, kind, display_name, status, config_json)
       VALUES (?, ?, ?, 'configured', ?)`,
      [providerKey, input.kind, input.displayName, input.config ? JSON.stringify(input.config) : null],
    );
    return getAiProviderById(Number(result.insertId));
  } finally {
    conn.release();
  }
}

export async function updateAiProvider(providerId: number, input: {
  displayName?: string;
  status?: AiProviderStatus;
  configuredModel?: string | null;
  availableModels?: string[];
  config?: Record<string, unknown> | null;
  lastError?: string | null;
  lastConnectedAt?: string | null;
}) {
  const conn = await pool.getConnection();
  try {
    const existingRows = await conn.query('SELECT * FROM ai_providers WHERE id = ? LIMIT 1', [providerId]);
    const existing = Array.isArray(existingRows) && existingRows[0] ? existingRows[0] : null;
    if (!existing) return null;

    const existingConfig = parseJson<Record<string, unknown>>(existing.config_json) ?? {};
    const nextConfig = input.config ? { ...existingConfig, ...input.config } : existingConfig;

    await conn.query(
      `UPDATE ai_providers
       SET display_name = ?, status = ?, configured_model = ?, available_models_json = ?, config_json = ?, last_error = ?, last_connected_at = ?
       WHERE id = ?`,
      [
        input.displayName ?? existing.display_name,
        input.status ?? existing.status,
        input.configuredModel === undefined ? existing.configured_model : input.configuredModel,
        input.availableModels ? JSON.stringify(input.availableModels) : existing.available_models_json,
        JSON.stringify(nextConfig),
        input.lastError === undefined ? existing.last_error : input.lastError,
        input.lastConnectedAt === undefined ? existing.last_connected_at : input.lastConnectedAt,
        providerId,
      ],
    );

    return getAiProviderById(providerId);
  } finally {
    conn.release();
  }
}

export async function setAiProviderModel(providerId: number, model: string) {
  return updateAiProvider(providerId, {
    configuredModel: model,
    status: 'connected',
    lastError: null,
    lastConnectedAt: new Date().toISOString(),
  });
}

export async function setAiRouting(input: { defaultProviderId: number | null; fallbackProviderId: number | null; }) {
  const conn = await pool.getConnection();
  try {
    await conn.query('UPDATE ai_providers SET is_default = 0, is_fallback = 0');

    if (input.defaultProviderId != null) {
      await conn.query('UPDATE ai_providers SET is_default = 1 WHERE id = ?', [input.defaultProviderId]);
    }

    if (input.fallbackProviderId != null) {
      await conn.query('UPDATE ai_providers SET is_fallback = 1 WHERE id = ?', [input.fallbackProviderId]);
    }
  } finally {
    conn.release();
  }

  return listAiProviders();
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json();
}

export async function probeAiProvider(providerId: number) {
  const provider = await getAiProviderById(providerId);
  if (!provider) return null;

  try {
    if (provider.kind === 'lmstudio') {
      const baseUrl = String((provider.config as any)?.baseUrl || '').replace(/\/$/, '');
      if (!baseUrl) throw new Error('LM Studio baseUrl is required');
      const payload = await fetchJson(`${baseUrl}/v1/models`);
      const models = Array.isArray(payload?.data) ? payload.data.map((item: any) => item.id).filter(Boolean) : [];
      return updateAiProvider(providerId, {
        status: 'connected',
        availableModels: models,
        lastError: null,
        lastConnectedAt: new Date().toISOString(),
      });
    }

    if (provider.kind === 'ollama') {
      const baseUrl = String((provider.config as any)?.baseUrl || '').replace(/\/$/, '');
      if (!baseUrl) throw new Error('Ollama baseUrl is required');
      const payload = await fetchJson(`${baseUrl}/api/tags`);
      const models = Array.isArray(payload?.models) ? payload.models.map((item: any) => item.name).filter(Boolean) : [];
      return updateAiProvider(providerId, {
        status: 'connected',
        availableModels: models,
        lastError: null,
        lastConnectedAt: new Date().toISOString(),
      });
    }

    if (provider.kind === 'openai') {
      const { probeOpenAiCodexOAuth } = await import('./openaiCodexOAuth.js');
      const probe = await probeOpenAiCodexOAuth(providerId);
      return updateAiProvider(providerId, {
        status: 'connected',
        availableModels: probe.availableModels,
        configuredModel: provider.configuredModel ?? probe.model,
        lastError: null,
        lastConnectedAt: new Date().toISOString(),
        config: {
          lastProbeModel: probe.model,
          lastProbeAt: new Date().toISOString(),
        },
      });
    }

    throw new Error(`Unsupported provider kind: ${provider.kind}`);
  } catch (error) {
    return updateAiProvider(providerId, {
      status: 'error',
      lastError: error instanceof Error ? error.message : 'Unknown connection error',
    });
  }
}
