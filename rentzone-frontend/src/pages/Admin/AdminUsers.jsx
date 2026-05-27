import { useState, useEffect } from 'react';
import { adminAPI } from '../../services/api';
import AdminLayout from '../../components/common/AdminLayout';
import AdminUserDetailModal from './AdminUserDetailModal';
import { Users, Search, CheckCircle, Lock, Unlock, AlertCircle } from 'lucide-react';

export default function AdminUsers() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 768
  );
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('All Roles');
  const [statusFilter, setStatusFilter] = useState('All Statuses');
  const [verifiedFilter, setVerifiedFilter] = useState('');
  const [actionBusyId, setActionBusyId] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [detailModal, setDetailModal] = useState(false);
  const [suspendModal, setSuspendModal] = useState(null);
  const [actionReason, setActionReason] = useState('');

  const limit = 20;

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => { loadUsers(); }, [page, search, roleFilter, statusFilter, verifiedFilter]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const params = {
        page, limit,
        ...(search && { search }),
        ...(roleFilter !== 'All Roles' && { role: roleFilter }),
        ...(statusFilter !== 'All Statuses' && { status: statusFilter }),
        ...(verifiedFilter && { verified: verifiedFilter === 'verified' ? 'true' : 'false' })
      };
      const res = await adminAPI.getUsers(params);
      setUsers(res.data?.users || []);
      setTotal(res.data?.pagination?.total || 0);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUserAction = async (user, action, reason = '') => {
    setActionBusyId(user._id);
    try {
      await adminAPI.updateUser(user._id, { action, reason });
      // Refresh the user in the list
      setUsers(prev => prev.map(u => {
        if (u._id !== user._id) return u;
        if (action === 'suspend') return { ...u, isSuspended: true, isActive: false, status: 'Suspended' };
        if (action === 'activate') return { ...u, isSuspended: false, isActive: true, status: 'Active' };
        return u;
      }));
      setSuspendModal(null);
      setActionReason('');
    } catch (err) {
      console.error(`Failed to ${action} user:`, err);
    } finally {
      setActionBusyId('');
    }
  };

  // Called when AdminUserDetailModal performs an action
  const handleModalAction = (userId, action) => {
    setUsers(prev => prev.map(u => {
      if (u._id !== userId) return u;
      if (action === 'suspend') return { ...u, isSuspended: true, isActive: false, status: 'Suspended' };
      if (action === 'activate') return { ...u, isSuspended: false, isActive: true, status: 'Active' };
      if (action === 'verify') return { ...u, isVerified: true };
      if (action === 'verify_identity') return { ...u, isAdminVerified: true };
      return u;
    }));
  };

  const getStatusBadge = (u) => {
    if (u.status === 'Suspended') return { bg: '#FEE2E2', color: '#991B1B', label: 'Suspended' };
    if (u.status === 'Inactive') return { bg: '#F3F4F6', color: '#6B7280', label: 'Inactive' };
    return { bg: '#ECFDF5', color: '#065F46', label: 'Active' };
  };

  const getRoleBadge = (role) => {
    const configs = {
      renter: { bg: '#EFF6FF', color: '#1E40AF', label: 'Renter' },
      owner:  { bg: '#F0FDFA', color: '#0F766E', label: 'Owner' },
      admin:  { bg: '#FEF3C7', color: '#92400E', label: 'Admin' }
    };
    return configs[role] || { bg: '#F3F4F6', color: '#374151', label: 'User' };
  };

  const totalPages = Math.ceil(total / limit);

  if (loading && users.length === 0) {
    return (
      <AdminLayout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <p style={{ color: 'var(--text-secondary)' }}>Loading users…</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="dashboard-header">
        <h1 className="dashboard-title">User Management</h1>
        <p className="dashboard-subtitle">Manage platform users — click a user's avatar to view full details and NIC documents</p>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 28, padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Search</label>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input type="text" placeholder="Name, email..." value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                style={{ width: '100%', paddingLeft: 36, padding: '8px 12px 8px 36px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, background: '#fff' }} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Role</label>
            <select value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setPage(1); }}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, background: '#fff', cursor: 'pointer' }}>
              <option>All Roles</option><option>renter</option><option>owner</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Status</label>
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, background: '#fff', cursor: 'pointer' }}>
              <option>All Statuses</option><option>Active</option><option>Suspended</option><option>Inactive</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Verification</label>
            <select value={verifiedFilter} onChange={e => { setVerifiedFilter(e.target.value); setPage(1); }}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, background: '#fff', cursor: 'pointer' }}>
              <option value="">All Users</option><option value="verified">Verified Only</option><option value="unverified">Unverified Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                {['User', 'Role', 'Email', 'Status', 'NIC / Identity', 'Properties', 'Bookings', 'Joined', 'Actions'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '12px 14px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.length > 0 ? users.map((u, i) => {
                const statusBadge = getStatusBadge(u);
                const roleBadge = getRoleBadge(u.role);
                const joinedDate = new Date(u.createdAt).toLocaleDateString('en-LK', { month: 'short', day: 'numeric', year: 'numeric' });

                return (
                  <tr key={u._id || i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    {/* ── Avatar (clickable) ── */}
                    <td style={{ padding: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          onClick={() => { setSelectedUser(u); setDetailModal(true); }}
                          title="Click to view full profile & NIC documents"
                          style={{
                            width: 38, height: 38, borderRadius: '50%',
                            background: 'linear-gradient(135deg,#14B8A6,#2563EB)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#fff', fontWeight: 600, flexShrink: 0, overflow: 'hidden',
                            cursor: 'pointer',
                            border: '2px solid transparent',
                            transition: 'border-color 0.15s, transform 0.15s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = '#2563EB'; e.currentTarget.style.transform = 'scale(1.08)'; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.transform = 'scale(1)'; }}
                        >
                          {u.profileImage
                            ? <img src={u.profileImage} alt={`${u.firstName}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : u.firstName?.charAt(0) || 'U'
                          }
                        </div>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: 14 }}>{u.firstName} {u.lastName}</div>
                          <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                            {!u.isVerified && <span style={{ fontSize: 10, color: '#F59E0B', fontWeight: 600 }}>⚠ Email</span>}
                            {u.role === 'owner' && !u.isAdminVerified && <span style={{ fontSize: 10, color: '#EF4444', fontWeight: 600 }}>⚠ NIC</span>}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td style={{ padding: 14 }}>
                      <span style={{ background: roleBadge.bg, color: roleBadge.color, padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                        {roleBadge.label}
                      </span>
                    </td>
                    <td style={{ padding: 14, color: 'var(--text-secondary)', fontSize: 14 }}>{u.email}</td>
                    <td style={{ padding: 14 }}>
                      <span style={{ background: statusBadge.bg, color: statusBadge.color, padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                        {statusBadge.label}
                      </span>
                    </td>

                    {/* NIC / Identity column */}
                    <td style={{ padding: 14 }}>
                      {u.role === 'owner' ? (
                        u.isAdminVerified
                          ? <span style={{ background: '#ECFDF5', color: '#065F46', padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>✓ Verified</span>
                          : u.nicDetails?.frontImageUrl
                            ? <span style={{ background: '#FEF3C7', color: '#92400E', padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                                onClick={() => { setSelectedUser(u); setDetailModal(true); }}>
                                📋 Review NIC
                              </span>
                            : <span style={{ background: '#FEE2E2', color: '#991B1B', padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>✗ Missing</span>
                      ) : (
                        <span style={{ color: '#CBD5E1', fontSize: 12 }}>N/A</span>
                      )}
                    </td>

                    <td style={{ padding: 14, fontSize: 14 }}><span style={{ fontWeight: 600 }}>{u.properties || 0}</span></td>
                    <td style={{ padding: 14, fontSize: 14 }}><span style={{ fontWeight: 600 }}>{u.bookings || 0}</span></td>
                    <td style={{ padding: 14, color: 'var(--text-secondary)', fontSize: 13 }}>{joinedDate}</td>

                    <td style={{ padding: 14 }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => { setSelectedUser(u); setSuspendModal(u); }}
                          disabled={u.status === 'Suspended' || actionBusyId === u._id}
                          className="btn btn-sm"
                          style={{ background: '#FEE2E2', color: '#991B1B', fontSize: 11, padding: '4px 10px', opacity: u.status === 'Suspended' ? 0.5 : 1 }}
                        >
                          {u.status === 'Suspended' ? 'Suspended' : 'Suspend'}
                        </button>
                        {u.status === 'Suspended' && (
                          <button onClick={() => handleUserAction(u, 'activate')} disabled={actionBusyId === u._id}
                            className="btn btn-sm" style={{ background: '#ECFDF5', color: '#065F46', fontSize: 11, padding: '4px 10px' }}>
                            Activate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={9} style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <Users style={{ margin: '0 auto 12px', color: 'var(--text-muted)' }} size={42} />
                    <p>No users found</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{ padding: 16, borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 10 : 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Page {page} of {totalPages} ({total} total)</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn btn-sm" style={{ border: '1px solid #E2E8F0' }}>Previous</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn btn-sm" style={{ border: '1px solid #E2E8F0' }}>Next</button>
            </div>
          </div>
        )}
      </div>

      {/* ── User Detail Modal (avatar click) ── */}
      {detailModal && selectedUser && (
        <AdminUserDetailModal
          user={selectedUser}
          onClose={() => { setDetailModal(false); setSelectedUser(null); }}
          onActionComplete={handleModalAction}
        />
      )}

      {/* ── Suspend Confirmation Modal ── */}
      {suspendModal && !detailModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.55)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', zIndex: 1300, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, width: 'min(420px,96vw)', boxShadow: '0 24px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
            <div style={{ padding: isMobile ? '16px 16px 0' : '20px 24px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: '#FEF2F2', display: 'grid', placeItems: 'center' }}>
                <AlertCircle size={22} style={{ color: '#EF4444' }} />
              </div>
              <button onClick={() => { setSuspendModal(null); setActionReason(''); }} style={{ background: '#F1F5F9', border: 'none', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'grid', placeItems: 'center', color: '#64748B' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ padding: isMobile ? '12px 16px 0' : '14px 24px 0' }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>Suspend User?</h2>
              <p style={{ fontSize: 14, color: '#64748B', lineHeight: 1.65 }}>
                Suspend <strong>{suspendModal.firstName} {suspendModal.lastName}</strong>? They won't be able to log in.
              </p>
            </div>
            <div style={{ margin: isMobile ? '12px 16px 0' : '14px 24px 0' }}>
              <textarea placeholder="Reason (optional)" value={actionReason} onChange={e => setActionReason(e.target.value)}
                style={{ width: '100%', padding: 8, border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 13, resize: 'none', height: 60, fontFamily: 'inherit', boxSizing: 'border-box' }} />
            </div>
            <div style={{ padding: isMobile ? '14px 16px 16px' : '16px 24px 20px', display: 'flex', gap: 10, flexDirection: isMobile ? 'column-reverse' : 'row' }}>
              <button onClick={() => { setSuspendModal(null); setActionReason(''); }}
                style={{ flex: 1, height: 42, borderRadius: 10, border: '1px solid #E2E8F0', background: '#F8FAFC', color: '#475569', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={() => handleUserAction(suspendModal, 'suspend', actionReason)} disabled={actionBusyId === suspendModal._id}
                style={{ flex: 1, height: 42, borderRadius: 10, border: 'none', background: '#EF4444', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {actionBusyId === suspendModal._id ? 'Suspending…' : 'Suspend User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}