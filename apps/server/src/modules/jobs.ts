import path from 'node:path';
import { buildDocumentFilename } from '../../../../packages/shared/src/naming/document.js';
import { pool } from '../db/pool.js';

type OcrTextHandling = 'skip-text' | 'redo-ocr' | 'force-ocr';

function mapDocument(row: any) {
  return {
    id: row.id,
    jobId: row.job_id,
    originalFilename: row.original_filename,
    originalPath: row.original_path,
    currentPath: row.current_path,
    taxYear: row.tax_year,
    formType: row.form_type,
    issuer: row.issuer,
    clientName: row.client_name,
    ssnLast4: row.ssn_last4,
    status: row.status,
    confidenceScore: row.confidence_score,
    extractedText: row.extracted_text,
    ocrStatus: row.ocr_status,
    ocrProvider: row.ocr_provider,
    reviewNotes: row.review_notes,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listJobs(limit = 25) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, job_type, status, source_path, message, payload_json, result_json, created_at, updated_at
       FROM processing_jobs
       ORDER BY created_at DESC
       LIMIT ?`,
      [limit],
    );
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      id: row.id,
      jobType: row.job_type,
      status: row.status,
      sourcePath: row.source_path,
      message: row.message,
      payloadJson: row.payload_json,
      resultJson: row.result_json,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  } finally {
    conn.release();
  }
}

export async function createJob(input: { jobType: string; sourcePath: string; message?: string | null; payload?: unknown }) {
  const conn = await pool.getConnection();
  try {
    const result = await conn.query(
      `INSERT INTO processing_jobs (job_type, status, source_path, message, payload_json)
       VALUES (?, 'queued', ?, ?, ?)`,
      [input.jobType, input.sourcePath, input.message ?? null, input.payload ? JSON.stringify(input.payload) : null],
    );
    return Number(result.insertId);
  } finally {
    conn.release();
  }
}

export async function updateJobStatus(jobId: number, status: 'queued' | 'processing' | 'completed' | 'failed', message?: string | null, result?: unknown) {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `UPDATE processing_jobs
       SET status = ?, message = ?, result_json = ?
       WHERE id = ?`,
      [status, message ?? null, result ? JSON.stringify(result) : null, jobId],
    );
  } finally {
    conn.release();
  }
}

export async function createDocument(input: {
  jobId?: number | null;
  originalFilename: string;
  originalPath: string;
  currentPath: string;
  status?: 'intake' | 'review' | 'filed' | 'error';
  extractedText?: string | null;
}) {
  const conn = await pool.getConnection();
  try {
    const result = await conn.query(
      `INSERT INTO documents (job_id, original_filename, original_path, current_path, status, extracted_text)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.jobId ?? null, input.originalFilename, input.originalPath, input.currentPath, input.status ?? 'intake', input.extractedText ?? null],
    );
    return Number(result.insertId);
  } finally {
    conn.release();
  }
}

export async function listDocuments(limit = 25) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, job_id, original_filename, original_path, current_path, tax_year, form_type, issuer, client_name, ssn_last4, status, confidence_score, extracted_text, ocr_status, ocr_provider, review_notes, created_at, updated_at
       FROM documents
       ORDER BY created_at DESC
       LIMIT ?`,
      [limit],
    );
    return (Array.isArray(rows) ? rows : []).map(mapDocument);
  } finally {
    conn.release();
  }
}

export async function getDocumentById(documentId: number) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, job_id, original_filename, original_path, current_path, tax_year, form_type, issuer, client_name, ssn_last4, status, confidence_score, extracted_text, ocr_status, ocr_provider, review_notes, created_at, updated_at
       FROM documents WHERE id = ? LIMIT 1`,
      [documentId],
    );
    return Array.isArray(rows) && rows[0] ? mapDocument(rows[0]) : null;
  } finally {
    conn.release();
  }
}

export async function getQueuedJobs(limit = 10) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, job_type, status, source_path, message, payload_json, created_at, updated_at
       FROM processing_jobs
       WHERE status = 'queued'
       ORDER BY created_at ASC
       LIMIT ?`,
      [limit],
    );
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      id: row.id,
      jobType: row.job_type,
      status: row.status,
      sourcePath: row.source_path,
      message: row.message,
      payloadJson: row.payload_json,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  } finally {
    conn.release();
  }
}

export async function findJobBySourcePath(sourcePath: string) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, status FROM processing_jobs WHERE source_path = ? ORDER BY id DESC LIMIT 1`,
      [sourcePath],
    );
    return Array.isArray(rows) && rows[0] ? { id: rows[0].id, status: rows[0].status } : null;
  } finally {
    conn.release();
  }
}

export async function findDocumentByJobId(jobId: number) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, job_id, original_filename, original_path, current_path, tax_year, form_type, issuer, client_name, ssn_last4, status, confidence_score, extracted_text, ocr_status, ocr_provider, review_notes, created_at, updated_at
       FROM documents WHERE job_id = ? LIMIT 1`,
      [jobId],
    );
    return Array.isArray(rows) && rows[0] ? mapDocument(rows[0]) : null;
  } finally {
    conn.release();
  }
}

export async function updateDocumentProcessing(
  jobId: number,
  input: {
    status: 'intake' | 'review' | 'filed' | 'error';
    taxYear?: string | null;
    formType?: string | null;
    issuer?: string | null;
    clientName?: string | null;
    ssnLast4?: string | null;
    confidenceScore?: number | null;
    extractedText?: string | null;
    currentPath?: string | null;
    ocrStatus?: 'pending' | 'processing' | 'completed' | 'failed';
    ocrProvider?: string | null;
    reviewNotes?: string | null;
  },
) {
  const conn = await pool.getConnection();
  try {
    const existing = await findDocumentByJobId(jobId);
    if (!existing) return null;

    const currentPath =
      input.currentPath ??
      buildDocumentFilename({
        taxYear: input.taxYear,
        formType: input.formType,
        issuer: input.issuer,
        clientName: input.clientName,
        ssnLast4: input.ssnLast4,
      });

    await conn.query(
      `UPDATE documents
       SET status = ?, tax_year = ?, form_type = ?, issuer = ?, client_name = ?, ssn_last4 = ?, confidence_score = ?, extracted_text = ?, current_path = ?, ocr_status = ?, ocr_provider = ?, review_notes = ?
       WHERE job_id = ?`,
      [
        input.status,
        input.taxYear ?? null,
        input.formType ?? null,
        input.issuer ?? null,
        input.clientName ?? null,
        input.ssnLast4 ?? null,
        input.confidenceScore ?? null,
        input.extractedText ?? existing.extractedText ?? null,
        currentPath,
        input.ocrStatus ?? existing.ocrStatus ?? 'pending',
        input.ocrProvider ?? existing.ocrProvider ?? null,
        input.reviewNotes ?? existing.reviewNotes ?? null,
        jobId,
      ],
    );

    return findDocumentByJobId(jobId);
  } finally {
    conn.release();
  }
}

export async function updateDocumentReview(documentId: number, input: { status?: 'intake' | 'review' | 'filed' | 'error'; formType?: string | null; issuer?: string | null; clientName?: string | null; taxYear?: string | null; ssnLast4?: string | null; reviewNotes?: string | null; }) {
  const conn = await pool.getConnection();
  try {
    const existing = await getDocumentById(documentId);
    if (!existing) return null;

    const taxYear = input.taxYear ?? existing.taxYear;
    const formType = input.formType ?? existing.formType;
    const issuer = input.issuer ?? existing.issuer;
    const clientName = input.clientName ?? existing.clientName;
    const ssnLast4 = input.ssnLast4 ?? existing.ssnLast4;

    const currentPath = buildDocumentFilename({ taxYear, formType, issuer, clientName, ssnLast4 });

    await conn.query(
      `UPDATE documents
       SET status = ?, tax_year = ?, form_type = ?, issuer = ?, client_name = ?, ssn_last4 = ?, review_notes = ?, current_path = ?
       WHERE id = ?`,
      [
        input.status ?? existing.status,
        taxYear ?? null,
        formType ?? null,
        issuer ?? null,
        clientName ?? null,
        ssnLast4 ?? null,
        input.reviewNotes ?? existing.reviewNotes ?? null,
        currentPath,
        documentId,
      ],
    );

    return getDocumentById(documentId);
  } finally {
    conn.release();
  }
}

export async function queueDocumentOcrRerun(documentId: number, input: { ocrTextHandling: Exclude<OcrTextHandling, 'skip-text'> }) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, job_id, original_filename, original_path, current_path, tax_year, form_type, issuer, client_name, ssn_last4, status, confidence_score, extracted_text, ocr_status, ocr_provider, review_notes, created_at, updated_at
       FROM documents WHERE id = ? LIMIT 1`,
      [documentId],
    );
    const existing = Array.isArray(rows) && rows[0] ? mapDocument(rows[0]) : null;
    if (!existing) return null;

    const rerunNote = `OCR re-run queued with --${input.ocrTextHandling} on ${new Date().toISOString()}.`;
    const reviewNotes = [existing.reviewNotes?.trim(), rerunNote].filter(Boolean).join('\n\n');
    const sourcePath = existing.currentPath && path.isAbsolute(existing.currentPath) ? existing.currentPath : existing.originalPath;

    const result = await conn.query(
      `INSERT INTO processing_jobs (job_type, status, source_path, message, payload_json)
       VALUES ('document.ocr_rerun', 'queued', ?, ?, ?)`,
      [
        sourcePath,
        `Queued OCR re-run (${input.ocrTextHandling})`,
        JSON.stringify({
          originalFilename: existing.originalFilename,
          rerunForDocumentId: existing.id,
          previousJobId: existing.jobId,
          ocrTextHandlingOverride: input.ocrTextHandling,
        }),
      ],
    );

    const jobId = Number(result.insertId);
    await conn.query(
      `UPDATE documents
       SET job_id = ?, status = 'review', ocr_status = 'pending', ocr_provider = ?, review_notes = ?, current_path = ?
       WHERE id = ?`,
      [jobId, `queued:${input.ocrTextHandling}`, reviewNotes, sourcePath, documentId],
    );

    return getDocumentById(documentId);
  } finally {
    conn.release();
  }
}
