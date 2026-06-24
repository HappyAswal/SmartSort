/**
 * App.jsx – Smart Photo Sorter Dashboard
 * Full single-page dashboard: Scan → Preview → Sort → Clean-Up → Travelogue
 */
import React, { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react';
import {
  FolderOpen, ScanLine, Sparkles, BookOpen, Trash2, Copy,
  Move, Play, Eye, X, Edit2, CheckCircle, AlertTriangle,
  MapPin, Calendar, Image, FileText, Settings, ChevronDown,
  ChevronRight, Loader2, Download, RefreshCw, Camera, Zap,
} from 'lucide-react';

const API = 'http://localhost:8000';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fileUrl(path) {
  return `${API}/api/file?path=${encodeURIComponent(path)}`;
}

function thumbUrl(path, size = 200) {
  return `${API}/api/thumbnail?path=${encodeURIComponent(path)}&size=${size}`;
}

// ─── Shared IntersectionObserver ─────────────────────────────────────────────
// One observer for the entire page instead of one per image.
// Callbacks are registered per-element and fired when they enter viewport.

const _ioCallbacks = new Map();
let _sharedIO = null;

function getSharedIO() {
  if (_sharedIO) return _sharedIO;
  _sharedIO = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const cb = _ioCallbacks.get(entry.target);
          if (cb) {
            cb();
            _ioCallbacks.delete(entry.target);
            _sharedIO.unobserve(entry.target);
          }
        }
      }
    },
    { rootMargin: '300px' }
  );
  return _sharedIO;
}

function observeElement(el, cb) {
  _ioCallbacks.set(el, cb);
  getSharedIO().observe(el);
  return () => {
    _ioCallbacks.delete(el);
    getSharedIO().unobserve(el);
  };
}

/**
 * LazyThumb — image only fetches when near the viewport.
 * Uses a single shared IntersectionObserver for the whole page.
 * Shimmer only animates when visible (saves GPU on hidden items).
 * Falls back to full-res if thumbnail endpoint fails.
 */
const LazyThumb = memo(function LazyThumb({ path, alt, size = 200, style, className, onClick }) {
  const [phase, setPhase] = useState('idle'); // idle → loading → loaded | error
  const [src, setSrc] = useState(null);
  const [retriedFull, setRetriedFull] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!path || !ref.current) return;
    const el = ref.current;
    return observeElement(el, () => {
      setSrc(thumbUrl(path, size));
      setPhase('loading');
    });
  }, [path, size]);

  function handleError() {
    if (!retriedFull) {
      setRetriedFull(true);
      setPhase('loading');
      setSrc(fileUrl(path));
    } else {
      setPhase('error');
    }
  }

  return (
    <div
      ref={ref}
      className={className}
      style={{
        background: 'var(--bg-surface)',
        overflow: 'hidden',
        position: 'relative',
        cursor: onClick ? 'pointer' : 'default',
        flexShrink: 0,
        ...style,
      }}
      onClick={onClick}
    >
      {phase !== 'loaded' && phase !== 'error' && (
        <div style={{
          position: 'absolute', inset: 0,
          background: phase === 'loading'
            ? 'linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-card-hover) 50%, var(--bg-surface) 75%)'
            : 'var(--bg-surface)',
          backgroundSize: '200% 100%',
          animation: phase === 'loading' ? 'shimmer 1.4s infinite' : 'none',
        }} />
      )}
      {src && (
        <img
          src={src}
          alt={alt}
          style={{
            width: '100%', height: '100%',
            objectFit: 'cover',
            opacity: phase === 'loaded' ? 1 : 0,
            transition: 'opacity 0.15s ease',
            display: 'block',
            pointerEvents: 'none',
            imageOrientation: 'from-image',
          }}
          onLoad={() => setPhase('loaded')}
          onError={handleError}
        />
      )}
      {phase === 'error' && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-muted)', fontSize: '0.7rem',
        }}>
          ✕
        </div>
      )}
    </div>
  );
});

// ─── Pagination hook ──────────────────────────────────────────────────────────

function usePagination(items, pageSize = 20) {
  const [page, setPage] = useState(1);
  // Reset to page 1 whenever the source list changes
  const prevItems = useRef(items);
  if (prevItems.current !== items) {
    prevItems.current = items;
    // Can't call setPage during render — use a ref flag and effect instead
  }
  useEffect(() => { setPage(1); }, [items]);

  const visible = useMemo(() => items.slice(0, page * pageSize), [items, page, pageSize]);
  const hasMore = visible.length < items.length;
  const loadMore = useCallback(() => setPage(p => p + 1), []);
  return { visible, hasMore, loadMore };
}

// ─── Memoised card components ─────────────────────────────────────────────────

const DupPhotoCard = memo(function DupPhotoCard({ photo, groupIdx, onPreview, onDelete }) {
  return (
    <div className="dup-photo-card">
      {/* Thumbnail — natural aspect ratio, click to preview */}
      <div className="dup-photo-thumb-wrap" onClick={() => onPreview(photo)}>
        <LazyThumb
          path={photo.path}
          alt={photo.filename}
          size={400}
          style={{ width: '100%', height: '100%', borderRadius: 0 }}
        />
      </div>

      {/* Footer */}
      <div className="dup-photo-footer">
        <span className="dup-photo-name" title={photo.path}>{photo.filename}</span>
        <button
          className="btn btn-danger btn-sm"
          style={{ padding: '4px 12px', fontSize: '0.75rem', flexShrink: 0 }}
          onClick={() => onDelete(groupIdx, photo)}
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </div>
  );
});

const BlurryCard = memo(function BlurryCard({ photo, onPreview, onDelete }) {
  return (
    <div className="blurry-card">
      <LazyThumb
        path={photo.path}
        alt={photo.filename}
        size={320}
        style={{ width: '100%', height: 110 }}
        onClick={() => onPreview(photo)}
      />
      <div className="blurry-card-info">
        <div className="photo-name truncate">{photo.filename}</div>
        <div className="blurry-score">Blur score: {photo.blur_score?.toFixed(1)}</div>
        <button
          className="btn btn-danger btn-sm"
          style={{ width: '100%', marginTop: 6, padding: '5px 8px', fontSize: '0.75rem' }}
          onClick={() => onDelete(photo)}
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </div>
  );
});

function fmt(n) {
  return (n ?? 0).toLocaleString();
}

function bytesHuman(b) {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function useLog() {
  const [lines, setLines] = useState([]);
  const push = useCallback((msg, type = 'info') => {
    const ts = new Date().toLocaleTimeString();
    setLines(prev => [...prev, { msg, type, ts }]);
  }, []);
  const clear = useCallback(() => setLines([]), []);
  return { lines, push, clear };
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Spinner({ size = 20 }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        border: '2px solid rgba(255,255,255,0.12)',
        borderTopColor: 'var(--accent)',
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
        flexShrink: 0,
      }}
    />
  );
}

function EmptyState({ icon, title, desc }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <h3>{title}</h3>
      {desc && <p>{desc}</p>}
    </div>
  );
}

// Simple Markdown renderer (headings + paragraphs only)
function MarkdownView({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <div className="travelogue-preview">
      {lines.map((line, i) => {
        if (line.startsWith('# '))  return <h1 key={i}>{line.slice(2)}</h1>;
        if (line.startsWith('## ')) return <h2 key={i}>{line.slice(3)}</h2>;
        if (line.startsWith('### '))return <h2 key={i}>{line.slice(4)}</h2>;
        if (line.trim() === '')     return <br key={i} />;
        return <p key={i} dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />;
      })}
    </div>
  );
}

// Image preview modal
// ─── Confirm Modal + hook ─────────────────────────────────────────────────────

function ConfirmModal({ message, detail, confirmLabel = 'Delete', onConfirm, onCancel }) {
  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onCancel(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'var(--rose-glow)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Trash2 size={16} style={{ color: 'var(--rose)' }} />
          </div>
          <div className="modal-title" style={{ margin: 0 }}>{message}</div>
        </div>
        {detail && (
          <p className="text-sm text-secondary" style={{ marginBottom: 20, lineHeight: 1.6 }}>{detail}</p>
        )}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * useConfirm — returns a confirm(message, detail) function that shows
 * the in-app modal and resolves true/false like window.confirm.
 * Usage: const confirmed = await confirm('Are you sure?', 'This cannot be undone.')
 */
function useConfirm() {
  const [state, setState] = useState(null); // { message, detail, confirmLabel, resolve }

  const confirm = useCallback((message, detail, confirmLabel) => {
    return new Promise(resolve => {
      setState({ message, detail, confirmLabel, resolve });
    });
  }, []);

  function handleConfirm() {
    state?.resolve(true);
    setState(null);
  }

  function handleCancel() {
    state?.resolve(false);
    setState(null);
  }

  const modal = state ? (
    <ConfirmModal
      message={state.message}
      detail={state.detail}
      confirmLabel={state.confirmLabel}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null;

  return { confirm, modal };
}

// ─── PreviewModal ─────────────────────────────────────────────────────────────

function PreviewModal({ photo, onClose }) {
  if (!photo) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal preview-modal" onClick={e => e.stopPropagation()}>
        <img src={fileUrl(photo.path)} alt={photo.filename} style={{ imageOrientation: 'from-image' }} />
        <div className="preview-modal-meta">
          <div>
            <div className="text-sm" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{photo.filename}</div>
            <div className="text-xs text-muted">{photo.date_taken_str} · {bytesHuman(photo.size_bytes)}</div>
          </div>
          <div className="flex gap-2 items-center">
            {photo.is_blurry && <span className="badge badge-amber">Blurry ({photo.blur_score?.toFixed(1)})</span>}
            <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={14} /> Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Inline editable cluster name
function EditableName({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);

  function start() { setDraft(value); setEditing(true); setTimeout(() => ref.current?.focus(), 0); }
  function commit() { if (draft.trim()) onChange(draft.trim()); setEditing(false); }

  if (editing) {
    return (
      <input
        ref={ref}
        className="input"
        style={{ fontSize: '0.9rem', padding: '4px 8px', width: '100%' }}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      />
    );
  }

  return (
    <span className="cluster-name">
      <span style={{ flex: 1 }}>{value || 'Unnamed Event'}</span>
      <Edit2 size={13} className="edit-icon" onClick={start} title="Rename" />
    </span>
  );
}

// Single cluster card
function ClusterCard({ cluster, idx, onChange, onPreview }) {
  const [open, setOpen] = useState(false);
  const { event_name, photo_count, date_range, location_label, photos = [] } = cluster;

  return (
    <div className="cluster-card">
      <div className="cluster-header">
        <EditableName
          value={event_name}
          onChange={name => onChange(idx, { ...cluster, event_name: name })}
        />
        <div className="cluster-meta">
          {location_label && (
            <span className="badge badge-teal"><MapPin size={10} />{location_label}</span>
          )}
          {date_range && (
            <span className="badge badge-muted">
              <Calendar size={10} />
              {date_range.start === date_range.end ? date_range.start : `${date_range.start} → ${date_range.end}`}
            </span>
          )}
          <span className="badge badge-accent"><Image size={10} />{photo_count} photos</span>
        </div>
      </div>

      <div className="cluster-body">
        <button
          className="btn btn-ghost btn-sm w-full"
          onClick={() => setOpen(o => !o)}
          style={{ justifyContent: 'space-between' }}
        >
          <span>View photos</span>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {open && (
          <div className="photo-list mt-2">
            {photos.map((p, pi) => (
              <div key={pi} className="photo-row" onClick={() => onPreview(p)}>
                <LazyThumb
                  path={p.path}
                  alt={p.filename}
                  size={72}
                  className="photo-thumb"
                  style={{ width: 36, height: 36, borderRadius: 6, flexShrink: 0 }}
                />
                <div className="photo-info">
                  <div className="photo-name">{p.filename}</div>
                  <div className="photo-date">{p.date_taken_str} · {bytesHuman(p.size_bytes)}</div>
                </div>
                <div className="photo-flags">
                  {p.is_blurry && <span title={`Blur: ${p.blur_score?.toFixed(1)}`}>🌫️</span>}
                  {p.error && <span title={p.error}>⚠️</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  // ── Config state
  const [sourceDir, setSourceDir]       = useState('');
  const [destDir, setDestDir]           = useState('');
  const [timeGap, setTimeGap]           = useState(24);
  const [mode, setMode]                 = useState('copy');
  const [apiKey, setApiKey]             = useState(() => localStorage.getItem('smartsort_gemini_key') || '');
  const [showApiKey, setShowApiKey]     = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // ── Scan results
  const [scanData, setScanData]   = useState(null);
  const [clusters, setClusters]   = useState([]);
  const [scanning, setScanning]   = useState(false);

  // ── AI state
  const [naming, setNaming]               = useState(false);
  const [generating, setGenerating]       = useState(false);
  const [travelogue, setTravelogue]       = useState('');
  const [showTravelogue, setShowTravelogue] = useState(false);

  // ── Sort state
  const [sorting, setSorting]   = useState(false);
  const [sortResult, setSortResult] = useState(null);
  const [dryRun, setDryRun]     = useState(true);

  // ── Delete state
  const [deletingDups, setDeletingDups]     = useState(false);
  const [deletingBlurry, setDeletingBlurry] = useState(false);

  // ── UI state
  const [tab, setTab]             = useState('events');
  const [previewPhoto, setPreviewPhoto] = useState(null);

  // ── Confirm dialog
  const { confirm, modal: confirmModal } = useConfirm();

  // ── Pagination
  const dupPagination    = usePagination(scanData?.duplicates ?? [], 20);
  const blurryPagination = usePagination(scanData?.blurry    ?? [], 40);

  // ── Stable callbacks for memoised cards (defined after delete handlers below)
  const onPreview = useCallback(p => setPreviewPhoto(p), []);

  // ── Console log
  const { lines: logLines, push: log, clear: clearLog } = useLog();

  // ─── Scan ──────────────────────────────────────────────────────────────────

  async function handleScan() {
    if (!sourceDir.trim()) { alert('Please enter a source directory path.'); return; }
    setScanning(true);
    setScanData(null);
    setClusters([]);
    setSortResult(null);
    setTravelogue('');
    clearLog();
    log(`Scanning: ${sourceDir}`, 'info');

    try {
      const res = await fetch(`${API}/api/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_dir: sourceDir, time_gap_hours: Number(timeGap) }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Scan failed');
      }
      const data = await res.json();
      setScanData(data);
      setClusters(data.clusters || []);
      log(`Scan complete: ${data.total_scanned} images found, ${data.clusters?.length ?? 0} events, ${data.duplicates?.length ?? 0} duplicate groups, ${data.blurry?.length ?? 0} blurry photos.`, 'ok');
    } catch (e) {
      log(`Error: ${e.message}`, 'error');
    } finally {
      setScanning(false);
    }
  }

  // ─── AI Naming ─────────────────────────────────────────────────────────────

  async function handleGenerateNames() {
    if (!apiKey.trim()) { alert('Please enter your Gemini API key in Settings.'); return; }
    if (!clusters.length) return;
    setNaming(true);
    log('Sending clusters to Gemini for naming…', 'info');
    try {
      const res = await fetch(`${API}/api/generate-names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusters, api_key: apiKey }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      const { names } = await res.json();
      setClusters(prev => prev.map((c, i) => ({ ...c, event_name: names[i] ?? c.event_name })));
      log(`AI naming complete: ${names.length} names generated.`, 'ok');
    } catch (e) {
      log(`Naming error: ${e.message}`, 'error');
    } finally {
      setNaming(false);
    }
  }

  // ─── Sort ──────────────────────────────────────────────────────────────────

  async function handleSort(dry) {
    if (!destDir.trim()) { alert('Please enter a destination directory path.'); return; }
    setSorting(true);
    setSortResult(null);
    const isDry = dry ?? dryRun;
    log(`${isDry ? 'Dry-run preview' : `Executing ${mode}`} → ${destDir}`, 'info');
    try {
      const res = await fetch(`${API}/api/sort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_dir: sourceDir,
          destination_dir: destDir,
          clusters,
          mode,
          dry_run: isDry,
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      const result = await res.json();
      setSortResult(result);
      if (isDry) {
        log(`Preview: ${result.operations} files would be ${mode === 'move' ? 'moved' : 'copied'}.`, 'ok');
      } else {
        log(`Done: ${result.operations} files ${mode === 'move' ? 'moved' : 'copied'}. ${result.errors?.length ?? 0} errors.`, result.errors?.length ? 'warn' : 'ok');
      }
    } catch (e) {
      log(`Sort error: ${e.message}`, 'error');
    } finally {
      setSorting(false);
    }
  }

  // ─── Delete helpers ────────────────────────────────────────────────────────

  async function deletePaths(paths) {
    const res = await fetch(`${API}/api/delete-files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Delete failed'); }
    return res.json();
  }

  // Purge a set of successfully-deleted paths from ALL state: clusters, duplicates, blurry, counts.
  function purgeDeletedFromState(deletedPaths) {
    const deleted = new Set(deletedPaths);

    // Remove from clusters — compute filtered photos once to avoid referencing stale c.photos
    setClusters(prev =>
      prev.map(c => {
        const photos = c.photos.filter(p => !deleted.has(p.path));
        return { ...c, photos, photo_count: photos.length };
      }).filter(c => c.photo_count > 0)
    );

    // Remove from scanData: duplicates, blurry, and recalculate counts
    setScanData(prev => {
      const newDuplicates = prev.duplicates
        .map(group => group.filter(p => !deleted.has(p.path)))
        .filter(group => group.length > 1);
      const newBlurry = prev.blurry.filter(p => !deleted.has(p.path));
      const removedCount = deletedPaths.length;
      return {
        ...prev,
        duplicates: newDuplicates,
        blurry: newBlurry,
        total_scanned: Math.max(0, prev.total_scanned - removedCount),
        total_valid: Math.max(0, prev.total_valid - removedCount),
      };
    });
  }

  // Delete all duplicates
  async function handleDeleteAllDuplicates() {
    const toDelete = scanData.duplicates.flatMap(group => group.map(p => p.path));
    if (!toDelete.length) return;
    const ok = await confirm(
      'Delete all duplicates?',
      `This will permanently delete ${toDelete.length} photo${toDelete.length !== 1 ? 's' : ''}.`,
      'Delete All'
    );
    if (!ok) return;
    setDeletingDups(true);
    try {
      const result = await deletePaths(toDelete);
      log(`Deleted ${result.deleted.length} duplicates. ${result.failed.length} failed.`, result.failed.length ? 'warn' : 'ok');
      if (result.failed.length) {
        result.failed.forEach(f => log(`  Failed: ${f.path} — ${f.error}`, 'error'));
      }
      purgeDeletedFromState(result.deleted);
    } catch (e) {
      log(`Delete error: ${e.message}`, 'error');
    } finally {
      setDeletingDups(false);
    }
  }

  // Delete a single photo from a duplicate group
  async function handleDeleteDupPhoto(groupIdx, photo) {
    const ok = await confirm(
      `Delete "${photo.filename}"?`,
      'This will permanently delete this photo. This cannot be undone.',
      'Delete'
    );
    if (!ok) return;
    try {
      const result = await deletePaths([photo.path]);
      if (result.deleted.length) {
        log(`Deleted ${photo.filename}.`, 'ok');
        purgeDeletedFromState(result.deleted);
      } else {
        log(`Failed to delete ${photo.filename}: ${result.failed[0]?.error}`, 'error');
      }
    } catch (e) {
      log(`Delete error: ${e.message}`, 'error');
    }
  }

  // Delete all blurry photos
  async function handleDeleteAllBlurry() {
    const toDelete = scanData.blurry.map(p => p.path);
    if (!toDelete.length) return;
    const ok = await confirm(
      'Delete all blurry photos?',
      `This will permanently delete ${toDelete.length} blurry photo${toDelete.length !== 1 ? 's' : ''}.`,
      'Delete All'
    );
    if (!ok) return;
    setDeletingBlurry(true);
    try {
      const result = await deletePaths(toDelete);
      log(`Deleted ${result.deleted.length} blurry photos. ${result.failed.length} failed.`, result.failed.length ? 'warn' : 'ok');
      if (result.failed.length) {
        result.failed.forEach(f => log(`  Failed: ${f.path} — ${f.error}`, 'error'));
      }
      purgeDeletedFromState(result.deleted);
    } catch (e) {
      log(`Delete error: ${e.message}`, 'error');
    } finally {
      setDeletingBlurry(false);
    }
  }

  // Delete a single blurry photo
  async function handleDeleteBlurryPhoto(photo) {
    const ok = await confirm(
      `Delete "${photo.filename}"?`,
      'This will permanently delete this photo. This cannot be undone.',
      'Delete'
    );
    if (!ok) return;
    try {
      const result = await deletePaths([photo.path]);
      if (result.deleted.length) {
        log(`Deleted ${photo.filename}.`, 'ok');
        purgeDeletedFromState(result.deleted);
      } else {
        log(`Failed to delete ${photo.filename}: ${result.failed[0]?.error}`, 'error');
      }
    } catch (e) {
      log(`Delete error: ${e.message}`, 'error');
    }
  }

  // ─── Travelogue ────────────────────────────────────────────────────────────
  async function handleTravelogue() {
    if (!apiKey.trim()) { alert('Please enter your Gemini API key in Settings.'); return; }
    if (!destDir.trim()) { alert('Please enter a destination directory so the log can be saved.'); return; }
    setGenerating(true);
    log('Generating AI travel log…', 'info');
    try {
      const res = await fetch(`${API}/api/generate-travelogue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusters, destination_dir: destDir, api_key: apiKey }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      const { markdown, saved_to } = await res.json();
      setTravelogue(markdown);
      setShowTravelogue(true);
      log(saved_to ? `Travel log saved to ${saved_to}` : 'Travel log generated.', 'ok');
    } catch (e) {
      log(`Travelogue error: ${e.message}`, 'error');
    } finally {
      setGenerating(false);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const hasScan    = !!scanData;
  const hasDups    = (scanData?.duplicates?.length ?? 0) > 0;
  const hasBlurry  = (scanData?.blurry?.length ?? 0) > 0;

  return (
    <div className="app-shell">
      {/* ── Topbar ── */}
      <header className="topbar">
        <div className="topbar-logo">
          <div className="logo-icon"><Camera size={15} /></div>
          SmartSort
        </div>
        <div className="topbar-spacer" />
        <div className="topbar-actions">
          {hasScan && (
            <span className="badge badge-green">
              <CheckCircle size={10} /> {fmt(scanData.total_scanned)} photos scanned
            </span>
          )}
          <button className="btn btn-ghost btn-icon" title="Settings" onClick={() => setShowSettings(true)}>
            <Settings size={16} />
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="main-content">
        <div className="flex flex-col gap-6">

          {/* ─ Scan Config Card ─ */}
          <div className="card">
            <div className="section-header">
              <div>
                <div className="section-title"><ScanLine size={16} /> Scan Configuration</div>
                <div className="section-subtitle">Point to your source folder and set how photos should be grouped</div>
              </div>
            </div>

            <div className="config-panel">
              <div className="field-group">
                <label className="field-label">Source Directory</label>
                <input
                  className="input input-mono"
                  placeholder="C:\Users\You\Pictures\Unsorted"
                  value={sourceDir}
                  onChange={e => setSourceDir(e.target.value)}
                />
              </div>
              <div className="field-group">
                <label className="field-label">Destination Directory</label>
                <input
                  className="input input-mono"
                  placeholder="C:\Users\You\Pictures\Sorted"
                  value={destDir}
                  onChange={e => setDestDir(e.target.value)}
                />
              </div>
              <div className="field-group">
                <label className="field-label">Event Time Gap (hours)</label>
                <select className="input" value={timeGap} onChange={e => setTimeGap(e.target.value)}>
                  {[4, 8, 12, 24, 48, 72].map(h => (
                    <option key={h} value={h}>{h}h gap between events</option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label className="field-label">Sort Mode</label>
                <select className="input" value={mode} onChange={e => setMode(e.target.value)}>
                  <option value="copy">Copy (keep originals)</option>
                  <option value="move">Move (relocate files)</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-4" style={{ flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-lg" onClick={handleScan} disabled={scanning || !sourceDir.trim()}>
                {scanning ? <><Spinner size={16} /> Scanning…</> : <><ScanLine size={16} /> Scan Photos</>}
              </button>
              {hasScan && (
                <>
                  <button className="btn btn-ghost" onClick={handleScan} disabled={scanning}>
                    <RefreshCw size={14} /> Re-scan
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={handleGenerateNames}
                    disabled={naming || !clusters.length}
                    title={!apiKey ? 'Set Gemini API key in Settings' : ''}
                  >
                    {naming ? <><Spinner size={14} /> Naming…</> : <><Sparkles size={14} /> AI Name Events</>}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* ─ Stats Row ─ */}
          {hasScan && (
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon accent"><Image size={16} /></div>
                <div className="stat-value">{fmt(scanData.total_scanned)}</div>
                <div className="stat-label">Photos Found</div>
              </div>
              <div className="stat-card">
                <div className="stat-icon teal"><FolderOpen size={16} /></div>
                <div className="stat-value">{fmt(clusters.length)}</div>
                <div className="stat-label">Events</div>
              </div>
              <div className="stat-card">
                <div className="stat-icon amber"><Copy size={16} /></div>
                <div className="stat-value">{fmt(scanData.duplicates?.length)}</div>
                <div className="stat-label">Dup Groups</div>
              </div>
              <div className="stat-card">
                <div className="stat-icon rose"><AlertTriangle size={16} /></div>
                <div className="stat-value">{fmt(scanData.blurry?.length)}</div>
                <div className="stat-label">Blurry</div>
              </div>
              <div className="stat-card">
                <div className="stat-icon green"><CheckCircle size={16} /></div>
                <div className="stat-value">{fmt(scanData.total_valid)}</div>
                <div className="stat-label">Valid Photos</div>
              </div>
            </div>
          )}

          {/* ─ Tabs ─ */}
          {hasScan && (
            <>
              <div className="tabs" style={{ overflowX: 'auto' }}>
                {[
                  { id: 'events',     icon: <FolderOpen size={14} />,      label: 'Events',      count: clusters.length },
                  { id: 'duplicates', icon: <Copy size={14} />,            label: 'Duplicates',  count: scanData.duplicates?.length ?? 0 },
                  { id: 'blurry',     icon: <AlertTriangle size={14} />,   label: 'Blurry',      count: scanData.blurry?.length ?? 0 },
                  { id: 'sort',       icon: <Move size={14} />,            label: 'Sort & Execute' },
                  { id: 'travelogue', icon: <BookOpen size={14} />,        label: 'Travel Log' },
                ].map(t => (
                  <button
                    key={t.id}
                    className={`tab-btn ${tab === t.id ? 'active' : ''}`}
                    onClick={() => setTab(t.id)}
                  >
                    {t.icon}
                    {t.label}
                    {t.count !== undefined && (
                      <span className={`tab-count ${tab === t.id ? 'active' : ''}`}>{t.count}</span>
                    )}
                  </button>
                ))}
              </div>

              {/* ── Events Tab ── */}
              {tab === 'events' && (
                <div>
                  {clusters.length === 0 ? (
                    <EmptyState icon={<FolderOpen size={28} />} title="No events detected" desc="Try reducing the time gap or ensure photos have EXIF date data." />
                  ) : (
                    <div className="clusters-grid">
                      {clusters.map((c, i) => (
                        <ClusterCard
                          key={i}
                          cluster={c}
                          idx={i}
                          onChange={(idx, updated) => setClusters(prev => prev.map((x, j) => j === idx ? updated : x))}
                          onPreview={setPreviewPhoto}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Duplicates Tab ── */}
              {tab === 'duplicates' && (
                <div>
                  {!hasDups ? (
                    <EmptyState icon={<Copy size={28} />} title="No duplicates found" desc="All photos appear to be unique." />
                  ) : (
                    <>
                      {/* Toolbar */}
                      <div className="dup-toolbar">
                        <div>
                          <span className="text-sm" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                            {scanData.duplicates.length} duplicate group{scanData.duplicates.length !== 1 ? 's' : ''}
                          </span>
                          <span className="text-sm text-secondary" style={{ marginLeft: 8 }}>
                            · keeping 1 per group removes{' '}
                            <strong style={{ color: 'var(--rose)' }}>
                              {scanData.duplicates.reduce((s, g) => s + g.length - 1, 0)} photos
                            </strong>
                          </span>
                        </div>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={handleDeleteAllDuplicates}
                          disabled={deletingDups}
                        >
                          {deletingDups
                            ? <><Spinner size={13} /> Deleting…</>
                            : <><Trash2 size={13} /> Delete All Duplicates</>}
                        </button>
                      </div>

                      {/* Groups */}
                      <div className="dup-groups-list">
                        {dupPagination.visible.map((group, gi) => (
                          <div key={gi} className="dup-group">
                            {/* Group header */}
                            <div className="dup-group-header">
                              <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Group {gi + 1}</span>
                              <span className="badge badge-amber">{group.length} similar photos</span>
                            </div>

                            {/* Photos row */}
                            <div className="dup-photos-row">
                              {group.map((photo, pi) => (
                                <DupPhotoCard
                                  key={photo.path}
                                  photo={photo}
                                  groupIdx={gi}
                                  onPreview={onPreview}
                                  onDelete={handleDeleteDupPhoto}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>

                      {dupPagination.hasMore && (
                        <div style={{ textAlign: 'center', marginTop: 16 }}>
                          <button className="btn btn-ghost" onClick={dupPagination.loadMore}>
                            Show more ({scanData.duplicates.length - dupPagination.visible.length} remaining)
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Blurry Tab ── */}
              {tab === 'blurry' && (
                <div>
                  {!hasBlurry ? (
                    <EmptyState icon={<Eye size={28} />} title="No blurry photos detected" desc="All photos passed the sharpness threshold." />
                  ) : (
                    <>
                      {/* Toolbar */}
                      <div className="flex items-center justify-between mb-4" style={{ flexWrap: 'wrap', gap: 12 }}>
                        <span className="text-sm text-secondary">
                          {scanData.blurry.length} blurry photo{scanData.blurry.length !== 1 ? 's' : ''} detected
                        </span>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={handleDeleteAllBlurry}
                          disabled={deletingBlurry}
                        >
                          {deletingBlurry ? <><Spinner size={13} /> Deleting…</> : <><Trash2 size={13} /> Delete All Blurry</>}
                        </button>
                      </div>

                      <div className="blurry-grid">
                        {blurryPagination.visible.map((p) => (
                          <BlurryCard
                            key={p.path}
                            photo={p}
                            onPreview={onPreview}
                            onDelete={handleDeleteBlurryPhoto}
                          />
                        ))}
                      </div>

                      {blurryPagination.hasMore && (
                        <div style={{ textAlign: 'center', marginTop: 16 }}>
                          <button className="btn btn-ghost" onClick={blurryPagination.loadMore}>
                            Show more ({scanData.blurry.length - blurryPagination.visible.length} remaining)
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Sort Tab ── */}
              {tab === 'sort' && (
                <div className="flex flex-col gap-4">
                  <div className="card">
                    <div className="section-title mb-4"><Zap size={15} /> Execute Sort</div>

                    <div className="grid-2">
                      <div className="field-group">
                        <label className="field-label">Destination Directory</label>
                        <input
                          className="input input-mono"
                          placeholder="C:\Users\You\Pictures\Sorted"
                          value={destDir}
                          onChange={e => setDestDir(e.target.value)}
                        />
                      </div>
                      <div className="field-group">
                        <label className="field-label">Mode</label>
                        <select className="input" value={mode} onChange={e => setMode(e.target.value)}>
                          <option value="copy">Copy (keep originals)</option>
                          <option value="move">Move (relocate files)</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex gap-3 mt-4" style={{ flexWrap: 'wrap' }}>
                      <button className="btn btn-ghost" onClick={() => handleSort(true)} disabled={sorting || !destDir.trim()}>
                        {sorting ? <Spinner size={14} /> : <Eye size={14} />} Preview (Dry Run)
                      </button>
                      <button
                        className={`btn btn-lg ${mode === 'move' ? 'btn-danger' : 'btn-teal'}`}
                        onClick={() => handleSort(false)}
                        disabled={sorting || !destDir.trim()}
                      >
                        {sorting
                          ? <><Spinner size={16} /> Working…</>
                          : <><Play size={16} /> {mode === 'move' ? 'Move' : 'Copy'} {fmt(clusters.reduce((s, c) => s + c.photo_count, 0))} Photos</>}
                      </button>
                    </div>
                  </div>

                  {/* Sort result summary */}
                  {sortResult && (
                    <div className="card card-sm">
                      <div className="flex items-center gap-3 mb-3">
                        {sortResult.errors?.length ? (
                          <AlertTriangle size={16} style={{ color: 'var(--amber)' }} />
                        ) : (
                          <CheckCircle size={16} style={{ color: 'var(--green)' }} />
                        )}
                        <span className="text-sm" style={{ fontWeight: 600 }}>
                          {sortResult.dry_run ? 'Dry-run preview' : 'Sort complete'} — {sortResult.operations} operations
                          {sortResult.errors?.length > 0 && `, ${sortResult.errors.length} errors`}
                        </span>
                      </div>
                      {sortResult.dry_run && sortResult.preview?.length > 0 && (
                        <div className="console-wrap" style={{ maxHeight: 180 }}>
                          {sortResult.preview.slice(0, 40).map((op, i) => (
                            <div key={i} className="log-line">
                              <span style={{ color: 'var(--text-muted)' }}>{op.mode === 'move' ? '→' : '⎘'}</span>{' '}
                              <span style={{ color: 'var(--teal)' }}>{op.src.split(/[/\\]/).pop()}</span>
                              {' → '}
                              <span style={{ color: 'var(--text-secondary)' }}>{op.dst.split(/[/\\]/).slice(-3).join('/')}</span>
                            </div>
                          ))}
                          {sortResult.preview.length > 40 && (
                            <div className="log-line text-muted">… and {sortResult.preview.length - 40} more</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Console */}
                  {logLines.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>Console</span>
                        <button className="btn btn-ghost btn-sm" onClick={clearLog}>Clear</button>
                      </div>
                      <div className="console-wrap">
                        {logLines.map((l, i) => (
                          <div key={i} className={`log-line ${l.type}`}>
                            <span style={{ opacity: 0.4, marginRight: 8 }}>{l.ts}</span>{l.msg}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Travel Log Tab ── */}
              {tab === 'travelogue' && (
                <div className="flex flex-col gap-4">
                  <div className="card">
                    <div className="section-title mb-2"><BookOpen size={15} /> AI Travel Log</div>
                    <p className="text-sm text-secondary" style={{ marginBottom: 16 }}>
                      Gemini will write a narrative travel journal based on your sorted events, saved as <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-light)' }}>travel_log.md</code> in your destination folder.
                    </p>
                    <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-primary"
                        onClick={handleTravelogue}
                        disabled={generating || !clusters.length}
                      >
                        {generating
                          ? <><Spinner size={14} /> Writing…</>
                          : <><Sparkles size={14} /> Generate Travel Log</>}
                      </button>
                      {travelogue && (
                        <button className="btn btn-ghost" onClick={() => setShowTravelogue(v => !v)}>
                          <FileText size={14} /> {showTravelogue ? 'Hide' : 'Show'} Preview
                        </button>
                      )}
                    </div>
                  </div>

                  {showTravelogue && travelogue && (
                    <MarkdownView text={travelogue} />
                  )}
                </div>
              )}
            </>
          )}

          {/* ─ Initial empty state ─ */}
          {!hasScan && !scanning && (
            <EmptyState
              icon={<Camera size={32} />}
              title="Ready to sort your photos"
              desc="Enter a source directory above and hit Scan Photos to get started."
            />
          )}

          {/* ─ Console always visible during/after scan ─ */}
          {(scanning || (logLines.length > 0 && tab !== 'sort')) && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>Console</span>
                <button className="btn btn-ghost btn-sm" onClick={clearLog}>Clear</button>
              </div>
              <div className="console-wrap">
                {scanning && (
                  <div className="log-line info flex items-center gap-2">
                    <Spinner size={12} /> Scanning directory…
                  </div>
                )}
                {logLines.map((l, i) => (
                  <div key={i} className={`log-line ${l.type}`}>
                    <span style={{ opacity: 0.4, marginRight: 8 }}>{l.ts}</span>{l.msg}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </main>

      {/* ── Settings Modal ── */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title"><Settings size={16} style={{ display: 'inline', marginRight: 8 }} />Settings</div>

            <div className="flex flex-col gap-4">
              <div className="field-group">
                <label className="field-label">Gemini API Key</label>
                <div className="flex gap-2">
                  <input
                    className="input input-mono flex-1"
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="AIza…"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                  />
                  <button className="btn btn-ghost btn-icon" onClick={() => setShowApiKey(v => !v)} title={showApiKey ? 'Hide' : 'Show'}>
                    <Eye size={14} />
                  </button>
                </div>
                <div className="text-xs text-muted mt-2">
                  Required for AI Event Naming and Travel Log. Get yours at <span style={{ color: 'var(--accent-light)' }}>aistudio.google.com</span>.
                  The key is only stored in memory and never sent anywhere except the Gemini API.
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowSettings(false)}>Close</button>
              <button className="btn btn-primary" onClick={() => { localStorage.setItem('smartsort_gemini_key', apiKey); setShowSettings(false); }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Image Preview Modal ── */}
      {previewPhoto && (
        <PreviewModal photo={previewPhoto} onClose={() => setPreviewPhoto(null)} />
      )}

      {/* ── Confirm Modal ── */}
      {confirmModal}
    </div>
  );
}
