import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mariadb from 'mariadb';
import dotenv from 'dotenv';

const execFileAsync = promisify(execFile);

dotenv.config({ path: process.env.CONFIG_PATH || '.env' });

const env = {
  DB_HOST: process.env.DB_HOST || '127.0.0.1',
  DB_PORT: Number(process.env.DB_PORT || 3306),
  DB_NAME: process.env.DB_NAME || 'tax_ops',
  DB_USER: process.env.DB_USER || 'tax_ops',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  WATCH_FOLDER: process.env.WATCH_FOLDER || '/data/incoming',
  PROCESSED_FOLDER: process.env.PROCESSED_FOLDER || '/data/processed',
  OCR_BINARY: process.env.OCR_BINARY || '/opt/ocrmypdf-venv/bin/ocrmypdf',
  QPDF_BINARY: process.env.QPDF_BINARY || 'qpdf',
  WATCH_STABLE_MS: Number(process.env.WATCH_STABLE_MS || 8000),
};

const defaultSettings = {
  ocr_mode: 'internal',
  ocr_deskew: 'true',
  ocr_rotate_pages: 'true',
  ocr_jobs_enabled: 'true',
  ocr_jobs: '1',
  ocr_text_handling: 'skip-text',
  ocr_sidecar: 'true',
  ocr_rotate_pages_threshold_enabled: 'false',
  ocr_rotate_pages_threshold: '14.0',
  ocr_clean: 'false',
  ocr_clean_final: 'false',
} as const;

type OcrTextHandling = 'skip-text' | 'redo-ocr' | 'force-ocr';
type AiProviderKind = 'openai' | 'lmstudio' | 'ollama';

const OPENAI_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';

const pool = mariadb.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  connectionLimit: 4,
});

async function waitForSettingsTable(retries = 20) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const conn = await pool.getConnection().catch(() => null);
    if (!conn) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }

    try {
      await conn.query('SELECT setting_key, setting_value FROM system_settings LIMIT 1');
      conn.release();
      return;
    } catch (error) {
      conn.release();
      if (attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

async function getSettingsMap() {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query('SELECT setting_key, setting_value FROM system_settings');
    return {
      ...defaultSettings,
      ...Object.fromEntries((Array.isArray(rows) ? rows : []).map((row) => [row.setting_key, row.setting_value])),
    };
  } finally {
    conn.release();
  }
}

async function getQueuedJobs(limit = 10) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, job_type, source_path, payload_json FROM processing_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?`,
      [limit],
    );
    return Array.isArray(rows) ? rows : [];
  } finally {
    conn.release();
  }
}

async function getAiProviders() {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, kind, display_name, status, is_default, is_fallback, configured_model, config_json
       FROM ai_providers
       ORDER BY is_default DESC, is_fallback DESC, id ASC`,
    );
    return Array.isArray(rows) ? rows : [];
  } finally {
    conn.release();
  }
}

async function getToolRunById(runId: number) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, tool_type, source_kind, source_document_id, source_filename, source_path, status, page_count, selected_page_range, detected_metadata_json
       FROM tool_runs
       WHERE id = ? LIMIT 1`,
      [runId],
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } finally {
    conn.release();
  }
}

async function getToolRunPage(runId: number, pageNumber: number) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, run_id, page_number, status, review_status, extracted_text
       FROM tool_run_pages
       WHERE run_id = ? AND page_number = ?
       LIMIT 1`,
      [runId, pageNumber],
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } finally {
    conn.release();
  }
}

async function findJobBySourcePath(sourcePath: string) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, status FROM processing_jobs WHERE source_path = ? ORDER BY id DESC LIMIT 1`,
      [sourcePath],
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } finally {
    conn.release();
  }
}

async function isFileStable(sourcePath: string) {
  try {
    const first = await fs.stat(sourcePath);
    if (Date.now() - first.mtimeMs < env.WATCH_STABLE_MS) return false;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const second = await fs.stat(sourcePath);
    return first.size === second.size && first.mtimeMs === second.mtimeMs;
  } catch {
    return false;
  }
}

async function createJobForFile(sourcePath: string, originalFilename: string) {
  const conn = await pool.getConnection();
  try {
    const result = await conn.query(
      `INSERT INTO processing_jobs (job_type, status, source_path, message, payload_json)
       VALUES ('intake.scan', 'queued', ?, 'Queued from watched folder', ?)`,
      [sourcePath, JSON.stringify({ originalFilename, discoveredBy: 'worker-watch' })],
    );

    const jobId = Number(result.insertId);
    await conn.query(
      `INSERT INTO documents (job_id, original_filename, original_path, current_path, status, ocr_status)
       VALUES (?, ?, ?, ?, 'intake', 'pending')`,
      [jobId, originalFilename, sourcePath, sourcePath],
    );

    return jobId;
  } finally {
    conn.release();
  }
}

async function updateJobStatus(jobId: number, status: 'processing' | 'completed' | 'failed', message: string, result?: unknown) {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `UPDATE processing_jobs SET status = ?, message = ?, result_json = ? WHERE id = ?`,
      [status, message, result ? JSON.stringify(result) : null, jobId],
    );
  } finally {
    conn.release();
  }
}

async function updateDocument(jobId: number, input: { status: 'intake' | 'review' | 'error'; formType: string; issuer: string; taxYear: string; clientName: string; ssnLast4: string; confidenceScore: number; extractedText: string; currentPath: string; ocrStatus: 'pending' | 'processing' | 'completed' | 'failed'; ocrProvider: string; reviewNotes: string; }) {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `UPDATE documents
       SET status = ?, form_type = ?, issuer = ?, tax_year = ?, client_name = ?, ssn_last4 = ?, confidence_score = ?, extracted_text = ?, current_path = ?, ocr_status = ?, ocr_provider = ?, review_notes = ?
       WHERE job_id = ?`,
      [input.status, input.formType, input.issuer, input.taxYear, input.clientName, input.ssnLast4, input.confidenceScore, input.extractedText, input.currentPath, input.ocrStatus, input.ocrProvider, input.reviewNotes, jobId],
    );
  } finally {
    conn.release();
  }
}

async function markDocumentOcr(jobId: number, status: 'processing' | 'completed' | 'failed' | 'pending', provider: string) {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      'UPDATE documents SET ocr_status = ?, ocr_provider = ? WHERE job_id = ?',
      [status, provider, jobId],
    );
  } finally {
    conn.release();
  }
}

async function updateToolRunStatus(runId: number, status: 'queued' | 'processing' | 'reviewing' | 'completed' | 'failed', detectedMetadata?: Record<string, unknown> | null) {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `UPDATE tool_runs
       SET status = ?, detected_metadata_json = COALESCE(?, detected_metadata_json)
       WHERE id = ?`,
      [status, detectedMetadata ? JSON.stringify(detectedMetadata) : null, runId],
    );
  } finally {
    conn.release();
  }
}

async function updateToolRunPage(
  runId: number,
  pageNumber: number,
  input: {
    status: 'queued' | 'processing' | 'ready' | 'reviewed' | 'failed';
    reviewStatus?: 'pending' | 'reviewed' | 'flagged';
    extractedText?: string | null;
    warnings?: string[];
    errorMessage?: string | null;
  },
) {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `UPDATE tool_run_pages
       SET status = ?, review_status = COALESCE(?, review_status), extracted_text = COALESCE(?, extracted_text), warnings_json = ?, error_message = ?
       WHERE run_id = ? AND page_number = ?`,
      [
        input.status,
        input.reviewStatus ?? null,
        input.extractedText ?? null,
        input.warnings ? JSON.stringify(input.warnings) : null,
        input.errorMessage ?? null,
        runId,
        pageNumber,
      ],
    );
  } finally {
    conn.release();
  }
}

async function upsertToolRunPageResult(runPageId: number, result: { result: Record<string, unknown>; normalizedRows: Record<string, unknown>[]; audit: Record<string, unknown>; }) {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `INSERT INTO tool_run_page_results (run_page_id, result_json, normalized_rows_json, audit_json)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         result_json = VALUES(result_json),
         normalized_rows_json = VALUES(normalized_rows_json),
         audit_json = VALUES(audit_json)`,
      [runPageId, JSON.stringify(result.result), JSON.stringify(result.normalizedRows), JSON.stringify(result.audit)],
    );
  } finally {
    conn.release();
  }
}

async function refreshToolRunAggregateStatus(runId: number) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT
         COUNT(*) AS total_count,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
         SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) AS reviewed_count,
         SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready_count,
         SUM(CASE WHEN status IN ('queued', 'processing') THEN 1 ELSE 0 END) AS pending_count
       FROM tool_run_pages
       WHERE run_id = ?`,
      [runId],
    );

    const stats = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!stats) return;

    const totalCount = Number(stats.total_count ?? 0);
    const failedCount = Number(stats.failed_count ?? 0);
    const reviewedCount = Number(stats.reviewed_count ?? 0);
    const readyCount = Number(stats.ready_count ?? 0);
    const pendingCount = Number(stats.pending_count ?? 0);

    let status: 'queued' | 'processing' | 'reviewing' | 'completed' | 'failed' = 'processing';
    if (totalCount > 0 && failedCount === totalCount) {
      status = 'failed';
    } else if (pendingCount > 0) {
      status = readyCount > 0 || reviewedCount > 0 ? 'reviewing' : 'processing';
    } else if (readyCount > 0 || reviewedCount > 0) {
      status = 'reviewing';
    } else {
      status = 'completed';
    }

    await conn.query('UPDATE tool_runs SET status = ? WHERE id = ?', [status, runId]);
  } finally {
    conn.release();
  }
}

function inferMetadata(fileName: string) {
  const base = fileName.replace(/\.pdf$/i, '');
  const parts = base.split(/[_-]+/).filter(Boolean);
  const year = parts.find((part) => /^20\d{2}$/.test(part)) || String(new Date().getFullYear());
  const formType = parts.find((part) => /^1099|w2|w-2|1098/i.test(part)) || 'Scanned Document';
  const issuer = parts[0] || 'Unknown Issuer';
  const clientName = parts.slice(1, 3).join(' ') || 'Unknown Client';
  const ssnLast4Match = base.match(/(\d{4})(?!.*\d)/);
  const ssnLast4 = ssnLast4Match?.[1] || '';

  return {
    taxYear: year,
    formType: formType.toUpperCase(),
    issuer,
    clientName,
    ssnLast4,
    confidenceScore: 0.42,
  };
}

function settingEnabled(value: string | undefined, fallback: boolean) {
  if (value == null) return fallback;
  return value === 'true';
}

function normalizePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function normalizePositiveNumber(value: string | undefined) {
  const parsed = Number.parseFloat(value || '');
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function isOcrTextHandling(value: unknown): value is OcrTextHandling {
  return value === 'skip-text' || value === 'redo-ocr' || value === 'force-ocr';
}

function resolveOcrTextHandling(settings: Record<string, string>, override?: unknown): OcrTextHandling {
  if (isOcrTextHandling(override)) return override;
  if (isOcrTextHandling(settings.ocr_text_handling)) return settings.ocr_text_handling;
  if (settingEnabled(settings.ocr_skip_text, true)) return 'skip-text';
  return 'redo-ocr';
}

function buildInternalOcrCommand(
  settings: Record<string, string>,
  sourcePath: string,
  outputPath: string,
  sidecarPath: string,
  textHandlingOverride?: unknown,
  options?: { includeSidecar?: boolean },
) {
  const args = [env.OCR_BINARY];
  const textHandling = resolveOcrTextHandling(settings, textHandlingOverride);
  const includeSidecar = options?.includeSidecar ?? settingEnabled(settings.ocr_sidecar, true);

  if (settingEnabled(settings.ocr_deskew, true)) args.push('--deskew');
  if (settingEnabled(settings.ocr_rotate_pages, true)) args.push('--rotate-pages');
  if (settingEnabled(settings.ocr_jobs_enabled, true)) args.push('--jobs', String(normalizePositiveInt(settings.ocr_jobs, 1)));
  args.push(`--${textHandling}`);
  if (includeSidecar) args.push('--sidecar', sidecarPath);
  if (settingEnabled(settings.ocr_rotate_pages_threshold_enabled, false)) {
    const threshold = normalizePositiveNumber(settings.ocr_rotate_pages_threshold);
    if (threshold !== null) args.push('--rotate-pages-threshold', String(threshold));
  }
  if (settingEnabled(settings.ocr_clean, false)) args.push('--clean');
  if (settingEnabled(settings.ocr_clean_final, false)) args.push('--clean-final');

  args.push(sourcePath, outputPath);
  return args.map(shellQuote).join(' ');
}

async function extractPdfPage(sourcePath: string, outputPath: string, pageNumber: number) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await execFileAsync(env.QPDF_BINARY, [sourcePath, '--pages', sourcePath, String(pageNumber), '--', outputPath]);
  return outputPath;
}

async function extractEmbeddedPdfText(pdfPath: string) {
  const data = await fs.readFile(pdfPath);
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) });

  try {
    const doc = await loadingTask.promise;
    const pageTexts: string[] = [];

    for (let pageIndex = 1; pageIndex <= doc.numPages; pageIndex += 1) {
      const page = await doc.getPage(pageIndex);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: any) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
        .filter(Boolean)
        .join(' ')
        .trim();
      if (text) pageTexts.push(text);
    }

    return pageTexts.join('\n\n').trim();
  } finally {
    await loadingTask.destroy();
  }
}

async function runInternalOcrPass(
  settings: Record<string, string>,
  sourcePath: string,
  outputPath: string,
  sidecarPath: string,
  textHandling: OcrTextHandling,
  options?: { includeSidecar?: boolean },
) {
  const includeSidecar = options?.includeSidecar ?? settingEnabled(settings.ocr_sidecar, true);
  const command = buildInternalOcrCommand(settings, sourcePath, outputPath, sidecarPath, textHandling, { includeSidecar });
  const { stdout, stderr } = await execFileAsync('/bin/sh', ['-lc', command]);
  let details = [stderr?.trim(), stdout?.trim()].filter(Boolean).join(' | ');
  let extractedText = includeSidecar ? await fs.readFile(sidecarPath, 'utf8').catch(() => '') : '';

  if (includeSidecar) {
    await fs.unlink(sidecarPath).catch(() => undefined);
  }

  extractedText = extractedText.trim();
  if (!extractedText) {
    const embeddedText = await extractEmbeddedPdfText(outputPath).catch(() => '');
    if (embeddedText) {
      extractedText = embeddedText;
      details = [details, 'Recovered text from embedded PDF text layer because OCR sidecar was empty.'].filter(Boolean).join(' | ');
    }
  }

  return {
    details,
    extractedText,
  };
}

async function runOcrStep(sourcePath: string, fileName: string, settings: Record<string, string>, payload: Record<string, unknown>) {
  const ocrMode = settings.ocr_mode === 'external' ? 'external' : 'internal';
  const textHandling = resolveOcrTextHandling(settings, payload.ocrTextHandlingOverride);

  if (ocrMode === 'external') {
    return {
      provider: 'external:pending',
      extractedText: '',
      notes: 'External OCR mode is saved, but automatic external folder handoff/import is not wired yet. This document stayed in intake without extracted text.',
      outputPath: sourcePath,
      ocrStatus: 'pending' as const,
      documentStatus: 'intake' as const,
    };
  }

  const outputRoot = path.join(env.PROCESSED_FOLDER, 'ocr');
  await fs.mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, fileName);
  const sidecarPath = `${outputPath}.txt`;
  const sidecarEnabled = settingEnabled(settings.ocr_sidecar, true);

  let details = '';
  let extractedText = '';

  if (textHandling === 'force-ocr') {
    const stagingRoot = path.join(outputRoot, '.staging');
    await fs.mkdir(stagingRoot, { recursive: true });
    const normalizedPath = path.join(stagingRoot, `${path.parse(fileName).name}.${Date.now()}.normalized.pdf`);
    const normalizedSidecarPath = `${normalizedPath}.txt`;

    try {
      const normalized = await runInternalOcrPass(settings, sourcePath, normalizedPath, normalizedSidecarPath, 'skip-text', { includeSidecar: false });
      const forced = await runInternalOcrPass(settings, normalizedPath, outputPath, sidecarPath, 'force-ocr', { includeSidecar: sidecarEnabled });
      extractedText = forced.extractedText;
      details = [
        normalized.details ? `Normalization (--skip-text): ${normalized.details}` : 'Normalization (--skip-text) completed.',
        forced.details || `Bundled OCR command completed with --force-ocr. Extracted text ${forced.extractedText ? 'captured' : 'not captured'}.`,
      ].join(' | ');
    } finally {
      await fs.unlink(normalizedPath).catch(() => undefined);
      await fs.unlink(normalizedSidecarPath).catch(() => undefined);
    }
  } else {
    const result = await runInternalOcrPass(settings, sourcePath, outputPath, sidecarPath, textHandling, { includeSidecar: sidecarEnabled });
    extractedText = result.extractedText;
    details = result.details || `Bundled OCR command completed with --${textHandling}. Extracted text ${result.extractedText ? 'captured' : 'not captured'}.`;
  }

  return {
    provider: `container:ocrmypdf:${textHandling}`,
    extractedText,
    notes: details,
    outputPath,
    ocrStatus: 'completed' as const,
    documentStatus: 'review' as const,
  };
}

function parseJson<T>(value: unknown): T | null {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function decryptOpenAiToken(token: string) {
  const raw = Buffer.from(token, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const key = crypto.createHash('sha256').update(process.env.SESSION_SECRET || '').digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function encryptOpenAiToken(token: string) {
  const key = crypto.createHash('sha256').update(process.env.SESSION_SECRET || '').digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

async function refreshOpenAiCodexToken(refreshToken: string) {
  const response = await fetch(OPENAI_CODEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: OPENAI_CODEX_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) throw new Error(`OpenAI Codex token refresh failed (${response.status}): ${await response.text()}`);
  return (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
}

async function getValidOpenAiCodexToken(provider: any, config: Record<string, unknown>) {
  const encryptedAccessToken = typeof config.accessToken === 'string' ? config.accessToken : null;
  if (!encryptedAccessToken) throw new Error('OpenAI Codex OAuth token missing');

  const encryptedRefreshToken = typeof config.refreshToken === 'string' ? config.refreshToken : null;
  const expiresAt = Number(config.expiresAt ?? 0);
  const now = Math.floor(Date.now() / 1000);

  if (expiresAt > 0 && now >= expiresAt - 300 && encryptedRefreshToken) {
    const refreshed = await refreshOpenAiCodexToken(decryptOpenAiToken(encryptedRefreshToken));
    const nextExpiresAt = Math.floor(Date.now() / 1000) + (refreshed.expires_in || 3600);
    const nextConfig = {
      ...config,
      accessToken: encryptOpenAiToken(refreshed.access_token),
      refreshToken: refreshed.refresh_token ? encryptOpenAiToken(refreshed.refresh_token) : encryptedRefreshToken,
      expiresAt: nextExpiresAt,
      authMode: 'codex-oauth',
      baseUrl: OPENAI_CODEX_RESPONSES_URL,
    };

    const conn = await pool.getConnection();
    try {
      await conn.query(
        `UPDATE ai_providers SET status = 'connected', config_json = ?, last_error = NULL, last_connected_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [JSON.stringify(nextConfig), provider.id],
      );
    } finally {
      conn.release();
    }

    return refreshed.access_token;
  }

  return decryptOpenAiToken(encryptedAccessToken);
}

async function resolveAiProviderChain() {
  const providers = await getAiProviders();
  const connectedProviders = providers.filter((provider) => provider.status === 'connected' && provider.configured_model);
  const defaultProvider = connectedProviders.find((provider) => Boolean(provider.is_default));
  const fallbackProvider = connectedProviders.find((provider) => Boolean(provider.is_fallback) && provider.id !== defaultProvider?.id);

  if (defaultProvider || fallbackProvider) {
    return [defaultProvider, fallbackProvider].filter(Boolean) as any[];
  }

  if (connectedProviders.length === 1) {
    return connectedProviders;
  }

  return [];
}

function build1099BExtractionPrompt(run: any, pageNumber: number, extractedText: string) {
  return {
    system: `You extract structured 1099-B page data for tax preparation. Return JSON only. If no transactions are present, return an empty transactions array and include warnings.`,
    user: JSON.stringify({
      task: 'Extract all visible 1099-B transaction rows and page-level metadata from this single page.',
      constraints: [
        'Return valid JSON only.',
        'Include broker, accountLabel, taxYear when visible.',
        'Use null for unknown scalar values.',
        'transactions must be an array of structured objects.',
        'Include warnings array for uncertainty or ambiguous OCR.',
      ],
      pageNumber,
      sourceFilename: run.source_filename,
      extractedText,
    }),
  };
}

function normalize1099BModelResponse(pageNumber: number, payload: any) {
  const transactions = Array.isArray(payload?.transactions) ? payload.transactions : [];
  return {
    result: {
      pageNumber,
      extractedAt: new Date().toISOString(),
      detectedForm: payload?.detectedForm || '1099-B',
      broker: payload?.broker ?? null,
      accountLabel: payload?.accountLabel ?? null,
      taxYear: payload?.taxYear ?? null,
      transactionCountEstimate: transactions.length,
      warnings: Array.isArray(payload?.warnings) ? payload.warnings : [],
    },
    normalizedRows: transactions.map((row: any, index: number) => ({
      rowType: 'transaction',
      rowIndex: index,
      pageNumber,
      symbol: row?.symbol ?? null,
      description: row?.description ?? null,
      proceeds: row?.proceeds ?? null,
      costBasis: row?.costBasis ?? null,
      dateAcquired: row?.dateAcquired ?? null,
      dateSold: row?.dateSold ?? null,
      washSaleDisallowed: row?.washSaleDisallowed ?? null,
      gainOrLoss: row?.gainOrLoss ?? null,
      term: row?.term ?? null,
    })),
    warnings: Array.isArray(payload?.warnings) ? payload.warnings : [],
  };
}

async function callLmStudio(baseUrl: string, model: string, systemPrompt: string, userPrompt: string) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!response.ok) throw new Error(`LM Studio error (${response.status}): ${await response.text()}`);
  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content ?? '{}';
}

async function callOllama(baseUrl: string, model: string, systemPrompt: string, userPrompt: string) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Ollama error (${response.status}): ${await response.text()}`);
  const payload = await response.json();
  return payload?.message?.content ?? '{}';
}

async function callOpenAiCodex(provider: any, model: string, systemPrompt: string, userPrompt: string, pagePdfPath?: string) {
  const config = parseJson<Record<string, unknown>>(provider.config_json) ?? {};
  const accessToken = await getValidOpenAiCodexToken(provider, config);
  const jwtParts = accessToken.split('.');
  if (jwtParts.length < 2) throw new Error('Invalid OpenAI Codex JWT');
  const jwtPayload = JSON.parse(Buffer.from(jwtParts[1], 'base64').toString('utf8'));
  const accountId = jwtPayload?.['https://api.openai.com/auth']?.chatgpt_account_id;
  if (!accountId) throw new Error('chatgpt_account_id missing from OpenAI Codex token');

  const userContent: Array<Record<string, string>> = [{ type: 'input_text', text: userPrompt }];
  if (pagePdfPath) {
    const pdfBase64 = await fs.readFile(pagePdfPath, 'base64');
    userContent.push({
      type: 'input_file',
      filename: path.basename(pagePdfPath),
      file_data: `data:application/pdf;base64,${pdfBase64}`,
    });
  }

  const response = await fetch(OPENAI_CODEX_RESPONSES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'chatgpt-account-id': accountId,
      'OpenAI-Beta': 'responses=experimental',
      originator: 'pi',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model,
      store: false,
      stream: true,
      instructions: systemPrompt,
      input: [{ role: 'user', content: userContent }],
      text: { format: { type: 'json_object' } },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI Codex error (${response.status}): ${await response.text()}`);
  const raw = await response.text();
  let content = '';
  let errorMessage = '';
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') break;
    try {
      const event = JSON.parse(data);
      if (event.type === 'error' || event.error) errorMessage = JSON.stringify(event.error || event);
      if (event.type === 'response.output_text.delta' && event.delta) content += event.delta;
      if (!content && (event.type === 'response.completed' || event.type === 'response.done')) {
        if (event.response?.status === 'failed' || event.response?.error) {
          errorMessage = JSON.stringify(event.response.error || event.response.status_details || event.response.status);
        }
        const output = event.response?.output || [];
        for (const item of output) {
          if (item.type === 'message' && Array.isArray(item.content)) {
            for (const part of item.content) {
              if (part.type === 'output_text' && part.text) content += part.text;
            }
          }
        }
      }
    } catch {
      // ignore malformed lines
    }
  }
  if (!content && errorMessage) throw new Error(`OpenAI Codex returned error: ${errorMessage}`);
  return content || '{}';
}

async function extract1099BViaAi(run: any, pageNumber: number, extractedText: string, pagePdfPath?: string) {
  const providerChain = await resolveAiProviderChain();
  if (providerChain.length === 0) {
    throw new Error('No routable AI providers configured. Set a default provider in AI Routing, or leave exactly one connected provider configured with a model.');
  }

  const prompt = build1099BExtractionPrompt(run, pageNumber, extractedText);
  const errors: string[] = [];

  for (const provider of providerChain) {
    const model = provider.configured_model;
    if (!model) {
      errors.push(`${provider.display_name}: no model configured`);
      continue;
    }

    const config = parseJson<Record<string, unknown>>(provider.config_json) ?? {};
    try {
      let raw = '{}';
      if (provider.kind === 'lmstudio') {
        const baseUrl = String(config.baseUrl || 'http://127.0.0.1:1234');
        raw = await callLmStudio(baseUrl, model, prompt.system, prompt.user);
      } else if (provider.kind === 'ollama') {
        const baseUrl = String(config.baseUrl || 'http://127.0.0.1:11434');
        raw = await callOllama(baseUrl, model, prompt.system, prompt.user);
      } else if (provider.kind === 'openai') {
        raw = await callOpenAiCodex(provider, model, prompt.system, prompt.user, pagePdfPath);
      }

      const parsed = JSON.parse(raw);
      const normalized = normalize1099BModelResponse(pageNumber, parsed);
      return {
        providerLabel: `${provider.kind}:${model}`,
        ...normalized,
        audit: {
          processor: 'worker.ai_1099b_extract',
          providerKind: provider.kind as AiProviderKind,
          providerId: provider.id,
          providerName: provider.display_name,
          model,
          note: 'AI-backed structured extraction',
        },
      };
    } catch (error) {
      errors.push(`${provider.display_name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`All configured AI providers failed: ${errors.join(' | ')}`);
}

function build1099BDetectedMetadata(run: any, pageNumber: number) {
  const taxYearMatch = String(run.source_filename || '').match(/20\d{2}/);
  return {
    sourceFilename: run.source_filename,
    sourceKind: run.source_kind,
    taxYear: taxYearMatch?.[0] ?? null,
    pageNumber,
    broker: 'Pending broker detection',
    accountLabel: null,
  };
}

async function process1099BExtractPageJob(job: any, settings: Record<string, string>) {
  const payload = job.payload_json ? JSON.parse(job.payload_json) : {};
  const runId = Number(payload.runId);
  const pageNumber = Number(payload.pageNumber);

  if (!Number.isFinite(runId) || !Number.isFinite(pageNumber)) {
    throw new Error('1099-B page job missing runId or pageNumber');
  }

  const run = await getToolRunById(runId);
  if (!run) {
    throw new Error(`Tool run ${runId} not found`);
  }

  const runPage = await getToolRunPage(runId, pageNumber);
  if (!runPage) {
    throw new Error(`Tool run page ${pageNumber} not found for run ${runId}`);
  }

  await updateToolRunStatus(runId, 'processing', build1099BDetectedMetadata(run, pageNumber));
  await updateToolRunPage(runId, pageNumber, { status: 'processing', reviewStatus: 'pending', errorMessage: null });

  const pagesRoot = path.join(env.PROCESSED_FOLDER, 'tool-runs', String(runId), 'pages');
  const pagePdfPath = path.join(pagesRoot, `page-${String(pageNumber).padStart(4, '0')}.pdf`);
  const pageFileName = `${path.parse(run.source_filename).name}.page-${pageNumber}.pdf`;

  await extractPdfPage(run.source_path, pagePdfPath, pageNumber);
  const ocr = await runOcrStep(pagePdfPath, pageFileName, settings, payload);
  const aiResult = await extract1099BViaAi(run, pageNumber, ocr.extractedText, pagePdfPath);

  await updateToolRunPage(runId, pageNumber, {
    status: 'ready',
    reviewStatus: 'pending',
    extractedText: ocr.extractedText,
    warnings: aiResult.warnings,
    errorMessage: null,
  });
  await upsertToolRunPageResult(runPage.id, {
    result: {
      ...aiResult.result,
      sourceFilename: run.source_filename,
      textPreview: ocr.extractedText.slice(0, 500),
      pagePdfPath,
    },
    normalizedRows: aiResult.normalizedRows,
    audit: {
      ...aiResult.audit,
      pagePdfPath,
      ocrProvider: ocr.provider,
      ocrNotes: ocr.notes,
      aiProvider: aiResult.providerLabel,
    },
  });
  await refreshToolRunAggregateStatus(runId);

  await updateJobStatus(job.id, 'completed', `1099-B page ${pageNumber} extracted`, {
    runId,
    pageNumber,
    pagePdfPath,
    ocrProvider: ocr.provider,
    aiProvider: aiResult.providerLabel,
    warnings: aiResult.warnings,
  });
  console.log(`[worker] completed 1099-B page job #${job.id} (run ${runId} page ${pageNumber})`);
}

async function fail1099BExtractPageJob(job: any, error: unknown) {
  const payload = job.payload_json ? JSON.parse(job.payload_json) : {};
  const runId = Number(payload.runId);
  const pageNumber = Number(payload.pageNumber);

  if (Number.isFinite(runId) && Number.isFinite(pageNumber)) {
    await updateToolRunPage(runId, pageNumber, {
      status: 'failed',
      reviewStatus: 'flagged',
      errorMessage: String(error),
      warnings: ['Page extraction failed.'],
    }).catch(() => undefined);
    await refreshToolRunAggregateStatus(runId).catch(() => undefined);
  }

  await updateJobStatus(job.id, 'failed', `1099-B page extraction error: ${String(error)}`);
  console.error(`[worker] failed 1099-B page job #${job.id}`, error);
}

async function scanWatchFolder() {
  try {
    const entries = await fs.readdir(env.WATCH_FOLDER, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) continue;
      const sourcePath = path.join(env.WATCH_FOLDER, entry.name);
      const existing = await findJobBySourcePath(sourcePath);
      if (existing) continue;
      const stable = await isFileStable(sourcePath);
      if (!stable) continue;
      const jobId = await createJobForFile(sourcePath, entry.name);
      console.log(`[worker] queued watched-folder job #${jobId} for ${entry.name}`);
    }
  } catch (error) {
    console.error('[worker] watch scan error', error);
  }
}

async function processQueuedJobs() {
  const jobs = await getQueuedJobs(5);
  for (const job of jobs) {
    const settings = await getSettingsMap();

    if (job.job_type === 'tool.1099b.extract_page') {
      try {
        await updateJobStatus(job.id, 'processing', 'Worker picked up 1099-B page extraction job');
        await process1099BExtractPageJob(job, settings);
      } catch (error) {
        await fail1099BExtractPageJob(job, error);
      }
      continue;
    }

    try {
      const payload = job.payload_json ? JSON.parse(job.payload_json) : {};
      const textHandling = resolveOcrTextHandling(settings, payload.ocrTextHandlingOverride);
      const provider = settings.ocr_mode === 'external' ? 'external:pending' : 'container:ocrmypdf';
      await updateJobStatus(job.id, 'processing', 'Worker picked up job');
      await markDocumentOcr(job.id, 'processing', settings.ocr_mode === 'external' ? provider : `${provider}:${textHandling}`);
      const originalFilename = payload.originalFilename || path.basename(job.source_path);
      const inferred = inferMetadata(originalFilename);
      const ocr = await runOcrStep(job.source_path, originalFilename, settings, payload);
      await updateDocument(job.id, {
        status: ocr.documentStatus,
        ...inferred,
        extractedText: ocr.extractedText,
        currentPath: ocr.outputPath,
        ocrStatus: ocr.ocrStatus,
        ocrProvider: ocr.provider,
        reviewNotes: ocr.notes,
      });
      await updateJobStatus(job.id, 'completed', `OCR/classification step complete: ${ocr.notes}`, { ...inferred, ocrProvider: ocr.provider, outputPath: ocr.outputPath, notes: ocr.notes, ocrStatus: ocr.ocrStatus });
      console.log(`[worker] completed job #${job.id} (${originalFilename})`);
    } catch (error) {
      const payload = job.payload_json ? JSON.parse(job.payload_json) : {};
      const textHandling = resolveOcrTextHandling(settings, payload.ocrTextHandlingOverride);
      await markDocumentOcr(job.id, 'failed', `container:ocrmypdf:${textHandling}`);
      await updateDocument(job.id, {
        status: 'error',
        formType: 'Error',
        issuer: 'Worker',
        taxYear: String(new Date().getFullYear()),
        clientName: 'Unknown Client',
        ssnLast4: '',
        confidenceScore: 0,
        extractedText: '',
        currentPath: job.source_path,
        ocrStatus: 'failed',
        ocrProvider: `container:ocrmypdf:${textHandling}`,
        reviewNotes: `Worker failed during --${textHandling}: ${String(error)}`,
      });
      await updateJobStatus(job.id, 'failed', `Worker error: ${String(error)}`);
      console.error(`[worker] failed job #${job.id}`, error);
    }
  }
}

async function tick() {
  await scanWatchFolder();
  await processQueuedJobs();
}

async function main() {
  console.log('tax-ops worker bootstrap started');
  console.log(`watch folder: ${env.WATCH_FOLDER}`);
  await waitForSettingsTable();
  console.log('[worker] settings table ready');
  await tick();
  setInterval(() => {
    void tick();
  }, 4000);
}

void main().catch((error) => {
  console.error('tax-ops worker fatal error', error);
  process.exitCode = 1;
});
