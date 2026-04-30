import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { authenticate } from '../auth/login.js';
import { type AuthenticatedRequest, requireAdmin, requireAuth } from '../auth/requireAuth.js';
import { pool } from '../db/pool.js';
import { createAiProvider, listAiProviders, probeAiProvider, setAiProviderModel, setAiRouting, updateAiProvider } from '../modules/aiProviders.js';
import { disconnectOpenAiCodexOAuth, handleOpenAiCodexOAuthCallback, startOpenAiCodexOAuth } from '../modules/openaiCodexOAuth.js';
import { createDocument, createJob, getDocumentById, listDocuments, listJobs, queueDocumentOcrRerun, updateDocumentReview } from '../modules/jobs.js';
import { listSettings, upsertSettings } from '../modules/settings.js';
import { build1099BRunDetail, create1099BRun, listToolRuns } from '../modules/toolRuns.js';
import { createUser, getUserById, listUsers, recordAudit, resetUserPassword, updateUser } from '../modules/users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDistPath = path.resolve(__dirname, '../../../../../../../apps/web/dist');

const createUserSchema = z.object({
  username: z.string().min(3).max(100),
  password: z.string().min(8).max(100),
  role: z.enum(['admin', 'staff']),
  active: z.boolean().optional(),
});

const updateUserSchema = z.object({
  role: z.enum(['admin', 'staff']).optional(),
  active: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8).max(100),
});

const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});

const settingsSchema = z.object({
  settings: z.array(
    z.object({
      key: z.string().min(1).max(120),
      value: z.string().min(0).max(1000),
    }),
  ),
});

const createIntakeJobSchema = z.object({
  sourcePath: z.string().min(1).max(500),
  originalFilename: z.string().min(1).max(255),
  extractedText: z.string().optional(),
});

const updateDocumentReviewSchema = z.object({
  status: z.enum(['intake', 'review', 'filed', 'error']).optional(),
  taxYear: z.string().max(10).optional().nullable(),
  formType: z.string().max(120).optional().nullable(),
  issuer: z.string().max(255).optional().nullable(),
  clientName: z.string().max(255).optional().nullable(),
  ssnLast4: z.string().max(4).optional().nullable(),
  reviewNotes: z.string().max(5000).optional().nullable(),
});

const rerunDocumentOcrSchema = z.object({
  ocrTextHandling: z.enum(['redo-ocr', 'force-ocr']),
});

const create1099BRunSchema = z
  .object({
    sourceKind: z.enum(['upload', 'existing_document']),
    sourceFilename: z.string().min(1).max(255),
    sourcePath: z.string().min(1).max(500),
    sourceDocumentId: z.number().int().positive().optional().nullable(),
    clientId: z.number().int().positive().optional().nullable(),
    selectedPageRange: z.string().max(120).optional().nullable(),
    pageNumbers: z.array(z.number().int().positive()).min(1),
  })
  .superRefine((value, ctx) => {
    if (value.sourceKind === 'existing_document' && !value.sourceDocumentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'sourceDocumentId is required for existing_document runs',
        path: ['sourceDocumentId'],
      });
    }
  });

const createAiProviderSchema = z.object({
  kind: z.enum(['openai', 'lmstudio', 'ollama']),
  displayName: z.string().min(1).max(120),
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

const updateAiProviderSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

const setAiProviderModelSchema = z.object({
  model: z.string().min(1).max(255),
});

const setAiRoutingSchema = z.object({
  defaultProviderId: z.number().int().positive().nullable(),
  fallbackProviderId: z.number().int().positive().nullable(),
});

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', async (_req, res) => {
    try {
      const conn = await pool.getConnection();
      await conn.query('SELECT 1 AS ok');
      conn.release();
      res.json({ ok: true, service: 'tax-ops', db: 'ok' });
    } catch (error) {
      res.status(500).json({ ok: false, service: 'tax-ops', db: 'error', error: String(error) });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      res.status(400).json({ error: 'username and password are required' });
      return;
    }

    const session = await authenticate(String(username), String(password));
    if (!session) {
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }

    await recordAudit(session.user.id, 'auth.login', 'user', String(session.user.id), { username: session.user.username });
    res.json(session);
  });

  app.post('/api/auth/change-password', requireAuth, async (req: AuthenticatedRequest, res) => {
    const parsed = changeOwnPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const conn = await pool.getConnection();
    try {
      const rows = await conn.query('SELECT id, password_hash FROM users WHERE id = ? LIMIT 1', [req.auth!.userId]);
      const user = Array.isArray(rows) ? rows[0] : null;
      if (!user) {
        res.status(404).json({ error: 'user not found' });
        return;
      }

      const matches = await bcrypt.compare(parsed.data.currentPassword, user.password_hash);
      if (!matches) {
        res.status(401).json({ error: 'current password is incorrect' });
        return;
      }

      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
      await conn.query(
        'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
        [passwordHash, req.auth!.userId],
      );
      await recordAudit(req.auth!.userId, 'auth.change_password', 'user', String(req.auth!.userId), { selfService: true });
      res.json({ ok: true });
    } finally {
      conn.release();
    }
  });

  app.get('/api/bootstrap/status', async (_req, res) => {
    const conn = await pool.getConnection();
    try {
      const rows = await conn.query('SELECT COUNT(*) AS count FROM users');
      const count = Array.isArray(rows) ? Number(rows[0]?.count ?? 0) : 0;
      res.json({ hasUsers: count > 0, userCount: count });
    } finally {
      conn.release();
    }
  });

  app.get('/api/me', requireAuth, async (req: AuthenticatedRequest, res) => {
    const user = await getUserById(req.auth!.userId);
    if (!user) {
      res.status(404).json({ error: 'user not found' });
      return;
    }

    res.json({ user });
  });

  app.get('/api/users', requireAuth, requireAdmin, async (_req, res) => {
    const users = await listUsers();
    res.json({ users });
  });

  app.post('/api/users', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      const user = await createUser(parsed.data);
      await recordAudit(req.auth!.userId, 'user.create', 'user', user ? String(user.id) : null, parsed.data);
      res.status(201).json({ user });
    } catch (error) {
      res.status(400).json({ error: 'unable to create user', detail: String(error) });
    }
  });

  app.patch('/api/users/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: 'invalid user id' });
      return;
    }

    if (userId === req.auth!.userId && req.body?.active === false) {
      res.status(400).json({ error: 'admin cannot disable their own account' });
      return;
    }

    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const user = await updateUser(userId, parsed.data);
    await recordAudit(req.auth!.userId, 'user.update', 'user', String(userId), parsed.data);
    res.json({ user });
  });

  app.post('/api/users/:id/reset-password', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: 'invalid user id' });
      return;
    }

    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const user = await resetUserPassword(userId, parsed.data.password);
    await recordAudit(req.auth!.userId, 'user.reset_password', 'user', String(userId), { forcedReset: true });
    res.json({ user });
  });

  app.get('/api/settings', requireAuth, requireAdmin, async (_req, res) => {
    const settings = await listSettings();
    res.json({ settings });
  });

  app.get('/api/ai/providers', requireAuth, requireAdmin, async (_req, res) => {
    const providers = await listAiProviders();
    res.json({ providers });
  });

  app.post('/api/ai/providers', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const parsed = createAiProviderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const provider = await createAiProvider(parsed.data);
    await recordAudit(req.auth!.userId, 'ai_provider.create', 'ai_provider', provider ? String(provider.id) : null, parsed.data);
    res.status(201).json({ provider });
  });

  app.patch('/api/ai/providers/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const providerId = Number(req.params.id);
    if (!Number.isFinite(providerId)) {
      res.status(400).json({ error: 'invalid provider id' });
      return;
    }

    const parsed = updateAiProviderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const provider = await updateAiProvider(providerId, parsed.data);
    if (!provider) {
      res.status(404).json({ error: 'provider not found' });
      return;
    }

    await recordAudit(req.auth!.userId, 'ai_provider.update', 'ai_provider', String(providerId), parsed.data);
    res.json({ provider });
  });

  app.post('/api/ai/providers/:id/test', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const providerId = Number(req.params.id);
    if (!Number.isFinite(providerId)) {
      res.status(400).json({ error: 'invalid provider id' });
      return;
    }

    const provider = await probeAiProvider(providerId);
    if (!provider) {
      res.status(404).json({ error: 'provider not found' });
      return;
    }

    await recordAudit(req.auth!.userId, 'ai_provider.test', 'ai_provider', String(providerId), null);
    res.json({ provider });
  });

  app.post('/api/ai/providers/:id/openai-oauth/start', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const providerId = Number(req.params.id);
    if (!Number.isFinite(providerId)) {
      res.status(400).json({ error: 'invalid provider id' });
      return;
    }

    try {
      const result = await startOpenAiCodexOAuth(providerId);
      await recordAudit(req.auth!.userId, 'ai_provider.openai_oauth_start', 'ai_provider', String(providerId), null);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to start OpenAI OAuth flow' });
    }
  });

  app.get('/api/ai/openai/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : null;
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    const result = await handleOpenAiCodexOAuthCallback({ code, state });
    res.status(result.statusCode).type('html').send(result.html);
  });

  app.post('/api/ai/providers/:id/openai-oauth/disconnect', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const providerId = Number(req.params.id);
    if (!Number.isFinite(providerId)) {
      res.status(400).json({ error: 'invalid provider id' });
      return;
    }

    const provider = await disconnectOpenAiCodexOAuth(providerId);
    if (!provider) {
      res.status(404).json({ error: 'provider not found' });
      return;
    }

    await recordAudit(req.auth!.userId, 'ai_provider.openai_oauth_disconnect', 'ai_provider', String(providerId), null);
    res.json({ provider });
  });

  app.post('/api/ai/providers/:id/model', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const providerId = Number(req.params.id);
    if (!Number.isFinite(providerId)) {
      res.status(400).json({ error: 'invalid provider id' });
      return;
    }

    const parsed = setAiProviderModelSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const provider = await setAiProviderModel(providerId, parsed.data.model);
    if (!provider) {
      res.status(404).json({ error: 'provider not found' });
      return;
    }

    await recordAudit(req.auth!.userId, 'ai_provider.set_model', 'ai_provider', String(providerId), parsed.data);
    res.json({ provider });
  });

  app.put('/api/ai/routing', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const parsed = setAiRoutingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const providers = await setAiRouting(parsed.data);
    await recordAudit(req.auth!.userId, 'ai_provider.set_routing', 'ai_provider', null, parsed.data);
    res.json({ providers });
  });

  app.put('/api/settings', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    await upsertSettings(parsed.data.settings);
    await recordAudit(req.auth!.userId, 'settings.update', 'system_settings', null, parsed.data.settings);
    const settings = await listSettings();
    res.json({ settings });
  });

  app.get('/api/jobs', requireAuth, async (_req, res) => {
    const jobs = await listJobs();
    res.json({ jobs });
  });

  app.get('/api/documents', requireAuth, async (_req, res) => {
    const documents = await listDocuments();
    res.json({ documents });
  });

  app.get('/api/documents/:id', requireAuth, async (req, res) => {
    const documentId = Number(req.params.id);
    if (!Number.isFinite(documentId)) {
      res.status(400).json({ error: 'invalid document id' });
      return;
    }

    const document = await getDocumentById(documentId);
    if (!document) {
      res.status(404).json({ error: 'document not found' });
      return;
    }

    res.json({ document });
  });

  app.patch('/api/documents/:id/review', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const documentId = Number(req.params.id);
    if (!Number.isFinite(documentId)) {
      res.status(400).json({ error: 'invalid document id' });
      return;
    }

    const parsed = updateDocumentReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const document = await updateDocumentReview(documentId, parsed.data);
    await recordAudit(req.auth!.userId, 'document.review_update', 'document', String(documentId), parsed.data);
    res.json({ document });
  });

  app.post('/api/documents/:id/rerun-ocr', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const documentId = Number(req.params.id);
    if (!Number.isFinite(documentId)) {
      res.status(400).json({ error: 'invalid document id' });
      return;
    }

    const parsed = rerunDocumentOcrSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const document = await queueDocumentOcrRerun(documentId, parsed.data);
    if (!document) {
      res.status(404).json({ error: 'document not found' });
      return;
    }

    await recordAudit(req.auth!.userId, 'document.ocr_rerun', 'document', String(documentId), parsed.data);
    res.status(202).json({ document });
  });

  app.post('/api/intake/jobs', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const parsed = createIntakeJobSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const jobId = await createJob({
      jobType: 'intake.scan',
      sourcePath: parsed.data.sourcePath,
      message: 'Queued from admin dashboard',
      payload: { originalFilename: parsed.data.originalFilename },
    });

    const documentId = await createDocument({
      jobId,
      originalFilename: parsed.data.originalFilename,
      originalPath: parsed.data.sourcePath,
      currentPath: parsed.data.sourcePath,
      extractedText: parsed.data.extractedText ?? null,
      status: 'intake',
    });

    await recordAudit(req.auth!.userId, 'intake.job_create', 'processing_job', String(jobId), {
      documentId,
      sourcePath: parsed.data.sourcePath,
      originalFilename: parsed.data.originalFilename,
    });

    res.status(201).json({ jobId, documentId });
  });

  app.get('/api/tools/1099b/runs', requireAuth, async (_req, res) => {
    const runs = await listToolRuns();
    res.json({ runs });
  });

  app.get('/api/tools/1099b/runs/:id', requireAuth, async (req, res) => {
    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ error: 'invalid run id' });
      return;
    }

    const detail = await build1099BRunDetail(runId);
    if (!detail) {
      res.status(404).json({ error: 'run not found' });
      return;
    }

    res.json(detail);
  });

  app.post('/api/tools/1099b/runs', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const parsed = create1099BRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const pageNumbers = Array.from(new Set(parsed.data.pageNumbers)).sort((a, b) => a - b);
    const run = await create1099BRun({
      ...parsed.data,
      pageNumbers,
      createdByUserId: req.auth!.userId,
    });

    if (!run) {
      res.status(500).json({ error: 'failed to create run' });
      return;
    }

    await recordAudit(req.auth!.userId, 'tool_run.create_1099b', 'tool_run', String(run.id), {
      sourceKind: parsed.data.sourceKind,
      sourceDocumentId: parsed.data.sourceDocumentId ?? null,
      sourceFilename: parsed.data.sourceFilename,
      sourcePath: parsed.data.sourcePath,
      selectedPageRange: parsed.data.selectedPageRange ?? null,
      pageNumbers,
    });

    const detail = await build1099BRunDetail(run.id);
    res.status(201).json(detail);
  });

  app.use(express.static(webDistPath));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/health') {
      next();
      return;
    }
    res.sendFile(path.join(webDistPath, 'index.html'));
  });

  return app;
}
