import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
  OCR_COMMAND: process.env.OCR_COMMAND || '/opt/ocrmypdf-venv/bin/ocrmypdf --deskew --skip-text --sidecar "{sidecar}" "{input}" "{output}"',
  WATCH_STABLE_MS: Number(process.env.WATCH_STABLE_MS || 8000),
};

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
    return Object.fromEntries((Array.isArray(rows) ? rows : []).map((row) => [row.setting_key, row.setting_value]));
  } finally {
    conn.release();
  }
}

async function getQueuedJobs(limit = 10) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, source_path, payload_json FROM processing_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?`,
      [limit],
    );
    return Array.isArray(rows) ? rows : [];
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

async function updateDocument(jobId: number, input: { status: 'review' | 'error'; formType: string; issuer: string; taxYear: string; clientName: string; ssnLast4: string; confidenceScore: number; extractedText: string; currentPath: string; ocrStatus: 'processing' | 'completed' | 'failed'; ocrProvider: string; reviewNotes: string; }) {
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

async function markDocumentOcr(jobId: number, status: 'processing' | 'completed' | 'failed', provider: string) {
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

function renderCommand(template: string, inputPath: string, outputPath: string, sidecarPath: string) {
  return template
    .replaceAll('{input}', inputPath)
    .replaceAll('{output}', outputPath)
    .replaceAll('{sidecar}', sidecarPath);
}

async function runOcrStep(sourcePath: string, fileName: string) {
  const outputRoot = path.join(env.PROCESSED_FOLDER, 'ocr');
  await fs.mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, fileName);
  const sidecarPath = `${outputPath}.txt`;
  const command = renderCommand(env.OCR_COMMAND, sourcePath, outputPath, sidecarPath);
  const { stdout, stderr } = await execFileAsync('/bin/sh', ['-lc', command]);
  const details = [stderr?.trim(), stdout?.trim()].filter(Boolean).join(' | ');
  const extractedText = await fs.readFile(sidecarPath, 'utf8').catch(() => '');
  await fs.unlink(sidecarPath).catch(() => undefined);
  return {
    provider: 'container:ocrmypdf',
    extractedText: extractedText.trim(),
    notes: details || `Bundled OCR command completed. Extracted text ${extractedText.trim() ? 'captured' : 'not captured'}.`,
    outputPath,
  };
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
  const settings = await getSettingsMap();
  const jobs = await getQueuedJobs(5);
  for (const job of jobs) {
    try {
      await updateJobStatus(job.id, 'processing', 'Worker picked up job');
      await markDocumentOcr(job.id, 'processing', 'container:ocrmypdf');
      const payload = job.payload_json ? JSON.parse(job.payload_json) : {};
      const originalFilename = payload.originalFilename || path.basename(job.source_path);
      const inferred = inferMetadata(originalFilename);
      const ocr = await runOcrStep(job.source_path, originalFilename);
      await updateDocument(job.id, {
        status: 'review',
        ...inferred,
        extractedText: ocr.extractedText,
        currentPath: ocr.outputPath,
        ocrStatus: 'completed',
        ocrProvider: ocr.provider,
        reviewNotes: ocr.notes,
      });
      await updateJobStatus(job.id, 'completed', `OCR/classification step complete: ${ocr.notes}`, { ...inferred, ocrProvider: ocr.provider, outputPath: ocr.outputPath, notes: ocr.notes });
      console.log(`[worker] completed job #${job.id} (${originalFilename})`);
    } catch (error) {
      await markDocumentOcr(job.id, 'failed', 'container:ocrmypdf');
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
        ocrProvider: 'container:ocrmypdf',
        reviewNotes: `Worker failed: ${String(error)}`,
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
