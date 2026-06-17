// pages/admin/AdminFraudMonitoring.jsx
import { useState, useEffect } from 'react';
import { adminAPI } from '../../services/api';
import AdminLayout from '../../components/common/AdminLayout';
import { AlertTriangle, Shield, CheckCircle, Search, Lock, Unlock } from 'lucide-react';

export default function AdminFraudMonitoring() {
  const [flaggedAccounts,  setFlaggedAccounts ] = useState([]);
  const [lockedAccounts,   setLockedAccounts  ] = useState([]);
  const [statistics,       setStatistics      ] = useState(null);
  const [loading,          setLoading         ] = useState(true);
  const [lockedLoading,    setLockedLoading   ] = useState(true);
  const [page,             setPage            ] = useState(1);
  const [total,            setTotal           ] = useState(0);
  const [search,           setSearch          ] = useState('');
  const [riskFilter,       setRiskFilter      ] = useState('');
  const [userTypeFilter,   setUserTypeFilter  ] = useState('All Types');
  const [actionBusyId,     setActionBusyId    ] = useState('');
  const [selectedAccount,  setSelectedAccount ] = useState(null);
  const [actionModal,      setActionModal     ] = useState(null);
  const [actionResolution, setActionResolution] = useState('');
  const [activeTab,        setActiveTab       ] = useState('flagged'); // 'flagged' | 'locked'
  const [unlockToast,      setUnlockToast     ] = useState('');

  const limit = 20;

  useEffect(() => { loadFraudData();  }, [page, search, riskFilter, userTypeFilter]);
  useEffect(() => { loadLockedUsers(); }, []);

  const loadFraudData = async () => {
    try {
      setLoading(true);
      const params = {
        page, limit,
        ...(search && { search }),
        ...(riskFilter && { riskLevel: riskFilter }),
        ...(userTypeFilter !== 'All Types' && { userType: userTypeFilter }),
      };
      const res = await adminAPI.getFraudMonitoring(params);
      setFlaggedAccounts(res.data?.flaggedAccounts || []);
      setStatistics(res.data?.statistics || null);
      setTotal(res.data?.pagination?.total || 0);
    } catch (err) {
      console.error('Failed to load fraud data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadLockedUsers = async () => {
    try {
      setLockedLoading(true);
      const res = await adminAPI.getUsers({ locked: 'true', limit: 50 });
      const users = (res.data?.users || []).filter(u => u.isLocked);
      setLockedAccounts(users);
    } catch (err) {
      console.error('Failed to load locked users:', err);
    } finally {
      setLockedLoading(false);
    }
  };

  const handleFraudAction = async (account, action, resolution) => {
    setActionBusyId(account._id);
    try {
      await adminAPI.resolveFraudCase(account._id, { action, resolution, userId: account._id });
      setFlaggedAccounts(prev => prev.filter(a => a._id !== account._id));
      setActionModal(null);
      setActionResolution('');
    } catch (err) {
      console.error(`Failed to ${action} fraud case:`, err);
    } finally {
      setActionBusyId('');
    }
  };

  const handleUnlockAccount = async (user) => {
    setActionBusyId(user._id);
    try {
      await adminAPI.updateUser(user._id, { action: 'reset_lockout' });
      setLockedAccounts(prev => prev.filter(u => u._id !== user._id));
      setUnlockToast(`Account unlocked for ${user.firstName} ${user.lastName}`);
      setTimeout(() => setUnlockToast(''), 3000);
    } catch (err) {
      console.error('Failed to unlock account:', err);
    } finally {
      setActionBusyId('');
    }
  };

  const getRiskBadge = (score) => {
    if (score >= 70) return { bg: '#FEE2E2', color: '#991B1B', label: '🔴 High Risk',   icon: AlertTriangle };
    if (score >= 40) return { bg: '#FEF3C7', color: '#92400E', label: '🟡 Medium Risk', icon: AlertTriangle };
    return               { bg: '#ECFDF5', color: '#065F46', label: '🟢 Low Risk',    icon: Shield };
  };

  const getLockoutMinutesLeft = (user) => {
    if (!user.lockExpiresAt) return null;
    return Math.max(0, Math.ceil((new Date(user.lockExpiresAt) - new Date()) / 60000));
  };

  const totalPages = Math.ceil(total / limit);

  if (loading && flaggedAccounts.length === 0) {
    return (
      <AdminLayout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-teal mx-auto mb-4" />
            <p style={{ color: 'var(--text-secondary)' }}>Loading fraud monitoring data…</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      {/* ── Toast ── */}
      {unlockToast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 2000,
          background: '#065F46', color: '#fff', padding: '12px 20px',
          borderRadius: 10, fontSize: 14, fontWeight: 500,
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          animation: 'fadeIn 0.2s ease',
        }}>
          ✓ {unlockToast}
        </div>
      )}

      {/* ── Header ── */}
      <div className="dashboard-header">
        <h1 className="dashboard-title">Fraud Monitoring & Detection</h1>
        <p className="dashboard-subtitle">Monitor suspicious accounts, fraud flags, and login lockouts</p>
      </div>

      {/* ── Statistics ── */}
      {statistics && (
        <div className="stats-grid" style={{ marginBottom: 28, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: '#FEE2E2', borderRadius: 8, padding: 10 }}>
              <AlertTriangle size={22} style={{ color: '#991B1B' }} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{statistics.highRisk || 0}</div>
              <div className="stat-label">High Risk Accounts</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon" style={{ background: '#FEF3C7', borderRadius: 8, padding: 10 }}>
              <AlertTriangle size={22} style={{ color: '#92400E' }} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{statistics.mediumRisk || 0}</div>
              <div className="stat-label">Medium Risk Accounts</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon" style={{ background: '#ECFDF5', borderRadius: 8, padding: 10 }}>
              <Shield size={22} style={{ color: '#065F46' }} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{statistics.totalFlagged || 0}</div>
              <div className="stat-label">Total Flagged</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon" style={{ background: '#EFF6FF', borderRadius: 8, padding: 10 }}>
              <CheckCircle size={22} style={{ color: '#2563EB' }} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{statistics.resolvedToday || 0}</div>
              <div className="stat-label">Resolved Today</div>
            </div>
          </div>

          {/* Locked accounts stat */}
          <div className="stat-card" style={{ background: lockedAccounts.length > 0 ? '#FFFBEB' : undefined, border: lockedAccounts.length > 0 ? '1px solid #FDE68A' : undefined }}>
            <div className="stat-icon" style={{ background: '#FEF3C7', borderRadius: 8, padding: 10 }}>
              <Lock size={22} style={{ color: '#D97706' }} />
            </div>
            <div className="stat-content">
              <div className="stat-value" style={{ color: lockedAccounts.length > 0 ? '#D97706' : undefined }}>
                {lockedLoading ? '…' : lockedAccounts.length}
              </div>
              <div className="stat-label">Locked Accounts</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Locked accounts alert ── */}
      {lockedAccounts.length > 0 && (
        <div style={{
          background: '#FEF3C7', border: '1px solid #FDE68A',
          borderRadius: 12, padding: '16px 20px', marginBottom: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Lock size={18} style={{ color: '#D97706' }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#92400E' }}>
              {lockedAccounts.length} Account{lockedAccounts.length !== 1 ? 's' : ''} Currently Locked
            </span>
          </div>
          <p style={{ fontSize: 13, color: '#92400E', margin: '0 0 12px' }}>
            These accounts have been automatically locked after 5 failed login attempts.
            Switch to the <strong>Locked Accounts</strong> tab below to review and unlock them.
          </p>
          <button
            onClick={() => setActiveTab('locked')}
            style={{
              background: '#D97706', color: '#fff', border: 'none',
              borderRadius: 8, padding: '8px 16px', fontSize: 13,
              fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Lock size={13} /> View Locked Accounts
          </button>
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid #E2E8F0' }}>
        {[
          { key: 'flagged', label: 'Flagged Accounts', count: statistics?.totalFlagged || 0 },
          { key: 'locked',  label: 'Locked Accounts',  count: lockedAccounts.length },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 20px', background: 'none', border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #2563EB' : '2px solid transparent',
              marginBottom: -2, cursor: 'pointer',
              fontSize: 14, fontWeight: activeTab === tab.key ? 700 : 500,
              color: activeTab === tab.key ? '#2563EB' : 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', gap: 8,
              transition: 'color 0.15s',
            }}
          >
            {tab.label}
            {tab.count > 0 && (
              <span style={{
                background: tab.key === 'locked' ? '#F59E0B' : '#EF4444',
                color: '#fff', fontSize: 11, fontWeight: 700,
                padding: '1px 7px', borderRadius: 20,
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── FLAGGED ACCOUNTS TAB ── */}
      {activeTab === 'flagged' && (
        <>
          {/* Filters */}
          <div className="card" style={{ marginBottom: 28, padding: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Search Accounts</label>
                <div style={{ position: 'relative' }}>
                  <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input type="text" placeholder="Name, email..." value={search}
                    onChange={e => { setSearch(e.target.value); setPage(1); }}
                    style={{ width: '100%', paddingLeft: 36, padding: '8px 12px 8px 36px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, background: '#fff' }} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Risk Level</label>
                <select value={riskFilter} onChange={e => { setRiskFilter(e.target.value); setPage(1); }}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, background: '#fff', cursor: 'pointer' }}>
                  <option value="">All Risk Levels</option>
                  <option value="high">High Risk Only</option>
                  <option value="medium">Medium Risk Only</option>
                  <option value="low">Low Risk Only</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>User Type</label>
                <select value={userTypeFilter} onChange={e => { setUserTypeFilter(e.target.value); setPage(1); }}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, background: '#fff', cursor: 'pointer' }}>
                  <option>All Types</option>
                  <option>renter</option>
                  <option>owner</option>
                </select>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                    {['Account', 'Risk Score', 'Flagged Reason', 'Type', 'Login Security', 'Flagged Date', 'Actions'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '12px 14px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {flaggedAccounts.length > 0 ? flaggedAccounts.map((account, i) => {
                    const riskBadge   = getRiskBadge(account.riskScore);
                    const flaggedDate = new Date(account.flaggedAt).toLocaleDateString('en-LK', { month: 'short', day: 'numeric', year: 'numeric' });
                    const lockInfo    = account.isLocked ? getLockoutMinutesLeft(account) : null;

                    return (
                      <tr key={account._id || i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: 14 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{
                              width: 36, height: 36, borderRadius: '50%',
                              background: 'linear-gradient(135deg,#14B8A6,#2563EB)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: '#fff', fontWeight: 600, flexShrink: 0,
                            }}>
                              {account.firstName?.charAt(0) || 'U'}
                            </div>
                            <div>
                              <div style={{ fontWeight: 500, fontSize: 14 }}>{account.firstName} {account.lastName}</div>
                              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{account.email}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: 14 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 700, fontSize: 14, color: riskBadge.color }}>{account.riskScore}</span>
                            <div style={{ height: 24, width: 48, background: '#E2E8F0', borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${Math.min(account.riskScore, 100)}%`, background: account.riskScore >= 70 ? '#EF4444' : account.riskScore >= 40 ? '#F59E0B' : '#22C55E' }} />
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: 14, fontSize: 13, color: 'var(--text-secondary)' }}>
                          {account.fraudDetails?.reasons?.[0] || 'Suspected fraud'}
                        </td>
                        <td style={{ padding: 14 }}>
                          <span style={{
                            background: account.role === 'owner' ? '#F0FDFA' : '#EFF6FF',
                            color: account.role === 'owner' ? '#0F766E' : '#1E40AF',
                            padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                          }}>
                            {account.role}
                          </span>
                        </td>

                        {/* Login Security column — NEW */}
                        <td style={{ padding: 14 }}>
                          {account.isLocked ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <span style={{ background: '#FEF3C7', color: '#92400E', padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, width: 'fit-content' }}>
                                🔒 Locked
                              </span>
                              {lockInfo !== null && (
                                <span style={{ fontSize: 11, color: '#B45309' }}>{lockInfo}m remaining</span>
                              )}
                            </div>
                          ) : account.loginAttempts > 0 ? (
                            <span style={{ background: '#FFF7ED', color: '#C2410C', padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                              ⚠ {account.loginAttempts}/5 attempts
                            </span>
                          ) : (
                            <span style={{ color: '#A1A1AA', fontSize: 12 }}>—</span>
                          )}
                        </td>

                        <td style={{ padding: 14, color: 'var(--text-secondary)', fontSize: 13 }}>{flaggedDate}</td>
                        <td style={{ padding: 14 }}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button onClick={() => { setSelectedAccount(account); setActionModal('investigate'); }}
                              className="btn btn-sm" style={{ background: '#EFF6FF', color: '#2563EB', fontSize: 11, padding: '4px 10px', border: 'none' }}>
                              Investigate
                            </button>
                            <button onClick={() => { setSelectedAccount(account); setActionModal('resolve'); }}
                              disabled={actionBusyId === account._id}
                              className="btn btn-sm" style={{ background: '#ECFDF5', color: '#065F46', fontSize: 11, padding: '4px 10px', border: 'none' }}>
                              Resolve
                            </button>
                            {account.isLocked && (
                              <button
                                onClick={() => handleUnlockAccount(account)}
                                disabled={actionBusyId === account._id}
                                className="btn btn-sm"
                                style={{ background: '#FEF3C7', color: '#92400E', fontSize: 11, padding: '4px 10px', border: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                              >
                                <Unlock size={10} />
                                {actionBusyId === account._id ? 'Unlocking…' : 'Unlock'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td colSpan={7} style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        <Shield style={{ margin: '0 auto 12px', color: 'var(--text-muted)' }} size={42} />
                        <p>No flagged accounts found</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div style={{ padding: 16, borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Page {page} of {totalPages}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn btn-sm" style={{ border: '1px solid #E2E8F0' }}>Previous</button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn btn-sm" style={{ border: '1px solid #E2E8F0' }}>Next</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── LOCKED ACCOUNTS TAB ── */}
      {activeTab === 'locked' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {lockedLoading ? (
            <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading locked accounts…
            </div>
          ) : lockedAccounts.length === 0 ? (
            <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <Unlock style={{ margin: '0 auto 12px', color: 'var(--text-muted)' }} size={42} />
              <p style={{ fontWeight: 600, marginBottom: 4 }}>No locked accounts</p>
              <p style={{ fontSize: 13 }}>All accounts are accessible. No failed login lockouts detected.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ padding: '14px 18px', background: '#FFFBEB', borderBottom: '1px solid #FDE68A', fontSize: 13, color: '#92400E' }}>
                <strong>{lockedAccounts.length}</strong> account{lockedAccounts.length !== 1 ? 's' : ''} locked after 5 consecutive failed login attempts.
                Accounts auto-unlock after 30 minutes, or you can unlock them manually below.
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                    {['Account', 'Role', 'Failed Attempts', 'Last Failed Login', 'Time Remaining', 'Actions'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '12px 14px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lockedAccounts.map((user, i) => {
                    const minutesLeft = getLockoutMinutesLeft(user);
                    const lastFailed  = user.lastFailedLogin
                      ? new Date(user.lastFailedLogin).toLocaleString('en-LK', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : '—';

                    return (
                      <tr key={user._id || i} style={{ borderBottom: '1px solid #F1F5F9', background: '#FFFBEB' }}>
                        <td style={{ padding: 14 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{
                              width: 36, height: 36, borderRadius: '50%',
                              background: 'linear-gradient(135deg,#F59E0B,#EF4444)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: '#fff', fontWeight: 600, flexShrink: 0,
                            }}>
                              {user.firstName?.charAt(0) || 'U'}
                            </div>
                            <div>
                              <div style={{ fontWeight: 500, fontSize: 14 }}>{user.firstName} {user.lastName}</div>
                              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{user.email}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: 14 }}>
                          <span style={{
                            background: user.role === 'owner' ? '#F0FDFA' : '#EFF6FF',
                            color: user.role === 'owner' ? '#0F766E' : '#1E40AF',
                            padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                          }}>
                            {user.role}
                          </span>
                        </td>
                        <td style={{ padding: 14 }}>
                          <span style={{ background: '#FEE2E2', color: '#991B1B', padding: '4px 10px', borderRadius: 20, fontSize: 13, fontWeight: 700 }}>
                            {user.loginAttempts || 5} / 5
                          </span>
                        </td>
                        <td style={{ padding: 14, fontSize: 13, color: 'var(--text-secondary)' }}>
                          {lastFailed}
                        </td>
                        <td style={{ padding: 14 }}>
                          {minutesLeft !== null ? (
                            minutesLeft > 0 ? (
                              <span style={{ fontSize: 13, color: '#D97706', fontWeight: 600 }}>
                                🔒 {minutesLeft}m left
                              </span>
                            ) : (
                              <span style={{ fontSize: 13, color: '#22C55E', fontWeight: 600 }}>
                                ✓ Expired
                              </span>
                            )
                          ) : (
                            <span style={{ fontSize: 13, color: '#D97706', fontWeight: 600 }}>🔒 Locked</span>
                          )}
                        </td>
                        <td style={{ padding: 14 }}>
                          <button
                            onClick={() => handleUnlockAccount(user)}
                            disabled={actionBusyId === user._id}
                            className="btn btn-sm"
                            style={{
                              background: actionBusyId === user._id ? '#E2E8F0' : '#2563EB',
                              color: actionBusyId === user._id ? '#94A3B8' : '#fff',
                              fontSize: 12, padding: '6px 14px', border: 'none',
                              cursor: actionBusyId === user._id ? 'not-allowed' : 'pointer',
                              display: 'flex', alignItems: 'center', gap: 5,
                              borderRadius: 8,
                            }}
                          >
                            <Unlock size={12} />
                            {actionBusyId === user._id ? 'Unlocking…' : 'Unlock Account'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Resolution Modal ── */}
      {actionModal === 'resolve' && selectedAccount && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(2, 6, 23, 0.55)', backdropFilter: 'blur(4px)',
          display: 'grid', placeItems: 'center', zIndex: 1300, padding: 16,
        }}>
          <div style={{ background: '#fff', borderRadius: 16, width: 'min(420px, 96vw)', boxShadow: '0 24px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: '#EFF6FF', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Shield size={22} style={{ color: '#2563EB' }} />
              </div>
              <button onClick={() => { setActionModal(null); setActionResolution(''); }} style={{ background: '#F1F5F9', border: 'none', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'grid', placeItems: 'center', color: '#64748B' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div style={{ padding: '14px 24px 0' }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>Resolve Fraud Case</h2>
              <p style={{ fontSize: 14, color: '#64748B', lineHeight: 1.65, margin: 0 }}>
                Account: <strong>{selectedAccount.firstName} {selectedAccount.lastName}</strong>
              </p>
            </div>
            <div style={{ margin: '14px 24px 0' }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Resolution Action</label>
              <select value={actionResolution} onChange={e => setActionResolution(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, background: '#fff', marginBottom: 12 }}>
                <option value="">-- Select Action --</option>
                <option value="dismiss">Dismiss - False Positive</option>
                <option value="warn">Send Warning</option>
                <option value="suspend">Suspend Account</option>
                <option value="require_verification">Require Additional Verification</option>
              </select>
              {actionResolution && (
                <textarea placeholder="Add notes about this resolution…"
                  style={{ width: '100%', padding: '10px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'none', height: 60 }} />
              )}
            </div>
            <div style={{ padding: '16px 24px 20px', display: 'flex', gap: 10 }}>
              <button onClick={() => { setActionModal(null); setActionResolution(''); }}
                style={{ flex: 1, height: 42, borderRadius: 10, border: '1px solid #E2E8F0', background: '#F8FAFC', color: '#475569', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={() => handleFraudAction(selectedAccount, 'resolve', actionResolution)}
                disabled={!actionResolution || actionBusyId === selectedAccount._id}
                style={{
                  flex: 1, height: 42, borderRadius: 10, border: 'none',
                  background: !actionResolution || actionBusyId === selectedAccount._id ? '#BFDBFE' : '#2563EB',
                  color: '#fff', fontSize: 14, fontWeight: 600,
                  cursor: !actionResolution || actionBusyId === selectedAccount._id ? 'not-allowed' : 'pointer',
                }}
              >
                {actionBusyId === selectedAccount._id ? 'Resolving…' : 'Resolve Case'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </AdminLayout>
  );
}