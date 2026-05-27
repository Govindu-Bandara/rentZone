import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { propertyAPI } from '../../services/api';
import OwnerLayout from '../../components/common/OwnerLayout';
import { Eye, Heart, Calendar, DollarSign, Edit, Trash2, Search, Filter, ChevronDown, Plus } from 'lucide-react';
import toast from 'react-hot-toast';

export default function CreatedListings() {
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768
  );
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [overallStats, setOverallStats] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0 });
  
  // Filters
  const [filters, setFilters] = useState({
    search: '',
    verificationStatus: '',
    propertyType: '',
    rentalType: '',
    sortBy: 'updated',
  });
  
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    loadListings();
  }, [filters, pagination.page]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const loadListings = async () => {
    setLoading(true);
    try {
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        ...(filters.search && { search: filters.search }),
        ...(filters.verificationStatus && { verificationStatus: filters.verificationStatus }),
        ...(filters.propertyType && { propertyType: filters.propertyType }),
        ...(filters.rentalType && { rentalType: filters.rentalType }),
        sortBy: filters.sortBy,
      };

      const response = await propertyAPI.getOwnerListings(params);
      
      setListings(response.data.listings || []);
      setOverallStats(response.data.overallStats || null);
      setPagination(response.data.pagination || pagination);
    } catch (error) {
      console.error('Error loading listings:', error);
      toast.error('Failed to load listings');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (listingId, title) => {
    if (!window.confirm(`Are you sure you want to delete "${title}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await propertyAPI.deleteProperty(listingId);
      toast.success('Listing deleted successfully');
      loadListings();
    } catch (error) {
      console.error('Error deleting listing:', error);
      toast.error(error?.response?.data?.message || 'Failed to delete listing');
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, page: 1 })); // Reset to first page
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      verificationStatus: '',
      propertyType: '',
      rentalType: '',
      sortBy: 'updated',
    });
  };

  const getVerificationBadge = (listing) => {
    if (listing.isVerified) {
      return (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 10px',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 500,
          background: '#D1FAE5',
          color: '#065F46',
        }}>
          <span>✓</span> Verified
        </span>
      );
    } else if (listing.verificationStatus === 'pending') {
      return (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 10px',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 500,
          background: '#FEF3C7',
          color: '#92400E',
        }}>
          <span>⏱</span> Pending
        </span>
      );
    } else if (listing.verificationStatus === 'rejected') {
      return (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 10px',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 500,
          background: '#FEE2E2',
          color: '#991B1B',
        }}>
          <span>✗</span> Rejected
        </span>
      );
    }
    return null;
  };

  const getListingImageSrc = (listing) => {
    return listing.mainImage?.url || listing.mainImage || listing.images?.[0]?.url || 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=400';
  };

  return (
    <OwnerLayout>
      {/* Header */}
      <div
        className="dashboard-header"
        style={{ marginBottom: 20 }}
      >
        <div>
          <h1 className="dashboard-title">My Listings</h1>
          <p className="dashboard-subtitle">Manage your property listings</p>
        </div>
      </div>

      {/* Top Row */}
      {overallStats && (
        <div className="stats-grid" style={{ marginBottom: 28 }}>
          <Link
            to="/owner/create-listing"
            className="stat-card"
            style={{
              textDecoration: 'none',
              color: '#fff',
              background: 'linear-gradient(135deg, #2563EB 0%, #14B8A6 100%)',
            }}
          >
            <div
              className="stat-icon"
              style={{
                background: 'rgba(255,255,255,0.2)',
                borderRadius: 8,
                padding: 10,
              }}
            >
              <Plus size={22} style={{ color: '#fff' }} />
            </div>
            <div className="stat-content">
              <div className="stat-value" style={{ color: '#fff' }}>+</div>
              <div className="stat-label" style={{ color: '#fff' }}>Add New Listing</div>
            </div>
          </Link>

          <div className="stat-card">
            <div className="stat-icon blue">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            </div>
            <div className="stat-content">
              <div className="stat-value">{overallStats.totalProperties}</div>
              <div className="stat-label">Total Properties</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
            <div className="stat-content">
              <div className="stat-value">{overallStats.verifiedProperties}</div>
              <div className="stat-label">Verified</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon amber">
              <Eye size={20} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{overallStats.totalViews?.toLocaleString() || 0}</div>
              <div className="stat-label">Total Views</div>
            </div>
          </div>
        </div>
      )}

      {/* Search & Filters */}
      <div className="card" style={{ marginBottom: 24, padding: 20 }}>
        <div style={{
          display: 'flex',
          gap: 12,
          marginBottom: showFilters ? 16 : 0,
          flexWrap: 'wrap',
          flexDirection: isMobile ? 'column' : 'row'
        }}>
          {/* Search */}
          <div style={{
            flex: 1,
            minWidth: isMobile ? '100%' : 250,
            position: 'relative',
          }}>
            <Search size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
            <input
              type="text"
              placeholder="Search by title..."
              value={filters.search}
              onChange={e => handleFilterChange('search', e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px 10px 40px',
                border: '1px solid #E2E8F0',
                borderRadius: 8,
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>

          {/* Sort */}
          <select
            value={filters.sortBy}
            onChange={e => handleFilterChange('sortBy', e.target.value)}
            style={{
              padding: '10px 32px 10px 12px',
              border: '1px solid #E2E8F0',
              borderRadius: 8,
              fontSize: 14,
              outline: 'none',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            <option value="updated">Recently Updated</option>
            <option value="createdAt">Newest First</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
            <option value="views">Most Viewed</option>
            <option value="verification">Verification Status</option>
          </select>

          {/* Filter Toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 16px',
              background: showFilters ? 'var(--primary)' : '#F1F5F9',
              color: showFilters ? '#fff' : '#64748B',
              border: 'none',
            }}
          >
            <Filter size={16} />
            Filters
            <ChevronDown size={14} style={{ transform: showFilters ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>
        </div>

        {/* Advanced Filters */}
        {showFilters && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            paddingTop: 16,
            borderTop: '1px solid #E2E8F0'
          }}>
            <select
              value={filters.verificationStatus}
              onChange={e => handleFilterChange('verificationStatus', e.target.value)}
              style={{
                padding: '10px 12px',
                border: '1px solid #E2E8F0',
                borderRadius: 8,
                fontSize: 14,
                outline: 'none',
                background: '#fff',
              }}
            >
              <option value="">All Verification Status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>

            <select
              value={filters.propertyType}
              onChange={e => handleFilterChange('propertyType', e.target.value)}
              style={{
                padding: '10px 12px',
                border: '1px solid #E2E8F0',
                borderRadius: 8,
                fontSize: 14,
                outline: 'none',
                background: '#fff',
              }}
            >
              <option value="">All Property Types</option>
              <option value="Apartment">Apartment</option>
              <option value="House">House</option>
              <option value="Boarding Place">Boarding Place</option>
              <option value="Short-Stay Rental">Short-Stay Rental</option>
            </select>

            <select
              value={filters.rentalType}
              onChange={e => handleFilterChange('rentalType', e.target.value)}
              style={{
                padding: '10px 12px',
                border: '1px solid #E2E8F0',
                borderRadius: 8,
                fontSize: 14,
                outline: 'none',
                background: '#fff',
              }}
            >
              <option value="">All Rental Types</option>
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
            </select>

            <button
              onClick={clearFilters}
              style={{
                padding: '10px 12px',
                border: '1px solid #E2E8F0',
                borderRadius: 8,
                fontSize: 14,
                background: '#fff',
                color: '#64748B',
                cursor: 'pointer',
              }}
            >
              Clear Filters
            </button>
          </div>
        )}
      </div>

      {/* Listings */}
      {loading ? (
        <div className="card" style={{ padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Loading listings...</div>
        </div>
      ) : listings.length === 0 ? (
        <div className="card" style={{ padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🏠</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>
            No listings found
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>
            {Object.values(filters).some(v => v) ? 'Try adjusting your filters' : 'Create your first property listing'}
          </div>
          {!Object.values(filters).some(v => v) && (
            <Link to="/owner/create-listing" className="btn btn-primary">
              + Add New Listing
            </Link>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 20, marginBottom: 24 }}>
            {listings.map(listing => (
              <div key={listing._id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr' : '240px 1fr auto',
                  gap: 0,
                }}>
                  {/* Image */}
                  <div style={{
                    position: 'relative',
                    background: '#F1F5F9',
                    height: isMobile ? '200px' : 'auto'
                  }}>
                    <img
                      src={getListingImageSrc(listing)}
                      alt={listing.title}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    {getVerificationBadge(listing) && (
                      <div style={{ position: 'absolute', top: 12, left: 12 }}>
                        {getVerificationBadge(listing)}
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div style={{ padding: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div>
                        <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                          {listing.title}
                        </h3>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                          {listing.location?.city}, {listing.location?.district}
                        </div>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {listing.propertyType}
                          </span>
                          <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#CBD5E1' }} />
                          <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--primary)' }}>
                            LKR {listing.price?.amount?.toLocaleString()}
                            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)' }}>
                              /{listing.rentalType === 'daily' ? 'day' : 'mo'}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Stats */}
                    <div style={{ display: 'flex', gap: 20, marginTop: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Eye size={16} color="#64748B" />
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                          {listing.views || 0} views
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Heart size={16} color="#64748B" />
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                          {listing.favorites || 0} saves
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Calendar size={16} color="#64748B" />
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                          {listing.bookingStats?.confirmedBookings || 0} bookings
                        </span>
                      </div>
                      {listing.bookingStats?.totalRevenue > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <DollarSign size={16} color="#14B8A6" />
                          <span style={{ fontSize: 13, color: '#14B8A6', fontWeight: 500 }}>
                            LKR {listing.bookingStats.totalRevenue.toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{
                    padding: 20,
                    borderLeft: isMobile ? 'none' : '1px solid #E2E8F0',
                    borderTop: isMobile ? '1px solid #E2E8F0' : 'none',
                    display: 'flex',
                    flexDirection: isMobile ? 'row' : 'column',
                    gap: 10,
                    justifyContent: isMobile ? 'flex-start' : 'center'
                  }}>
                    <button
                      onClick={() => navigate(`/owner/properties/${listing._id}/edit`, { state: { listing } })}
                      className="btn"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 20px',
                        background: '#F1F5F9',
                        color: '#475569',
                        border: 'none',
                        fontSize: 14,
                        flex: isMobile ? '1 1 auto' : 'auto'
                      }}
                    >
                      <Edit size={16} />
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(listing._id, listing.title)}
                      className="btn"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 20px',
                        background: '#FEE2E2',
                        color: '#991B1B',
                        border: 'none',
                        fontSize: 14,
                        flex: isMobile ? '1 1 auto' : 'auto'
                      }}
                    >
                      <Trash2 size={16} />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12 }}>
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                disabled={pagination.page === 1}
                className="btn"
                style={{
                  padding: '8px 16px',
                  background: pagination.page === 1 ? '#F1F5F9' : '#fff',
                  color: pagination.page === 1 ? '#CBD5E1' : 'var(--primary)',
                  border: '1px solid #E2E8F0',
                  cursor: pagination.page === 1 ? 'not-allowed' : 'pointer',
                }}
              >
                Previous
              </button>
              
              <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                Page {pagination.page} of {pagination.totalPages}
              </span>

              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                disabled={pagination.page === pagination.totalPages}
                className="btn"
                style={{
                  padding: '8px 16px',
                  background: pagination.page === pagination.totalPages ? '#F1F5F9' : '#fff',
                  color: pagination.page === pagination.totalPages ? '#CBD5E1' : 'var(--primary)',
                  border: '1px solid #E2E8F0',
                  cursor: pagination.page === pagination.totalPages ? 'not-allowed' : 'pointer',
                }}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </OwnerLayout>
  );
}
