import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Activity, History, Terminal as TerminalIcon, XCircle, GitBranch, GitCommit, Tag, RefreshCw, ChevronDown, Check, FolderOpen, AlertTriangle, CheckCircle2, Trash2, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';

const host = window.location.hostname || 'localhost';
const WS_URL = `ws://${host}:3001`;
const API_URL = `http://${host}:3001/api`;
const COLORS = ['#38bdf8', '#818cf8', '#34d399', '#f87171'];

// ─── Types ──────────────────────────────────────────────────────────────────
interface CommitInfo  { hash: string; message: string; author: string; time: string; }
interface RefInfo     { type: 'branch' | 'tag'; name: string; hash: string; message: string; author: string; time: string; isCurrent?: boolean; }
interface GitRefs     { branches: RefInfo[]; tags: RefInfo[]; currentBranch: string; }
interface BuildResult { status: 'Success' | 'Failed' | 'Canceled'; archivePath?: string | null; lastError?: string | null; durationSeconds?: number; }

type RevisionTab = 'branches' | 'tags' | 'commits';

// ─── GitRevisionPicker ──────────────────────────────────────────────────────
interface GitRevisionPickerProps {
  repoPath: string;
  value: string;
  onChange: (val: string) => void;
  apiUrl: string;
}

function GitRevisionPicker({ repoPath, value, onChange, apiUrl }: GitRevisionPickerProps) {
  const [open, setOpen]           = useState(false);
  const [tab, setTab]             = useState<RevisionTab>('branches');
  const [refs, setRefs]           = useState<GitRefs | null>(null);
  const [commits, setCommits]     = useState<CommitInfo[]>([]);
  const [loading, setLoading]     = useState(false);
  const [filterText, setFilterText] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const dropdownRef               = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchRefs = useCallback(async () => {
    if (!repoPath) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/git/refs?path=${encodeURIComponent(repoPath)}`);
      if (res.ok) {
        const data: GitRefs = await res.json();
        setRefs(data);
        if (data.currentBranch) setSelectedBranch(data.currentBranch);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [repoPath, apiUrl]);

  const fetchCommits = useCallback(async (branch: string) => {
    if (!repoPath) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/git/commits?path=${encodeURIComponent(repoPath)}&branch=${encodeURIComponent(branch)}`);
      if (res.ok) setCommits(await res.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [repoPath, apiUrl]);

  const handleOpen = () => {
    setOpen(v => {
      if (!v) { fetchRefs(); setFilterText(''); }
      return !v;
    });
  };

  const handleTabChange = (t: RevisionTab) => {
    setTab(t);
    setFilterText('');
    if (t === 'commits') fetchCommits(selectedBranch || 'HEAD');
  };

  const handleSelectBranch = (ref: RefInfo) => {
    onChange(ref.name);
    setSelectedBranch(ref.name);
    setOpen(false);
  };

  const handleSelectCommit = (c: CommitInfo) => {
    onChange(c.hash);
    setOpen(false);
  };

  const handleBranchForCommits = (branchName: string) => {
    setSelectedBranch(branchName);
    setTab('commits');
    fetchCommits(branchName);
  };

  const displayLabel = value
    ? value
    : refs?.currentBranch
    ? `HEAD (${refs.currentBranch})`
    : 'Leave empty — use current HEAD';

  const filteredBranches = (refs?.branches || []).filter(b =>
    b.name.toLowerCase().includes(filterText.toLowerCase()) ||
    b.message.toLowerCase().includes(filterText.toLowerCase())
  );
  const filteredTags = (refs?.tags || []).filter(t =>
    t.name.toLowerCase().includes(filterText.toLowerCase())
  );
  const filteredCommits = commits.filter(c =>
    c.hash.includes(filterText) ||
    c.message.toLowerCase().includes(filterText.toLowerCase()) ||
    c.author.toLowerCase().includes(filterText.toLowerCase())
  );

  return (
    <div className="git-picker" ref={dropdownRef}>
      <button className={`git-picker-trigger ${open ? 'open' : ''}`} onClick={handleOpen} type="button">
        <span className="git-picker-trigger-icon">
          {value
            ? (refs?.branches.some(b => b.name === value) ? <GitBranch size={14}/> : <GitCommit size={14}/>)
            : <GitBranch size={14}/>}
        </span>
        <span className="git-picker-trigger-label">{displayLabel}</span>
        <span className="git-picker-trigger-chevron" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          <ChevronDown size={14}/>
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="git-picker-dropdown"
            initial={{ opacity: 0, y: -8, scaleY: 0.95 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -8, scaleY: 0.95 }}
            transition={{ duration: 0.15 }}
          >
            <div className="git-picker-tabs">
              <button className={`git-picker-tab ${tab === 'branches' ? 'active' : ''}`} onClick={() => handleTabChange('branches')}>
                <GitBranch size={13}/> Branches {refs && <span className="git-picker-tab-count">{refs.branches.length}</span>}
              </button>
              <button className={`git-picker-tab ${tab === 'tags' ? 'active' : ''}`} onClick={() => handleTabChange('tags')}>
                <Tag size={13}/> Tags {refs && <span className="git-picker-tab-count">{refs.tags.length}</span>}
              </button>
              <button className={`git-picker-tab ${tab === 'commits' ? 'active' : ''}`} onClick={() => handleTabChange('commits')}>
                <GitCommit size={13}/> Commits
              </button>
              <button className="git-picker-refresh" onClick={fetchRefs} title="Refresh">
                <RefreshCw size={13} className={loading ? 'spin' : ''}/>
              </button>
            </div>

            <div className="git-picker-search">
              <input
                className="git-picker-search-input"
                placeholder={tab === 'commits' ? 'Filter by hash, message, author...' : 'Filter by name...'}
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
                autoFocus
              />
            </div>

            {tab === 'commits' && refs && (
              <div className="git-picker-branch-bar">
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>From:</span>
                <div className="git-picker-branch-chips">
                  {refs.branches.map(b => (
                    <button
                      key={b.name}
                      className={`git-picker-branch-chip ${selectedBranch === b.name ? 'active' : ''}`}
                      onClick={() => handleBranchForCommits(b.name)}
                    >{b.name}</button>
                  ))}
                </div>
              </div>
            )}

            <div
              className={`git-picker-item head-item ${value === '' ? 'selected' : ''}`}
              onClick={() => { onChange(''); setOpen(false); }}
            >
              <span className="git-picker-item-icon"><GitBranch size={13}/></span>
              <span className="git-picker-item-name">HEAD <span style={{color:'var(--text-secondary)', fontWeight:400}}>(current)</span></span>
              {value === '' && <Check size={13} style={{marginLeft:'auto', color:'var(--primary-color)'}}/>}
            </div>

            <div className="git-picker-list">
              {loading && <div className="git-picker-loading"><RefreshCw size={16} className="spin"/> Loading...</div>}

              {!loading && tab === 'branches' && filteredBranches.map(b => (
                <div key={b.name} className={`git-picker-item ${value === b.name ? 'selected' : ''}`} onClick={() => handleSelectBranch(b)}>
                  <span className="git-picker-item-icon">
                    {b.isCurrent
                      ? <GitBranch size={13} style={{color:'var(--success-color)'}}/>
                      : <GitBranch size={13} style={{color: b.remote ? '#818cf8' : undefined}}/>}
                  </span>
                  <span className="git-picker-item-body">
                    <span className="git-picker-item-name">
                      {b.name}
                      {b.isCurrent && <span className="git-picker-current-badge">current</span>}
                      {b.remote && <span className="git-picker-remote-badge">remote</span>}
                    </span>
                    <span className="git-picker-item-meta">{b.hash} · {b.message}</span>
                  </span>
                  <span className="git-picker-item-time">{b.time}</span>
                  {value === b.name && <Check size={13} style={{color:'var(--primary-color)', flexShrink:0}}/>}
                </div>
              ))}

              {!loading && tab === 'tags' && filteredTags.map(t => (
                <div key={t.name} className={`git-picker-item ${value === t.name ? 'selected' : ''}`} onClick={() => handleSelectBranch(t)}>
                  <span className="git-picker-item-icon"><Tag size={13}/></span>
                  <span className="git-picker-item-body">
                    <span className="git-picker-item-name">{t.name}</span>
                    <span className="git-picker-item-meta">{t.hash} · {t.message}</span>
                  </span>
                  <span className="git-picker-item-time">{t.time}</span>
                  {value === t.name && <Check size={13} style={{color:'var(--primary-color)', flexShrink:0}}/>}
                </div>
              ))}

              {!loading && tab === 'commits' && filteredCommits.map(c => (
                <div key={c.hash} className={`git-picker-item ${value === c.hash ? 'selected' : ''}`} onClick={() => handleSelectCommit(c)}>
                  <span className="git-picker-item-icon"><GitCommit size={13}/></span>
                  <span className="git-picker-item-body">
                    <span className="git-picker-item-name">{c.message}</span>
                    <span className="git-picker-item-meta"><code>{c.hash}</code> · {c.author}</span>
                  </span>
                  <span className="git-picker-item-time">{c.time}</span>
                  {value === c.hash && <Check size={13} style={{color:'var(--primary-color)', flexShrink:0}}/>}
                </div>
              ))}

              {!loading && tab === 'branches' && filteredBranches.length === 0 && <div className="git-picker-empty">No branches found</div>}
              {!loading && tab === 'tags'    && filteredTags.length === 0    && <div className="git-picker-empty">No tags found</div>}
              {!loading && tab === 'commits' && filteredCommits.length === 0 && commits.length === 0 && <div className="git-picker-empty">Select a branch above to load commits</div>}
              {!loading && tab === 'commits' && filteredCommits.length === 0 && commits.length > 0  && <div className="git-picker-empty">No matching commits</div>}
            </div>

            {value && (
              <div className="git-picker-footer">
                <span>Selected:</span>
                <code>{value}</code>
                <button className="git-picker-clear" onClick={() => { onChange(''); setOpen(false); }}>Clear</button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── BuildResultCard ─────────────────────────────────────────────────────────
function BuildResultCard({ result }: { result: BuildResult }) {
  const isSuccess  = result.status === 'Success';
  const isCanceled = result.status === 'Canceled';

  if (isCanceled) return null;

  const openFolder = async (p: string) => {
    try {
      await fetch(`http://${window.location.hostname}:3001/api/open-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: p }),
      });
    } catch (e) {
      console.error('Failed to open folder:', e);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8, height: 0 }}
        animate={{ opacity: 1, y: 0, height: 'auto' }}
        exit={{ opacity: 0, y: 8, height: 0 }}
        transition={{ duration: 0.3 }}
        style={{ marginTop: '1rem', overflow: 'hidden' }}
      >
        {isSuccess ? (
          /* ── 성공 카드 ── */
          <div style={{
            borderRadius: '0.75rem',
            background: 'rgba(52,211,153,0.08)',
            border: '1px solid rgba(52,211,153,0.3)',
            padding: '0.875rem 1rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <CheckCircle2 size={15} color="var(--success-color)"/>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--success-color)' }}>
                빌드 성공
                {result.durationSeconds && <span style={{ fontWeight: 400, color: 'var(--text-secondary)', marginLeft: '0.4rem' }}>({result.durationSeconds}s)</span>}
              </span>
            </div>
            {result.archivePath && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>아카이브 경로</span>
                <button
                  onClick={() => openFolder(result.archivePath!)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)',
                    borderRadius: '0.4rem', padding: '0.4rem 0.6rem',
                    color: 'var(--success-color)', cursor: 'pointer',
                    fontSize: '0.72rem', fontFamily: 'monospace',
                    textAlign: 'left', wordBreak: 'break-all',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(52,211,153,0.22)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(52,211,153,0.12)')}
                  title="탐색기에서 열기"
                >
                  <FolderOpen size={13} style={{ flexShrink: 0 }}/>
                  <span>{result.archivePath}</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          /* ── 실패 카드 ── */
          <div style={{
            borderRadius: '0.75rem',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.3)',
            padding: '0.875rem 1rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: result.lastError ? '0.5rem' : 0 }}>
              <AlertTriangle size={15} color="var(--error-color)"/>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--error-color)' }}>
                빌드 실패
                {result.durationSeconds && <span style={{ fontWeight: 400, color: 'var(--text-secondary)', marginLeft: '0.4rem' }}>({result.durationSeconds}s)</span>}
              </span>
            </div>
            {result.lastError && (
              <div style={{
                background: 'rgba(0,0,0,0.3)', borderRadius: '0.4rem',
                padding: '0.5rem 0.75rem',
                fontSize: '0.72rem', fontFamily: 'monospace',
                color: '#fca5a5', lineHeight: 1.5,
                wordBreak: 'break-all', maxHeight: '80px', overflowY: 'auto',
              }}>
                {result.lastError}
              </div>
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab]   = useState<'build' | 'analytics'>('build');
  const [platform, setPlatform]     = useState('Win64');
  const [config, setConfig]         = useState('Development');

  const [enginePath, setEnginePath]   = useState('F:\\wz\\UE_CICD\\UnrealEngine\\UnrealEngine');
  const [projectPath, setProjectPath] = useState('F:\\wz\\UE_CICD\\SampleProject');
  const [gitRepoPath, setGitRepoPath] = useState('F:\\wz\\UE_CICD\\SampleProject');
  const [gitRevision, setGitRevision] = useState('');

  const [cleanBuild, setCleanBuild]   = useState(false);
  const [clearCache, setClearCache]     = useState(false);
  const [clearCacheConfirm, setClearCacheConfirm] = useState(false);
  const [isBuilding, setIsBuilding]   = useState(false);
  const [buildStatus, setBuildStatus] = useState('Idle');
  const [buildStep, setBuildStep]     = useState<{ step: number; total: number; label: string } | null>(null);
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  const [logs, setLogs]               = useState<string[]>([]);
  const [history, setHistory]         = useState<any[]>([]);
  const [analytics, setAnalytics]     = useState<any>(null);
  const [revertConfirm, setRevertConfirm] = useState<{ buildId: string; files: string[] } | null>(null);
  const [isBuildLocked, setIsBuildLocked] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'BUILD_LOCK_RESET') {
        setIsBuildLocked(false);
        setIsBuilding(false);
        setBuildStatus('Lock auto-reset by server');
        return;
      }
      if (message.type === 'LOG' || message.type === 'LOG_ERROR') {
        const text = message.data.trim();
        if (text) {
          setLogs(prev => [...prev.slice(-300), text]);
          if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
      } else if (message.type === 'STEP') {
        setBuildStep({ step: message.step, total: message.total, label: message.label });
        setBuildStatus(message.label);
      } else if (message.type === 'GIT_DONE') {
        setBuildStatus('Git Done — Launching Build...');
      } else if (message.type === 'CONFIRM_REVERT') {
        setBuildStatus('Waiting for confirmation...');
        setRevertConfirm({ buildId: message.buildId, files: message.files });
      } else if (message.type === 'STATUS') {
        setBuildStatus(message.data);
        if (message.data.includes('Success') || message.data.includes('Failed') || message.data.includes('Canceled')) {
          const finalStatus = message.data.includes('Success') ? 'Success'
                            : message.data.includes('Failed')  ? 'Failed'
                            : 'Canceled';
          setIsBuilding(false);
          setBuildStep(null);
          setRevertConfirm(null);
          // 빌드 결과 저장
          setBuildResult({
            status: finalStatus,
            archivePath: message.archivePath ?? null,
            lastError:   message.lastError   ?? null,
            durationSeconds: message.durationSeconds ?? null,
          });
          fetchHistory();
          fetchAnalytics();
        }
      }
    };
    fetchHistory();
    fetchAnalytics();
    return () => ws.close();
  }, []);

  const fetchHistory   = async () => { try { const r = await fetch(`${API_URL}/history`);  setHistory(await r.json());  } catch(e){} };
  const fetchAnalytics = async () => { try { const r = await fetch(`${API_URL}/analytics`); setAnalytics(await r.json()); } catch(e){} };

  const handleBuild = () => {
    if (clearCache) {
      setClearCacheConfirm(true);
      return;
    }
    proceedBuild();
  };

  const proceedBuild = async () => {

    setIsBuilding(true);
    setBuildResult(null);
    setLogs([]);
    setBuildStep(null);
    setRevertConfirm(null);
    setBuildStatus('Starting Build...');
    try {
      const res = await fetch(`${API_URL}/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, config, enginePath, projectPath, gitRevision, cleanBuild, clearCache })
      });
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        if (body.error?.includes('already in progress')) {
          setIsBuildLocked(true);
          setBuildStatus('Build Locked');
          setIsBuilding(false);
          return;
        }
      }
      if (!res.ok) throw new Error('Failed to start build');
    } catch {
      setBuildStatus('Failed to start');
      setIsBuilding(false);
    }
  };

  const handleResetLock = async () => {
    try {
      await fetch(`${API_URL}/build/reset`, { method: 'POST' });
      setIsBuildLocked(false);
      setBuildStatus('Idle');
    } catch {}
  };

  const handleCancelBuild = async () => {
    if (window.confirm('정말 진행 중인 빌드 작업을 중지하시겠습니까?')) {
      try { await fetch(`${API_URL}/build/cancel`, { method: 'POST' }); } catch {}
    }
  };

  const handleRevertConfirm = async () => {
    setRevertConfirm(null);
    try { await fetch(`${API_URL}/build/confirm`, { method: 'POST' }); } catch {}
  };

  const handleRevertCancel = async () => {
    setRevertConfirm(null);
    setIsBuilding(false);
    setBuildStep(null);
    setBuildStatus('Canceled');
    try { await fetch(`${API_URL}/build/cancel`, { method: 'POST' }); } catch {}
  };

  return (
    <div className="app-container">

      {/* ── Revert 확인 모달 ── */}
      <AnimatePresence>
        {revertConfirm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              style={{ background: 'var(--panel-bg)', border: '1px solid rgba(251,191,36,0.4)', borderRadius: '1rem', padding: '2rem', maxWidth: '480px', width: '90%', boxShadow: '0 0 40px rgba(251,191,36,0.15)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <span style={{ fontSize: '1.5rem' }}>⚠️</span>
                <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>로컬 변경사항 감지</span>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem', lineHeight: 1.6 }}>
                Git 체크아웃 전에 아래 파일의 변경사항이 발견되었습니다.<br/>
                <strong style={{ color: 'var(--error-color)' }}>Revert</strong>하고 빌드를 진행하시겠습니까?
              </p>
              <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1.5rem', maxHeight: '160px', overflowY: 'auto' }}>
                {revertConfirm.files.map((f, i) => (
                  <div key={i} style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#fbbf24', padding: '0.1rem 0' }}>{f}</div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button className="btn-secondary" onClick={handleRevertCancel} style={{ padding: '0.6rem 1.2rem' }}>
                  빌드 취소
                </button>
                <button className="btn-danger" onClick={handleRevertConfirm} style={{ padding: '0.6rem 1.2rem', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>
                  Revert 후 빌드 진행
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Clear Cache 확인 모달 ── */}
      <AnimatePresence>
        {clearCacheConfirm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              style={{ background: 'var(--panel-bg)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '1rem', padding: '2rem', maxWidth: '480px', width: '90%', boxShadow: '0 0 40px rgba(239,68,68,0.15)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <Trash2 size={22} color="#ef4444"/>
                <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>Clear Cache Warning</span>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem', lineHeight: 1.6 }}>
                The following folders will be <strong style={{ color: '#ef4444' }}>permanently deleted</strong> from the project directory:
              </p>
              <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.75rem' }}>
                {['Intermediate/', 'Saved/', 'Binaries/', 'XmlConfigCache.bin'].map((f, i) => (
                  <div key={i} style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#fca5a5', padding: '0.15rem 0', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Trash2 size={11} style={{ opacity: 0.6 }}/> {f}
                  </div>
                ))}
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '1.5rem', lineHeight: 1.5, background: 'rgba(239,68,68,0.08)', padding: '0.6rem 0.8rem', borderRadius: '0.4rem', border: '1px solid rgba(239,68,68,0.15)' }}>
                This will force a full rebuild from scratch. Build time will significantly increase.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button className="btn-secondary" onClick={() => setClearCacheConfirm(false)} style={{ padding: '0.6rem 1.2rem' }}>
                  Cancel
                </button>
                <button
                  onClick={() => { setClearCacheConfirm(false); proceedBuild(); }}
                  style={{ padding: '0.6rem 1.2rem', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  <Trash2 size={14}/> Confirm & Build
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Sidebar ── */}
      <nav className="sidebar">
        <div className="header-title"><TerminalIcon size={28}/><span>ExFrameWork Portal</span></div>

        <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '2rem' }}>
          <div className="tabs" style={{ flexDirection: 'column' }}>
            <button className={`tab ${activeTab === 'build' ? 'active' : ''}`} onClick={() => setActiveTab('build')} style={{ textAlign: 'left', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <Activity size={18}/> Build Launcher
            </button>
            <button className={`tab ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')} style={{ textAlign: 'left', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <History size={18}/> Analytics & History
            </button>
          </div>
        </div>

        {/* ── System Status Panel ── */}
        <motion.div
          className="glass-panel"
          style={{ padding: '1.5rem', marginTop: 'auto' }}
          animate={{ borderColor: isBuilding ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.1)' }}
        >
          <div className="form-label" style={{ marginBottom: '1rem' }}>System Status</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className={`dot ${isBuilding ? 'yellow' : buildResult?.status === 'Success' ? 'green' : buildResult?.status === 'Failed' ? 'red' : 'green'}`}></div>
            <span style={{ fontWeight: 600 }}>{isBuilding ? 'Engine Occupied' : 'Ready for Build'}</span>
          </div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{buildStatus}</div>

          {/* 빌드 잠금 배너 */}
          {isBuildLocked && (
            <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.4)', borderRadius: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ color: '#facc15', fontWeight: 600, fontSize: '0.85rem' }}>⚠️ Build Lock Detected</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>이전 빌드가 비정상 종료되어 잠금이 걸려 있습니다.</div>
              <button
                onClick={handleResetLock}
                style={{ marginTop: '0.25rem', padding: '0.4rem 0.9rem', background: 'rgba(234,179,8,0.2)', border: '1px solid rgba(234,179,8,0.5)', color: '#facc15', borderRadius: '0.4rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', alignSelf: 'flex-start' }}
              >
                🔓 Reset Build Lock
              </button>
            </div>
          )}

          {/* 단계별 스텝퍼 */}
          <AnimatePresence>
            {isBuilding && buildStep && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                style={{ marginTop: '1rem', overflow: 'hidden' }}
              >
                <div style={{ marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                    <span>Step {buildStep.step} / {buildStep.total}</span>
                    <span>{Math.round((buildStep.step / buildStep.total) * 100)}%</span>
                  </div>
                  <div style={{ height: '4px', borderRadius: '999px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                    <motion.div
                      style={{ height: '100%', borderRadius: '999px', background: 'linear-gradient(90deg, #38bdf8, #818cf8)' }}
                      animate={{ width: `${(buildStep.step / buildStep.total) * 100}%` }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                    />
                  </div>
                </div>
                {(buildStep && buildStep.total === 6
                  ? [
                      { step: 1, label: 'Git Check' },
                      { step: 2, label: 'Git Fetch' },
                      { step: 3, label: 'Git Checkout' },
                      { step: 4, label: 'Git Pull' },
                      { step: 5, label: 'Clear Cache', isDanger: true },
                      { step: 6, label: 'Build' },
                    ]
                  : [
                      { step: 1, label: 'Git Check' },
                      { step: 2, label: 'Git Fetch' },
                      { step: 3, label: 'Git Checkout' },
                      { step: 4, label: 'Git Pull' },
                      { step: 5, label: 'Build' },
                    ]
                ).map(s => {
                  const done   = s.step < buildStep.step;
                  const active = s.step === buildStep.step;
                  const danger = (s as any).isDanger;
                  const activeColor = danger && active ? '#ef4444' : 'var(--primary-color)';
                  const doneColor   = danger && done ? '#ef4444' : 'var(--success-color)';
                  return (
                  <div key={s.step} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.2rem 0', fontSize: '0.78rem' }}>
                  <div style={{
                  width: '16px', height: '16px', borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: done ? doneColor : active ? activeColor : 'rgba(255,255,255,0.08)',
                  fontSize: '0.6rem', fontWeight: 700,
                    color: (done || active) ? '#0f172a' : 'var(--text-secondary)',
                  boxShadow: active ? `0 0 8px ${danger ? 'rgba(239,68,68,0.6)' : 'rgba(56,189,248,0.6)'}` : 'none',
                    transition: 'all 0.3s'
                  }}>
                  {done ? '✓' : s.step}
                  </div>
                  <span style={{ color: done ? doneColor : active ? activeColor : 'var(--text-secondary)', fontWeight: active ? 600 : 400 }}>
                      {s.label}
                        {active && <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.2 }}>...</motion.span>}
                      </span>
                    </div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── 빌드 결과 카드 (System Status 하단) ── */}
          {!isBuilding && buildResult && (
            <BuildResultCard result={buildResult} />
          )}
        </motion.div>
      </nav>

      {/* ── Main ── */}
      <main>
        {activeTab === 'build' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
              <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Play size={20} color="var(--primary-color)"/> Configure Build
              </h2>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '1.5rem' }}>
                <div className="form-group">
                  <label className="form-label">Target Platform</label>
                  <select className="form-select" value={platform} onChange={e => setPlatform(e.target.value)}>
                    <option value="Win64">Windows (Win64)</option>
                    <option value="Android">Android</option>
                    <option value="IOS">iOS</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Build Configuration</label>
                  <select className="form-select" value={config} onChange={e => setConfig(e.target.value)}>
                    <option value="Development">Development (Debug Symbols)</option>
                    <option value="Debug">Debug (Detailed)</option>
                    <option value="Shipping">Shipping (Optimized for Release)</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: '1.5rem', padding: '1.5rem', borderRadius: '12px', background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.2)' }}>
                <h3 style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.05rem', color: 'var(--primary-color)' }}>
                  <GitBranch size={18}/> Git Revision Control
                </h3>
                <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                  <label className="form-label">Project Git Repository Path</label>
                  <input type="text" className="path-input" value={gitRepoPath} onChange={e => setGitRepoPath(e.target.value)} placeholder="e.g. F:\wz\UE_CICD\SampleProject"/>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
                    Open the picker below to load branches &amp; commits from this path.
                  </div>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <GitCommit size={13}/> Git Revision — Branch / Tag / Commit&nbsp;<span style={{ fontWeight: 400 }}>(optional)</span>
                  </label>
                  <GitRevisionPicker repoPath={gitRepoPath} value={gitRevision} onChange={setGitRevision} apiUrl={API_URL}/>
                  {gitRevision && (
                    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} className="git-revision-badge">
                      <Check size={12}/> Will checkout <code>{gitRevision}</code> before building
                    </motion.div>
                  )}
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">Engine Directory Path</label>
                <input type="text" className="path-input" value={enginePath} onChange={e => setEnginePath(e.target.value)} placeholder="e.g. F:\wz\UE_CICD\UnrealEngine\UnrealEngine"/>
              </div>
              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">Project Directory Path (.uproject location)</label>
                <input type="text" className="path-input" value={projectPath} onChange={e => setProjectPath(e.target.value)} placeholder="e.g. F:\wz\UE_CICD\SampleProject"/>
              </div>

              {/* ── Build Options ── */}
              <div style={{
                marginTop: '1rem',
                padding: '1rem 1.25rem',
                borderRadius: '12px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '1rem',
              }}>
                <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* Clean Build Toggle */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', userSelect: 'none' }}>
                    <div
                      onClick={() => setCleanBuild(v => !v)}
                      style={{
                        width: '38px', height: '20px', borderRadius: '999px',
                        background: cleanBuild ? 'var(--primary-color)' : 'rgba(255,255,255,0.1)',
                        position: 'relative', transition: 'background 0.2s', cursor: 'pointer',
                        border: `1px solid ${cleanBuild ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.15)'}`,
                      }}
                    >
                      <motion.div
                        animate={{ x: cleanBuild ? 18 : 2 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        style={{
                          width: '16px', height: '16px', borderRadius: '50%',
                          background: cleanBuild ? '#fff' : 'rgba(255,255,255,0.4)',
                          position: 'absolute', top: '1px',
                          boxShadow: cleanBuild ? '0 0 6px rgba(56,189,248,0.5)' : 'none',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Sparkles size={13} style={{ color: cleanBuild ? 'var(--primary-color)' : 'var(--text-secondary)' }}/>
                      <span style={{ fontSize: '0.82rem', fontWeight: 500, color: cleanBuild ? 'var(--text-primary)' : 'var(--text-secondary)' }}>Clean Build</span>
                    </div>
                  </label>

                  {/* Clear Cache Toggle */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', userSelect: 'none' }}>
                    <div
                      onClick={() => setClearCache(v => !v)}
                      style={{
                        width: '38px', height: '20px', borderRadius: '999px',
                        background: clearCache ? '#ef4444' : 'rgba(255,255,255,0.1)',
                        position: 'relative', transition: 'background 0.2s', cursor: 'pointer',
                        border: `1px solid ${clearCache ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.15)'}`,
                      }}
                    >
                      <motion.div
                        animate={{ x: clearCache ? 18 : 2 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        style={{
                          width: '16px', height: '16px', borderRadius: '50%',
                          background: clearCache ? '#fff' : 'rgba(255,255,255,0.4)',
                          position: 'absolute', top: '1px',
                          boxShadow: clearCache ? '0 0 6px rgba(239,68,68,0.5)' : 'none',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Trash2 size={13} style={{ color: clearCache ? '#ef4444' : 'var(--text-secondary)' }}/>
                      <span style={{ fontSize: '0.82rem', fontWeight: 500, color: clearCache ? '#ef4444' : 'var(--text-secondary)' }}>Clear Cache</span>
                    </div>
                  </label>
                </div>

                {!isBuilding ? (
                  <button className="glass-button launch" onClick={handleBuild}><TerminalIcon size={20}/> Launch Editor Build</button>
                ) : (
                  <button className="glass-button launch" onClick={handleCancelBuild} style={{ background: 'linear-gradient(135deg,#ef4444,#f87171)', boxShadow: '0 0 20px rgba(248,113,113,0.4)' }}>
                    <XCircle size={20}/> Cancel Build
                  </button>
                )}
              </div>
            </div>

            {/* Terminal */}
            <div className="glass-panel terminal-container">
              <div className="terminal-header">
                <div className="terminal-dots"><div className="dot red"/><div className="dot yellow"/><div className="dot green"/></div>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>UAT BuildCookRun Console</div>
              </div>
              <div className="terminal-output" ref={terminalRef}>
                {logs.length === 0
                  ? <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>Waiting for build command...</div>
                  : logs.map((log, i) => {
                      let cls = '';
                      if (log.toLowerCase().includes('error'))   cls = 'error';
                      if (log.toLowerCase().includes('success')) cls = 'success';
                      if (log.toLowerCase().includes('warning')) cls = 'info';
                      return <div key={i} className={cls}>{log}</div>;
                    })}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'analytics' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <h2 style={{ marginBottom: '1.5rem' }}>Metrics Dashboard</h2>
            <div className="stats-grid">
              <div className="glass-panel stat-card"><div className="stat-label">Total Builds</div><div className="stat-value">{analytics?.totalBuilds || 0}</div></div>
              <div className="glass-panel stat-card"><div className="stat-label">Successful Builds</div><div className="stat-value" style={{ color: 'var(--success-color)' }}>{analytics?.successfulBuilds || 0}</div></div>
              <div className="glass-panel stat-card"><div className="stat-label">Failed Builds</div><div className="stat-value" style={{ color: 'var(--error-color)' }}>{analytics?.failedBuilds || 0}</div></div>
              <div className="glass-panel stat-card"><div className="stat-label">Success Rate</div><div className="stat-value">{analytics?.totalBuilds ? Math.round((analytics.successfulBuilds / analytics.totalBuilds) * 100) : 0}%</div></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
              <div className="glass-panel" style={{ padding: '1.5rem', height: '300px' }}>
                <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: 'var(--text-secondary)' }}>Platform Distribution</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={analytics?.platformStats || []} dataKey="count" nameKey="platform" cx="50%" cy="50%" outerRadius={80} label>
                      {(analytics?.platformStats || []).map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}
                    </Pie>
                    <Tooltip contentStyle={{ background: 'var(--bg-dark)', border: 'none', borderRadius: '8px' }}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="glass-panel" style={{ padding: '1.5rem', height: '300px' }}>
                <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: 'var(--text-secondary)' }}>Recent Execution Times (s)</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={history.slice(0, 5).reverse()}>
                    <XAxis dataKey="platform" stroke="var(--text-secondary)" fontSize={12}/>
                    <Tooltip contentStyle={{ background: 'var(--bg-dark)', border: 'none', borderRadius: '8px' }}/>
                    <Bar dataKey="duration_seconds" fill="var(--primary-color)" radius={[4, 4, 0, 0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="glass-panel" style={{ padding: '1.5rem', overflowX: 'auto' }}>
              <h3 style={{ marginBottom: '1.5rem', fontSize: '1rem' }}>Execution History</h3>
              <table className="history-table">
                <thead><tr><th>Configuration</th><th>Platform</th><th>Status</th><th>Duration</th><th>Date</th></tr></thead>
                <tbody>
                  {history.map(record => (
                    <tr key={record.id}>
                      <td style={{ fontWeight: 500 }}>{record.config}</td>
                      <td>{record.platform}</td>
                      <td><span className={`badge ${record.status.toLowerCase()}`}>{record.status}</span></td>
                      <td>{record.duration_seconds ? `${record.duration_seconds}s` : '-'}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{format(new Date(record.start_time), 'MMM dd, HH:mm:ss')}</td>
                    </tr>
                  ))}
                  {history.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>No execution history found.</td></tr>}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
}
