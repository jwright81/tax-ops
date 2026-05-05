import { pool } from '../db/pool.js';

type ToolRunStatus = 'queued' | 'processing' | 'reviewing' | 'completed' | 'failed';
type ToolRunSourceKind = 'upload' | 'existing_document';
type ToolRunPageStatus = 'queued' | 'processing' | 'ready' | 'reviewed' | 'failed';
type ToolExportType = 'txf';

function parseJson<T>(value: unknown): T | null {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function mapRun(row: any) {
  return {
    id: row.id,
    toolType: row.tool_type,
    sourceKind: row.source_kind,
    sourceDocumentId: row.source_document_id,
    sourceFilename: row.source_filename,
    sourcePath: row.source_path,
    clientId: row.client_id,
    status: row.status,
    pageCount: row.page_count,
    selectedPageRange: row.selected_page_range,
    detectedMetadata: parseJson<Record<string, unknown>>(row.detected_metadata_json),
    createdByUserId: row.created_by_user_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapRunPage(row: any) {
  return {
    id: row.id,
    runId: row.run_id,
    pageNumber: row.page_number,
    status: row.status,
    reviewStatus: row.review_status,
    previewPath: row.preview_path,
    textPath: row.text_path,
    extractedText: row.extracted_text,
    warnings: parseJson<string[]>(row.warnings_json) ?? [],
    errorMessage: row.error_message,
    result: row.result_id
      ? {
          id: row.result_id,
          result: parseJson<Record<string, unknown>>(row.result_json),
          normalizedRows: parseJson<Record<string, unknown>[]>(row.normalized_rows_json) ?? [],
          audit: parseJson<Record<string, unknown>>(row.audit_json),
          createdAt: new Date(row.result_created_at).toISOString(),
          updatedAt: new Date(row.result_updated_at).toISOString(),
        }
      : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapRunExport(row: any) {
  return {
    id: row.id,
    runId: row.run_id,
    exportType: row.export_type,
    status: row.status,
    outputPath: row.output_path,
    summary: parseJson<Record<string, unknown>>(row.summary_json),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapRunPageResult(row: any) {
  return {
    id: row.id,
    runPageId: row.run_page_id,
    result: parseJson<Record<string, unknown>>(row.result_json),
    normalizedRows: parseJson<Record<string, unknown>[]>(row.normalized_rows_json) ?? [],
    audit: parseJson<Record<string, unknown>>(row.audit_json),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listToolRuns(limit = 25, toolType = '1099-b-extractor') {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, tool_type, source_kind, source_document_id, source_filename, source_path, client_id, status, page_count, selected_page_range, detected_metadata_json, created_by_user_id, created_at, updated_at
       FROM tool_runs
       WHERE tool_type = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [toolType, limit],
    );
    return (Array.isArray(rows) ? rows : []).map(mapRun);
  } finally {
    conn.release();
  }
}

export async function getToolRunById(runId: number) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, tool_type, source_kind, source_document_id, source_filename, source_path, client_id, status, page_count, selected_page_range, detected_metadata_json, created_by_user_id, created_at, updated_at
       FROM tool_runs
       WHERE id = ? LIMIT 1`,
      [runId],
    );
    return Array.isArray(rows) && rows[0] ? mapRun(rows[0]) : null;
  } finally {
    conn.release();
  }
}

export async function listToolRunPages(runId: number) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT
         p.id, p.run_id, p.page_number, p.status, p.review_status, p.preview_path, p.text_path, p.extracted_text, p.warnings_json, p.error_message, p.created_at, p.updated_at,
         r.id AS result_id, r.result_json, r.normalized_rows_json, r.audit_json, r.created_at AS result_created_at, r.updated_at AS result_updated_at
       FROM tool_run_pages p
       LEFT JOIN tool_run_page_results r ON r.run_page_id = p.id
       WHERE p.run_id = ?
       ORDER BY p.page_number ASC`,
      [runId],
    );
    return (Array.isArray(rows) ? rows : []).map(mapRunPage);
  } finally {
    conn.release();
  }
}

export async function listToolRunExports(runId: number) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, run_id, export_type, status, output_path, summary_json, created_at, updated_at
       FROM tool_run_exports
       WHERE run_id = ?
       ORDER BY created_at DESC`,
      [runId],
    );
    return (Array.isArray(rows) ? rows : []).map(mapRunExport);
  } finally {
    conn.release();
  }
}

export async function listToolRunPageResults(runId: number) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT r.id, r.run_page_id, r.result_json, r.normalized_rows_json, r.audit_json, r.created_at, r.updated_at
       FROM tool_run_page_results r
       INNER JOIN tool_run_pages p ON p.id = r.run_page_id
       WHERE p.run_id = ?
       ORDER BY p.page_number ASC`,
      [runId],
    );
    return (Array.isArray(rows) ? rows : []).map(mapRunPageResult);
  } finally {
    conn.release();
  }
}

export async function createToolRun(input: {
  toolType: string;
  sourceKind: ToolRunSourceKind;
  sourceFilename: string;
  sourcePath: string;
  sourceDocumentId?: number | null;
  clientId?: number | null;
  pageCount?: number | null;
  selectedPageRange?: string | null;
  detectedMetadata?: Record<string, unknown> | null;
  createdByUserId?: number | null;
}) {
  const conn = await pool.getConnection();
  try {
    const result = await conn.query(
      `INSERT INTO tool_runs (
         tool_type, source_kind, source_document_id, source_filename, source_path, client_id, status, page_count, selected_page_range, detected_metadata_json, created_by_user_id
       ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
      [
        input.toolType,
        input.sourceKind,
        input.sourceDocumentId ?? null,
        input.sourceFilename,
        input.sourcePath,
        input.clientId ?? null,
        input.pageCount ?? null,
        input.selectedPageRange ?? null,
        input.detectedMetadata ? JSON.stringify(input.detectedMetadata) : null,
        input.createdByUserId ?? null,
      ],
    );

    const runId = Number(result.insertId);
    return getToolRunById(runId);
  } finally {
    conn.release();
  }
}

export async function queueToolRunPages(input: {
  runId: number;
  pageNumbers: number[];
}) {
  const conn = await pool.getConnection();
  try {
    for (const pageNumber of input.pageNumbers) {
      await conn.query(
        `INSERT INTO tool_run_pages (run_id, page_number, status, review_status)
         VALUES (?, ?, 'queued', 'pending')`,
        [input.runId, pageNumber],
      );

      await conn.query(
        `INSERT INTO processing_jobs (job_type, status, source_path, message, payload_json)
         VALUES ('tool.1099b.extract_page', 'queued', '', ?, ?)`,
        [
          `Queued 1099-B extraction for run ${input.runId} page ${pageNumber}`,
          JSON.stringify({ runId: input.runId, pageNumber, toolType: '1099-b-extractor' }),
        ],
      );
    }

    await conn.query(
      `UPDATE tool_runs
       SET status = 'processing', page_count = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [input.pageNumbers.length, input.runId],
    );
  } finally {
    conn.release();
  }
}

export async function create1099BRun(input: {
  sourceKind: ToolRunSourceKind;
  sourceFilename: string;
  sourcePath: string;
  sourceDocumentId?: number | null;
  clientId?: number | null;
  selectedPageRange?: string | null;
  pageNumbers: number[];
  createdByUserId?: number | null;
}) {
  const run = await createToolRun({
    toolType: '1099-b-extractor',
    sourceKind: input.sourceKind,
    sourceFilename: input.sourceFilename,
    sourcePath: input.sourcePath,
    sourceDocumentId: input.sourceDocumentId,
    clientId: input.clientId,
    pageCount: input.pageNumbers.length,
    selectedPageRange: input.selectedPageRange ?? null,
    detectedMetadata: null,
    createdByUserId: input.createdByUserId ?? null,
  });

  if (!run) return null;
  await queueToolRunPages({ runId: run.id, pageNumbers: input.pageNumbers });
  return getToolRunById(run.id);
}

export async function build1099BRunDetail(runId: number) {
  const [run, pages, pageResults, exports] = await Promise.all([
    getToolRunById(runId),
    listToolRunPages(runId),
    listToolRunPageResults(runId),
    listToolRunExports(runId),
  ]);

  if (!run) return null;
  const resultsByPageId = new Map(pageResults.map((result) => [result.runPageId, result]));
  return { run, pages: pages.map((page) => ({ ...page, result: resultsByPageId.get(page.id) ?? null })), exports };
}
