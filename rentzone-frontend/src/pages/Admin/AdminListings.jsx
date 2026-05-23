// pages/admin/AdminListings.jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { adminAPI } from '../../services/api';
import AdminLayout from '../../components/common/AdminLayout';
import AdminListingReviewModal from '../../components/common/AdminListingReviewModal';
import { Eye, Shield, CheckCircle, XCircle, AlertCircle, Search, Filter, Star } from 'lucide-react';

export default function AdminListings() {
  const { user } = useAuth();

  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [actionBusyId, setActionBusyId] = useState('');
  const [selectedListing, setSelectedListing] = useState(null);
  const [actionModal, setActionModal] = useState(null);
  const [actionReason, setActionReason] = useState('');
  const [selectedBadge, setSelectedBadge] = useState('verified');

  const limit = 15;

  useEffect(() => {
    loadListings();
  }, [page, search, statusFilter, priorityFilter]);

  const loadListings = async () => {
    try {
      setLoading(true);
      const params = {
        page,
        limit,
        verificationStatus: statusFilter,
        ...(search && { search }),
        ...(priorityFilter && { priority: priorityFilter })
      };

      const res = await adminAPI.getVerificationQueue(params);
      setListings(await enrichListings(res.data?.listings || []));
      setTotal(res.data?.pagination?.total || 0);
    } catch (err) {
      console.error('Failed to load listings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleListingAction = async (listing, action, reason = '', badgeType = '') => {
    setActionBusyId(listing._id);
    try {
      await adminAPI.verifyListing(listing._id, { action, reason, badgeType });
      setListings(prev => prev.filter(l => l._id !== listing._id));
      setActionModal(null);
      setActionReason('');
      setSelectedBadge('verified');
    } catch (err) {
      console.error(`Failed to ${action} listing:`, err);
    } finally {
      setActionBusyId('');
    }
  };

  const getScoreColor = (score) => {
    if (score >= 80) return '#22C55E';
    if (score >= 60) return '#F59E0B';
    return '#EF4444';
  };

  const getPriorityBadge = (priority) => {
    const configs = {
      high: { bg: '#FEE2E2', color: '#991B1B', label: '🔴 High Priority' },
      medium: { bg: '#FEF3C7', color: '#92400E', label: '🟡 Medium' },
      low: { bg: '#ECFDF5', color: '#065F46', label: '🟢 Low' }
    };
    return configs[priority] || configs.medium;
  };

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

  const enrichListings = async (items) => Promise.all((items || []).map(async (item) => ({
    ...item,
    owner: item?.owner?._id ? await enrichOwner(item.owner) : item.owner,
  })));

  const totalPages = Math.ceil(total / limit);

  if (loading && listings.length === 0) {
    return (
      <AdminLayout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-teal mx-auto mb-4" />
            <p style={{ color: 'var(--text-secondary)' }}>Loading listings…</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      {/* ── Header ── */}
      <div className="dashboard-header">
        <h1 className="dashboard-title">Listing Verification Queue</h1>
        <p className="dashboard-subtitle">Review and verify property listings before publication</p>
      </div>

      {/* ── Filters ── */}
      <div className="card" style={{ marginBottom: 28, padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
              Search Listings
            </label>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Title, owner email..."
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
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              style={{
                width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8,
                fontSize: 14, background: '#fff', cursor: 'pointer'
              }}
            >
              <option value="pending">Pending</option>
              <option value="verified">Verified</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
              Priority
            </label>
            <select
              value={priorityFilter}
              onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}
              style={{
                width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8,
                fontSize: 14, background: '#fff', cursor: 'pointer'
              }}
            >
              <option value="">All Priorities</option>
              <option value="high">High Priority</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Listings Grid ── */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
          {listings.length > 0 ? listings.map((listing, i) => {
            const priorityBadge = getPriorityBadge(listing.verificationPriority);
            const daysLive = listing.daysLive || 0;
            const displayImage = listing.mainImage?.url || listing.mainImage || listing.images?.[0]?.url || listing.images?.[0] || 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=400&auto=format&fit=crop&q=60';

            return (
              <div key={listing._id || i} style={{
                border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column'
              }}>
                {/* ── Image ── */}
                <div style={{ position: 'relative', height: 200, background: '#F3F4F6', overflow: 'hidden' }}>
                  <img src={displayImage} alt={listing.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 8 }}>
                    <span style={{
                      background: priorityBadge.bg, color: priorityBadge.color,
                      padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600
                    }}>
                      {priorityBadge.label}
                    </span>
                  </div>
                </div>

                {/* ── Content ── */}
                <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column' }}>
                  {/* Title & Owner */}
                  <div style={{ marginBottom: 12 }}>
                    <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: 'var(--text-primary)' }}>
                      {listing.title}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: '50%', background: getOwnerAvatarSrc(listing.owner) ? 'transparent' : 'linear-gradient(135deg,#14B8A6,#2563EB)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontWeight: 600, fontSize: 11, flexShrink: 0, overflow: 'hidden'
                      }}>
                        {getOwnerAvatarSrc(listing.owner)
                          ? <img src={getOwnerAvatarSrc(listing.owner)} alt={listing.owner?.name || 'Owner'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
                          : getOwnerInitial(listing.owner)
                        }
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{listing.owner?.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{listing.owner?.email}</div>
                      </div>
                    </div>
                  </div>

                  {/* Details */}
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                      <div>📍 {listing.location?.city}</div>
                      <div>💰 Rs {(listing.price?.amount || 0).toLocaleString()}/mo</div>
                      <div>🏠 {listing.propertyDetails?.bedrooms || 0} beds</div>
                      <div>⏱️ {daysLive} days live</div>
                    </div>
                  </div>

                  {/* Verification Score */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Verification Score</span>
                      <span style={{
                        fontSize: 14, fontWeight: 700, color: getScoreColor(listing.verificationScore)
                      }}>
                        {Math.round(listing.verificationScore)}%
                      </span>
                    </div>
                    <div style={{ height: 6, background: '#E2E8F0', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${listing.verificationScore}%`,
                        background: getScoreColor(listing.verificationScore),
                        transition: 'width 0.3s ease'
                      }} />
                    </div>
                  </div>

                  {/* Issues */}
                  {listing.completenessIssues?.length > 0 && (
                    <div style={{ marginBottom: 12, padding: 10, background: '#FEF3C7', borderRadius: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#92400E', marginBottom: 6 }}>Issues:</div>
                      <ul style={{ fontSize: 12, color: '#92400E', margin: 0, paddingLeft: 16 }}>
                        {listing.completenessIssues.slice(0, 3).map((issue, idx) => (
                          <li key={idx}>{issue}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                    <button
                      onClick={() => { setSelectedListing(listing); setActionModal('view'); }}
                      className="btn btn-sm"
                      style={{
                        flex: 1, background: '#EFF6FF', color: '#2563EB', fontSize: 12, fontWeight: 600,
                        border: '1px solid #BFDBFE'
                      }}
                    >
                      <Eye size={14} style={{ marginRight: 4 }} /> View
                    </button>
                    <button
                      onClick={() => { setSelectedListing(listing); setActionModal('approve'); }}
                      disabled={actionBusyId === listing._id}
                      className="btn btn-sm"
                      style={{
                        flex: 1, background: '#ECFDF5', color: '#065F46', fontSize: 12, fontWeight: 600,
                        border: '1px solid #A7F3D0'
                      }}
                    >
                      <CheckCircle size={14} style={{ marginRight: 4 }} /> Verify
                    </button>
                    <button
                      onClick={() => { setSelectedListing(listing); setActionModal('reject'); }}
                      disabled={actionBusyId === listing._id}
                      className="btn btn-sm"
                      style={{
                        flex: 1, background: '#FEE2E2', color: '#991B1B', fontSize: 12, fontWeight: 600,
                        border: '1px solid #FECACA'
                      }}
                    >
                      <XCircle size={14} style={{ marginRight: 4 }} /> Reject
                    </button>
                  </div>
                </div>
              </div>
            );
          }) : (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px 20px' }}>
              <Shield style={{ margin: '0 auto 12px', color: 'var(--text-muted)' }} size={48} />
              <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>No listings to verify</p>
            </div>
          )}
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Page {page} of {totalPages}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn btn-sm" style={{ border: '1px solid #E2E8F0' }}>
                Previous
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn btn-sm" style={{ border: '1px solid #E2E8F0' }}>
                Next
              </button>
            </div>
          </div>
        )}
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
        onApprove={(listing, badge) => handleListingAction(listing, 'verify', '', badge)}
        onReject={(listing, reason) => handleListingAction(listing, 'reject', reason)}
        busy={selectedListing ? actionBusyId === selectedListing._id : false}
        selectedBadge={selectedBadge}
        onBadgeChange={setSelectedBadge}
        actionReason={actionReason}
        onActionReasonChange={setActionReason}
      />
    </AdminLayout>
  );
}
