// pages/admin/AdminSystemLogs.jsx
import { useState, useEffect } from 'react';
import { adminAPI } from '../../services/api';
import AdminLayout from '../../components/common/AdminLayout';
import { Activity, Search, Info, AlertCircle, AlertTriangle, Lock } from 'lucide-react';

export default function AdminSystemLogs() {
  const [logs,             setLogs           ] = useState([]);
  const [loading,          setLoading        ] = useState(true);
  const [page,             setPage           ] = useState(1);
  const [total,            setTotal          ] = useState(0);
  const [search,           setSearch         ] = useState('');
  const [levelFilter,      setLevelFilter    ] = useState('All Levels');
  const [categoryFilter,   setCategoryFilter ] = useState('All Categories');
  const [timeRangeFilter,  setTimeRangeFilter] = useState('Last 24 hours');
  const [statistics,       setStatistics     ] = useState(null);
  const [selectedLog,      setSelectedLog    ] = useState(null);
  const [lockedAlerts,     setLockedAlerts   ] = useState([]);

  const limit = 25;

  useEffect(() => { loadLogs(); }, [page, search, levelFilter, categoryFilter, timeRangeFilter]);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const params = {
        page, limit,
        ...(search && { search }),
        ...(levelFilter !== 'All Levels' && { level: levelFilter }),
        ...(categoryFilter !== 'All Categories' && { category: categoryFilter }),
        ...(timeRangeFilter && { timeRange: timeRangeFilter }),
      };

      const res = await adminAPI.getSystemLogs(params);
      const allLogs = res.data?.logs || [];
      setLogs(allLogs);
      setStatistics(res.data?.statistics || null);
      setTotal(res.data?.pagination?.total || 0);

      // Pull out lockout-related logs for the alert banner
      const lockoutLogs = allLogs.filter(l =>
        l.message?.toLowerCase().includes('locked') ||
        l.message?.toLowerCase().includes('too many') ||
        l.message?.toLowerCase().includes('failed login') ||
        l.message?.toLowerCase().includes('failed attempt') ||
        (l.category === 'Authentication' && l.level === 'WARNING')
      );
      setLockedAlerts(lockoutLogs.slice(0, 5));

    } catch (err) {
      console.error('Failed to load logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const getLevelIcon = (level) => {
    switch (level) {
      case 'INFO':    return <Info        size={14} style={{ color: '#2563EB' }} />;
      case 'WARNING': return <AlertTriangle size={14} style={{ color: '#F59E0B' }} />;
      case 'ERROR':   return <AlertCircle  size={14} style={{ color: '#EF4444' }} />;
      default:        return <Activity     size={14} />;
    }
  };

  const getLevelBadge = (level) => {
    const configs = {
      INFO:    { bg: '#EFF6FF', color: '#1E40AF', label: 'Info'    },
      WARNING: { bg: '#FEF3C7', color: '#92400E', label: 'Warning' },
      ERROR:   { bg: '#FEE2E2', color: '#991B1B', label: 'Error'   },
    };
    return configs[level] || configs.INFO;
  };

  const getCategoryColor = (category) => {
    const colors = {
      Authentication: '#4CAF50', Listing: '#2196F3', Payment: '#FF9800',
      User: '#9C27B0', Security: '#F44336', Admin: '#607D8B', Database: '#795548',
    };
    return colors[category] || '#607D8B';
  };

  // Determine if a log is lockout-related for visual highlighting
  const isLockoutLog = (log) =>
    log.message?.toLowerCase().includes('locked') ||
    log.message?.toLowerCase().includes('too many') ||
    log.message?.toLowerCase().includes('failed login') ||
    log.message?.toLowerCase().includes('failed attempt') ||
    (log.category === 'Authentication' && log.level === 'WARNING' && log.message?.toLowerCase().includes('attempt'));

  const totalPages = Math.ceil(total / limit);

  if (loading && logs.length === 0) {
    return (
      <AdminLayout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-teal mx-auto mb-4" />
            <p style={{ color: 'var(--text-secondary)' }}>Loading system logs…</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      {/* ── Header ── */}
      <div className="dashboard-header">
        <h1 className="dashboard-title">System Activity Logs</h1>
        <p className="dashboard-subtitle">Monitor platform activities and audit trails</p>
      </div>

      {/* ── Lockout Alert Banner ── */}
      {lockedAlerts.length > 0 && (
        <div style={{
          background: '#FEF3C7', border: '1px solid #FDE68A',
          borderRadius: 12, padding: '16px 20px', marginBottom: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Lock size={18} style={{ color: '#D97706', flexShrink: 0 }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#92400E' }}>
              Account Lockout Events Detected
            </span>
            <span style={{ background: '#F59E0B', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>
              {lockedAlerts.length}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lockedAlerts.map((log, i) => (
              <div key={i}
                onClick={() => setSelectedLog(log)}
                style={{
                  background: '#fff', borderRadius: 8, padding: '10px 14px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  cursor: 'pointer', border: '1px solid #FDE68A',
                  transition: 'box-shadow 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
              >
                <div>
                  <p style={{ fontWeight: 600, fontSize: 13, color: '#1E293B', margin: 0 }}>{log.message}</p>
                  <p style={{ fontSize: 11, color: '#94A3B8', margin: '2px 0 0' }}>
                    {log.userEmail || 'Unknown user'} · IP {log.ipAddress} · {log.formattedTimestamp || new Date(log.timestamp).toLocaleString()}
                  </p>
                </div>
                <span style={{ fontSize: 12, color: '#D97706', fontWeight: 500, flexShrink: 0, marginLeft: 12 }}>
                  View →
                </span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: '#92400E', marginTop: 10, marginBottom: 0 }}>
            Go to <strong>User Management</strong> to unlock affected accounts.
          </p>
        </div>
      )}

      {/* ── Statistics ── */}
      {statistics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 28 }}>
          <div className="card" style={{ padding: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#2563EB', marginBottom: 4 }}>{statistics.info || 0}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Info Logs</div>
          </div>
          <div className="card" style={{ padding: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#F59E0B', marginBottom: 4 }}>{statistics.warnings || 0}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Warnings</div>
          </div>
          <div className="card" style={{ padding: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#EF4444', marginBottom: 4 }}>{statistics.errors || 0}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Errors</div>
          </div>
          <div className="card" style={{ padding: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#374151', marginBottom: 4 }}>{statistics.total || 0}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Total Logs</div>
          </div>
          {/* Lockout stat */}
          <div className="card" style={{ padding: 16, textAlign: 'center', background: lockedAlerts.length > 0 ? '#FFFBEB' : undefined, border: lockedAlerts.length > 0 ? '1px solid #FDE68A' : undefined }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#D97706', marginBottom: 4 }}>{lockedAlerts.length}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Lockout Events</div>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="card" style={{ marginBottom: 28, padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Search Logs</label>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input type="text" placeholder="Message, email, IP..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                style={{ width: '100%', paddingLeft: 36, padding: '8px 12px 8px 36px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, background: '#fff' }} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Level</label>
            <select value={levelFilter} onChange={e => { setLevelFilter(e.target.value); setPage(1); }}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, background: '#fff', cursor: 'pointer' }}>
              <option>All Levels</option>
              <option>INFO</option>
              <option>WARNING</option>
              <option>ERROR</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Category</label>
            <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, background: '#fff', cursor: 'pointer' }}>
              <option>All Categories</option>
              <option>Authentication</option>
              <option>Listing</option>
              <option>Payment</option>
              <option>User</option>
              <option>Security</option>
              <option>Admin</option>
              <option>Database</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Time Range</label>
            <select value={timeRangeFilter} onChange={e => { setTimeRangeFilter(e.target.value); setPage(1); }}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, background: '#fff', cursor: 'pointer' }}>
              <option>Last 1 hour</option>
              <option>Last 6 hours</option>
              <option>Last 12 hours</option>
              <option>Last 24 hours</option>
              <option>Last 7 days</option>
              <option>Last 14 days</option>
              <option>Last 30 days</option>
            </select>
          </div>

          {/* Quick filter for lockout events */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Quick Filter</label>
            <button
              onClick={() => {
                setCategoryFilter('Authentication');
                setLevelFilter('WARNING');
                setPage(1);
              }}
              style={{
                width: '100%', padding: '8px 12px', border: '1px solid #FDE68A',
                borderRadius: 8, fontSize: 13, background: '#FFFBEB', color: '#92400E',
                cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <Lock size={13} /> Show Lockout Events
            </button>
          </div>
        </div>
      </div>

      {/* ── Logs Table ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                {['Time', 'Level', 'Category', 'Message', 'User', 'IP Address', 'Actions'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '12px 14px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.length > 0 ? logs.map((log, i) => {
                const levelBadge  = getLevelBadge(log.level);
                const timestamp   = log.formattedTimestamp || new Date(log.timestamp).toLocaleString();
                const highlighted = isLockoutLog(log);

                return (
                  <tr key={log.id || i} style={{
                    borderBottom: '1px solid #F1F5F9',
                    height: 60,
                    background: highlighted ? '#FFFBEB' : 'transparent',
                  }}>
                    <td style={{ padding: 14, fontSize: 13, color: 'var(--text-secondary)' }}>
                      {timestamp}
                    </td>
                    <td style={{ padding: 14 }}>
                      <span style={{
                        background: levelBadge.bg, color: levelBadge.color,
                        padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 4, width: 'fit-content',
                      }}>
                        {getLevelIcon(log.level)} {levelBadge.label}
                      </span>
                    </td>
                    <td style={{ padding: 14 }}>
                      <span style={{
                        background: getCategoryColor(log.category) + '20',
                        color: getCategoryColor(log.category),
                        padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                      }}>
                        {log.category}
                      </span>
                    </td>
                    <td style={{ padding: 14, fontSize: 13, color: 'var(--text-primary)', maxWidth: 300 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {highlighted && <Lock size={12} style={{ color: '#D97706', flexShrink: 0 }} />}
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {log.message}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: 14, fontSize: 13, color: 'var(--text-secondary)' }}>
                      {log.userEmail || '—'}
                    </td>
                    <td style={{ padding: 14, fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                      {log.ipAddress}
                    </td>
                    <td style={{ padding: 14 }}>
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="btn btn-sm"
                        style={{ background: '#EFF6FF', color: '#2563EB', fontSize: 11, padding: '4px 10px', border: 'none', cursor: 'pointer' }}
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={7} style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <Activity style={{ margin: '0 auto 12px', color: 'var(--text-muted)' }} size={42} />
                    <p>No logs found</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ padding: 16, borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Page {page} of {totalPages} ({total} total logs)
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn btn-sm" style={{ border: '1px solid #E2E8F0' }}>Previous</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn btn-sm" style={{ border: '1px solid #E2E8F0' }}>Next</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Log Detail Modal ── */}
      {selectedLog && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(2, 6, 23, 0.55)', backdropFilter: 'blur(4px)',
          display: 'grid', placeItems: 'center', zIndex: 1300, padding: 16,
        }}>
          <div style={{
            background: '#fff', borderRadius: 16, width: 'min(500px, 96vw)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.25)', overflow: 'hidden', maxHeight: '90vh', overflowY: 'auto',
          }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', margin: 0 }}>Log Details</h2>
                {isLockoutLog(selectedLog) && (
                  <span style={{ background: '#FEF3C7', color: '#92400E', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Lock size={10} /> Lockout Event
                  </span>
                )}
              </div>
              <button onClick={() => setSelectedLog(null)} style={{ background: 'none', border: 'none', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'grid', placeItems: 'center', color: '#64748B' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div style={{ padding: 24 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Level</label>
                  <span style={{ background: getLevelBadge(selectedLog.level).bg, color: getLevelBadge(selectedLog.level).color, padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, display: 'inline-block' }}>
                    {selectedLog.level}
                  </span>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Category</label>
                  <span style={{ background: getCategoryColor(selectedLog.category) + '20', color: getCategoryColor(selectedLog.category), padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, display: 'inline-block' }}>
                    {selectedLog.category}
                  </span>
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Message</label>
                <div style={{ background: '#F8FAFC', padding: 12, borderRadius: 8, fontSize: 13, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                  {selectedLog.message}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Timestamp</label>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                    {selectedLog.timestamp ? new Date(selectedLog.timestamp).toLocaleString() : 'N/A'}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>User Email</label>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{selectedLog.userEmail || '—'}</div>
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>IP Address</label>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', fontFamily: 'monospace', background: '#F8FAFC', padding: 10, borderRadius: 6 }}>
                  {selectedLog.ipAddress}
                </div>
              </div>

              {isLockoutLog(selectedLog) && (
                <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '12px 14px', marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <Lock size={14} style={{ color: '#D97706' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#92400E' }}>Account Lockout Event</span>
                  </div>
                  <p style={{ fontSize: 12, color: '#92400E', margin: 0, lineHeight: 1.6 }}>
                    This log entry indicates failed login attempts or an account lockout.
                    Navigate to <strong>User Management</strong> and search for this user's email to unlock their account.
                  </p>
                </div>
              )}

              {selectedLog.details && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Additional Details</label>
                  <pre style={{ background: '#F8FAFC', padding: 12, borderRadius: 8, fontSize: 12, color: 'var(--text-primary)', overflow: 'auto', margin: 0 }}>
                    {JSON.stringify(selectedLog.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div style={{ padding: '16px 24px', borderTop: '1px solid #E2E8F0' }}>
              <button onClick={() => setSelectedLog(null)} style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid #E2E8F0', background: '#F8FAFC', color: '#475569', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}