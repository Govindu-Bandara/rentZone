// pages/admin/AdminFraudMonitoring.jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { adminAPI } from '../../services/api';
import AdminLayout from '../../components/common/AdminLayout';
import { AlertTriangle, Shield, Activity, CheckCircle, XCircle, Search, Filter, Zap } from 'lucide-react';

export default function AdminFraudMonitoring() {
  const { user } = useAuth();

  const [flaggedAccounts, setFlaggedAccounts] = useState([]);
  const [statistics, setStatistics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [userTypeFilter, setUserTypeFilter] = useState('All Types');
  const [actionBusyId, setActionBusyId] = useState('');
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [actionModal, setActionModal] = useState(null);
  const [actionResolution, setActionResolution] = useState('');

  const limit = 20;

  useEffect(() => {
    loadFraudData();
  }, [page, search, riskFilter, userTypeFilter]);

  const loadFraudData = async () => {
    try {
      setLoading(true);
      const params = {
        page,
        limit,
        ...(search && { search }),
        ...(riskFilter && { riskLevel: riskFilter }),
        ...(userTypeFilter !== 'All Types' && { userType: userTypeFilter })
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

  const getRiskBadge = (score) => {
    if (score >= 70) {
      return { bg: '#FEE2E2', color: '#991B1B', label: '🔴 High Risk', icon: AlertTriangle };
    }
    if (score >= 40) {
      return { bg: '#FEF3C7', color: '#92400E', label: '🟡 Medium Risk', icon: AlertTriangle };
    }
    return { bg: '#ECFDF5', color: '#065F46', label: '🟢 Low Risk', icon: Shield };
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
      {/* ── Header ── */}
      <div className="dashboard-header">
        <h1 className="dashboard-title">Fraud Monitoring & Detection</h1>
        <p className="dashboard-subtitle">Monitor and manage suspicious accounts and activities</p>
      </div>

      {/* ── Statistics Cards ── */}
      {statistics && (
        <div className="stats-grid" style={{ marginBottom: 28, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
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
              <div className="stat-label">Total Flagged Accounts</div>
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
        </div>
      )}

      {/* ── Filters ── */}
      <div className="card" style={{ marginBottom: 28, padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
              Search Accounts
            </label>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Name, email..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                style={{
                  width: '100%', paddingLeft: 36, padding: '8px 12px 8px 36px',
                  border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14,
                  background: '#fff'
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
              Risk Level
            </label>
            <select
              value={riskFilter}
              onChange={(e) => { setRiskFilter(e.target.value); setPage(1); }}
              style={{
                width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8,
                fontSize: 14, background: '#fff', cursor: 'pointer'
              }}
            >
              <option value="">All Risk Levels</option>
              <option value="high">High Risk Only</option>
              <option value="medium">Medium Risk Only</option>
              <option value="low">Low Risk Only</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
              User Type
            </label>
            <select
              value={userTypeFilter}
              onChange={(e) => { setUserTypeFilter(e.target.value); setPage(1); }}
              style={{
                width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8,
                fontSize: 14, background: '#fff', cursor: 'pointer'
              }}
            >
              <option>All Types</option>
              <option>renter</option>
              <option>owner</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Flagged Accounts Table ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                {['Account', 'Risk Score', 'Flagged Reason', 'Type', 'Flagged Date', 'Actions'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '12px 14px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {flaggedAccounts.length > 0 ? flaggedAccounts.map((account, i) => {
                const riskBadge = getRiskBadge(account.riskScore);
                const flaggedDate = new Date(account.flaggedAt).toLocaleDateString('en-LK', { month: 'short', day: 'numeric', year: 'numeric' });

                return (
                  <tr key={account._id || i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#14B8A6,#2563EB)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 600, flexShrink: 0
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
                        <span style={{ fontWeight: 700, fontSize: 14, color: riskBadge.color }}>
                          {account.riskScore}
                        </span>
                        <div style={{ height: 24, width: 48, background: '#E2E8F0', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', width: `${Math.min(account.riskScore, 100)}%`,
                            background: account.riskScore >= 70 ? '#EF4444' : account.riskScore >= 40 ? '#F59E0B' : '#22C55E'
                          }} />
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
                        padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600
                      }}>
                        {account.role}
                      </span>
                    </td>
                    <td style={{ padding: 14, color: 'var(--text-secondary)', fontSize: 13 }}>
                      {flaggedDate}
                    </td>
                    <td style={{ padding: 14 }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => { setSelectedAccount(account); setActionModal('investigate'); }}
                          className="btn btn-sm"
                          style={{ background: '#EFF6FF', color: '#2563EB', fontSize: 11, padding: '4px 10px', border: 'none' }}
                        >
                          Investigate
                        </button>
                        <button
                          onClick={() => { setSelectedAccount(account); setActionModal('resolve'); }}
                          disabled={actionBusyId === account._id}
                          className="btn btn-sm"
                          style={{ background: '#ECFDF5', color: '#065F46', fontSize: 11, padding: '4px 10px', border: 'none' }}
                        >
                          Resolve
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={6} style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <Shield style={{ margin: '0 auto 12px', color: 'var(--text-muted)' }} size={42} />
                    <p>No flagged accounts found</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div style={{ padding: 16, borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Page {page} of {totalPages}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn btn-sm"
                style={{ border: '1px solid #E2E8F0' }}
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn btn-sm"
                style={{ border: '1px solid #E2E8F0' }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Resolution Modal ── */}
      {actionModal === 'resolve' && selectedAccount && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(2, 6, 23, 0.55)', backdropFilter: 'blur(4px)',
          display: 'grid', placeItems: 'center', zIndex: 1300, padding: 16
        }}>
          <div style={{
            background: '#fff', borderRadius: 16, width: 'min(420px, 96vw)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.25)', overflow: 'hidden'
          }}>
            <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12, background: '#EFF6FF',
                display: 'grid', placeItems: 'center', flexShrink: 0
              }}>
                <Shield size={22} style={{ color: '#2563EB' }} />
              </div>
              <button onClick={() => { setActionModal(null); setActionResolution(''); }} style={{
                background: '#F1F5F9', border: 'none', borderRadius: 8, width: 32, height: 32,
                cursor: 'pointer', display: 'grid', placeItems: 'center', color: '#64748B'
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div style={{ padding: '14px 24px 0' }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>
                Resolve Fraud Case
              </h2>
              <p style={{ fontSize: 14, color: '#64748B', lineHeight: 1.65, margin: 0 }}>
                Account: <strong>{selectedAccount.firstName} {selectedAccount.lastName}</strong>
              </p>
            </div>
            <div style={{ margin: '14px 24px 0' }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                Resolution Action
              </label>
              <select
                value={actionResolution}
                onChange={(e) => setActionResolution(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8,
                  fontSize: 14, background: '#fff', marginBottom: 12
                }}
              >
                <option value="">-- Select Action --</option>
                <option value="dismiss">Dismiss - False Positive</option>
                <option value="warn">Send Warning</option>
                <option value="suspend">Suspend Account</option>
                <option value="require_verification">Require Additional Verification</option>
              </select>

              {actionResolution && (
                <textarea
                  placeholder="Add notes about this resolution..."
                  style={{
                    width: '100%', padding: '10px', border: '1px solid #E2E8F0', borderRadius: 6,
                    fontSize: 13, fontFamily: 'inherit', resize: 'none', height: 60
                  }}
                />
              )}
            </div>
            <div style={{ padding: '16px 24px 20px', display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setActionModal(null); setActionResolution(''); }}
                style={{
                  flex: 1, height: 42, borderRadius: 10, border: '1px solid #E2E8F0',
                  background: '#F8FAFC', color: '#475569', fontSize: 14, fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleFraudAction(selectedAccount, 'resolve', actionResolution)}
                disabled={!actionResolution || actionBusyId === selectedAccount._id}
                style={{
                  flex: 1, height: 42, borderRadius: 10, border: 'none',
                  background: !actionResolution || actionBusyId === selectedAccount._id ? '#BFDBFE' : '#2563EB',
                  color: '#fff', fontSize: 14, fontWeight: 600,
                  cursor: !actionResolution || actionBusyId === selectedAccount._id ? 'not-allowed' : 'pointer'
                }}
              >
                {actionBusyId === selectedAccount._id ? 'Resolving…' : 'Resolve Case'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
