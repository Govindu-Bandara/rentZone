// pages/admin/AdminDashboard.jsx
// ─────────────────────────────────────────────────────────────
// Uses AdminLayout so it gets sidebar + topbar + footer.
// ─────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { dashboardAPI, adminAPI } from '../../services/api';
import AdminLayout from '../../components/common/AdminLayout';
import AdminListingReviewModal from '../../components/common/AdminListingReviewModal';
import {
  Users, Home, Shield,
  AlertTriangle, CheckCircle, XCircle,
  TrendingUp, Activity, Eye, Clock,
} from 'lucide-react';

export default function AdminDashboard() {
  const { user } = useAuth();

  const [stats,             setStats            ] = useState(null);
  const [verificationQueue, setVerificationQueue ] = useState([]);
  const [fraudAlerts,       setFraudAlerts       ] = useState([]);
  const [recentActivity,    setRecentActivity    ] = useState([]);
  const [loading,           setLoading           ] = useState(true);
  const [actionBusyId,      setActionBusyId      ] = useState(null);
  const [selectedListing,   setSelectedListing   ] = useState(null);
  const [actionModal,       setActionModal       ] = useState(null);
  const [actionReason,      setActionReason      ] = useState('');
  const [selectedBadge,     setSelectedBadge     ] = useState('verified');

  useEffect(() => {
    (async () => {
      try {
        const [statsRes, queueRes] = await Promise.all([
          dashboardAPI.getAdminDashboard(),
          adminAPI.getVerificationQueue(),
        ]);

        const s = statsRes.data.stats || null;
        setStats(s);
        setVerificationQueue(await enrichVerificationQueue(queueRes.data.listings || []));

        // Build fraud alerts from stats payload
        const fm = s?.fraudMonitoring || {};
        setFraudAlerts(
          [
            { label: 'High Risk Users',   count: fm.highRisk   || 0 },
            { label: 'Medium Risk Users', count: fm.mediumRisk || 0 },
            { label: 'Low Risk Users',    count: fm.lowRisk    || 0 },
          ]
            .filter(x => x.count > 0)
            .map(x => ({
              title: x.label,
              description: `${x.count} users flagged as ${x.label.toLowerCase().replace(' users', '')}`,
            }))
        );

        // Load recent activity from admin system logs (most reliable source)
        try {
          const logsResp = await adminAPI.getSystemLogs({ limit: 12, sort: 'desc' });
          const logs = logsResp.data?.logs || logsResp.data || [];
          const mapped = (logs || []).map(l => {
            const ts = l.timestamp || l.createdAt || l.time || l.date || l.loggedAt;
            const msg = l.message || l.event || l.description || JSON.stringify(l.payload || l.meta || {}).slice(0, 140);
            return { description: msg, timestamp: ts };
          }).filter(x => x.timestamp).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
          setRecentActivity(mapped.slice(0, 10));
        } catch (logErr) {
          // Fallback to dashboard recentActivities if logs fetch fails
          const ra = s?.recentActivities || {};
          setRecentActivity(
            [
              ...(ra.users      || []).map(u  => ({ description: `New ${u.role} registered: ${u.firstName} ${u.lastName}`,      timestamp: u.createdAt })),
              ...(ra.properties || []).map(p  => ({ description: `New property listed: ${p.title || 'Property'}`,               timestamp: p.createdAt })),
              ...(ra.bookings   || []).map(b  => ({ description: `New booking created: ${b.propertyTitle || 'Property'}`,        timestamp: b.createdAt })),
            ].filter(x => x.timestamp).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))
          );
        }
      } catch (err) {
        console.error('Admin dashboard error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleApprove = async (id, badgeType = 'verified') => {
    try {
      const sid = id?.toString();
      setActionBusyId(sid);
      await adminAPI.verifyListing(sid, { action: 'verify', badgeType });
      setVerificationQueue(prev => prev.filter(x => x._id?.toString() !== sid));
      setActionModal(null);
      setSelectedListing(null);
      setActionReason('');
    } catch (err) { console.error(err); } finally { setActionBusyId(null); }
  };

  const handleReject = async (id, reason = '') => {
    try {
      const sid = id?.toString();
      setActionBusyId(sid);
      await adminAPI.verifyListing(sid, { action: 'reject', reason: reason || 'Rejected from admin dashboard' });
      setVerificationQueue(prev => prev.filter(x => x._id?.toString() !== sid));
      setActionModal(null);
      setSelectedListing(null);
      setActionReason('');
    } catch (err) { console.error(err); } finally { setActionBusyId(null); }
  };

  const handleView = (id) => {
    const sid = id?.toString();
    const listing = verificationQueue.find((item) => item._id?.toString() === sid);
    if (listing) {
      setSelectedListing(listing);
      setActionModal('view');
    }
  };

  const statCards = [
    { label: 'Total Users',              value: stats?.userStats?.total         || 0,                            icon: Users,   bgColor: '#EFF6FF', sub: '+12% from last month' },
    { label: 'Active Properties',        value: stats?.propertyStats?.active    || 0,                            icon: Home,    bgColor: '#F0FDFA', sub: '+8% from last month'  },
    { label: 'Pending Verifications',    value: stats?.propertyStats?.pending   || 0,                            icon: Shield,  bgColor: '#FFF7ED', sub: 'Requires attention'    },
  ];

  const getOwnerAvatarSrc = (owner) => owner?.profileImage || owner?.avatar || owner?.profilePic || null;
  const getOwnerInitial = (owner) => owner?.name?.charAt(0) || owner?.firstName?.charAt(0) || 'O';

  const enrichOwner = async (owner) => {
    if (!owner) return owner;
    if (owner.profileImage) return owner;
    try {
      const res = await adminAPI.getUsers({ search: owner.email, limit: 20, page: 1 });
      const users = res.data?.users || [];
      const match = users.find((candidate) => candidate._id === owner._id || candidate.email === owner.email) || users[0];
      return match ? { ...owner, ...match } : owner;
    } catch {
      return owner;
    }
  };

  const enrichVerificationQueue = async (items) => Promise.all((items || []).map(async (item) => ({
    ...item,
    owner: item?.owner?._id ? await enrichOwner(item.owner) : item.owner,
  })));

  if (loading) {
    return (
      <AdminLayout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-teal mx-auto mb-4" />
            <p style={{ color: 'var(--text-secondary)' }}>Loading admin dashboard…</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      {/* ── Header ── */}
      <div className="dashboard-header">
        <h1 className="dashboard-title">Admin Dashboard</h1>
        <p className="dashboard-subtitle">Monitor and manage the Rent Zone platform</p>
      </div>

      {/* ── Stats ── */}
      <div className="stats-grid" style={{ marginBottom: 28 }}>
        {statCards.map(s => (
          <div className="stat-card" key={s.label} style={{ padding: 16 }}>
            <div className="stat-icon" style={{ background: s.bgColor, borderRadius: 8, padding: 10 }}>
              <s.icon size={22} style={{ color: '#374151' }} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{s.value}</div>
              <div className="stat-label">{s.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{s.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Fraud Alerts ── */}
      {fraudAlerts.length > 0 && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, padding: '20px 24px', marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <AlertTriangle size={20} style={{ color: '#DC2626' }} />
            <h2 style={{ fontWeight: 700, color: '#7F1D1D', fontSize: 16 }}>Fraud Alerts</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {fraudAlerts.map((a, i) => (
              <div key={i} style={{ background: '#fff', borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{a.title}</p>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{a.description}</p>
                </div>
                <button style={{ fontSize: 13, color: '#DC2626', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer' }}>
                  Investigate →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Verification Queue ── */}
      <div className="card" style={{ marginBottom: 28, padding: 18 }}>
        <div className="section-header" style={{ marginBottom: 20, paddingBottom: 14, borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="section-title">Property Verification Queue</div>
            <span style={{ background: '#FEF3C7', color: '#92400E', padding: '3px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600 }}>
              {verificationQueue.length} Pending
            </span>
          </div>
          <Link to="/admin/verification" className="view-all-btn">View All →</Link>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                {['Property', 'Owner', 'Location', 'Submitted', 'Docs', 'Actions'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {verificationQueue.length > 0 ? verificationQueue.map((item, i) => (
                <tr key={item._id || i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <img src={item.mainImage?.url || item.mainImage || item.images?.[0]?.url || item.images?.[0] || 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=400&auto=format&fit=crop&q=60'} alt={item.title} style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} />
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 14 }}>{item.title || 'Property Title'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          Rs {(item.price?.amount || item.price || 50000).toLocaleString()}/month
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: getOwnerAvatarSrc(item.owner) ? 'transparent' : 'linear-gradient(135deg,#14B8A6,#2563EB)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 600, fontSize: 14, flexShrink: 0, overflow: 'hidden' }}>
                        {getOwnerAvatarSrc(item.owner)
                          ? <img src={getOwnerAvatarSrc(item.owner)} alt={item.owner?.name || 'Owner'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
                          : getOwnerInitial(item.owner)
                        }
                      </div>
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 14 }}>{item.owner?.name || 'Owner'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.owner?.email || '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: 14, fontSize: 14, color: 'var(--text-secondary)' }}>
                    {item.location?.city || 'Colombo'}, {item.location?.district || 'Sri Lanka'}
                  </td>
                  <td style={{ padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontSize: 13 }}>
                      <Clock size={14} />
                      {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'Recently'}
                    </div>
                  </td>
                  <td style={{ padding: 14 }}>
                    <button onClick={() => handleView(item._id)} style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
                      <Eye size={15} /> View
                    </button>
                  </td>
                  <td style={{ padding: 14 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => { setSelectedListing(item); setActionModal('approve'); }} disabled={actionBusyId === item._id?.toString()} className="btn btn-sm" style={{ background: '#22C55E', color: '#fff', fontSize: 12, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <CheckCircle size={13} /> Approve
                      </button>
                      <button onClick={() => { setSelectedListing(item); setActionModal('reject'); }} disabled={actionBusyId === item._id?.toString()} className="btn btn-sm" style={{ background: '#EF4444', color: '#fff', fontSize: 12, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <XCircle size={13} /> Reject
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <Shield style={{ margin: '0 auto 12px', color: 'var(--text-muted)' }} size={42} />
                    <p>No properties pending verification</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <AdminListingReviewModal
        open={!!actionModal && !!selectedListing}
        mode={actionModal || 'view'}
        listing={selectedListing}
        onClose={() => {
          setActionModal(null);
          setSelectedListing(null);
          setActionReason('');
        }}
        onApprove={(listing, badge) => handleApprove(listing._id, badge)}
        onReject={(listing, reason) => handleReject(listing._id, reason)}
        busy={selectedListing ? actionBusyId === selectedListing._id?.toString() : false}
        selectedBadge={selectedBadge}
        onBadgeChange={setSelectedBadge}
        actionReason={actionReason}
        onActionReasonChange={setActionReason}
      />

      {/* ── Activity ── */}
      <div className="card" style={{ padding: 18 }}>
        <div className="section-header" style={{ marginBottom: 20, paddingBottom: 14, borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="section-title">Recent Activity</div>
          <Link to="/admin/activity" className="view-all-btn">View All →</Link>
        </div>

        {recentActivity.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {recentActivity.slice(0, 8).map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, background: '#F8FAFC', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Activity size={14} style={{ color: '#2563EB' }} />
                </div>
                <div>
                  <p style={{ fontSize: 14, color: 'var(--text-primary)' }}>{a.description}</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.timestamp}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)' }}>
            <Activity style={{ margin: '0 auto 12px', color: 'var(--text-muted)' }} size={36} />
            <p>No recent activity</p>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}