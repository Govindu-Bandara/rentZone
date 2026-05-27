import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import RenterLayout from '../../components/common/RenterLayout';
import PropertyModal from '../../components/common/PropertyModal';
import { favoriteAPI } from '../../services/api';

function SavedPropertyCard({ property, onRemove, onOpenModal }) {
  const [removing, setRemoving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 640
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const typeLabel = { apartment: 'Apartment', house: 'House', boarding: 'Boarding Place', shortStay: 'Short-Stay Rental' }[property.propertyType] || property.propertyType;
  const typeColor = { apartment: 'badge-blue', house: 'badge-teal', boarding: 'badge-amber', shortStay: 'badge-gray' }[property.propertyType] || 'badge-blue';
  const priceUnit = property.rentalType === 'short_stay' ? '/day' : '/mo';
  const priceAmount = typeof property.price === 'object' ? property.price?.amount : property.price;

  // Handle image from multiple possible formats
  const getImageSrc = () => {
    if (!property.images) return 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=500&auto=format&fit=crop&q=60';
    const firstImage = property.images[0];
    if (typeof firstImage === 'string') return firstImage;
    if (firstImage?.url) return firstImage.url;
    return 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=500&auto=format&fit=crop&q=60';
  };
  
    // Use mainImage if available, otherwise fallback to getImageSrc
    const displayImageSrc = property.mainImage?.url || property.mainImage || getImageSrc();

  const handleCardClick = (e) => {
    // If confirmation modal is open, prevent any action
    if (showConfirm) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // otherwise, open the property modal if provided
    if (typeof onOpenModal === 'function') {
      e.preventDefault();
      e.stopPropagation();
      onOpenModal(property._id);
    }
  };

  const handleRemoveClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShowConfirm(true);
  };

  const confirmRemove = async () => {
    setRemoving(true);
    try {
      await favoriteAPI.removeFavorite(property._id);
      setShowConfirm(false);
      onRemove(property._id);
    } catch (error) {
      console.error('Error removing favorite:', error);
      setRemoving(false);
      setShowConfirm(false);
    }
  };

  return (
    <>
      <div className="property-card card-hover" style={{ textDecoration: 'none', cursor: 'pointer' }} onClick={handleCardClick}>
        <div className="property-card-image">
          <img
              src={displayImageSrc}
            alt={property.title}
            loading="lazy"
          />
          <div className="property-card-badges">
            <span className={`badge ${typeColor}`}>{typeLabel}</span>
            {property.isVerified && <span className="badge badge-verified">Verified</span>}
          </div>
          <button
            className="property-card-fav active"
            onClick={handleRemoveClick}
            disabled={removing}
            aria-label="Remove from saved"
            title="Remove from saved"
          >
            {removing ? (
              <div className="spinner spinner-sm" style={{ width: 12, height: 12, borderWidth: 2 }} />
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="#EF4444" stroke="#EF4444" strokeWidth="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            )}
          </button>
        </div>
        <div className="property-card-body">
          <div className="property-card-title">{property.title}</div>
          <div className="property-card-location">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
            </svg>
            {property.location?.city}, {property.location?.country || 'Sri Lanka'}
          </div>
          <div className="property-card-meta">
            <span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v6H2M2 12h20" /></svg>
              {property.bedrooms} Beds
            </span>
            <span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12h16a1 1 0 0 1 1 1v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3a1 1 0 0 1 1-1zM6 12V5a2 2 0 0 1 2-2h3v2.25" /></svg>
              {property.bathrooms} Baths
            </span>
          </div>
          <div className="property-card-price">
            LKR {(priceAmount || 0).toLocaleString()}<span>{priceUnit}</span>
          </div>
        </div>
      </div>

      {showConfirm && (
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onMouseUp={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowConfirm(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2,6,23,0.5)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 9999,
            padding: 16,
            pointerEvents: 'auto',
          }}
        >
          <div
            className="card"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            style={{
              width: isMobile ? '100%' : 'min(400px,96vw)',
              maxWidth: '400px',
              padding: isMobile ? '16px' : '24px',
              textAlign: 'center',
              pointerEvents: 'auto',
            }}
          >
            <div
              style={{
                width: '56px',
                height: '56px',
                margin: '0 auto 16px',
                background: '#FEE2E2',
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2">
                <polyline points="3 6 5 4 21 20" />
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </div>
            <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px', color: '#1F2937' }}>
              Remove from Saved?
            </h3>
            <p style={{ fontSize: '14px', color: '#6B7280', marginBottom: '20px' }}>
              Are you sure you want to remove "{property.title}" from your saved properties?
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexDirection: isMobile ? 'column-reverse' : 'row' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowConfirm(false);
                }}
                disabled={removing}
                style={{ flex: 1 }}
              >
                Keep it
              </button>
              <button
                type="button"
                className="btn btn-error"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  confirmRemove();
                }}
                disabled={removing}
                style={{ flex: 1 }}
              >
                {removing ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function SavedProperties() {
  const [properties, setProperties] = useState([]);
  const [modalPropertyId, setModalPropertyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchSaved = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await favoriteAPI.getFavorites();
      // Backend returns { success, message, data: { houses, pagination } }
      const savedProperties = res.data?.data?.houses || res.data?.houses || res.data?.favorites || res.data || [];
      setProperties(Array.isArray(savedProperties) ? savedProperties : []);
    } catch (err) {
      console.error('Error fetching favorites:', err);
      setError('Failed to load saved properties.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSaved(); }, [fetchSaved]);

  const handleRemove = (id) => {
    setProperties(prev => prev.filter(p => p._id !== id));
  };

  return (
    <RenterLayout>
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Saved Properties</h1>
          <p className="page-subtitle">
            {loading ? 'Loading…' : `${properties.length} ${properties.length === 1 ? 'property' : 'properties'} found`}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="loading-spinner"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert-error" style={{ marginTop: 24 }}>{error}</div>
      ) : properties.length === 0 ? (
        <div className="empty-state" style={{ paddingTop: 80 }}>
          <div className="empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </div>
          <div className="empty-title">No saved properties yet</div>
          <div className="empty-desc">Browse listings and tap the heart icon to save properties you love.</div>
          <Link to="/renter/search" className="btn btn-primary btn-sm" style={{ marginTop: 16 }}>
            Browse Properties
          </Link>
        </div>
      ) : (
        <div className="properties-grid" style={{ marginTop: 24 }}>
          {properties.map(p => (
            <SavedPropertyCard key={p._id} property={p} onRemove={handleRemove} onOpenModal={id => setModalPropertyId(id)} />
          ))}
          {modalPropertyId && (
            <PropertyModal propertyId={modalPropertyId} onClose={() => setModalPropertyId(null)} />
          )}
        </div>
      )}
    </RenterLayout>
  );
}