import { CheckCircle, Eye, XCircle, X, Phone } from 'lucide-react';
import LocationMap from './LocationMap';
import AdminUserDetailModal from "../../pages/Admin/AdminUserDetailModal";
import { useState, useEffect } from 'react';
import { adminAPI } from '../../services/api';

function getImage(listing) {
  return (
    listing?.mainImage?.url ||
    listing?.mainImage ||
    listing?.images?.[0]?.url ||
    listing?.images?.[0] ||
    'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1200&auto=format&fit=crop&q=60'
  );
}

function InfoCard({ label, value, highlight = false }) {
  return (
    <div style={{ padding: 14, background: highlight ? '#F0FDFA' : '#F8FAFC', borderRadius: 12, border: '1px solid #E2E8F0' }}>
      <div style={{ fontSize: 12, color: '#64748B', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A', lineHeight: 1.5 }}>{value}</div>
    </div>
  );
}

// Normalise listing.owner into the shape AdminUserDetailModal expects.
// Also merges in any extra fields fetched separately (e.g. profileImage).
function normaliseOwner(owner, extras = {}) {
  if (!owner) return null;
  const rawName = owner.name || `${owner.firstName || ''} ${owner.lastName || ''}`.trim();
  const parts = rawName.split(' ');
  return {
    ...owner,
    ...extras,
    firstName: owner.firstName || parts[0] || '',
    lastName:  owner.lastName  || parts.slice(1).join(' ') || '',
    role:      owner.role      || 'owner',
  };
}

export default function AdminListingReviewModal({
  open,
  mode,
  listing,
  onClose,
  onApprove,
  onReject,
  busy = false,
  selectedBadge = 'verified',
  onBadgeChange,
  actionReason = '',
  onActionReasonChange,
}) {
  const [activeImageIdx, setActiveImageIdx]     = useState(0);
  const [showUserDetailModal, setShowUserDetailModal] = useState(false);
  // Enriched owner data fetched once when the view modal opens
  const [enrichedOwner, setEnrichedOwner]       = useState(null);

  // Fetch full owner details when the modal opens in view mode so we have
  // profileImage and other fields the listing.owner stub is missing.
  useEffect(() => {
    if (!open || mode !== 'view' || !listing?.owner?._id) {
      setEnrichedOwner(null);
      return;
    }
    let cancelled = false;
    adminAPI.getUsers({ search: listing.owner.email, limit: 20, page: 1 })
      .then(res => {
        const users = res.data?.users || [];
        const match = users.find((candidate) => candidate._id === listing.owner._id || candidate.email === listing.owner.email) || users[0];
        if (!cancelled) setEnrichedOwner(match || listing.owner);
      })
      .catch(() => {/* silently fall back to stub */});
    return () => { cancelled = true; };
  }, [open, mode, listing?.owner._id, listing?.owner?.email]);

  if (!open || !listing) return null;

  const images = (listing.images || []).map(i => (typeof i === 'string' ? i : i?.url)).filter(Boolean);
  if (listing.mainImage) images.unshift(typeof listing.mainImage === 'string' ? listing.mainImage : listing.mainImage.url);
  const imageCount = images.length || 1;

  const title    = listing.title || 'Listing Details';
  const location = listing.location?.address
    || [listing.location?.city, listing.location?.district].filter(Boolean).join(', ')
    || 'Unknown location';

  // Use enrichedOwner's profileImage if available, fall back to stub
  const ownerForCard = enrichedOwner || listing.owner;
  const ownerDisplayName =
    ownerForCard?.name ||
    `${ownerForCard?.firstName || ''} ${ownerForCard?.lastName || ''}`.trim() ||
    ownerForCard?.email ||
    '—';
  const ownerProfileImage = ownerForCard?.profileImage || null;

  const price     = `Rs ${(listing.price?.amount || listing.price || 0).toLocaleString()}/month`;
  const bedrooms  = `${listing.propertyDetails?.bedrooms || 0} beds`;
  const bathrooms = `${listing.propertyDetails?.bathrooms || 0} baths`;

  // ── Approve / Reject confirmation ──────────────────────────────────────
  if (mode === 'approve' || mode === 'reject') {
    const isApprove = mode === 'approve';
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.58)', display: 'grid', placeItems: 'center', zIndex: 1300, padding: 16 }}>
        <div style={{ width: 'min(520px, 96vw)', background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,0.2)', padding: 20 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, display: 'grid', placeItems: 'center', background: isApprove ? '#ECFDF5' : '#FEE2E2', color: isApprove ? '#065F46' : '#991B1B' }}>
              {isApprove ? <CheckCircle size={20} /> : <XCircle size={20} />}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0F172A' }}>{isApprove ? 'Approve Listing' : 'Reject Listing'}</h3>
              <p style={{ margin: 0, marginTop: 6, color: '#64748B' }}>
                {isApprove
                  ? `Are you sure you want to approve "${title}"? This will publish the listing.`
                  : `Are you sure you want to reject "${title}"? The owner will be notified.`}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={onClose} style={{ flex: 1, height: 44, borderRadius: 10, border: '1px solid #E2E8F0', background: '#F8FAFC', color: '#475569', fontWeight: 700, cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={() => isApprove ? onApprove?.(listing) : onReject?.(listing)}
              disabled={busy}
              style={{ flex: 1, height: 44, borderRadius: 10, border: 'none', background: isApprove ? (busy ? '#86EFAC' : '#22C55E') : (busy ? '#FCA5A5' : '#EF4444'), color: '#fff', fontWeight: 800, cursor: busy ? 'not-allowed' : 'pointer' }}
            >
              {busy ? (isApprove ? 'Approving…' : 'Rejecting…') : (isApprove ? 'Approve' : 'Reject')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── View mode ───────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', display: 'grid', placeItems: 'center', zIndex: 1400, padding: 20 }}>
      <div style={{ width: 'min(1040px, 96vw)', background: '#fff', borderRadius: 14, overflow: 'hidden', boxShadow: '0 30px 80px rgba(2,6,23,0.35)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #EEF2F7' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999, background: '#EFF6FF', color: '#1D4ED8', fontSize: 12, fontWeight: 700 }}>
              <Eye size={14} /> View
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', margin: '8px 0 0' }}>{title}</h2>
            <div style={{ color: '#64748B', fontSize: 13, marginTop: 6 }}>{location}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 36, height: 36, borderRadius: 10, border: 'none', background: '#F8FAFC', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: 20, padding: 22, maxHeight: 'calc(90vh - 100px)', overflowY: 'auto' }}>
          {/* Left: images + description */}
          <div>
            <div style={{ borderRadius: 12, overflow: 'hidden', background: '#f8fafc' }}>
              <img src={images[activeImageIdx] || getImage(listing)} alt={title} style={{ width: '100%', height: 480, objectFit: 'cover', display: 'block' }} />
            </div>

            {imageCount > 1 && (
              <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
                {images.map((src, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveImageIdx(idx)}
                    style={{
                      border: activeImageIdx === idx ? '2px solid #2563EB' : '1px solid #E6EEF8',
                      borderRadius: 8, overflow: 'hidden', padding: 0,
                      width: 84, height: 64, background: '#fff', cursor: 'pointer',
                      boxShadow: activeImageIdx === idx ? '0 6px 18px rgba(37,99,235,0.12)' : 'none'
                    }}
                  >
                    <img src={src} alt={`thumb-${idx}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </button>
                ))}
              </div>
            )}

            <div style={{ marginTop: 14, background: '#FAFCFF', border: '1px solid #EEF2F7', padding: 14, borderRadius: 10 }}>
              <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Overview</h4>
              <p style={{ marginTop: 8, color: '#475569' }}>{listing.description || 'No description provided.'}</p>
            </div>
          </div>

          {/* Right: owner + map + details */}
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Owner card — click to open AdminUserDetailModal */}
            <div
              onClick={() => listing.owner?._id && setShowUserDetailModal(true)}
              style={{
                padding: 14, borderRadius: 10, border: '1px solid #EEF2F7', background: '#fff',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                cursor: listing.owner?._id ? 'pointer' : 'default', transition: 'all 0.15s'
              }}
              onMouseEnter={e => { if (listing.owner?._id) { e.currentTarget.style.borderColor = '#2563EB'; e.currentTarget.style.background = '#F0F7FF'; } }}
              onMouseLeave={e => { if (listing.owner?._id) { e.currentTarget.style.borderColor = '#EEF2F7'; e.currentTarget.style.background = '#fff'; } }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                {/* Avatar — shows real photo once enrichedOwner loads */}
                <div style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: 'linear-gradient(135deg,#2563EB,#14B8A6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 700, fontSize: 18, flexShrink: 0, overflow: 'hidden'
                }}>
                  {ownerProfileImage
                    ? <img src={ownerProfileImage} alt={ownerDisplayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
                    : (ownerDisplayName?.charAt(0)?.toUpperCase() || 'O')
                  }
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: '#64748B' }}>Owner</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#0F172A' }}>{ownerDisplayName}</div>
                  <div style={{ fontSize: 13, color: '#475569', marginTop: 2 }}>{ownerForCard?.email || '—'}</div>
                </div>
              </div>
              {(ownerForCard?.phone || listing.owner?.phone) && (
                <a
                  href={`tel:${ownerForCard?.phone || listing.owner?.phone}`}
                  onClick={e => e.stopPropagation()}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    background: '#F1F8FF', padding: '10px 14px', borderRadius: 10,
                    color: '#0F172A', textDecoration: 'none', fontWeight: 800,
                    boxShadow: 'inset 0 0 0 1px rgba(37,99,235,0.06)', flexShrink: 0
                  }}
                >
                  <Phone size={16} /> <span style={{ fontSize: 13 }}>{ownerForCard?.phone || listing.owner?.phone}</span>
                </a>
              )}
            </div>

            {/* Map */}
            <div style={{ padding: 12, borderRadius: 10, border: '1px solid #EEF2F7', background: '#fff' }}>
              <div style={{ fontSize: 12, color: '#64748B', marginBottom: 6 }}>Location</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>{location}</div>
              <div style={{ height: 240, borderRadius: 8, overflow: 'hidden' }}>
                <LocationMap
                  city={listing.location?.city}
                  district={listing.location?.district}
                  markerPosition={listing.location?.coordinates}
                  userRole="renter"
                  address={listing.location?.address}
                />
              </div>
            </div>

            {/* Details */}
            <div style={{ padding: 12, borderRadius: 10, border: '1px solid #EEF2F7', background: '#fff' }}>
              <div style={{ fontSize: 12, color: '#64748B', marginBottom: 8 }}>Details</div>
              <InfoCard label="Price" value={price} />
              <div style={{ height: 10 }} />
              <InfoCard label="Beds / Baths" value={`${bedrooms}, ${bathrooms}`} />
            </div>
          </aside>
        </div>
      </div>

      {/* User Detail Modal — pass normalised owner merged with any enriched data
          so profileImage is available immediately without waiting for a second fetch. */}
      {showUserDetailModal && listing.owner?._id && (
        <AdminUserDetailModal
          user={normaliseOwner(listing.owner, enrichedOwner || {})}
          onClose={() => setShowUserDetailModal(false)}
          onActionComplete={() => setShowUserDetailModal(false)}
        />
      )}
    </div>
  );
}