"use client";
import { useCallback, useEffect, useState } from "react";
import type { Category, Suite, Case, Run, User, UserRole, ViewId, ModalId } from "../lib/types";
import { STARTER_CODE } from "../lib/format";
import * as api from "../lib/api";
import { useRunStream } from "../lib/useRunStream";
import { useWorkspace } from "../lib/useWorkspace";
import AppHeader from "../components/AppHeader";
import Sidebar from "../components/Sidebar";
import WorkspaceView from "../components/WorkspaceView";
import LighthouseView from "../components/LighthouseView";
import HistoryView from "../components/HistoryView";
import ExecutionPanel from "../components/ExecutionPanel";
import Notice from "../components/Notice";
import AuthDialog from "../components/AuthDialog";
import SuiteDialog from "../components/SuiteDialog";
import CaseDialog from "../components/CaseDialog";
import CategoryDialog from "../components/CategoryDialog";
import UsersView from "../components/UsersView";

export default function Page() {
  // ─── Account state ───────────────────────────────────────────────────────────
  const [user, setUser] = useState<User | null>(null);
  const authenticated = !!user;
  const [users, setUsers] = useState<User[]>([]);

  // ─── Navigation state ────────────────────────────────────────────────────────
  const [sid, setSid] = useState('');
  const [cid, setCid] = useState('');
  const [code, setCode] = useState('');
  const [view, setView] = useState<ViewId>('workspace');
  const [collapsed, setCollapsed] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');

  // ─── Run controls ────────────────────────────────────────────────────────────
  const [mode, setMode] = useState('pw');
  const [headed, setHeaded] = useState(false);
  const [scope, setScope] = useState('suite');

  // ─── UI state ────────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState<ModalId>('');
  const [editing, setEditing] = useState(false);
  const [streamId, setStreamId] = useState('');

  // ─── Category editing ────────────────────────────────────────────────────────
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);

  // ─── Data ────────────────────────────────────────────────────────────────────
  const { categories, suites, runs, totalRuns, setRuns, refresh, loadMoreRuns, updateRunInList } =
    useWorkspace({ authenticated });

  const suite = suites.find(s => s.id === sid);
  const selected = suite?.cases.find(c => c.id === cid);
  const dirty = !!selected && selected.code !== code;

  // ─── Run stream ──────────────────────────────────────────────────────────────
  const { logs, connection, pollError, followLogs, terminalRef, reconnect } = useRunStream({
    runId: streamId,
    authenticated,
    onRunStatus: (run: Run) => {
      updateRunInList(run);
      // When run finishes, refresh full list to get final state
      if (['passed', 'failed', 'cancelled', 'interrupted'].includes(run.status) &&
          (!run.docsStatus || run.docsStatus !== 'building')) {
        refresh().catch(() => {});
      }
    },
  });

  const active = runs.find(r => r.id === streamId);

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  async function task(fn: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); }
    catch (e) {
      if (e instanceof api.ApiError && e.status === 401) {
        setUser(null);
        setUsers([]);
        setModal('auth');
        setError('Your session expired. Sign in again.');
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    finally { setBusy(false); }
  }

  function protectDirty() {
    return !dirty || confirm('Discard unsaved code changes?');
  }

  function choose(s: Suite, c?: Case) {
    if (!protectDirty()) return;
    setSid(s.id);
    setCid(c?.id || s.cases[0]?.id || '');
    setView('workspace');
    if (typeof innerWidth !== 'undefined' && innerWidth < 760) setCollapsed(true);
  }

  const guardedRequest = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    if (!authenticated) {
      setModal('auth');
      throw new Error('Sign in to continue.');
    }
    return api.request<T>(path, init);
  }, [authenticated]);

  // ─── Effects ─────────────────────────────────────────────────────────────────
  useEffect(() => { if (typeof window !== 'undefined') setCollapsed(window.innerWidth < 1000); }, []);

  // Auto-select first suite
  useEffect(() => {
    setSid(id => suites.some(s => s.id === id) ? id : suites[0]?.id || '');
    setOpen(o => Object.keys(o).length ? o : Object.fromEntries(suites.map(s => [s.id, true])));
  }, [suites]);

  // Auto-select first case in suite
  useEffect(() => {
    setCid(id => suite?.cases.some(c => c.id === id) ? id : suite?.cases[0]?.id || '');
  }, [suite]);

  // Sync code editor
  useEffect(() => { setCode(selected?.code || ''); setMenu(false); }, [selected?.id, selected?.code]);

  // Auto-select latest stream
  useEffect(() => { setStreamId(id => id || runs[0]?.id || ''); }, [runs]);

  // Restore the account session on mount
  useEffect(() => {
    api.checkAuth()
      .then(status => setUser(status.authenticated ? status.user ?? null : null))
      .catch(() => setUser(null));
  }, []);

  // Administrators load the account list only when the Users view is open.
  useEffect(() => {
    if (view !== 'users' || user?.role !== 'admin') return;
    let active = true;
    api.listUsers()
      .then(rows => { if (active) setUsers(rows); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, [view, user?.role]);

  // Dirty guard
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);

  // ─── Account handlers ────────────────────────────────────────────────────────
  async function handleAuthenticated(nextUser: User) {
    setUser(nextUser);
    setModal('');
    setView('workspace');
    setNotice('Signed in as ' + nextUser.name + '.');
    await refresh().catch(() => {});
  }

  async function disconnect() {
    if (!protectDirty()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.logout();
    } catch (e) {
      if (!(e instanceof api.ApiError && e.status === 401)) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setUser(null);
      setUsers([]);
      setRuns([]);
      setStreamId('');
      setView('workspace');
      setBusy(false);
    }
  }

  async function changeUserRole(target: User, role: UserRole) {
    await task(async () => {
      await guardedRequest('/api/users/' + target.id, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      setUsers(await api.listUsers());
      setNotice(target.name + ' is now ' + (role === 'admin' ? 'an administrator.' : 'a member.'));
    });
  }

  async function removeUser(target: User) {
    if (!confirm('Remove the account for ' + target.name + '? Their active sessions will be signed out.')) return;
    await task(async () => {
      await guardedRequest('/api/users/' + target.id, { method: 'DELETE' });
      setUsers(await api.listUsers());
      setNotice('Account removed.');
    });
  }

  async function reloadUsers() {
    await task(async () => setUsers(await api.listUsers()));
  }

  // ─── Suite/Case CRUD ─────────────────────────────────────────────────────────
  function openSuiteForm(edit = false) {
    if (!edit && !protectDirty()) return;
    setEditing(edit);
    setModal('suite');
    setMenu(false);
  }

  function openCaseForm(edit = false) {
    if (!edit && !protectDirty()) return;
    setEditing(edit);
    setModal('case');
    setMenu(false);
  }

  async function saveSuiteForm(data: { name: string; targetUrl: string; description: string; categoryId: string | null }) {
    await task(async () => {
      if (!data.name) throw new Error('Name is required.');
      const u = new URL(data.targetUrl);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Use an HTTP or HTTPS target URL.');
      const body = { name: data.name, targetUrl: data.targetUrl, description: data.description, categoryId: data.categoryId };
      if (editing) {
        const s = await guardedRequest<Suite>('/api/suites/' + sid, { method: 'PATCH', body: JSON.stringify(body) });
        setSid(s.id);
      } else {
        const s = await guardedRequest<Suite>('/api/suites', { method: 'POST', body: JSON.stringify(body) });
        setSid(s.id);
        setOpen(o => ({ ...o, [s.id]: true }));
      }
      await refresh();
      setModal('');
      setNotice('Changes saved.');
    });
  }

  async function saveCaseForm(data: { name: string }) {
    await task(async () => {
      if (!data.name) throw new Error('Name is required.');
      if (editing) {
        await guardedRequest('/api/cases/' + cid, { method: 'PATCH', body: JSON.stringify({ name: data.name }) });
      } else {
        const c = await guardedRequest<Case>('/api/suites/' + sid + '/cases', {
          method: 'POST',
          body: JSON.stringify({ name: data.name, code: STARTER_CODE, enabled: true }),
        });
        setCid(c.id);
      }
      await refresh();
      setModal('');
      setNotice('Changes saved.');
    });
  }

  async function remove(kind: string) {
    const msg = kind === 'suite'
      ? 'Delete this suite and all its cases? This cannot be undone.'
      : 'Delete this test case? This cannot be undone.';
    if (!confirm(msg)) return;
    await task(async () => {
      await guardedRequest(kind === 'suite' ? '/api/suites/' + sid : '/api/cases/' + cid, { method: 'DELETE' });
      await refresh();
      setMenu(false);
    });
  }

  // ─── Category CRUD ───────────────────────────────────────────────────────────
  function openCategoryForm(edit = false, cat?: Category) {
    setEditing(edit);
    setEditingCategory(cat || null);
    setModal('category');
  }

  async function saveCategoryForm(data: { name: string; description: string }) {
    await task(async () => {
      if (!data.name) throw new Error('Name is required.');
      if (editing && editingCategory) {
        await guardedRequest('/api/categories/' + editingCategory.id, {
          method: 'PATCH',
          body: JSON.stringify(data),
        });
      } else {
        await guardedRequest('/api/categories', {
          method: 'POST',
          body: JSON.stringify(data),
        });
      }
      await refresh();
      setModal('');
      setNotice('Category saved.');
    });
  }

  async function deleteCategory(cat: Category) {
    if (!confirm('Delete category "' + cat.name + '"? Suites will become uncategorized.')) return;
    await task(async () => {
      await guardedRequest('/api/categories/' + cat.id, { method: 'DELETE' });
      await refresh();
    });
  }

  // ─── Run controls ────────────────────────────────────────────────────────────
  const running = runs.some(r => ['queued', 'running'].includes(r.status) || r.docsStatus === 'building');

  async function runTest(runMode = mode) {
    await task(async () => {
      if (runMode !== 'lh' && dirty) throw new Error('Save code changes before running.');
      const r = await guardedRequest<Run>('/api/runs', {
        method: 'POST',
        body: JSON.stringify({
          suiteId: sid,
          mode: runMode,
          headed,
          ...(runMode !== 'lh' && scope === 'case' && selected ? { caseIds: [cid] } : {}),
        }),
      });
      setRuns(p => [r, ...p]);
      setStreamId(r.id);
      setNotice('Run queued. Live output appears below.');
    });
  }

  async function cancelRun() {
    if (!active) return;
    await task(async () => {
      try {
        const updated = await api.cancelRun(active.id);
        updateRunInList(updated);
        setNotice('Run cancelled.');
      } catch (e) {
        if (e instanceof api.ApiError && e.status === 409) {
          setNotice('Run is not active.');
        } else {
          throw e;
        }
      }
    });
  }

  async function saveCode() {
    await task(async () => {
      await guardedRequest('/api/cases/' + cid, { method: 'PATCH', body: JSON.stringify({ code }) });
      await refresh();
      setNotice('Test code saved.');
    });
  }

  async function toggleEnabled(c: Case) {
    await task(async () => {
      await guardedRequest('/api/cases/' + c.id, { method: 'PATCH', body: JSON.stringify({ enabled: !c.enabled }) });
      await refresh();
    });
  }

  function handleLhChangeSuite(id: string) {
    if (protectDirty()) setSid(id);
  }

  function reportUrl(r: Run): string | null {
    if (!r.reportUrl?.startsWith('/reports/')) return null;
    return (process.env.NEXT_PUBLIC_API || '') + r.reportUrl;
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <AppHeader
        view={view}
        setView={setView}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        user={user}
        onSignIn={() => setModal('auth')}
        onSignOut={disconnect}
      />

      <main id="main-content">
        <Notice message={error} type="error" onDismiss={() => setError('')} />
        <Notice message={notice} type="info" />

        <div className={'workbench ' + (collapsed ? 'sidebar-hidden' : '')}>
          <Sidebar
            collapsed={collapsed}
            authenticated={authenticated}
            categories={categories}
            suites={suites}
            selectedSuiteId={sid}
            selectedCaseId={cid}
            query={query}
            setQuery={setQuery}
            open={open}
            setOpen={setOpen}
            onChoose={choose}
            onNewSuite={() => openSuiteForm(false)}
            onNewCategory={() => openCategoryForm(false)}
            onEditCategory={cat => openCategoryForm(true, cat)}
            onDeleteCategory={deleteCategory}
          />

          <section className="workspace">
            <div className="section-title">
              <div>
                <h1>{view === 'lighthouse' ? 'Lighthouse' : view === 'history' ? 'Reports' : view === 'users' ? 'Users' : 'Playwright'}</h1>
                <p>{view === 'users' ? 'Manage team access and roles.' : suite ? suite.name + ' · ' + suite.targetUrl : 'Select or create a suite.'}</p>
              </div>
              {suite && view !== 'users' && (
                <div className="actions">
                  <button onClick={() => openSuiteForm(true)}>Edit suite</button>
                  <button onClick={() => remove('suite')}>Delete suite</button>
                </div>
              )}
            </div>

            {view === 'workspace' && (
              <WorkspaceView
                suite={suite}
                selectedCaseId={cid}
                code={code}
                setCode={setCode}
                dirty={dirty}
                busy={busy}
                authenticated={authenticated}
                running={running}
                scope={scope}
                setScope={setScope}
                headed={headed}
                setHeaded={setHeaded}
                onRun={runTest}
                onNewCase={() => openCaseForm(false)}
                onChoose={choose}
                onEditCase={() => openCaseForm(true)}
                onDeleteCase={() => remove('case')}
                onSaveCode={saveCode}
                onToggleEnabled={toggleEnabled}
              />
            )}

            {view === 'lighthouse' && (
              <LighthouseView
                suites={suites}
                selectedSuiteId={sid}
                suite={suite}
                authenticated={authenticated}
                busy={busy}
                running={running}
                onChangeSuite={handleLhChangeSuite}
                onRun={() => runTest('lh')}
              />
            )}

            {view === 'history' && (
              <HistoryView
                runs={runs}
                streamId={streamId}
                totalRuns={totalRuns}
                onInspect={r => setStreamId(r.id)}
                onLoadMore={loadMoreRuns}
                reportUrl={reportUrl}
              />
            )}

            {view === 'users' && user?.role === 'admin' && (
              <UsersView
                users={users}
                currentUserId={user.id}
                busy={busy}
                onRoleChange={changeUserRole}
                onDelete={removeUser}
                onReload={reloadUsers}
              />
            )}
          </section>
        </div>

        <ExecutionPanel
          runs={runs}
          active={active}
          streamId={streamId}
          setStreamId={setStreamId}
          logs={logs}
          connection={connection}
          pollError={pollError}
          followLogs={followLogs}
          terminalRef={terminalRef}
          onReconnect={reconnect}
          onCancel={cancelRun}
          authenticated={authenticated}
        />
      </main>

      {/* Auth dialog */}
      <AuthDialog
        open={modal === 'auth'}
        onClose={() => setModal('')}
        onAuthenticated={handleAuthenticated}
      />

      {/* Suite dialog */}
      <SuiteDialog
        open={modal === 'suite'}
        onClose={() => setModal('')}
        editing={editing}
        categories={categories}
        initial={editing && suite ? {
          name: suite.name,
          targetUrl: suite.targetUrl,
          description: suite.description,
          categoryId: suite.categoryId || null,
        } : { name: '', targetUrl: '', description: '', categoryId: null }}
        onSave={saveSuiteForm}
        busy={busy}
        error={error}
      />

      {/* Case dialog */}
      <CaseDialog
        open={modal === 'case'}
        onClose={() => setModal('')}
        editing={editing}
        initial={editing && selected ? { name: selected.name } : { name: '' }}
        onSave={saveCaseForm}
        busy={busy}
        error={error}
      />

      {/* Category dialog */}
      <CategoryDialog
        open={modal === 'category'}
        onClose={() => setModal('')}
        editing={editing}
        initial={editing && editingCategory ? {
          name: editingCategory.name,
          description: editingCategory.description || '',
        } : { name: '', description: '' }}
        onSave={saveCategoryForm}
        busy={busy}
        error={error}
      />
    </div>
  );
}
