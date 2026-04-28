import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

type UserRole = 'admin' | 'staff';
type AppTab = 'overview' | 'users' | 'settings' | 'intake' | 'review';

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

type OcrTextHandling = 'skip-text' | 'redo-ocr' | 'force-ocr';

const tokenKey = 'tax-ops.token';
const autoRefreshIntervalMs = 5000;
const officeSettingKeys = ['office_name', 'auto_create_jobs'] as const;
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
          <p className="mt-3 text-sm text-slate-300">Sign in to manage users, settings, intake jobs, and office workflows.</p>
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
  const [activeTab, setActiveTab] = useState<AppTab>('overview');
  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ username: '', password: '', role: 'staff' as UserRole, active: true });
  const [resetMap, setResetMap] = useState<Record<number, string>>({});
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string>>({});
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [intakeForm, setIntakeForm] = useState({ sourcePath: '/data/incoming/sample-scan.pdf', originalFilename: 'sample-scan.pdf', extractedText: '' });
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<DocumentItem | null>(null);
  const [documentStatusFilter, setDocumentStatusFilter] = useState<'all' | 'intake' | 'review' | 'filed' | 'error'>('review');
  const [reviewDraft, setReviewDraft] = useState({ status: 'review', taxYear: '', formType: '', issuer: '', clientName: '', ssnLast4: '', reviewNotes: '' });
  const [reviewDirty, setReviewDirty] = useState(false);
  const [rerunBusyMode, setRerunBusyMode] = useState<Exclude<OcrTextHandling, 'skip-text'> | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isAdmin = me?.role === 'admin';
  const settingsMap = useMemo(() => Object.fromEntries(settings.map((setting) => [setting.key, setting.value])), [settings]);
  const officeName = settingsMap.office_name || 'Tax Office';
  const officeSettings = settings.filter((setting) => officeSettingKeys.includes(setting.key as typeof officeSettingKeys[number]));
  const ocrMode = settingDrafts.ocr_mode === 'external' ? 'external' : 'internal';
  const ocrSettingsDisabled = !isAdmin || ocrMode === 'external';
  const jobsEnabled = isEnabled(settingDrafts.ocr_jobs_enabled, true);
  const rotateThresholdEnabled = isEnabled(settingDrafts.ocr_rotate_pages_threshold_enabled, false);
  const sidecarEnabled = isEnabled(settingDrafts.ocr_sidecar, true);
  const ocrTextHandling = resolveOcrTextHandling(settingDrafts);
  const ocrCommandPreview = buildOcrCommandPreview(settingDrafts);

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

      const [jobsResult, documentsResult] = await Promise.all([
        api<{ jobs: Job[] }>('/api/jobs', {}, activeToken),
        api<{ documents: DocumentItem[] }>('/api/documents', {}, activeToken),
      ]);

      setJobs(jobsResult.jobs);
      setDocuments(documentsResult.documents);

      if (nextMe.role === 'admin') {
        const [usersResult, settingsResult] = await Promise.all([
          api<{ users: User[] }>('/api/users', {}, activeToken),
          api<{ settings: Setting[] }>('/api/settings', {}, activeToken),
        ]);
        setUsers(usersResult.users);
        setSettings(settingsResult.settings);
        if (!options.preserveSettingDrafts) {
          setSettingDrafts(withSettingDefaults(settingsResult.settings));
          setSettingsDirty(false);
        }
      } else {
        setUsers([]);
        setSettings([]);
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

  useEffect(() => {
    if (!token) return;

    const interval = window.setInterval(() => {
      void loadData(token, {
        background: true,
        preserveSettingDrafts: activeTab === 'settings' && settingsDirty,
      });

      if (selectedDocumentId) {
        void loadDocument(selectedDocumentId, {
          background: true,
          preserveReviewDraft: activeTab === 'review' && reviewDirty,
        });
      }
    }, autoRefreshIntervalMs);

    return () => window.clearInterval(interval);
  }, [token, activeTab, settingsDirty, selectedDocumentId, reviewDirty]);

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

  async function queueIntakeJob(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    try {
      await api('/api/intake/jobs', { method: 'POST', body: JSON.stringify(intakeForm) }, token);
      setIntakeForm({ sourcePath: '/data/incoming/sample-scan.pdf', originalFilename: 'sample-scan.pdf', extractedText: '' });
      setActiveTab('overview');
      await loadData(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue intake job');
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
    <main className="min-h-screen bg-bg px-6 py-8 text-text">
      <div className="mx-auto grid max-w-7xl gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-muted">{officeName}</div>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">tax-ops</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">MVP control panel for auth, settings, intake jobs, review, and document pipeline foundation.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-full border border-line px-3 py-2 text-sm text-slate-300">Signed in as {me?.username ?? '...'}</div>
            <button className="rounded-xl border border-line px-4 py-2 text-sm text-slate-200 hover:bg-white/5" onClick={() => {
              setStoredToken(null);
              setToken(null);
              setMe(null);
              setUsers([]);
              setSettings([]);
              setSettingsDirty(false);
              setReviewDirty(false);
            }}>
              Log out
            </button>
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{error}</div> : null}
        {successMessage ? <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{successMessage}</div> : null}

        <nav className="flex flex-wrap gap-2">
          {([
            ['overview', 'Overview'],
            ['users', 'Users'],
            ['settings', 'Settings'],
            ['intake', 'Intake'],
            ['review', 'Review'],
          ] as [AppTab, string][]).map(([tab, label]) => (
            <button key={tab} className={`rounded-xl px-4 py-2 text-sm transition ${activeTab === tab ? 'bg-accent text-white' : 'border border-line text-slate-300 hover:bg-white/5'}`} onClick={() => setActiveTab(tab)}>
              {label}
            </button>
          ))}
        </nav>

        {activeTab === 'overview' ? (
          <>
            <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-7">
              {[
                ['Users', String(stats.totalUsers), 'Total accounts'],
                ['Admins', String(stats.admins), 'Admin-capable accounts'],
                ['Active', String(stats.activeUsers), 'Users able to sign in'],
                ['Forced Reset', String(stats.resets), 'Must change password'],
                ['Queued Jobs', String(stats.queuedJobs), 'Intake queue'],
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
              <Panel title="Recent processing jobs" subtitle="Watch queue, OCR execution, and failures" actions={<div className="rounded-full border border-line px-3 py-2 text-xs uppercase tracking-[0.12em] text-muted">{loading ? 'Refreshing…' : `${jobs.length} loaded`}</div>}>
                <div className="grid gap-3">
                  {jobs.length === 0 ? <div className="rounded-xl border border-dashed border-line px-4 py-6 text-sm text-slate-400">No jobs queued yet.</div> : null}
                  {jobs.map((job) => (
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
              </Panel>

              <Panel title="OCR runtime readiness" subtitle="What the worker expects from the bundled OCR stack">
                <ul className="grid gap-3 text-sm text-slate-300">
                  <li>• <span className="text-slate-100">mode</span>: {settingsMap.ocr_mode || 'internal'}</li>
                  <li>• <span className="text-slate-100">sidecar capture</span>: {isEnabled(settingsMap.ocr_sidecar, true) ? 'enabled' : 'disabled'}</li>
                  <li>• <span className="text-slate-100">generated command</span>: <code className="text-xs text-slate-200">{buildOcrCommandPreview(withSettingDefaults(settings))}</code></li>
                  <li>• The container image bundles the OCR tools (<span className="text-slate-100">ocrmypdf</span>, <span className="text-slate-100">tesseract</span>, usually <span className="text-slate-100">qpdf</span>).</li>
                </ul>
              </Panel>
            </section>
          </>
        ) : null}

        {activeTab === 'users' ? (
          <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            <Panel title="User management" subtitle="Admin-managed users for first-pass MVP" actions={<div className="rounded-full border border-line px-3 py-2 text-xs uppercase tracking-[0.12em] text-muted">{loading ? 'Refreshing…' : isAdmin ? 'Admin mode' : 'Read only'}</div>}>
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

        {activeTab === 'settings' ? (
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
                        <span className="text-slate-300">{setting.key}</span>
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
                    <p className="mt-1 text-sm text-slate-300">These settings apply to newly processed documents. Input/output paths stay container-controlled.</p>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2 text-sm md:col-span-2">
                      <span className="text-slate-300">OCR Mode</span>
                      <select className="rounded-xl border border-line bg-[#09111d] px-3 py-2" disabled={!isAdmin} value={ocrMode} onChange={(event) => setSettingDraftValue('ocr_mode', event.target.value)}>
                        <option value="internal">internal</option>
                        <option value="external">external</option>
                      </select>
                      <span className="text-xs text-slate-500">Internal runs OCRmyPDF in the worker. External mode is saved now, but automatic handoff/import is not fully wired yet.</span>
                    </label>

                    <label className={`inline-flex items-center gap-2 text-sm ${ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}`}><input type="checkbox" checked={isEnabled(settingDrafts.ocr_deskew, true)} disabled={ocrSettingsDisabled} onChange={(event) => setSettingDraftValue('ocr_deskew', String(event.target.checked))} />--deskew</label>
                    <label className={`inline-flex items-center gap-2 text-sm ${ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}`}><input type="checkbox" checked={isEnabled(settingDrafts.ocr_rotate_pages, true)} disabled={ocrSettingsDisabled} onChange={(event) => setSettingDraftValue('ocr_rotate_pages', String(event.target.checked))} />--rotate-pages</label>
                    <label className={`inline-flex items-center gap-2 text-sm ${ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}`}><input type="checkbox" checked={jobsEnabled} disabled={ocrSettingsDisabled} onChange={(event) => setSettingDraftValue('ocr_jobs_enabled', String(event.target.checked))} />--jobs</label>
                    {jobsEnabled ? <label className="grid gap-2 text-sm"><span className={ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}>Jobs value</span><input className="rounded-xl border border-line bg-[#09111d] px-3 py-2 disabled:text-slate-500" disabled={ocrSettingsDisabled} inputMode="numeric" value={settingDrafts.ocr_jobs ?? '1'} onChange={(event) => setSettingDraftValue('ocr_jobs', event.target.value)} /></label> : <div />}
                    <label className="grid gap-2 text-sm md:col-span-2">
                      <span className={ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}>Existing text handling</span>
                      <select className="rounded-xl border border-line bg-[#09111d] px-3 py-2 disabled:text-slate-500" disabled={ocrSettingsDisabled} value={ocrTextHandling} onChange={(event) => setSettingDraftValue('ocr_text_handling', event.target.value)}>
                        <option value="skip-text">skip-text — preserve existing text layer</option>
                        <option value="redo-ocr">redo-ocr — replace bad text layer while keeping page content</option>
                        <option value="force-ocr">force-ocr — rasterize then OCR everything</option>
                      </select>
                      <span className="text-xs text-slate-500">skip-text preserves an existing text layer. redo-ocr or force-ocr can help when searchable highlights are misaligned.</span>
                    </label>
                    <label className={`inline-flex items-center gap-2 text-sm ${ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}`}><input type="checkbox" checked={sidecarEnabled} disabled={ocrSettingsDisabled} onChange={(event) => setSettingDraftValue('ocr_sidecar', String(event.target.checked))} />--sidecar</label>
                    <label className={`inline-flex items-center gap-2 text-sm ${ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}`}><input type="checkbox" checked={rotateThresholdEnabled} disabled={ocrSettingsDisabled} onChange={(event) => setSettingDraftValue('ocr_rotate_pages_threshold_enabled', String(event.target.checked))} />--rotate-pages-threshold</label>
                    {rotateThresholdEnabled ? <label className="grid gap-2 text-sm"><span className={ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}>Threshold value</span><input className="rounded-xl border border-line bg-[#09111d] px-3 py-2 disabled:text-slate-500" disabled={ocrSettingsDisabled} inputMode="decimal" value={settingDrafts.ocr_rotate_pages_threshold ?? ''} onChange={(event) => setSettingDraftValue('ocr_rotate_pages_threshold', event.target.value)} /></label> : <div />}
                    <label className={`inline-flex items-center gap-2 text-sm ${ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}`}><input type="checkbox" checked={isEnabled(settingDrafts.ocr_clean, false)} disabled={ocrSettingsDisabled} onChange={(event) => setSettingDraftValue('ocr_clean', String(event.target.checked))} />--clean</label>
                    <label className={`inline-flex items-center gap-2 text-sm ${ocrSettingsDisabled ? 'text-slate-500' : 'text-slate-300'}`}><input type="checkbox" checked={isEnabled(settingDrafts.ocr_clean_final, false)} disabled={ocrSettingsDisabled} onChange={(event) => setSettingDraftValue('ocr_clean_final', String(event.target.checked))} />--clean-final</label>
                  </div>

                  {ocrMode === 'external' ? <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">OCRmyPDF options are disabled while OCR Mode is set to external.</div> : null}

                  <div className="mt-5 rounded-xl border border-line bg-[#09111d] px-4 py-3 text-sm text-slate-300">
                    <div className="text-xs uppercase tracking-[0.12em] text-muted">Generated command preview</div>
                    <code className="mt-2 block whitespace-pre-wrap break-all text-xs text-slate-200">{ocrCommandPreview}</code>
                    <div className="mt-2 text-xs text-slate-500">{sidecarEnabled ? 'When sidecar is enabled, the worker reads extracted text from it and removes the temporary file.' : 'When sidecar is disabled, the worker does not fabricate extracted text.'}</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60" disabled={!isAdmin} type="submit">Save settings</button>
                  {successMessage === 'Settings saved.' ? <span className="text-sm text-emerald-300">Saved successfully.</span> : null}
                </div>
              </form>
            </Panel>

            <Panel title="System notes" subtitle="Filesystem paths and OCR execution are container-controlled">
              <ul className="grid gap-3 text-sm text-slate-300">
                <li>• Incoming, processed, review, clients, and originals paths are fixed by container/env configuration.</li>
                <li>• Internal OCR settings are applied by the worker when each new job runs.</li>
                <li>• External OCR mode currently stores intent and keeps the limitation visible instead of pretending folder mapping is done.</li>
                <li>• If a file stalls in processing, check worker logs for the next OCR or file-write step.</li>
              </ul>
            </Panel>
          </section>
        ) : null}

        {activeTab === 'intake' ? (
          <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
            <Panel title="Queue intake job" subtitle="Manual job creation while watched-folder automation is still being wired">
              <form className="grid gap-3" onSubmit={queueIntakeJob}>
                <input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" disabled={!isAdmin} placeholder="/data/incoming/client-scan.pdf" value={intakeForm.sourcePath} onChange={(event) => setIntakeForm((current) => ({ ...current, sourcePath: event.target.value }))} />
                <input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" disabled={!isAdmin} placeholder="client-scan.pdf" value={intakeForm.originalFilename} onChange={(event) => setIntakeForm((current) => ({ ...current, originalFilename: event.target.value }))} />
                <textarea className="min-h-32 rounded-xl border border-line bg-[#0d1422] px-3 py-2" disabled={!isAdmin} placeholder="Optional extracted text or notes" value={intakeForm.extractedText} onChange={(event) => setIntakeForm((current) => ({ ...current, extractedText: event.target.value }))} />
                <button className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60" disabled={!isAdmin} type="submit">Queue intake job</button>
              </form>
            </Panel>

            <Panel title="First Unraid test milestone" subtitle="What to validate once you install the container there">
              <ol className="grid gap-3 text-sm text-slate-300 list-decimal pl-5">
                <li>Set DB host/port/user/password and mounted folders.</li>
                <li>Confirm the bundled OCR tools are present in the container image.</li>
                <li>Open the web UI and confirm login works with bootstrap admin.</li>
                <li>Drop a sample scanned PDF into the watched folder.</li>
                <li>Verify job appears, worker processes it, and document lands in review.</li>
              </ol>
            </Panel>
          </section>
        ) : null}

        {activeTab === 'review' ? (
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
                {documents
                  .filter((document) => documentStatusFilter === 'all' ? true : document.status === documentStatusFilter)
                  .map((document) => (
                    <button key={document.id} className={`rounded-xl border px-4 py-3 text-left ${selectedDocumentId === document.id ? 'border-accent bg-[#10182c]' : 'border-line bg-[#0d1422]'}`} onClick={() => setSelectedDocumentId(document.id)}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium">#{document.id} · {document.originalFilename}</div>
                        <div className="rounded-full border border-line px-2 py-1 text-xs uppercase tracking-[0.12em] text-slate-300">{document.status}</div>
                      </div>
                      <div className="mt-2 text-xs text-slate-400">OCR: {document.ocrStatus} · {document.ocrProvider || 'n/a'}</div>
                      <div className="mt-1 text-sm text-slate-300">{document.currentPath}</div>
                    </button>
                  ))}
                {documents.filter((document) => documentStatusFilter === 'all' ? true : document.status === documentStatusFilter).length === 0 ? (
                  <div className="rounded-xl border border-dashed border-line px-4 py-8 text-sm text-slate-400">No documents in the {documentStatusFilter} queue.</div>
                ) : null}
              </div>
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
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
