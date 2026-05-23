import { useEffect, useMemo, useState } from 'react';
import { propertyAPI } from '../../services/api';
import AdminLayout from '../../components/common/AdminLayout';
import AdminListingReviewModal from '../../components/common/AdminListingReviewModal';
import { Search, Filter, Home, Shield, MapPin, Bath, BedDouble, DollarSign, Eye } from 'lucide-react';

export default function AdminProperties() {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [selectedProperty, setSelectedProperty] = useState(null);

  const limit = 12;

  useEffect(() => {
    loadProperties();
  }, [page, search, statusFilter, typeFilter, sortBy]);

  const loadProperties = async () => {
    try {
      setLoading(true);
      const params = {
        view: 'all',
        // This flag tells the lambda to enrich owner info for admin
        includeOwner: 'true',
        page,
        limit,
        sortBy,
        ...(search && { search }),
        ...(typeFilter && { propertyType: typeFilter }),
      };

      if (statusFilter !== 'all') {
        params.status = statusFilter;
      }

      const res = await propertyAPI.getProperties(params);
      const payload = res.data || {};
      setProperties(payload.houses || payload.properties || []);
      setTotal(payload.pagination?.total || 0);
    } catch (err) {
      console.error('Failed to load admin properties:', err);
    } finally {
      setLoading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const statusCounts = useMemo(() => {
    return properties.reduce((acc, property) => {
      const status = property.status || 'unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
  }, [properties]);

  const getImage = (property) =>
    property.mainImage?.url ||
    property.mainImage ||
    property.images?.[0]?.url ||
    property.images?.[0] ||
    'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&auto=format&fit=crop&q=60';

  /**
   * Resolve owner display name.
   * Priority: structured owner object → flat fields on property.
   */
  const getOwnerName = (property) => {
    const src = property?.owner || property?.ownerDetails || property?.ownerInfo || property?.host || property?.createdBy;

    if (src) {
      if (typeof src === 'string') return src;

      const full = [src.firstName, src.lastName].filter(Boolean).join(' ').trim();
      return full || src.name || src.fullName || src.displayName || src.ownerName || src.email || null;
    }

    return (
      property?.ownerName ||
      property?.ownerFullName ||
      property?.ownerEmail ||
      null
    );
  };

  const getOwnerEmail = (property) => {
    const src = property?.owner || property?.ownerDetails || property?.ownerInfo || property?.host || property?.createdBy;

    if (src && typeof src === 'object') {
      return src.email || null;
    }

    return property?.ownerEmail || null;
  };

  /**
   * Build a normalised listing object that AdminListingReviewModal
   * expects. The modal reads `listing.owner.name` and `listing.owner.email`.
   */
  const normaliseForModal = (property) => {
    const ownerName = getOwnerName(property);
    const ownerEmail = getOwnerEmail(property);

    // If the property already has a well-formed owner object, keep it.
    // Otherwise, synthesise one from the flat fields.
    const owner =
      property.owner && typeof property.owner === 'object' && (property.owner.name || property.owner.email)
        ? property.owner
        : {
            _id: property.ownerId || property.owner?._id,
            name: ownerName || 'Property Owner',
            email: ownerEmail || '—',
            phone: property.owner?.phone || property.ownerPhone || null,
          };

    return { ...property, owner };
  };

  if (loading && properties.length === 0) {
    return (
      <AdminLayout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-teal mx-auto mb-4" />
            <p style={{ color: 'var(--text-secondary)' }}>Loading properties…</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="dashboard-header">
        <h1 className="dashboard-title">Properties</h1>
        <p className="dashboard-subtitle">All properties in the system</p>
      </div>

      {/* ── Stats ── */}
      <div className="stats-grid" style={{ marginBottom: 28 }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#EFF6FF', borderRadius: 8, padding: 10 }}>
            <Home size={22} style={{ color: '#1D4ED8' }} />
          </div>
          <div className="stat-content">
            <div className="stat-value">{total}</div>
            <div className="stat-label">Total Properties</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#ECFDF5', borderRadius: 8, padding: 10 }}>
            <Shield size={22} style={{ color: '#047857' }} />
          </div>
          <div className="stat-content">
            <div className="stat-value">{statusCounts.approved || 0}</div>
            <div className="stat-label">Approved</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#FFF7ED', borderRadius: 8, padding: 10 }}>
            <Filter size={22} style={{ color: '#B45309' }} />
          </div>
          <div className="stat-content">
            <div className="stat-value">{statusCounts.pending || 0}</div>
            <div className="stat-label">Pending</div>
          </div>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="card" style={{ marginBottom: 28, padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
              Search Properties
            </label>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Title, city, district..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                style={{
                  width: '100%', paddingLeft: 36, padding: '8px 12px 8px 36px',
                  border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14,
                  background: '#fff',
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
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, background: '#fff', cursor: 'pointer' }}
            >
              <option value="all">All Statuses</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
              Property Type
            </label>
            <input
              type="text"
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
              placeholder="Apartment, House, Villa..."
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, background: '#fff' }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
              Sort By
            </label>
            <select
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, background: '#fff', cursor: 'pointer' }}
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
              <option value="featured">Featured</option>
              <option value="verified">Verified</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Grid ── */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
          {properties.length > 0 ? properties.map((property, index) => {
            const image = getImage(property);
            const status = property.status || 'unknown';
            const isVerified = !!property.isVerified;
            const ownerName = getOwnerName(property) || 'Property Owner';
            const ownerEmail = getOwnerEmail(property);

            return (
              <div
                key={property._id || index}
                style={{ border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', background: '#fff' }}
              >
                {/* Image + badges */}
                <div style={{ height: 180, position: 'relative', background: '#F8FAFC' }}>
                  <img src={image} alt={property.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ background: isVerified ? '#ECFDF5' : '#FEF3C7', color: isVerified ? '#065F46' : '#92400E', padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                      {isVerified ? 'Verified' : 'Not Verified'}
                    </span>
                    <span style={{ background: '#EFF6FF', color: '#1D4ED8', padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                      {status}
                    </span>
                  </div>
                </div>

                {/* Content */}
                <div style={{ padding: 16 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>
                    {property.title || 'Untitled Property'}
                  </h3>

                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <MapPin size={14} /> {property.location?.city || 'Unknown city'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <DollarSign size={14} /> Rs {(property.price?.amount || property.price || 0).toLocaleString()}/month
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <BedDouble size={14} /> {property.propertyDetails?.bedrooms || 0} beds
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Bath size={14} /> {property.propertyDetails?.bathrooms || 0} baths
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    {/* Owner info */}
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ownerName}
                      </div>
                      {ownerEmail && (
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ownerEmail}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => setSelectedProperty(normaliseForModal(property))}
                      className="btn btn-sm"
                      style={{ background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
                    >
                      <Eye size={14} /> View
                    </button>
                  </div>
                </div>
              </div>
            );
          }) : (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px 20px' }}>
              <Home style={{ margin: '0 auto 12px', color: 'var(--text-muted)' }} size={48} />
              <p style={{ color: 'var(--text-secondary)', marginBottom: 0 }}>No properties found</p>
            </div>
          )}
        </div>

        {/* Pagination */}
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
        open={!!selectedProperty}
        mode="view"
        listing={selectedProperty}
        onClose={() => setSelectedProperty(null)}
      />
    </AdminLayout>
  );
}