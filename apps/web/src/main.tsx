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

const tokenKey = 'tax-ops.token';

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
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('changeme123');
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

        <Panel title="Login" subtitle="Bootstrap auth flow for MVP">
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
  const [intakeForm, setIntakeForm] = useState({ sourcePath: '/data/incoming/sample-scan.pdf', originalFilename: 'sample-scan.pdf', extractedText: '' });
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<DocumentItem | null>(null);
  const [reviewDraft, setReviewDraft] = useState({ status: 'review', taxYear: '', formType: '', issuer: '', clientName: '', ssnLast4: '', reviewNotes: '' });

  const isAdmin = me?.role === 'admin';

  async function loadData(activeToken = token) {
    if (!activeToken) return;
    setLoading(true);
    setError(null);
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
        setSettingDrafts(Object.fromEntries(settingsResult.settings.map((setting) => [setting.key, setting.value])));
      } else {
        setUsers([]);
        setSettings([]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load app data';
      setError(message);
      if (message.toLowerCase().includes('invalid token') || message.toLowerCase().includes('missing bearer')) {
        setStoredToken(null);
        setToken(null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) {
      void loadData(token);
    }
  }, [token]);

  async function loadDocument(documentId: number) {
    if (!token) return;
    try {
      const response = await api<{ document: DocumentItem }>(`/api/documents/${documentId}`, {}, token);
      setSelectedDocument(response.document);
      setReviewDraft({
        status: response.document.status,
        taxYear: response.document.taxYear ?? '',
        formType: response.document.formType ?? '',
        issuer: response.document.issuer ?? '',
        clientName: response.document.clientName ?? '',
        ssnLast4: response.document.ssnLast4 ?? '',
        reviewNotes: response.document.reviewNotes ?? '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load document');
    }
  }

  useEffect(() => {
    if (selectedDocumentId) {
      void loadDocument(selectedDocumentId);
    } else {
      setSelectedDocument(null);
    }
  }, [selectedDocumentId]);

  const stats = useMemo(
    () => ({
      totalUsers: users.length,
      admins: users.filter((user) => user.role === 'admin').length,
      activeUsers: users.filter((user) => user.active).length,
      resets: users.filter((user) => user.mustChangePassword).length,
      queuedJobs: jobs.filter((job) => job.status === 'queued').length,
      reviewDocs: documents.filter((doc) => doc.status === 'review').length,
    }),
    [users, jobs, documents],
  );

  if (!token) {
    return (
      <LoginScreen
        onLogin={(session) => {
          setStoredToken(session.token);
          setToken(session.token);
        }}
      />
    );
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
    try {
      const payload = Object.entries(settingDrafts).map(([key, value]) => ({ key, value }));
      const response = await api<{ settings: Setting[] }>('/api/settings', { method: 'PUT', body: JSON.stringify({ settings: payload }) }, token);
      setSettings(response.settings);
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
      await loadData(token);
      await loadDocument(selectedDocumentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save review');
    }
  }

  return (
    <main className="min-h-screen bg-bg px-6 py-8 text-text">
      <div className="mx-auto grid max-w-7xl gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-muted">tax office ops</div>
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
            }}>
              Log out
            </button>
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{error}</div> : null}

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
            <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-6">
              {[
                ['Users', String(stats.totalUsers), 'Total accounts'],
                ['Admins', String(stats.admins), 'Admin-capable accounts'],
                ['Active', String(stats.activeUsers), 'Users able to sign in'],
                ['Forced Reset', String(stats.resets), 'Must change password'],
                ['Queued Jobs', String(stats.queuedJobs), 'Intake queue'],
                ['Review Docs', String(stats.reviewDocs), 'Needs document review'],
              ].map(([label, value, hint]) => (
                <article key={label} className="rounded-2xl border border-line bg-panel p-5">
                  <div className="text-xs uppercase tracking-[0.12em] text-muted">{label}</div>
                  <div className="mt-3 text-3xl font-semibold text-text">{value}</div>
                  <div className="mt-2 text-sm text-slate-300">{hint}</div>
                </article>
              ))}
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <Panel title="Recent processing jobs" subtitle="MVP intake/job queue visibility" actions={<div className="rounded-full border border-line px-3 py-2 text-xs uppercase tracking-[0.12em] text-muted">{loading ? 'Refreshing…' : `${jobs.length} loaded`}</div>}>
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

              <Panel title="Recent documents" subtitle="Document registry foundation with OCR/review state">
                <div className="grid gap-3">
                  {documents.length === 0 ? <div className="rounded-xl border border-dashed border-line px-4 py-6 text-sm text-slate-400">No documents recorded yet.</div> : null}
                  {documents.map((document) => (
                    <button key={document.id} className="rounded-xl border border-line bg-[#0d1422] px-4 py-3 text-left hover:border-accent" onClick={() => { setActiveTab('review'); setSelectedDocumentId(document.id); }}>
                      <div className="font-medium">#{document.id} · {document.originalFilename}</div>
                      <div className="mt-1 text-sm text-slate-300">{document.currentPath}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                        <span>Status: {document.status}</span>
                        <span>OCR: {document.ocrStatus}</span>
                        {document.formType ? <span>Form: {document.formType}</span> : null}
                        {document.clientName ? <span>Client: {document.clientName}</span> : null}
                      </div>
                    </button>
                  ))}
                </div>
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
                        <td className="px-4 py-4"><label className="inline-flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={user.active} disabled={!isAdmin} onChange={(event) => void patchUser(user.id, { active: event.target.checked })} />active</label>{user.mustChangePassword ? <div className="mt-2 text-xs text-amber-300">must reset password</div> : null}</td>
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
          <Panel title="System settings" subtitle="Admin-editable operational config persisted in MariaDB">
            <form className="grid gap-4 md:grid-cols-2" onSubmit={saveSettings}>
              {settings.map((setting) => (
                <label className="grid gap-2 text-sm" key={setting.key}>
                  <span className="text-slate-300">{setting.key}</span>
                  <input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" disabled={!isAdmin} value={settingDrafts[setting.key] ?? ''} onChange={(event) => setSettingDrafts((current) => ({ ...current, [setting.key]: event.target.value }))} />
                </label>
              ))}
              <div className="md:col-span-2"><button className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60" disabled={!isAdmin} type="submit">Save settings</button></div>
            </form>
          </Panel>
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

            <Panel title="Intake notes" subtitle="Current MVP behavior">
              <ul className="grid gap-3 text-sm text-slate-300">
                <li>• Watched-folder worker can auto-discover PDFs and create jobs.</li>
                <li>• Worker now marks OCR placeholder status and pushes documents into review state.</li>
                <li>• Manual job creation remains useful for testing before live NAS monitoring.</li>
                <li>• Next real upgrade is swapping placeholder OCR with actual OCR tooling.</li>
              </ul>
            </Panel>
          </section>
        ) : null}

        {activeTab === 'review' ? (
          <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <Panel title="Review queue" subtitle="Select a document to inspect and correct metadata">
              <div className="grid gap-3">
                {documents.filter((document) => document.status === 'review' || document.status === 'error').map((document) => (
                  <button key={document.id} className={`rounded-xl border px-4 py-3 text-left ${selectedDocumentId === document.id ? 'border-accent bg-[#10182c]' : 'border-line bg-[#0d1422]'}`} onClick={() => setSelectedDocumentId(document.id)}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">#{document.id} · {document.originalFilename}</div>
                      <div className="rounded-full border border-line px-2 py-1 text-xs uppercase tracking-[0.12em] text-slate-300">{document.status}</div>
                    </div>
                    <div className="mt-2 text-xs text-slate-400">OCR: {document.ocrStatus} · {document.ocrProvider || 'n/a'}</div>
                    <div className="mt-1 text-sm text-slate-300">{document.currentPath}</div>
                  </button>
                ))}
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

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2 text-sm"><span className="text-slate-300">Status</span><select className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" value={reviewDraft.status} onChange={(event) => setReviewDraft((current) => ({ ...current, status: event.target.value }))}><option value="review">review</option><option value="filed">filed</option><option value="intake">intake</option><option value="error">error</option></select></label>
                    <label className="grid gap-2 text-sm"><span className="text-slate-300">Tax year</span><input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" value={reviewDraft.taxYear} onChange={(event) => setReviewDraft((current) => ({ ...current, taxYear: event.target.value }))} /></label>
                    <label className="grid gap-2 text-sm"><span className="text-slate-300">Form type</span><input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" value={reviewDraft.formType} onChange={(event) => setReviewDraft((current) => ({ ...current, formType: event.target.value }))} /></label>
                    <label className="grid gap-2 text-sm"><span className="text-slate-300">Issuer</span><input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" value={reviewDraft.issuer} onChange={(event) => setReviewDraft((current) => ({ ...current, issuer: event.target.value }))} /></label>
                    <label className="grid gap-2 text-sm"><span className="text-slate-300">Client name</span><input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" value={reviewDraft.clientName} onChange={(event) => setReviewDraft((current) => ({ ...current, clientName: event.target.value }))} /></label>
                    <label className="grid gap-2 text-sm"><span className="text-slate-300">SSN last4</span><input className="rounded-xl border border-line bg-[#0d1422] px-3 py-2" value={reviewDraft.ssnLast4} onChange={(event) => setReviewDraft((current) => ({ ...current, ssnLast4: event.target.value }))} /></label>
                  </div>

                  <label className="grid gap-2 text-sm"><span className="text-slate-300">Review notes</span><textarea className="min-h-32 rounded-xl border border-line bg-[#0d1422] px-3 py-2" value={reviewDraft.reviewNotes} onChange={(event) => setReviewDraft((current) => ({ ...current, reviewNotes: event.target.value }))} /></label>

                  <Panel title="Extracted text" subtitle="Placeholder OCR output for now">
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
