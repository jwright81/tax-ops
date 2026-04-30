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
      `SELECT id, run_id, page_number, status, review_status, preview_path, text_path, extracted_text, warnings_json, error_message, created_at, updated_at
       FROM tool_run_pages
       WHERE run_id = ?
       ORDER BY page_number ASC`,
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
  const [run, pages, exports] = await Promise.all([
    getToolRunById(runId),
    listToolRunPages(runId),
    listToolRunExports(runId),
  ]);

  if (!run) return null;
  return { run, pages, exports };
}
