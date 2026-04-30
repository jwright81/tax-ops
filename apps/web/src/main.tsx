import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

type UserRole = 'admin' | 'staff';
type AppSection = 'admin' | 'clients' | 'extractor1099b';
type AdminTab = 'overview' | 'users' | 'settings' | 'aiProviders' | 'review';

interface User {
  id: number;
  username: string;
  role: UserRole;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

interface LoginResponse {
  token: string;
  user: User;
}

interface Setting {
  key: string;
  value: string;
}

interface Job {
  id: number;
  jobType: string;
  status: string;
  sourcePath: string;
  message: string | null;
  resultJson?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DocumentItem {
  id: number;
  jobId: number | null;
  originalFilename: string;
  originalPath: string;
  currentPath: string;
  taxYear: string | null;
  formType: string | null;
  issuer: string | null;
  clientName: string | null;
  ssnLast4: string | null;
  status: string;
  confidenceScore: string | null;
  extractedText: string | null;
  ocrStatus: string;
  ocrProvider: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

type AiProviderKind = 'openai' | 'lmstudio' | 'ollama';

interface AiProvider {
  id: number;
  providerKey: string;
  kind: AiProviderKind;
  displayName: string;
  status: 'unconfigured' | 'configured' | 'connected' | 'error';
  isDefault: boolean;
  isFallback: boolean;
  configuredModel: string | null;
  lastError: string | null;
  lastConnectedAt: string | null;
  availableModels: string[];
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface ToolRun {
  id: number;
  toolType: string;
  sourceKind: 'upload' | 'existing_document';
  sourceDocumentId: number | null;
  sourceFilename: string;
  sourcePath: string;
  clientId: number | null;
  status: 'queued' | 'processing' | 'reviewing' | 'completed' | 'failed';
  pageCount: number | null;
  selectedPageRange: string | null;
  detectedMetadata: Record<string, unknown> | null;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

interface ToolRunPage {
  id: number;
  runId: number;
  pageNumber: number;
  status: 'queued' | 'processing' | 'ready' | 'reviewed' | 'failed';
  reviewStatus: string;
  previewPath: string | null;
  textPath: string | null;
  extractedText: string | null;
  warnings: string[];
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ToolRunExport {
  id: number;
  runId: number;
  exportType: string;
  status: string;
  outputPath: string | null;
  summary: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface ToolRunDetail {
  run: ToolRun;
  pages: ToolRunPage[];
  exports: ToolRunExport[];
}

type OcrTextHandling = 'skip-text' | 'redo-ocr' | 'force-ocr';

const tokenKey = 'tax-ops.token';
const autoRefreshIntervalMs = 5000;
const pageSize = 5;
const officeSettingKeys = ['office_name', 'auto_create_jobs'] as const;
const officeSettingLabels: Record<(typeof officeSettingKeys)[number], string> = {
  office_name: 'Office Name',
  auto_create_jobs: 'Auto Create Jobs',
};
const ocrDefaultSettings: Record<string, string> = {
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
};

function withSettingDefaults(nextSettings: Setting[]) {
  return {
    ...ocrDefaultSettings,
    ...Object.fromEntries(nextSettings.map((setting) => [setting.key, setting.value])),
  };
}

function isEnabled(value: string | undefined, fallback = false) {
  if (value == null) return fallback;
  return value === 'true';
}

function shellPreview(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function isOcrTextHandling(value: string | undefined): value is OcrTextHandling {
  return value === 'skip-text' || value === 'redo-ocr' || value === 'force-ocr';
}

function resolveOcrTextHandling(settingDrafts: Record<string, string>): OcrTextHandling {
  if (isOcrTextHandling(settingDrafts.ocr_text_handling)) return settingDrafts.ocr_text_handling;
  if (isEnabled(settingDrafts.ocr_skip_text, true)) return 'skip-text';
  return 'redo-ocr';
}

function buildOcrCommandPreview(settingDrafts: Record<string, string>) {
  const args = ['/opt/ocrmypdf-venv/bin/ocrmypdf'];
  const textHandling = resolveOcrTextHandling(settingDrafts);

  if (isEnabled(settingDrafts.ocr_deskew, true)) args.push('--deskew');
  if (isEnabled(settingDrafts.ocr_rotate_pages, true)) args.push('--rotate-pages');
  if (isEnabled(settingDrafts.ocr_jobs_enabled, true)) args.push('--jobs', settingDrafts.ocr_jobs || '1');
  args.push(`--${textHandling}`);
  if (isEnabled(settingDrafts.ocr_sidecar, true)) args.push('--sidecar', '{sidecar}');
  if (isEnabled(settingDrafts.ocr_rotate_pages_threshold_enabled, false) && settingDrafts.ocr_rotate_pages_threshold?.trim()) {
    args.push('--rotate-pages-threshold', settingDrafts.ocr_rotate_pages_threshold.trim());
  }
  if (isEnabled(settingDrafts.ocr_clean, false)) args.push('--clean');
  if (isEnabled(settingDrafts.ocr_clean_final, false)) args.push('--clean-final');

  args.push('{input}', '{output}');
  return args.map(shellPreview).join(' ');
}

function getStoredToken() {
  return window.localStorage.getItem(tokenKey);
}

function setStoredToken(token: string | null) {
  if (!token) {
    window.localStorage.removeItem(tokenKey);
    return;
  }
  window.localStorage.setItem(tokenKey, token);
}

function paginateItems<T>(items: T[], page: number, size = pageSize) {
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * size;
  return {
    totalPages,
    currentPage: safePage,
    items: items.slice(start, start + size),
    start,
  };
}

async function api<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || payload.detail || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function Panel(props: React.PropsWithChildren<{ title: string; subtitle?: string; actions?: React.ReactNode }>) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text">{props.title}</h2>
          {props.subtitle ? <p className="mt-1 text-sm text-slate-300">{props.subtitle}</p> : null}
        </div>
        {props.actions}
      </div>
      <div className="mt-5">{props.children}</div>
    </section>
  );
}

function Pager({
  currentPage,
  totalPages,
  itemCount,
  pageSize: currentPageSize,
  itemLabel,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  itemCount: number;
  pageSize: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
}) {
  if (itemCount === 0) return null;

  const start = (currentPage - 1) * currentPageSize + 1;
  const end = Math.min(itemCount, start + currentPageSize - 1);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm text-slate-300">
      <div>
        Showing {start}-{end} of {itemCount} {itemLabel}
      </div>
      <div className="flex items-center gap-2">
        <button className="rounded-lg border border-line px-3 py-2 hover:bg-white/5 disabled:opacity-50" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>
          Previous
        </button>
        <div className="rounded-lg border border-line px-3 py-2 text-xs uppercase tracking-[0.12em] text-muted">
          Page {currentPage} / {totalPages}
        </div>
        <button className="rounded-lg border border-line px-3 py-2 hover:bg-white/5 disabled:opacity-50" disabled={currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

function PlaceholderSection({ title, description }: { title: string; description: string }) {
  return (
    <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <Panel title={title} subtitle="Planned next-phase workspace">
        <div className="rounded-2xl border border-dashed border-line bg-[#0d1422] p-6 text-sm text-slate-300">
          <div className="text-base font-medium text-text">Coming soon</div>
          <p className="mt-2 max-w-2xl">{description}</p>
        </div>
      </Panel>
      <Panel title="Planning note" subtitle="Kept intentionally lightweight for this pass">
        <ul className="grid gap-3 text-sm text-slate-300">
          <li>• Navigation is in place so the next modules can be added without reshuffling the shell again.</li>
          <li>• Admin-only workflows are now separated from future client-facing and tool-focused areas.</li>
        </ul>
      </Panel>
    </section>
  );
}

function AdminAccessNotice() {
  return (
    <Panel title="Admin access required" subtitle="This area is hidden for non-admin users.">
      <div className="rounded-2xl border border-dashed border-line bg-[#0d1422] p-6 text-sm text-slate-300">
        Your account can still sign in, but admin workflows are intentionally gated to admin-role users.
      </div>
    </Panel>
  );
}

function LoginScreen({ onLogin }: { onLogin: (session: LoginResponse) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      onLogin(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-bg px-6 py-10 text-text">
      <div className="mx-auto grid max-w-md gap-6">
        <div>
          <div className="text-xs uppercase tracking-[0.16em] text-muted">tax office ops</div>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">tax-ops</h1>
          <p className="mt-3 text-sm text-slate-300">Sign in to manage office workflows, OCR settings, review queues, and upcoming client/tools modules.</p>
        </div>

        <Panel title="Login" subtitle="Secure sign-in for office staff">
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <label className="grid gap-2 text-sm">
              <span className="text-slate-300">Username</span>
              <input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2 outline-none focus:border-accent" value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-slate-300">Password</span>
              <input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2 outline-none focus:border-accent" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
            <button className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60" disabled={busy} type="submit">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </Panel>
      </div>
    </main>
  );
}

function ChangePasswordScreen({ token, user, onComplete }: { token: string; user: User; onComplete: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    setBusy(true);
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      }, token);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-bg px-6 py-10 text-text">
      <div className="mx-auto grid max-w-md gap-6">
        <div>
          <div className="text-xs uppercase tracking-[0.16em] text-muted">password update required</div>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">Change password</h1>
          <p className="mt-3 text-sm text-slate-300">{user.username}, you need to change your temporary password before continuing.</p>
        </div>

        <Panel title="Set a new password" subtitle="Required before app access">
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <label className="grid gap-2 text-sm">
              <span className="text-slate-300">Current password</span>
              <input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2 outline-none focus:border-accent" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-slate-300">New password</span>
              <input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2 outline-none focus:border-accent" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-slate-300">Confirm new password</span>
              <input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2 outline-none focus:border-accent" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </label>
            {error ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
            <button className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60" disabled={busy} type="submit">
              {busy ? 'Saving…' : 'Update password'}
            </button>
          </form>
        </Panel>
      </div>
    </main>
  );
}

function App() {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [activeSection, setActiveSection] = useState<AppSection>('clients');
  const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>('overview');
  const [toolsExpanded, setToolsExpanded] = useState(true);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [aiProviders, setAiProviders] = useState<AiProvider[]>([]);
  const [toolRuns, setToolRuns] = useState<ToolRun[]>([]);
  const [selectedToolRunId, setSelectedToolRunId] = useState<number | null>(null);
  const [selectedToolRun, setSelectedToolRun] = useState<ToolRunDetail | null>(null);
  const [toolRunSourceDocumentId, setToolRunSourceDocumentId] = useState('');
  const [toolRunPageRange, setToolRunPageRange] = useState('1');
  const [toolRunBusy, setToolRunBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ username: '', password: '', role: 'staff' as UserRole, active: true });
  const [resetMap, setResetMap] = useState<Record<number, string>>({});
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string>>({});
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<DocumentItem | null>(null);
  const [documentStatusFilter, setDocumentStatusFilter] = useState<'all' | 'intake' | 'review' | 'filed' | 'error'>('review');
  const [reviewDraft, setReviewDraft] = useState({ status: 'review', taxYear: '', formType: '', issuer: '', clientName: '', ssnLast4: '', reviewNotes: '' });
  const [reviewDirty, setReviewDirty] = useState(false);
  const [rerunBusyMode, setRerunBusyMode] = useState<Exclude<OcrTextHandling, 'skip-text'> | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [jobsPage, setJobsPage] = useState(1);
  const [reviewPage, setReviewPage] = useState(1);
  const [newProviderKind, setNewProviderKind] = useState<AiProviderKind>('openai');
  const [newProviderDisplayName, setNewProviderDisplayName] = useState('');
  const [providerDrafts, setProviderDrafts] = useState<Record<number, Record<string, string>>>({});
  const [providerModelDrafts, setProviderModelDrafts] = useState<Record<number, string>>({});
  const [openAiCallbackDrafts, setOpenAiCallbackDrafts] = useState<Record<number, string>>({});
  const [aiRoutingDraft, setAiRoutingDraft] = useState({ defaultProviderId: '', fallbackProviderId: '' });

  const isAdmin = me?.role === 'admin';
  const settingsMap = useMemo(() => Object.fromEntries(settings.map((setting) => [setting.key, setting.value])), [settings]);
  const officeName = settingsMap.office_name || 'Tax Office';
  const officeSettings = settings.filter((setting) => officeSettingKeys.includes(setting.key as (typeof officeSettingKeys)[number]));
  const ocrMode = settingDrafts.ocr_mode === 'external' ? 'external' : 'internal';
  const ocrSettingsDisabled = !isAdmin || ocrMode === 'external';
  const jobsEnabled = isEnabled(settingDrafts.ocr_jobs_enabled, true);
  const rotateThresholdEnabled = isEnabled(settingDrafts.ocr_rotate_pages_threshold_enabled, false);
  const sidecarEnabled = isEnabled(settingDrafts.ocr_sidecar, true);
  const ocrTextHandling = resolveOcrTextHandling(settingDrafts);
  const ocrCommandPreview = buildOcrCommandPreview(settingDrafts);

  const filteredDocuments = useMemo(
    () => documents.filter((document) => (documentStatusFilter === 'all' ? true : document.status === documentStatusFilter)),
    [documents, documentStatusFilter],
  );
  const pagedJobs = useMemo(() => paginateItems(jobs, jobsPage), [jobs, jobsPage]);
  const pagedDocuments = useMemo(() => paginateItems(filteredDocuments, reviewPage), [filteredDocuments, reviewPage]);

  const ocrSnapshot = useMemo(() => {
    const pendingOcrDocs = documents.filter((document) => document.ocrStatus === 'pending' || document.ocrStatus === 'processing').length;
    const failedOcrDocs = documents.filter((document) => document.ocrStatus === 'failed').length;
    const externalModeDocs = documents.filter((document) => document.ocrProvider?.startsWith('external')).length;

    return {
      pendingOcrDocs,
      failedOcrDocs,
      externalModeDocs,
      reviewDocs: documents.filter((document) => document.status === 'review').length,
    };
  }, [documents]);

  function setSettingDraftValue(key: string, value: string) {
    setSettingsDirty(true);
    setSettingDrafts((current) => ({ ...current, [key]: value }));
  }

  function applyReviewDraft(document: DocumentItem) {
    setReviewDraft({
      status: document.status,
      taxYear: document.taxYear ?? '',
      formType: document.formType ?? '',
      issuer: document.issuer ?? '',
      clientName: document.clientName ?? '',
      ssnLast4: document.ssnLast4 ?? '',
      reviewNotes: document.reviewNotes ?? '',
    });
    setReviewDirty(false);
  }

  async function loadData(activeToken = token, options: { background?: boolean; preserveSettingDrafts?: boolean } = {}) {
    if (!activeToken) return;
    if (!options.background) {
      setLoading(true);
      setError(null);
    }
    try {
      const meResult = await api<{ user: User }>('/api/me', {}, activeToken);
      const nextMe = meResult.user;
      setMe(nextMe);

      const [jobsResult, documentsResult, toolRunsResult] = await Promise.all([
        api<{ jobs: Job[] }>('/api/jobs', {}, activeToken),
        api<{ documents: DocumentItem[] }>('/api/documents', {}, activeToken),
        api<{ runs: ToolRun[] }>('/api/tools/1099b/runs', {}, activeToken),
      ]);

      setJobs(jobsResult.jobs);
      setDocuments(documentsResult.documents);
      setToolRuns(toolRunsResult.runs);

      if (nextMe.role === 'admin') {
        const [usersResult, settingsResult, aiProvidersResult] = await Promise.all([
          api<{ users: User[] }>('/api/users', {}, activeToken),
          api<{ settings: Setting[] }>('/api/settings', {}, activeToken),
          api<{ providers: AiProvider[] }>('/api/ai/providers', {}, activeToken),
        ]);
        setUsers(usersResult.users);
        setSettings(settingsResult.settings);
        setAiProviders(aiProvidersResult.providers);
        if (!options.preserveSettingDrafts) {
          setSettingDrafts(withSettingDefaults(settingsResult.settings));
          setSettingsDirty(false);
        }
        setAiRoutingDraft({
          defaultProviderId: String(aiProvidersResult.providers.find((provider) => provider.isDefault)?.id ?? ''),
          fallbackProviderId: String(aiProvidersResult.providers.find((provider) => provider.isFallback)?.id ?? ''),
        });
        setProviderDrafts(
          Object.fromEntries(
            aiProvidersResult.providers.map((provider) => [
              provider.id,
              {
                displayName: provider.displayName,
                baseUrl: String(provider.config?.baseUrl ?? ''),
              },
            ]),
          ),
        );
        setProviderModelDrafts(
          Object.fromEntries(aiProvidersResult.providers.map((provider) => [provider.id, provider.configuredModel ?? ''])),
        );
      } else {
        setUsers([]);
        setSettings([]);
        setAiProviders([]);
        setSettingDrafts(withSettingDefaults([]));
        setSettingsDirty(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load app data';
      setError(message);
      setSuccessMessage(null);
      if (message.toLowerCase().includes('invalid token') || message.toLowerCase().includes('missing bearer')) {
        setStoredToken(null);
        setToken(null);
      }
    } finally {
      if (!options.background) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (token) {
      void loadData(token);
    }
  }, [token]);

  async function loadDocument(documentId: number, options: { background?: boolean; preserveReviewDraft?: boolean } = {}) {
    if (!token) return;
    try {
      const response = await api<{ document: DocumentItem }>(`/api/documents/${documentId}`, {}, token);
      setSelectedDocument(response.document);
      if (!options.background) {
        setSuccessMessage(null);
      }
      if (!options.preserveReviewDraft) {
        applyReviewDraft(response.document);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load document');
    }
  }

  useEffect(() => {
    if (selectedDocumentId) {
      void loadDocument(selectedDocumentId);
    } else {
      setSelectedDocument(null);
      setReviewDirty(false);
    }
  }, [selectedDocumentId]);

  async function loadToolRun(runId: number, options: { background?: boolean } = {}) {
    if (!token) return;
    try {
      const response = await api<ToolRunDetail>(`/api/tools/1099b/runs/${runId}`, {}, token);
      setSelectedToolRun(response);
      if (!options.background) {
        setSuccessMessage(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load 1099-B run');
    }
  }

  useEffect(() => {
    if (selectedToolRunId) {
      void loadToolRun(selectedToolRunId);
    } else {
      setSelectedToolRun(null);
    }
  }, [selectedToolRunId]);

  useEffect(() => {
    if (!token) return;

    const interval = window.setInterval(() => {
      void loadData(token, {
        background: true,
        preserveSettingDrafts: activeAdminTab === 'settings' && settingsDirty,
      });

      if (selectedDocumentId) {
        void loadDocument(selectedDocumentId, {
          background: true,
          preserveReviewDraft: activeAdminTab === 'review' && reviewDirty,
        });
      }

      if (selectedToolRunId) {
        void loadToolRun(selectedToolRunId, { background: true });
      }
    }, autoRefreshIntervalMs);

    return () => window.clearInterval(interval);
  }, [token, activeAdminTab, settingsDirty, selectedDocumentId, reviewDirty]);

  useEffect(() => {
    setJobsPage((current) => Math.min(current, Math.max(1, Math.ceil(jobs.length / pageSize))));
  }, [jobs.length]);

  useEffect(() => {
    setReviewPage(1);
  }, [documentStatusFilter]);

  useEffect(() => {
    setReviewPage((current) => Math.min(current, Math.max(1, Math.ceil(filteredDocuments.length / pageSize))));
  }, [filteredDocuments.length]);

  useEffect(() => {
    if (!isAdmin && activeSection === 'admin') {
      setActiveSection('clients');
    }
  }, [isAdmin, activeSection]);

  function handleLogout() {
    setStoredToken(null);
    setToken(null);
    setMe(null);
    setUsers([]);
    setSettings([]);
    setAiProviders([]);
    setSettingsDirty(false);
    setReviewDirty(false);
    setProfileMenuOpen(false);
  }

  const stats = useMemo(
    () => ({
      totalUsers: users.length,
      admins: users.filter((user) => user.role === 'admin').length,
      activeUsers: users.filter((user) => user.active).length,
      resets: users.filter((user) => user.mustChangePassword).length,
      queuedJobs: jobs.filter((job) => job.status === 'queued').length,
      reviewDocs: documents.filter((doc) => doc.status === 'review').length,
      failedOcr: documents.filter((doc) => doc.ocrStatus === 'failed').length,
    }),
    [users, jobs, documents],
  );

  if (!token) {
    return (
      <LoginScreen
        onLogin={(session) => {
          setStoredToken(session.token);
          setToken(session.token);
          setMe(session.user);
        }}
      />
    );
  }

  if (me?.mustChangePassword) {
    return <ChangePasswordScreen token={token} user={me} onComplete={() => void loadData(token)} />;
  }

  async function createUserSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    try {
      await api<{ user: User }>('/api/users', { method: 'POST', body: JSON.stringify(createForm) }, token);
      setCreateForm({ username: '', password: '', role: 'staff', active: true });
      await loadData(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    }
  }

  async function patchUser(userId: number, payload: Partial<Pick<User, 'role' | 'active' | 'mustChangePassword'>>) {
    if (!token) return;
    setError(null);
    try {
      await api(`/api/users/${userId}`, { method: 'PATCH', body: JSON.stringify(payload) }, token);
      await loadData(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
    }
  }

  async function resetPassword(userId: number) {
    if (!token) return;
    const password = resetMap[userId]?.trim();
    if (!password) {
      setError('Enter a new password first');
      return;
    }
    setError(null);
    try {
      await api(`/api/users/${userId}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }, token);
      setResetMap((current) => ({ ...current, [userId]: '' }));
      await loadData(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setSuccessMessage(null);
    try {
      const payload = Object.entries(settingDrafts).map(([key, value]) => ({ key, value }));
      const response = await api<{ settings: Setting[] }>('/api/settings', { method: 'PUT', body: JSON.stringify({ settings: payload }) }, token);
      setSettings(response.settings);
      setSettingDrafts(withSettingDefaults(response.settings));
      setSettingsDirty(false);
      setSuccessMessage('Settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    }
  }

  async function createAiProviderSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setSuccessMessage(null);
    try {
      const trimmedName = newProviderDisplayName.trim() || (newProviderKind === 'openai' ? 'OpenAI' : newProviderKind === 'lmstudio' ? 'LM Studio' : 'Ollama');
      const config = newProviderKind === 'lmstudio'
        ? { baseUrl: 'http://127.0.0.1:1234' }
        : newProviderKind === 'ollama'
          ? { baseUrl: 'http://127.0.0.1:11434' }
          : { baseUrl: 'https://api.openai.com' };
      await api('/api/ai/providers', {
        method: 'POST',
        body: JSON.stringify({ kind: newProviderKind, displayName: trimmedName, config }),
      }, token);
      setNewProviderDisplayName('');
      await loadData(token, { preserveSettingDrafts: true });
      setSuccessMessage('AI provider added.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add AI provider');
    }
  }

  async function saveAiProvider(provider: AiProvider) {
    if (!token) return;
    setError(null);
    setSuccessMessage(null);
    const draft = providerDrafts[provider.id] ?? {};
    try {
      await api(`/api/ai/providers/${provider.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: draft.displayName || provider.displayName,
          config: {
            ...(draft.baseUrl ? { baseUrl: draft.baseUrl } : {}),
          },
        }),
      }, token);
      await loadData(token, { preserveSettingDrafts: true });
      setSuccessMessage(`${provider.displayName} settings saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save AI provider');
    }
  }

  async function testAiProvider(providerId: number) {
    if (!token) return;
    setError(null);
    setSuccessMessage(null);
    try {
      await api(`/api/ai/providers/${providerId}/test`, { method: 'POST' }, token);
      await loadData(token, { preserveSettingDrafts: true });
      setSuccessMessage('Provider connection test completed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to test AI provider');
    }
  }

  async function startOpenAiOAuth(providerId: number) {
    if (!token) return;
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await api<{ authorizationUrl: string; redirectUri: string }>(`/api/ai/providers/${providerId}/openai-oauth/start`, { method: 'POST' }, token);
      const popup = window.open(response.authorizationUrl, '_blank', 'popup,width=520,height=760');
      if (!popup) {
        setError('Popup blocked. Allow popups for this site and try again.');
        return;
      }
      setSuccessMessage(`OpenAI OAuth started. After approval, copy the final browser URL from ${response.redirectUri} and paste it below.`);
      await loadData(token, { preserveSettingDrafts: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start OpenAI OAuth');
    }
  }

  async function completeOpenAiOAuth(providerId: number) {
    if (!token) return;
    const callbackUrl = openAiCallbackDrafts[providerId]?.trim();
    if (!callbackUrl) {
      setError('Paste the final localhost callback URL first.');
      return;
    }
    setError(null);
    setSuccessMessage(null);
    try {
      await api(`/api/ai/providers/${providerId}/openai-oauth/complete`, {
        method: 'POST',
        body: JSON.stringify({ callbackUrl }),
      }, token);
      setOpenAiCallbackDrafts((current) => ({ ...current, [providerId]: '' }));
      await loadData(token, { preserveSettingDrafts: true });
      setSuccessMessage('OpenAI OAuth callback captured and tokens stored. You can now test connection and set a model.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete OpenAI OAuth');
    }
  }

  async function disconnectOpenAiOAuth(providerId: number) {
    if (!token) return;
    setError(null);
    setSuccessMessage(null);
    try {
      await api(`/api/ai/providers/${providerId}/openai-oauth/disconnect`, { method: 'POST' }, token);
      await loadData(token, { preserveSettingDrafts: true });
      setSuccessMessage('OpenAI OAuth disconnected.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect OpenAI OAuth');
    }
  }

  async function setAiProviderModelSubmit(providerId: number) {
    if (!token) return;
    const model = providerModelDrafts[providerId]?.trim();
    if (!model) {
      setError('Select a model first');
      return;
    }
    setError(null);
    setSuccessMessage(null);
    try {
      await api(`/api/ai/providers/${providerId}/model`, {
        method: 'POST',
        body: JSON.stringify({ model }),
      }, token);
      await loadData(token, { preserveSettingDrafts: true });
      setSuccessMessage('Provider model updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set provider model');
    }
  }

  async function saveAiRouting() {
    if (!token) return;
    setError(null);
    setSuccessMessage(null);
    try {
      await api('/api/ai/routing', {
        method: 'PUT',
        body: JSON.stringify({
          defaultProviderId: aiRoutingDraft.defaultProviderId ? Number(aiRoutingDraft.defaultProviderId) : null,
          fallbackProviderId: aiRoutingDraft.fallbackProviderId ? Number(aiRoutingDraft.fallbackProviderId) : null,
        }),
      }, token);
      await loadData(token, { preserveSettingDrafts: true });
      setSuccessMessage('AI routing saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save AI routing');
    }
  }

  function parsePageRangeInput(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return [] as number[];
    const pages = new Set<number>();
    for (const part of trimmed.split(',')) {
      const token = part.trim();
      if (!token) continue;
      if (token.includes('-')) {
        const [startRaw, endRaw] = token.split('-', 2);
        const start = Number(startRaw.trim());
        const end = Number(endRaw.trim());
        if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end <= 0 || end < start) {
          throw new Error('Page range must use positive numbers like 1,3,5-7');
        }
        for (let page = start; page <= end; page += 1) pages.add(page);
      } else {
        const page = Number(token);
        if (!Number.isInteger(page) || page <= 0) {
          throw new Error('Page range must use positive numbers like 1,3,5-7');
        }
        pages.add(page);
      }
    }
    return [...pages].sort((a, b) => a - b);
  }

  async function create1099BRunSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    const sourceDocumentId = Number(toolRunSourceDocumentId);
    if (!Number.isFinite(sourceDocumentId)) {
      setError('Choose a source document first.');
      return;
    }

    const sourceDocument = documents.find((document) => document.id === sourceDocumentId);
    if (!sourceDocument) {
      setError('Selected document was not found in the current list.');
      return;
    }

    let pageNumbers: number[];
    try {
      pageNumbers = parsePageRangeInput(toolRunPageRange);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid page range');
      return;
    }

    if (pageNumbers.length === 0) {
      setError('Enter at least one page number.');
      return;
    }

    setToolRunBusy(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const detail = await api<ToolRunDetail>('/api/tools/1099b/runs', {
        method: 'POST',
        body: JSON.stringify({
          sourceKind: 'existing_document',
          sourceFilename: sourceDocument.originalFilename,
          sourcePath: sourceDocument.currentPath,
          sourceDocumentId,
          selectedPageRange: toolRunPageRange.trim() || null,
          pageNumbers,
        }),
      }, token);
      setSelectedToolRunId(detail.run.id);
      await loadData(token, { preserveSettingDrafts: true });
      setSuccessMessage(`1099-B run #${detail.run.id} created for ${pageNumbers.length} page(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create 1099-B run');
    } finally {
      setToolRunBusy(false);
    }
  }

  async function saveReview(event: FormEvent) {
    event.preventDefault();
    if (!token || !selectedDocumentId) return;
    setError(null);
    try {
      await api(`/api/documents/${selectedDocumentId}/review`, { method: 'PATCH', body: JSON.stringify(reviewDraft) }, token);
      setSuccessMessage(`Document #${selectedDocumentId} saved as ${reviewDraft.status}`);
      await loadData(token);
      await loadDocument(selectedDocumentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save review');
    }
  }

  async function rerunSelectedDocument(mode: Exclude<OcrTextHandling, 'skip-text'>) {
    if (!token || !selectedDocumentId) return;
    setError(null);
    setRerunBusyMode(mode);
    try {
      await api<{ document: DocumentItem }>(`/api/documents/${selectedDocumentId}/rerun-ocr`, {
        method: 'POST',
        body: JSON.stringify({ ocrTextHandling: mode }),
      }, token);
      setSuccessMessage(`Queued OCR re-run with --${mode}.`);
      await loadData(token);
      await loadDocument(selectedDocumentId, { preserveReviewDraft: reviewDirty });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue OCR re-run');
    } finally {
      setRerunBusyMode(null);
    }
  }

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="flex min-h-screen w-full flex-col lg:flex-row">
        <aside className="flex w-full flex-col border-b border-line bg-[#0a0f1c] lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:min-w-64 lg:border-b-0 lg:border-r">
          <div className="px-4 pb-4 pt-5">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{officeName}</div>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-text">TaxOps</div>
          </div>

          <nav className="grid gap-1 px-3">
            <button
              className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${activeSection === 'clients' ? 'bg-white/8 text-white' : 'text-slate-300 hover:bg-white/5'}`}
              onClick={() => {
                setActiveSection('clients');
                setProfileMenuOpen(false);
              }}
            >
              <span>Clients</span>
            </button>

            <button
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${activeSection === 'extractor1099b' ? 'bg-white/8 text-white' : 'text-slate-300 hover:bg-white/5'}`}
              onClick={() => setToolsExpanded((current) => !current)}
              type="button"
            >
              <span>Tools</span>
              <span className={`text-xs text-slate-500 transition ${toolsExpanded ? 'rotate-180' : ''}`}>⌄</span>
            </button>
            {toolsExpanded ? (
              <div className="grid gap-1">
                <button
                  className={`rounded-xl px-3 py-2 text-left text-sm transition ${activeSection === 'extractor1099b' ? 'bg-accent text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
                  onClick={() => {
                    setActiveSection('extractor1099b');
                    setProfileMenuOpen(false);
                  }}
                  type="button"
                >
                  <span className="block pl-4">1099-B Extractor</span>
                </button>
              </div>
            ) : null}
          </nav>

          <div className="mt-auto border-t border-line px-3 py-3">
            <div className="relative">
              <button
                className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition hover:bg-white/5"
                onClick={() => setProfileMenuOpen((current) => !current)}
                type="button"
              >
                <div>
                  <div className="text-sm font-medium text-text">{me?.username ?? '...'}</div>
                  <div className="text-xs text-slate-500">Signed in</div>
                </div>
                <span className={`text-xs text-slate-500 transition ${profileMenuOpen ? 'rotate-180' : ''}`}>⌄</span>
              </button>
              {profileMenuOpen ? (
                <div className="absolute inset-x-0 bottom-[calc(100%+0.5rem)] rounded-2xl border border-line bg-[#11192b] p-2 shadow-2xl">
                  {isAdmin ? (
                    <button
                      className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/5"
                      onClick={() => {
                        setActiveSection('admin');
                        setProfileMenuOpen(false);
                      }}
                      type="button"
                    >
                      Admin
                    </button>
                  ) : null}
                  <button className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/5" onClick={handleLogout} type="button">
                    Logout
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1 px-4 py-4 sm:px-6 sm:py-6">
          <header className="mb-6 rounded-[28px] border border-line bg-panel px-5 py-5 sm:px-6">
            <div className="text-xs uppercase tracking-[0.16em] text-muted">{activeSection === 'admin' ? 'Admin workspace' : activeSection === 'clients' ? 'Clients workspace' : 'Tool workspace'}</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-text sm:text-4xl">
              {activeSection === 'admin' ? 'Admin' : activeSection === 'clients' ? 'Clients' : '1099-B Extractor'}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              {activeSection === 'admin'
                ? 'Admin oversight, OCR controls, and review workflows stay gated exactly as before.'
                : activeSection === 'clients'
                  ? 'Client-facing workflow space is staged here so the new shell feels intentional before the module is fully built.'
                  : 'Tooling area for future extraction utilities, starting with a dedicated 1099-B entry point.'}
            </p>
          </header>

          {error ? <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{error}</div> : null}
          {successMessage ? <div className="mb-6 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{successMessage}</div> : null}

          <div className="grid gap-6">
            {activeSection === 'admin' && isAdmin ? (
          <>
            <nav className="flex flex-wrap gap-2">
              {([
                ['overview', 'Overview'],
                ['users', 'Users'],
                ['settings', 'Settings'],
                ['aiProviders', 'AI Providers'],
                ['review', 'Review'],
              ] as [AdminTab, string][]).map(([tab, label]) => (
                <button key={tab} className={`rounded-xl px-4 py-2 text-sm transition ${activeAdminTab === tab ? 'bg-accent text-white' : 'border border-line text-slate-300 hover:bg-white/5'}`} onClick={() => setActiveAdminTab(tab)}>
                  {label}
                </button>
              ))}
            </nav>

            {activeAdminTab === 'overview' ? (
              <>
                <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-7">
                  {[
                    ['Users', String(stats.totalUsers), 'Total accounts'],
                    ['Admins', String(stats.admins), 'Admin-capable accounts'],
                    ['Active', String(stats.activeUsers), 'Users able to sign in'],
                    ['Forced Reset', String(stats.resets), 'Must change password'],
                    ['Queued Jobs', String(stats.queuedJobs), 'Jobs waiting on worker pickup'],
                    ['Review Docs', String(stats.reviewDocs), 'Needs document review'],
                    ['OCR Failures', String(stats.failedOcr), 'Need OCR/runtime attention'],
                  ].map(([label, value, hint]) => (
                    <article key={label} className="rounded-2xl border border-line bg-panel p-5">
                      <div className="text-xs uppercase tracking-[0.12em] text-muted">{label}</div>
                      <div className="mt-3 text-3xl font-semibold text-text">{value}</div>
                      <div className="mt-2 text-sm text-slate-300">{hint}</div>
                    </article>
                  ))}
                </section>

                <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                  <Panel title="Recent processing jobs" subtitle="Most recent first, 5 at a time" actions={<div className="rounded-full border border-line px-3 py-2 text-xs uppercase tracking-[0.12em] text-muted">{loading ? 'Refreshing…' : `${jobs.length} loaded`}</div>}>
                    <div className="grid gap-3">
                      {jobs.length === 0 ? <div className="rounded-xl border border-dashed border-line px-4 py-6 text-sm text-slate-400">No jobs queued yet.</div> : null}
                      {pagedJobs.items.map((job) => (
                        <div key={job.id} className="rounded-xl border border-line bg-[#0d1422] px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-medium">#{job.id} · {job.jobType}</div>
                            <div className="rounded-full border border-line px-2 py-1 text-xs uppercase tracking-[0.12em] text-slate-300">{job.status}</div>
                          </div>
                          <div className="mt-2 text-sm text-slate-300">{job.sourcePath}</div>
                          <div className="mt-1 text-xs text-slate-500">{job.message || '—'} · {new Date(job.createdAt).toLocaleString()}</div>
                        </div>
                      ))}
                    </div>
                    <Pager currentPage={pagedJobs.currentPage} totalPages={pagedJobs.totalPages} itemCount={jobs.length} pageSize={pageSize} itemLabel="jobs" onPageChange={setJobsPage} />
                  </Panel>

                  <Panel title="OCR operations snapshot" subtitle="More actionable than the old readiness card">
                    <ul className="grid gap-3 text-sm text-slate-300">
                      <li>• <span className="text-slate-100">OCR mode</span>: {settingsMap.ocr_mode || 'internal'}</li>
                      <li>• <span className="text-slate-100">Documents awaiting OCR work</span>: {ocrSnapshot.pendingOcrDocs}</li>
                      <li>• <span className="text-slate-100">OCR failures needing attention</span>: {ocrSnapshot.failedOcrDocs}</li>
                      <li>• <span className="text-slate-100">Documents parked in external OCR mode</span>: {ocrSnapshot.externalModeDocs}</li>
                      <li>• <span className="text-slate-100">Review-ready documents</span>: {ocrSnapshot.reviewDocs}</li>
                      <li>• <span className="text-slate-100">Generated OCR command</span>: <code className="text-xs text-slate-200">{buildOcrCommandPreview(withSettingDefaults(settings))}</code></li>
                    </ul>
                  </Panel>
                </section>
              </>
            ) : null}

            {activeAdminTab === 'users' ? (
              <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
                <Panel title="User management" subtitle="Admin-managed users for first-pass MVP" actions={<div className="rounded-full border border-line px-3 py-2 text-xs uppercase tracking-[0.12em] text-muted">{loading ? 'Refreshing…' : 'Admin mode'}</div>}>
                  <div className="overflow-hidden rounded-2xl border border-line">
                    <table className="min-w-full divide-y divide-line text-left text-sm">
                      <thead className="bg-[#0d1422] text-slate-300"><tr><th className="px-4 py-3 font-medium">Username</th><th className="px-4 py-3 font-medium">Role</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Last login</th><th className="px-4 py-3 font-medium">Actions</th></tr></thead>
                      <tbody className="divide-y divide-line bg-panel">
                        {users.map((user) => (
                          <tr key={user.id}>
                            <td className="px-4 py-4"><div className="font-medium text-text">{user.username}</div><div className="text-xs text-slate-400">ID {user.id}</div></td>
                            <td className="px-4 py-4"><select className="rounded-lg border border-line bg-[#0d1422] px-3 py-2" disabled={!isAdmin} value={user.role} onChange={(event) => void patchUser(user.id, { role: event.target.value as UserRole })}><option value="admin">admin</option><option value="staff">staff</option></select></td>
                            <td className="px-4 py-4"><label className="inline-flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={user.active} disabled={!isAdmin || user.id === me?.id} onChange={(event) => void patchUser(user.id, { active: event.target.checked })} />active</label>{user.mustChangePassword ? <div className="mt-2 text-xs text-amber-300">must reset password</div> : null}{user.id === me?.id ? <div className="mt-2 text-xs text-slate-500">self-disable blocked</div> : null}</td>
                            <td className="px-4 py-4 text-slate-300">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}</td>
                            <td className="px-4 py-4"><div className="grid gap-2"><div className="flex gap-2"><input className="min-w-0 flex-1 rounded-lg border border-line bg-[#0d1422] px-3 py-2" disabled={!isAdmin} placeholder="new password" type="password" value={resetMap[user.id] ?? ''} onChange={(event) => setResetMap((current) => ({ ...current, [user.id]: event.target.value }))} /><button className="rounded-lg border border-line px-3 py-2 text-xs hover:bg-white/5 disabled:opacity-50" disabled={!isAdmin} onClick={() => void resetPassword(user.id)}>Reset</button></div><button className="text-left text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50" disabled={!isAdmin} onClick={() => void patchUser(user.id, { mustChangePassword: !user.mustChangePassword })}>Toggle force password change</button></div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>

                <Panel title="Create user" subtitle="Admin-only new account flow">
                  <form className="grid gap-3" onSubmit={createUserSubmit}>
                    <input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" disabled={!isAdmin} placeholder="username" value={createForm.username} onChange={(event) => setCreateForm((current) => ({ ...current, username: event.target.value }))} />
                    <input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" disabled={!isAdmin} placeholder="temporary password" type="password" value={createForm.password} onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))} />
                    <select className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" disabled={!isAdmin} value={createForm.role} onChange={(event) => setCreateForm((current) => ({ ...current, role: event.target.value as UserRole }))}><option value="staff">staff</option><option value="admin">admin</option></select>
                    <label className="inline-flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={createForm.active} disabled={!isAdmin} onChange={(event) => setCreateForm((current) => ({ ...current, active: event.target.checked }))} />active immediately</label>
                    <button className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60" disabled={!isAdmin} type="submit">Create user</button>
                  </form>
                </Panel>
              </section>
            ) : null}

            {activeAdminTab === 'settings' ? (
              <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                <Panel title="Settings" subtitle="Manage office-level behavior and OCR defaults without exposing container-controlled paths.">
                  <form className="grid gap-6" onSubmit={saveSettings}>
                    <div className="rounded-2xl border border-line bg-[#0d1422] p-5">
                      <div>
                        <h3 className="text-base font-semibold text-text">Office settings</h3>
                        <p className="mt-1 text-sm text-slate-300">Only true office-level settings live here; system paths stay container-controlled.</p>
                      </div>

                      <div className="mt-5 grid gap-4 md:grid-cols-2">
                        {officeSettings.map((setting) => (
                          <label className="grid gap-2 text-sm" key={setting.key}>
                            <span className="text-slate-300">{officeSettingLabels[setting.key as keyof typeof officeSettingLabels] ?? setting.key}</span>
                            {setting.key === 'auto_create_jobs' ? (
                              <select className="rounded-xl border border-line bg-[#09111d] px-3 py-2" disabled={!isAdmin} value={settingDrafts[setting.key] ?? ''} onChange={(event) => setSettingDraftValue(setting.key, event.target.value)}>
                                <option value="true">true</option>
                                <option value="false">false</option>
                              </select>
                            ) : (
                              <input className="rounded-xl border border-line bg-[#09111d] px-3 py-2" disabled={!isAdmin} value={settingDrafts[setting.key] ?? ''} onChange={(event) => setSettingDraftValue(setting.key, event.target.value)} />
                            )}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-line bg-[#0d1422] p-5">
                      <div>
                        <h3 className="text-base font-semibold text-text">OCRmyPDF</h3>
                        <p className="mt-1 text-sm text-slate-300">These settings shape how new documents are processed by the worker. Input/output paths stay container-controlled.</p>
                      </div>

                      <div className="mt-5 grid items-start gap-4 md:grid-cols-2">
                        <label className="grid gap-2 text-sm md:col-span-2">
                          <span className="text-slate-300">OCR Mode</span>
                          <select className="rounded-xl border border-line bg-[#09111d] px-3 py-2" disabled={!isAdmin} value={ocrMode} onChange={(event) => setSettingDraftValue('ocr_mode', event.target.value)}>
                            <option value="internal">internal</option>
                            <option value="external">external</option>
                          </select>
                          <span className="text-xs text-slate-500">Internal runs OCRmyPDF in the worker. External mode preserves the setting, but automated external handoff/import is still not wired.</span>
                        </label>

                        <label className={`inline-flex items-center gap-2 self-start text-sm ${ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}`}><input type="checkbox" checked={isEnabled(settingDrafts.ocr_deskew, true)} disabled={ocrSettingsDisabled} onChange={(event) => setSettingDraftValue('ocr_deskew', String(event.target.checked))} />--deskew</label>
                        <label className={`inline-flex items-center gap-2 self-start text-sm ${ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}`}><input type="checkbox" checked={isEnabled(settingDrafts.ocr_rotate_pages, true)} disabled={ocrSettingsDisabled} onChange={(event) => setSettingDraftValue('ocr_rotate_pages', String(event.target.checked))} />--rotate-pages</label>
                        <label className={`inline-flex items-center gap-2 self-start text-sm ${ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}`}><input type="checkbox" checked={jobsEnabled} disabled={ocrSettingsDisabled} onChange={(event) => setSettingDraftValue('ocr_jobs_enabled', String(event.target.checked))} />--jobs</label>
                        {jobsEnabled ? <label className="grid gap-2 text-sm"><span className={ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}>Jobs value</span><input className="rounded-xl border border-line bg-[#09111d] px-3 py-2 disabled:text-slate-500" disabled={ocrSettingsDisabled} inputMode="numeric" value={settingDrafts.ocr_jobs ?? '1'} onChange={(event) => setSettingDraftValue('ocr_jobs', event.target.value)} /></label> : <div className="hidden md:block" />}
                        <label className={`inline-flex items-center gap-2 self-start text-sm ${ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}`}><input type="checkbox" checked={sidecarEnabled} disabled={ocrSettingsDisabled} onChange={(event) => setSettingDraftValue('ocr_sidecar', String(event.target.checked))} />--sidecar</label>
                        <label className={`inline-flex items-center gap-2 self-start text-sm ${ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}`}><input type="checkbox" checked={rotateThresholdEnabled} disabled={ocrSettingsDisabled} onChange={(event) => setSettingDraftValue('ocr_rotate_pages_threshold_enabled', String(event.target.checked))} />--rotate-pages-threshold</label>
                        {rotateThresholdEnabled ? <label className="grid gap-2 text-sm"><span className={ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}>Threshold value</span><input className="rounded-xl border border-line bg-[#09111d] px-3 py-2 disabled:text-slate-500" disabled={ocrSettingsDisabled} inputMode="decimal" value={settingDrafts.ocr_rotate_pages_threshold ?? ''} onChange={(event) => setSettingDraftValue('ocr_rotate_pages_threshold', event.target.value)} /></label> : <div className="hidden md:block" />}
                        <label className={`inline-flex items-center gap-2 self-start text-sm ${ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}`}><input type="checkbox" checked={isEnabled(settingDrafts.ocr_clean, false)} disabled={ocrSettingsDisabled} onChange={(event) => setSettingDraftValue('ocr_clean', String(event.target.checked))} />--clean</label>
                        <label className={`inline-flex items-center gap-2 self-start text-sm ${ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}`}><input type="checkbox" checked={isEnabled(settingDrafts.ocr_clean_final, false)} disabled={ocrSettingsDisabled} onChange={(event) => setSettingDraftValue('ocr_clean_final', String(event.target.checked))} />--clean-final</label>
                        <label className="grid gap-2 text-sm md:col-span-2">
                          <span className={ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}>Existing text handling</span>
                          <select className="rounded-xl border border-line bg-[#09111d] px-3 py-2 disabled:text-slate-500" disabled={ocrSettingsDisabled} value={ocrTextHandling} onChange={(event) => setSettingDraftValue('ocr_text_handling', event.target.value)}>
                            <option value="skip-text">skip-text — preserve an existing searchable layer</option>
                            <option value="redo-ocr">redo-ocr — replace a bad text layer while keeping the page content</option>
                            <option value="force-ocr">force-ocr — rasterize then OCR everything as a stronger fallback</option>
                          </select>
                          <span className="text-xs text-slate-500">Use skip-text for already-searchable scans, redo-ocr when text exists but is misaligned or poor, and force-ocr for the most stubborn files.</span>
                        </label>
                      </div>

                      {ocrMode === 'external' ? <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">OCRmyPDF options are disabled while OCR Mode is set to external.</div> : null}

                      <div className="mt-5 rounded-xl border border-line bg-[#09111d] px-4 py-3 text-sm text-slate-300">
                        <div className="text-xs uppercase tracking-[0.12em] text-muted">Generated command preview</div>
                        <code className="mt-2 block whitespace-pre-wrap break-all text-xs text-slate-200">{ocrCommandPreview}</code>
                        <div className="mt-2 text-xs text-slate-500">{sidecarEnabled ? 'When sidecar is enabled, the worker reads OCR text from the temporary sidecar file and cleans it up after processing.' : 'When sidecar is disabled, the worker keeps the PDF output only and does not fabricate extracted text.'}</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <button className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60" disabled={!isAdmin} type="submit">Save settings</button>
                      {successMessage === 'Settings saved.' ? <span className="text-sm text-emerald-300">Saved successfully.</span> : null}
                    </div>
                  </form>
                </Panel>

                <Panel title="System notes" subtitle="Current behavior and why these OCR settings matter">
                  <ul className="grid gap-3 text-sm text-slate-300">
                    <li>• Incoming, processed, review, clients, and originals paths are fixed by container/env configuration rather than editable in the UI.</li>
                    <li>• <span className="text-slate-100">OCR Mode</span> decides whether the worker runs bundled OCRmyPDF now or leaves the document parked for a future external OCR handoff.</li>
                    <li>• <span className="text-slate-100">deskew</span>, <span className="text-slate-100">rotate-pages</span>, and <span className="text-slate-100">rotate-pages-threshold</span> affect scan cleanup before review, especially for crooked or rotated pages.</li>
                    <li>• <span className="text-slate-100">jobs</span> controls OCRmyPDF parallelism inside the worker and is mainly a performance tuning lever.</li>
                    <li>• <span className="text-slate-100">sidecar</span> controls whether the worker captures extracted text for the review screen and downstream automation.</li>
                    <li>• <span className="text-slate-100">skip-text</span>, <span className="text-slate-100">redo-ocr</span>, and <span className="text-slate-100">force-ocr</span> determine how aggressively OCRmyPDF treats existing text layers.</li>
                    <li>• If a file stalls, check worker logs first; the UI reflects queue state, but the worker is what discovers watched-folder files and advances processing.</li>
                  </ul>
                </Panel>
              </section>
            ) : null}

            {activeAdminTab === 'aiProviders' ? (
              <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                <Panel title="AI Providers" subtitle="Configure external and local model providers for extractor jobs.">
                  <div className="grid gap-4">
                    {aiProviders.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-line px-4 py-8 text-sm text-slate-400">No AI providers configured yet. Add one to begin connecting models.</div>
                    ) : null}

                    {aiProviders.map((provider) => {
                      const draft = providerDrafts[provider.id] ?? { displayName: provider.displayName, baseUrl: String(provider.config?.baseUrl ?? '') };
                      const modelDraft = providerModelDrafts[provider.id] ?? provider.configuredModel ?? '';
                      const showBaseUrl = provider.kind === 'lmstudio' || provider.kind === 'ollama';
                      return (
                        <div key={provider.id} className="rounded-2xl border border-line bg-[#0d1422] p-5">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="text-base font-semibold text-text">{provider.displayName}</div>
                              <div className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">{provider.kind} · {provider.status}</div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {provider.isDefault ? <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200">Default</span> : null}
                              {provider.isFallback ? <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">Fallback</span> : null}
                            </div>
                          </div>

                          <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <label className="grid gap-2 text-sm">
                              <span className="text-slate-300">Display name</span>
                              <input className="rounded-xl border border-line bg-[#09111d] px-3 py-2" value={draft.displayName} onChange={(event) => setProviderDrafts((current) => ({ ...current, [provider.id]: { ...draft, displayName: event.target.value } }))} />
                            </label>
                            {showBaseUrl ? (
                              <label className="grid gap-2 text-sm">
                                <span className="text-slate-300">Base URL</span>
                                <input className="rounded-xl border border-line bg-[#09111d] px-3 py-2" value={draft.baseUrl} onChange={(event) => setProviderDrafts((current) => ({ ...current, [provider.id]: { ...draft, baseUrl: event.target.value } }))} />
                              </label>
                            ) : (
                              <div className="rounded-xl border border-line bg-[#09111d] px-4 py-3 text-sm text-slate-300">
                                <div className="font-medium text-text">OpenAI Codex OAuth</div>
                                <div className="mt-1 text-xs text-slate-500">Uses ChatGPT-account OAuth, not API key auth. Start the browser flow below, then test connection and pick a model.</div>
                              </div>
                            )}
                          </div>

                          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
                            <label className="grid gap-2 text-sm">
                              <span className="text-slate-300">Model</span>
                              <select className="rounded-xl border border-line bg-[#09111d] px-3 py-2" value={modelDraft} onChange={(event) => setProviderModelDrafts((current) => ({ ...current, [provider.id]: event.target.value }))}>
                                <option value="">Select a model</option>
                                {provider.availableModels.map((model) => (
                                  <option key={model} value={model}>{model}</option>
                                ))}
                              </select>
                            </label>
                            <button className="self-end rounded-xl border border-line px-4 py-2 text-sm hover:bg-white/5" onClick={() => void testAiProvider(provider.id)} type="button">Test connection</button>
                            <button className="self-end rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90" onClick={() => void setAiProviderModelSubmit(provider.id)} type="button">Set model</button>
                          </div>

                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            <button className="rounded-xl border border-line px-4 py-2 text-sm hover:bg-white/5" onClick={() => void saveAiProvider(provider)} type="button">Save config</button>
                            {provider.kind === 'openai' ? (
                              provider.status === 'connected' ? (
                                <button className="rounded-xl border border-red-500/30 px-4 py-2 text-sm text-red-200 hover:bg-red-500/10" onClick={() => void disconnectOpenAiOAuth(provider.id)} type="button">Disconnect OAuth</button>
                              ) : (
                                <button className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90" onClick={() => void startOpenAiOAuth(provider.id)} type="button">Connect with ChatGPT</button>
                              )
                            ) : null}
                            <span className="text-xs text-slate-500">Configured model: {provider.configuredModel || 'none'}{provider.lastConnectedAt ? ` · connected ${new Date(provider.lastConnectedAt).toLocaleString()}` : ''}</span>
                          </div>
                          {provider.kind === 'openai' && provider.status !== 'connected' ? (
                            <div className="mt-4 grid gap-3 rounded-xl border border-line bg-[#09111d] p-4">
                              <label className="grid gap-2 text-sm">
                                <span className="text-slate-300">Paste final localhost callback URL</span>
                                <input
                                  className="rounded-xl border border-line bg-[#0d1422] px-3 py-2 text-sm"
                                  placeholder="http://localhost:1455/auth/callback?code=...&state=..."
                                  value={openAiCallbackDrafts[provider.id] ?? ''}
                                  onChange={(event) => setOpenAiCallbackDrafts((current) => ({ ...current, [provider.id]: event.target.value }))}
                                />
                              </label>
                              <div className="flex flex-wrap items-center gap-3">
                                <button className="rounded-xl border border-line px-4 py-2 text-sm hover:bg-white/5" onClick={() => void completeOpenAiOAuth(provider.id)} type="button">Complete OAuth</button>
                                <span className="text-xs text-slate-500">After OpenAI redirects to localhost and the page fails to load, copy that full URL here.</span>
                              </div>
                            </div>
                          ) : null}
                          {provider.lastError ? <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{provider.lastError}</div> : null}
                        </div>
                      );
                    })}
                  </div>
                </Panel>

                <div className="grid gap-6">
                  <Panel title="Add Provider" subtitle="Start with OpenAI, LM Studio, or Ollama.">
                    <form className="grid gap-3" onSubmit={createAiProviderSubmit}>
                      <label className="grid gap-2 text-sm">
                        <span className="text-slate-300">Provider type</span>
                        <select className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" value={newProviderKind} onChange={(event) => setNewProviderKind(event.target.value as AiProviderKind)}>
                          <option value="openai">OpenAI</option>
                          <option value="lmstudio">LM Studio</option>
                          <option value="ollama">Ollama</option>
                        </select>
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span className="text-slate-300">Display name</span>
                        <input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" placeholder="Optional, sensible default if blank" value={newProviderDisplayName} onChange={(event) => setNewProviderDisplayName(event.target.value)} />
                      </label>
                      <button className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90" type="submit">Add Provider</button>
                    </form>
                  </Panel>

                  <Panel title="Routing" subtitle="Global default and fallback for now, tool-specific overrides later.">
                    <div className="grid gap-4">
                      <label className="grid gap-2 text-sm">
                        <span className="text-slate-300">Default provider</span>
                        <select className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" value={aiRoutingDraft.defaultProviderId} onChange={(event) => setAiRoutingDraft((current) => ({ ...current, defaultProviderId: event.target.value }))}>
                          <option value="">None</option>
                          {aiProviders.map((provider) => (
                            <option key={provider.id} value={provider.id}>{provider.displayName}</option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span className="text-slate-300">Fallback provider</span>
                        <select className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" value={aiRoutingDraft.fallbackProviderId} onChange={(event) => setAiRoutingDraft((current) => ({ ...current, fallbackProviderId: event.target.value }))}>
                          <option value="">None</option>
                          {aiProviders.map((provider) => (
                            <option key={provider.id} value={provider.id}>{provider.displayName}</option>
                          ))}
                        </select>
                      </label>
                      <button className="rounded-xl border border-line px-4 py-2 text-sm hover:bg-white/5" onClick={() => void saveAiRouting()} type="button">Save routing</button>
                    </div>
                  </Panel>
                </div>
              </section>
            ) : null}

            {activeAdminTab === 'review' ? (
              <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                <Panel title="Document queue" subtitle="Select a document to inspect and correct metadata">
                  <div className="mb-4 flex flex-wrap gap-2">
                    {(['all', 'intake', 'review', 'filed', 'error'] as const).map((status) => (
                      <button
                        key={status}
                        className={`rounded-xl px-3 py-2 text-xs uppercase tracking-[0.12em] ${documentStatusFilter === status ? 'bg-accent text-white' : 'border border-line text-slate-300 hover:bg-white/5'}`}
                        onClick={() => setDocumentStatusFilter(status)}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-3">
                    {pagedDocuments.items.map((document) => (
                      <button key={document.id} className={`rounded-xl border px-4 py-3 text-left ${selectedDocumentId === document.id ? 'border-accent bg-[#10182c]' : 'border-line bg-[#0d1422]'}`} onClick={() => setSelectedDocumentId(document.id)}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium">#{document.id} · {document.originalFilename}</div>
                          <div className="rounded-full border border-line px-2 py-1 text-xs uppercase tracking-[0.12em] text-slate-300">{document.status}</div>
                        </div>
                        <div className="mt-2 text-xs text-slate-400">OCR: {document.ocrStatus} · {document.ocrProvider || 'n/a'}</div>
                        <div className="mt-1 text-sm text-slate-300">{document.currentPath}</div>
                      </button>
                    ))}
                    {filteredDocuments.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-line px-4 py-8 text-sm text-slate-400">No documents in the {documentStatusFilter} queue.</div>
                    ) : null}
                  </div>
                  <Pager currentPage={pagedDocuments.currentPage} totalPages={pagedDocuments.totalPages} itemCount={filteredDocuments.length} pageSize={pageSize} itemLabel="documents" onPageChange={setReviewPage} />
                </Panel>

                <Panel title="Document review" subtitle="Adjust inferred metadata before filing">
                  {!selectedDocument ? (
                    <div className="rounded-xl border border-dashed border-line px-4 py-8 text-sm text-slate-400">Select a document from the review queue.</div>
                  ) : (
                    <form className="grid gap-4" onSubmit={saveReview}>
                      <div className="grid gap-2 rounded-xl border border-line bg-[#0d1422] px-4 py-3 text-sm text-slate-300">
                        <div><span className="text-slate-500">Original:</span> {selectedDocument.originalFilename}</div>
                        <div><span className="text-slate-500">Current:</span> {selectedDocument.currentPath}</div>
                        <div><span className="text-slate-500">OCR:</span> {selectedDocument.ocrStatus} via {selectedDocument.ocrProvider || 'n/a'}</div>
                      </div>

                      <div className="rounded-xl border border-line bg-[#0d1422] px-4 py-3 text-sm text-slate-300">
                        <div className="font-medium text-text">OCR retry tools</div>
                        <div className="mt-1 text-xs text-slate-500">If highlights land in the wrong place, try redo-ocr first. force-ocr is the more aggressive fallback.</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button className="rounded-xl border border-line px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/5 disabled:opacity-50" disabled={!isAdmin || rerunBusyMode !== null} onClick={() => { void rerunSelectedDocument('redo-ocr'); }} type="button">{rerunBusyMode === 'redo-ocr' ? 'Queueing redo…' : 'Re-run OCR (redo)'}</button>
                          <button className="rounded-xl border border-line px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/5 disabled:opacity-50" disabled={!isAdmin || rerunBusyMode !== null} onClick={() => { void rerunSelectedDocument('force-ocr'); }} type="button">{rerunBusyMode === 'force-ocr' ? 'Queueing force…' : 'Re-run OCR (force)'}</button>
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="grid gap-2 text-sm"><span className="text-slate-300">Status</span><select className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" value={reviewDraft.status} onChange={(event) => { setReviewDirty(true); setReviewDraft((current) => ({ ...current, status: event.target.value })); }}><option value="review">review</option><option value="filed">filed</option><option value="intake">intake</option><option value="error">error</option></select></label>
                        <label className="grid gap-2 text-sm"><span className="text-slate-300">Tax year</span><input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" value={reviewDraft.taxYear} onChange={(event) => { setReviewDirty(true); setReviewDraft((current) => ({ ...current, taxYear: event.target.value })); }} /></label>
                        <label className="grid gap-2 text-sm"><span className="text-slate-300">Form type</span><input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" value={reviewDraft.formType} onChange={(event) => { setReviewDirty(true); setReviewDraft((current) => ({ ...current, formType: event.target.value })); }} /></label>
                        <label className="grid gap-2 text-sm"><span className="text-slate-300">Issuer</span><input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" value={reviewDraft.issuer} onChange={(event) => { setReviewDirty(true); setReviewDraft((current) => ({ ...current, issuer: event.target.value })); }} /></label>
                        <label className="grid gap-2 text-sm"><span className="text-slate-300">Client name</span><input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" value={reviewDraft.clientName} onChange={(event) => { setReviewDirty(true); setReviewDraft((current) => ({ ...current, clientName: event.target.value })); }} /></label>
                        <label className="grid gap-2 text-sm"><span className="text-slate-300">SSN last4</span><input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" value={reviewDraft.ssnLast4} onChange={(event) => { setReviewDirty(true); setReviewDraft((current) => ({ ...current, ssnLast4: event.target.value })); }} /></label>
                      </div>

                      <label className="grid gap-2 text-sm"><span className="text-slate-300">Review notes</span><textarea className="min-h-32 rounded-xl border border-line bg-[#0d1422] px-3 py-2" value={reviewDraft.reviewNotes} onChange={(event) => { setReviewDirty(true); setReviewDraft((current) => ({ ...current, reviewNotes: event.target.value })); }} /></label>

                      <Panel title="Extracted text" subtitle="OCR output or failure context">
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-[#0d1422] px-4 py-3 text-xs text-slate-300">{selectedDocument.extractedText || 'No extracted text available yet.'}</pre>
                      </Panel>

                      <button className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90" type="submit">Save review changes</button>
                    </form>
                  )}
                </Panel>
              </section>
            ) : null}
          </>
            ) : null}

            {activeSection === 'admin' && !isAdmin ? <AdminAccessNotice /> : null}
            {activeSection === 'clients' ? <PlaceholderSection title="Clients" description="This area is reserved for client-facing workflow, filing organization, and future client record tools." /> : null}
            {activeSection === 'extractor1099b' ? (
              <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                <div className="grid gap-6">
                  <Panel title="Create 1099-B run" subtitle="Start with an already-ingested document and selected page numbers.">
                    <form className="grid gap-4" onSubmit={create1099BRunSubmit}>
                      <label className="grid gap-2 text-sm">
                        <span className="text-slate-300">Source document</span>
                        <select className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" value={toolRunSourceDocumentId} onChange={(event) => setToolRunSourceDocumentId(event.target.value)}>
                          <option value="">Select a reviewed/intake document</option>
                          {documents.map((document) => (
                            <option key={document.id} value={document.id}>{document.id} · {document.originalFilename}</option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span className="text-slate-300">Page numbers</span>
                        <input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" placeholder="1 or 1,3,5-7" value={toolRunPageRange} onChange={(event) => setToolRunPageRange(event.target.value)} />
                      </label>
                      <div className="text-xs text-slate-500">Use existing ingested docs for this first pass. Upload flow can come next once the extraction path is proven.</div>
                      <button className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60" disabled={toolRunBusy} type="submit">{toolRunBusy ? 'Creating run…' : 'Create run'}</button>
                    </form>
                  </Panel>

                  <Panel title="Recent runs" subtitle="Latest 1099-B extraction runs and current status.">
                    <div className="grid gap-3">
                      {toolRuns.length === 0 ? <div className="rounded-xl border border-dashed border-line px-4 py-8 text-sm text-slate-400">No 1099-B runs yet.</div> : null}
                      {toolRuns.map((run) => (
                        <button key={run.id} className={`rounded-2xl border px-4 py-4 text-left transition ${selectedToolRunId === run.id ? 'border-accent bg-accent/10' : 'border-line bg-[#0d1422] hover:bg-white/5'}`} onClick={() => setSelectedToolRunId(run.id)} type="button">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="font-medium text-text">Run #{run.id} · {run.sourceFilename}</div>
                              <div className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">{run.status} · {run.pageCount ?? 0} page(s)</div>
                            </div>
                            <div className="text-xs text-slate-500">{new Date(run.updatedAt).toLocaleString()}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </Panel>
                </div>

                <div className="grid gap-6">
                  <Panel title="Run detail" subtitle="Page-level progress and extracted OCR text for the selected run.">
                    {!selectedToolRun ? (
                      <div className="rounded-xl border border-dashed border-line px-4 py-8 text-sm text-slate-400">Select a run to inspect page progress and extracted results.</div>
                    ) : (
                      <div className="grid gap-4">
                        <div className="rounded-xl border border-line bg-[#0d1422] px-4 py-3 text-sm text-slate-300">
                          <div><span className="text-slate-500">Run:</span> #{selectedToolRun.run.id}</div>
                          <div><span className="text-slate-500">Source:</span> {selectedToolRun.run.sourceFilename}</div>
                          <div><span className="text-slate-500">Path:</span> {selectedToolRun.run.sourcePath}</div>
                          <div><span className="text-slate-500">Pages:</span> {selectedToolRun.run.selectedPageRange || selectedToolRun.run.pageCount || 'n/a'}</div>
                          <div><span className="text-slate-500">Status:</span> {selectedToolRun.run.status}</div>
                        </div>
                        <div className="grid gap-3">
                          {selectedToolRun.pages.length === 0 ? <div className="rounded-xl border border-dashed border-line px-4 py-8 text-sm text-slate-400">No pages have been queued for this run yet.</div> : null}
                          {selectedToolRun.pages.map((page) => (
                            <div key={page.id} className="rounded-2xl border border-line bg-[#0d1422] p-4">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="font-medium text-text">Page {page.pageNumber}</div>
                                  <div className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">{page.status} · review {page.reviewStatus}</div>
                                </div>
                                <div className="text-xs text-slate-500">{new Date(page.updatedAt).toLocaleString()}</div>
                              </div>
                              {page.warnings.length > 0 ? <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">{page.warnings.join(' | ')}</div> : null}
                              {page.errorMessage ? <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">{page.errorMessage}</div> : null}
                              <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-[#09111d] px-3 py-3 text-xs text-slate-300">{page.extractedText || 'No extracted text captured yet.'}</pre>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </Panel>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
