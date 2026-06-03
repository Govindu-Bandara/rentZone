import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { bookingAPI, paymentAPI, propertyAPI } from '../../services/api';
import LocationMap from './LocationMap';
import ReceiptDownloadButton from './ReceiptDownloadButton';
import { useAuth } from '../../context/AuthContext';

/* ─── Stepper ─────────────────────────────────────────────── */
const STEPS = [
  { key: 1, label: 'Property' },
  { key: 2, label: 'Request' },
  { key: 3, label: 'Payment' },
  { key: 4, label: 'Complete' },
];

function Stepper({ activeStep }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 20 }}>
      {STEPS.map((step, idx) => (
        <div key={step.key} style={{ display: 'flex', alignItems: 'center', flex: idx < STEPS.length - 1 ? 1 : 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: step.key <= activeStep ? 'var(--primary, #2563EB)' : '#E2E8F0',
              border: `2px solid ${step.key <= activeStep ? 'var(--primary, #2563EB)' : '#CBD5E1'}`,
              color: step.key <= activeStep ? '#fff' : '#94A3B8',
              display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700,
              transition: 'all 0.3s',
            }}>
              {step.key < activeStep ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
              ) : step.key}
            </div>
            <span style={{ fontSize: 11, color: step.key <= activeStep ? 'var(--primary, #2563EB)' : '#94A3B8', fontWeight: step.key === activeStep ? 600 : 400, whiteSpace: 'nowrap' }}>
              {step.label}
            </span>
          </div>
          {idx < STEPS.length - 1 && (
            <div style={{ flex: 1, height: 2, background: step.key < activeStep ? 'var(--primary, #2563EB)' : '#E2E8F0', margin: '0 6px', marginBottom: 18, transition: 'background 0.3s' }} />
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── InfoRow ─────────────────────────────────────────────── */
function InfoRow({ label, value, bold, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #F1F5F9' }}>
      <span style={{ fontSize: 13, color: '#64748B' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: bold ? 700 : 500, color: color || '#1E293B' }}>{value}</span>
    </div>
  );
}

const AMENITY_LABELS = {
  wifi: 'WiFi',
  parking: 'Parking',
  ac: 'AC',
  airconditioning: 'Air Conditioning',
  heating: 'Heating',
  kitchen: 'Kitchen',
  washerdryer: 'Washer Dryer',
  petfriendly: 'Pet Friendly',
  gym: 'Gym',
  pool: 'Swimming Pool',
  balcony: 'Balcony',
  garden: 'Garden',
  securitysystem: 'Security System',
  laundry: 'Laundry',
  acheating: 'AC/Heating',
};

function formatAmenityLabel(amenity) {
  if (!amenity) return '';
  const normalized = String(amenity).replace(/[_\-/\s]+/g, '').toLowerCase();
  if (AMENITY_LABELS[normalized]) return AMENITY_LABELS[normalized];
  const text = String(amenity)
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/* ─── Helper: is payment fully settled ───────────────────── */
function isPaymentSettled(paymentStatus) {
  return ['paid', 'initial_paid', 'payment_confirmed'].includes(String(paymentStatus || '').toLowerCase());
}

/* ─── Main Modal ──────────────────────────────────────────── */
export default function PropertyModal({ propertyId, onClose, initialBookingId }) {
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 768
  );

  const [property, setProperty]             = useState(null);
  const [loading, setLoading]               = useState(true);
  const [activeStep, setActiveStep]         = useState(1);
  const [showMap, setShowMap]               = useState(false);
  const [currentBooking, setCurrentBooking] = useState(null);
  const [sendingRequest, setSendingRequest] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [orderedImages, setOrderedImages]   = useState([]);
  const { user } = useAuth();

  const [requestForm, setRequestForm] = useState({
    moveInDate: '',
    duration: 1,
    durationType: 'months',
    specialRequests: '',
    renterPhone: '',
  });

  const [paymentForm, setPaymentForm] = useState({
    cardName: '',
    cardNumber: '',
    expiry: '',
    cvc: '',
  });
  const [paymentError, setPaymentError] = useState('');

  /* Load bookings */
  const loadBookings = useCallback(async () => {
    try {
      const res = await bookingAPI.getRenterBookings({ houseId: propertyId, limit: 20 });
      const list = res.data?.bookings || res.data || [];
      if (!Array.isArray(list) || list.length === 0) { setCurrentBooking(null); return; }
      let picked = null;
      if (initialBookingId) picked = list.find(b => String(b._id || b.id) === String(initialBookingId));
      if (!picked) picked = [...list].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
      setCurrentBooking(picked || null);
    } catch { setCurrentBooking(null); }
  }, [propertyId, initialBookingId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await propertyAPI.getProperty(propertyId);
        const houseData = res.data?.house || res.data?.property || res.data;
        const ownerData = res.data?.owner;
        setProperty({ ...houseData, owner: ownerData });
        await loadBookings();
      } catch { toast.error('Failed to load property'); onClose(); }
      finally { setLoading(false); }
    })();
  }, [propertyId, loadBookings, onClose]);

  /* Reorder images to show mainImage first */
  useEffect(() => {
    if (!property) return;
    const images = property.images || [];
    if (property.mainImage && images.length > 0) {
      const mainImageUrl = typeof property.mainImage === 'string' ? property.mainImage : property.mainImage.url;
      const mainImageExists = images.findIndex(img => {
        const imgUrl = typeof img === 'string' ? img : img.url;
        return imgUrl === mainImageUrl;
      });
      if (mainImageExists > 0) {
        const reordered = [images[mainImageExists], ...images.slice(0, mainImageExists), ...images.slice(mainImageExists + 1)];
        setOrderedImages(reordered);
        setActiveImageIdx(0);
      } else if (mainImageExists === 0) {
        setOrderedImages(images);
        setActiveImageIdx(0);
      } else {
        setOrderedImages(images);
      }
    } else {
      setOrderedImages(images);
    }
  }, [property]);

  /* Auto-rotate images every 3 seconds */
  useEffect(() => {
    if (orderedImages.length <= 1) return;
    const interval = setInterval(() => {
      setActiveImageIdx(prev => (prev + 1) % orderedImages.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [orderedImages.length]);

  /* Sync step from booking status — handles payment_confirmed */
  useEffect(() => {
    if (!currentBooking) { setActiveStep(1); return; }
    const s = currentBooking.status;
    const p = currentBooking.paymentStatus;

    // Step 4: any settled payment OR completed booking
    if (isPaymentSettled(p) || s === 'payment_completed' || s === 'completed') {
      setActiveStep(4);
      return;
    }
    // Step 3: confirmed/active but payment not yet made
    if (s === 'confirmed' || s === 'active') { setActiveStep(3); return; }
    // Step 2: pending or rejected
    if (s === 'pending' || s === 'rejected') { setActiveStep(2); return; }
    setActiveStep(1);
  }, [currentBooking]);

  /* Lock body scroll */
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* Derived property details */
  const details = useMemo(() => {
    if (!property) return {};
    const images        = property.images || [];
    const priceAmount   = Number(property?.price?.amount ?? property?.price ?? 0);
    const securityDeposit = Number(property?.price?.securityDeposit ?? 0);
    const city          = property?.location?.city || '';
    const district      = property?.location?.district || '';
    const address       = property?.location?.address || [city, district, 'Sri Lanka'].filter(Boolean).join(', ');
    const bedrooms      = property?.propertyDetails?.bedrooms ?? property?.bedrooms ?? 0;
    const bathrooms     = property?.propertyDetails?.bathrooms ?? property?.bathrooms ?? 0;
    const owner         = property?.owner || {};
    const coords        = property?.location?.coordinates;
    const isDaily       = property?.rentalType === 'daily' || property?.propertyType === 'Short-Stay Rental';

    let centerCoords = null;
    if (coords) {
      if (Array.isArray(coords) && coords.length >= 2) {
        const a = Number(coords[0]);
        const b = Number(coords[1]);
        if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
          centerCoords = [a, b];
        } else {
          centerCoords = [b, a];
        }
      } else if (coords.latitude && coords.longitude) {
        centerCoords = [Number(coords.latitude), Number(coords.longitude)];
      }
    }

    let mapUrl = '';
    if (centerCoords) {
      const [lat, lng] = centerCoords;
      mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.015}%2C${lat - 0.015}%2C${lng + 0.015}%2C${lat + 0.015}&layer=mapnik&marker=${lat}%2C${lng}`;
    }
    if (!mapUrl) mapUrl = `https://maps.google.com/maps?q=${encodeURIComponent(address)}&t=&z=14&ie=UTF8&iwloc=&output=embed`;

    const ownerNameFallback = [owner.firstName, owner.lastName].filter(Boolean).join(' ')
      || owner.name || owner.fullName || property?.ownerName || property?.ownerFullName || property?.ownerInfo?.name || property?.host?.name || 'Property Owner';

    const ownerEmailFallback = owner.email || owner.contactEmail || property?.ownerEmail || property?.ownerInfo?.email || '';
    const ownerPhoneFallback = owner.phone || owner.contactPhone || property?.ownerPhone || property?.ownerInfo?.phone || '';

    return {
      images,
      priceAmount,
      securityDeposit,
      address, city, bedrooms, bathrooms, mapUrl, centerCoords,
      ownerName: ownerNameFallback,
      ownerEmail: ownerEmailFallback,
      ownerPhone: ownerPhoneFallback,
      isDaily,
    };
  }, [property]);

  const calculatePricingDetails = useMemo(() => {
    if (details.isDaily) {
      if (!requestForm.moveInDate || !requestForm.duration) {
        return { rentAmount: 0, days: 0, label: '—', description: '' };
      }
      const moveIn = new Date(requestForm.moveInDate);
      let moveOut = new Date(moveIn);
      const duration = parseInt(requestForm.duration) || 0;
      switch (requestForm.durationType) {
        case 'weeks':
          moveOut.setDate(moveOut.getDate() + (duration * 7));
          break;
        case 'months':
          moveOut.setMonth(moveOut.getMonth() + duration);
          break;
        case 'days':
        default:
          moveOut.setDate(moveOut.getDate() + duration);
          break;
      }
      const days = Math.ceil((moveOut - moveIn) / (1000 * 60 * 60 * 24));
      const rentAmount = details.priceAmount * days;
      return {
        rentAmount,
        days,
        label: `${days} ${days === 1 ? 'Day' : 'Days'} @ LKR ${details.priceAmount.toLocaleString()}/day`,
        description: `${days} night${days !== 1 ? 's' : ''}`,
      };
    } else {
      return {
        rentAmount: details.priceAmount,
        days: 1,
        label: '1st Month Rent',
        description: 'First month',
      };
    }
  }, [details.isDaily, details.priceAmount, requestForm.moveInDate, requestForm.duration, requestForm.durationType]);

  const priceDetails = useMemo(() => {
    if (currentBooking) {
      const rentPart = Number(currentBooking.totalAmount || 0) - Number(details.securityDeposit ?? 0);
      if (details.isDaily && currentBooking.checkInDate && currentBooking.checkOutDate) {
        const checkIn = new Date(currentBooking.checkInDate);
        const checkOut = new Date(currentBooking.checkOutDate);
        const days = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
        return {
          rentAmount: rentPart,
          days,
          label: `${days} ${days === 1 ? 'Day' : 'Days'} @ LKR ${details.priceAmount.toLocaleString()}/day`,
          description: `${days} night${days !== 1 ? 's' : ''}`,
        };
      }
      return {
        rentAmount: Number(details.priceAmount || currentBooking.monthlyRent || 0),
        days: 1,
        label: details.isDaily ? '—' : '1st Month Rent',
        description: 'Rent',
      };
    }
    return calculatePricingDetails;
  }, [currentBooking, details, calculatePricingDetails]);

  const requestDue = useMemo(() => {
    return Number(calculatePricingDetails.rentAmount || 0) + Number(details.securityDeposit || 0);
  }, [calculatePricingDetails.rentAmount, details.securityDeposit]);

  const paymentDue = useMemo(() => {
    if (currentBooking) {
      if (details.isDaily) return Number(currentBooking.totalAmount || 0);
      return Number(priceDetails.rentAmount || 0) + Number(details.securityDeposit || 0);
    }
    return requestDue;
  }, [currentBooking, details.isDaily, priceDetails.rentAmount, details.securityDeposit, requestDue]);

  /* Submit booking request */
  const submitBookingRequest = async () => {
    if (!requestForm.moveInDate || !requestForm.duration) {
      toast.error('Move-in date and duration are required'); return;
    }
    setSendingRequest(true);
    try {
      const res = await bookingAPI.createBookingRequest({
        houseId:         propertyId,
        moveInDate:      requestForm.moveInDate,
        duration:        Number(requestForm.duration),
        durationType:    requestForm.durationType,
        specialRequests: requestForm.specialRequests,
        renterPhone:     requestForm.renterPhone,
      });
      setCurrentBooking(res.data?.booking || null);
      setActiveStep(2);
      toast.success('Booking request sent to owner!');
    } catch (err) {
      toast.error(err?.error || 'Failed to send booking request');
    } finally { setSendingRequest(false); }
  };

  /* Process payment */
  const processPayment = async () => {
    const bookingId = currentBooking?._id || currentBooking?.id;
    if (!bookingId) { toast.error('Booking not found'); return; }
    setPaymentError('');

    if (!paymentForm.cardName || !paymentForm.cardNumber || !paymentForm.expiry || !paymentForm.cvc) {
      setPaymentError('Please fill all payment fields');
      return;
    }
    const cardNumberClean = paymentForm.cardNumber.replace(/\s/g, '');
    if (cardNumberClean.length < 13 || cardNumberClean.length > 19) {
      setPaymentError('Card number must be between 13 and 19 digits');
      return;
    }
    const expiryParts = paymentForm.expiry.split('/');
    if (expiryParts.length !== 2 || expiryParts[0].length !== 2 || expiryParts[1].length !== 2) {
      setPaymentError('Expiry date must be in MM/YY format');
      return;
    }
    if (paymentForm.cvc.length < 3 || paymentForm.cvc.length > 4) {
      setPaymentError('CVC must be 3 or 4 digits');
      return;
    }

    setProcessingPayment(true);
    try {
      const res = await paymentAPI.processPayment(bookingId, {
        paymentMethod: 'card',
        paymentType:   'first_month',
        amount:        paymentDue,
        cardDetails: {
          name:   paymentForm.cardName,
          number: paymentForm.cardNumber,
          expiry: paymentForm.expiry,
          cvc:    paymentForm.cvc,
        },
      });

      const updatedBooking = res?.data?.booking;
      if (updatedBooking) {
        setCurrentBooking((prev) => ({
          ...prev,
          ...updatedBooking,
          status: 'completed',
          paymentStatus: 'paid',
          paidAt: updatedBooking.paidAt || new Date().toISOString(),
        }));
      } else {
        setCurrentBooking((prev) => prev ? {
          ...prev,
          status: 'completed',
          paymentStatus: 'paid',
          paidAt: new Date().toISOString(),
        } : prev);
      }

      setActiveStep(4);
      toast.success('Payment successful!');
    } catch (err) {
      const errorMsg = err?.details || err?.error || 'Payment failed. Please try again.';
      setPaymentError(errorMsg);
      toast.error(errorMsg);
    } finally { setProcessingPayment(false); }
  };

  const formatDate = d => d ? new Date(d).toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  if (loading) {
    return (
      <ModalOverlay onClose={onClose}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <div className="spinner" />
        </div>
      </ModalOverlay>
    );
  }

  if (!property) return null;

  const status      = currentBooking?.status;
  const payStatus   = currentBooking?.paymentStatus || '';
  const paySettled  = isPaymentSettled(payStatus);
  const images      = orderedImages.length > 0 ? orderedImages : (details.images || []);
  const mainImage   = images[activeImageIdx]?.url || images[activeImageIdx] || 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&auto=format&fit=crop&q=60';

  return (
    <ModalOverlay onClose={onClose}>
      {/* Close button */}
      <button onClick={onClose} style={{
        position: 'absolute', top: isMobile ? 8 : 14, right: isMobile ? 8 : 14, zIndex: 10,
        background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%',
        width: 32, height: 32, color: '#fff', cursor: 'pointer',
        display: 'grid', placeItems: 'center', fontSize: 18,
      }}>×</button>

      <div className="property-modal-grid" style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 380px', gap: 0, height: '100%', overflow: 'hidden' }}>

        {/* ── LEFT: Property Info ──────────────────────────────── */}
        <div className="property-modal-main" style={{ overflowY: 'auto', borderRight: '1px solid #E2E8F0' }}>
          {/* Image */}
          <div className="property-modal-hero" style={{ position: 'relative', height: isMobile ? 220 : 260, background: '#0F172A', overflow: 'hidden' }}>
            <img src={mainImage} alt={property.title} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.9 }} />

            {/* Badges */}
            <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 6 }}>
              {property.isVerified && (
                <span style={{ background: '#10B981', color: '#fff', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>
                  ✓ Verified
                </span>
              )}
              <span style={{ background: '#2563EB', color: '#fff', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>
                {property.propertyType}
              </span>
            </div>

            {/* Image thumbnails */}
            {images.length > 1 && (
              <div style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6 }}>
                {images.slice(0, 5).map((_, i) => (
                  <button key={i} onClick={() => setActiveImageIdx(i)} style={{
                    width: i === activeImageIdx ? 20 : 8, height: 8, borderRadius: 4,
                    background: i === activeImageIdx ? '#fff' : 'rgba(255,255,255,0.5)',
                    border: 'none', cursor: 'pointer', transition: 'all 0.2s', padding: 0,
                  }} />
                ))}
              </div>
            )}

            {/* Price overlay */}
            <div style={{ position: 'absolute', bottom: 12, right: 12, background: 'rgba(0,0,0,0.7)', borderRadius: 10, padding: '6px 14px' }}>
              <span style={{ color: '#fff', fontWeight: 800, fontSize: 20 }}>LKR {details.priceAmount.toLocaleString()}</span>
              <span style={{ color: '#94A3B8', fontSize: 12 }}>/month</span>
            </div>
          </div>

          <div style={{ padding: '18px 20px' }}>
            {/* Title */}
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: '#0F172A' }}>{property.title}</h2>
            <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              {details.address}
            </p>

            {/* Stats */}
            <div className="property-modal-stats" style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10, marginBottom: 18 }}>
              {[
                { label: 'Bedrooms',  value: details.bedrooms },
                { label: 'Bathrooms', value: details.bathrooms },
                { label: 'Guests',    value: property.maxOccupancy || 1 },
                { label: 'Verified',  value: property.isVerified ? 'Yes' : 'No' },
              ].map(stat => (
                <div key={stat.label} style={{ background: '#F8FAFC', borderRadius: 10, padding: '10px 8px', textAlign: 'center', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: '#1E293B' }}>{stat.value}</div>
                  <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Description */}
            <div style={{ marginBottom: 18 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: '#1E293B' }}>Description</h3>
              <p style={{ fontSize: 13, color: '#64748B', lineHeight: 1.7 }}>{property.description || 'No description available.'}</p>
            </div>

            {/* Amenities */}
            {property.amenities?.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, color: '#1E293B' }}>Amenities</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {property.amenities.map(a => (
                    <span key={a} style={{ background: '#EFF6FF', color: '#2563EB', fontSize: 12, fontWeight: 500, padding: '4px 12px', borderRadius: 20, border: '1px solid #BFDBFE' }}>
                      {formatAmenityLabel(a)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Map button */}
            <button onClick={() => setShowMap(true)} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#2563EB', color: '#fff',
              border: '1px solid rgba(37,99,235,0.2)', borderRadius: 8, padding: '10px 16px',
              fontSize: 14, fontWeight: 600, cursor: 'pointer', boxShadow: '0 6px 18px rgba(37,99,235,0.12)'
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              View on Map
            </button>

            {/* Owner info */}
            <div className="property-modal-owner" style={{ marginTop: 18, padding: '14px', background: '#F8FAFC', borderRadius: 10, border: '1px solid #E2E8F0' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: '#1E293B' }}>Property Owner</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg,#2563EB,#14B8A6)', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 16, overflow: 'hidden', flexShrink: 0 }}>
                  {property?.owner?.profileImage ? (
                    <img src={property.owner.profileImage} alt={details.ownerName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    details.ownerName?.charAt(0) || 'O'
                  )}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#1E293B' }}>{details.ownerName}</div>
                  {details.ownerPhone && <div style={{ fontSize: 12, color: '#64748B' }}>{details.ownerPhone}</div>}
                </div>
                {user?.role === 'renter' && (
                  <div style={{ marginLeft: 'auto' }}>
                    <button onClick={() => {
                      const ownerId =
                        (property?.owner && (property.owner._id || property.owner.id || property.owner.userId || property.owner)) ||
                        property?.ownerId ||
                        property?.ownerUserId ||
                        null;

                      if (!ownerId) {
                        toast.error('Owner info is missing for this property');
                        return;
                      }
                      if (String(user?._id || '') === String(ownerId)) {
                        toast.error('You cannot message yourself');
                        return;
                      }
                      navigate('/renter/messages', {
                        state: {
                          recipientId: String(ownerId),
                          recipientName: details.ownerName,
                          propertyId,
                          propertyTitle: property?.title,
                        },
                      });
                    }} style={{ marginLeft: isMobile ? 0 : 12, background: '#2563EB', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, width: isMobile ? '100%' : 'auto' }}>
                      Message Owner
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Booking Panel ─────────────────────────────── */}
        <div className="property-modal-booking" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          {/* Header */}
          <div className="property-modal-stepper" style={{ padding: '18px 20px 0', borderBottom: '1px solid #E2E8F0', paddingBottom: 16 }}>
            <Stepper activeStep={activeStep} />
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>

            {/* ── STEP 1: Booking Form ── */}
            {activeStep === 1 && (
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, color: '#1E293B' }}>Request Your Booking</h3>

                <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#0369A1' }}>
                  The property owner needs to accept your request before payment.
                </div>

                <div style={{ display: 'grid', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: '#64748B', fontWeight: 500, display: 'block', marginBottom: 4 }}>Move-in Date *</label>
                    <input type="date" className="form-input" value={requestForm.moveInDate}
                      min={new Date().toISOString().split('T')[0]}
                      onChange={e => setRequestForm(f => ({ ...f, moveInDate: e.target.value }))}
                      style={{ fontSize: 13 }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, color: '#64748B', fontWeight: 500, display: 'block', marginBottom: 4 }}>Lease Duration *</label>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
                      <input type="number" min={1} className="form-input" value={requestForm.duration}
                        onChange={e => setRequestForm(f => ({ ...f, duration: e.target.value }))}
                        style={{ fontSize: 13 }}
                      />
                      <select className="form-input" value={requestForm.durationType}
                        onChange={e => setRequestForm(f => ({ ...f, durationType: e.target.value }))}
                        style={{ fontSize: 13 }}
                      >
                        <option value="days">Days</option>
                        <option value="weeks">Weeks</option>
                        <option value="months">Months</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: 12, color: '#64748B', fontWeight: 500, display: 'block', marginBottom: 4 }}>Phone Number</label>
                    <input type="text" className="form-input" placeholder="07X XXX XXXX"
                      value={requestForm.renterPhone}
                      onChange={e => setRequestForm(f => ({ ...f, renterPhone: e.target.value }))}
                      style={{ fontSize: 13 }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, color: '#64748B', fontWeight: 500, display: 'block', marginBottom: 4 }}>Special Requests</label>
                    <textarea className="form-input" rows={3} placeholder="Any special requirements..."
                      value={requestForm.specialRequests}
                      onChange={e => setRequestForm(f => ({ ...f, specialRequests: e.target.value }))}
                      style={{ fontSize: 13, resize: 'none' }}
                    />
                  </div>
                </div>

                {/* Order Summary */}
                <div style={{ marginTop: 16, background: '#F8FAFC', borderRadius: 10, padding: 14, border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: '#1E293B' }}>Order Summary</div>
                  {details.isDaily ? (
                    <>
                      <InfoRow
                        label={`${priceDetails.description} @ LKR ${details.priceAmount.toLocaleString()}/night`}
                        value={`LKR ${priceDetails.rentAmount.toLocaleString()} Total`}
                        bold
                      />
                      {details.securityDeposit > 0 && (
                        <InfoRow label="Security Deposit" value={`LKR ${details.securityDeposit.toLocaleString()}`} />
                      )}
                      <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 8, paddingTop: 8, borderTop: '1px solid #E2E8F0' }}>
                        📅 Check-in: {requestForm.moveInDate ? new Date(requestForm.moveInDate).toLocaleDateString('en-LK', { day: '2-digit', month: 'short' }) : 'Select date'}
                      </div>
                    </>
                  ) : (
                    <>
                      <InfoRow label="1st Month Rent" value={`LKR ${details.priceAmount.toLocaleString()}`} />
                      <InfoRow label="Security Deposit" value={`LKR ${details.securityDeposit.toLocaleString()}`} />
                      <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                        * First month rent + refundable security deposit
                      </div>
                    </>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', marginTop: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#1E293B' }}>Total Due Today</span>
                    <span style={{ fontSize: 15, fontWeight: 800, color: '#2563EB' }}>
                      LKR {requestDue.toLocaleString()}
                    </span>
                  </div>
                </div>

                <button
                  className="btn btn-primary btn-full"
                  style={{ marginTop: 16, height: 44, fontSize: 14, fontWeight: 600 }}
                  onClick={submitBookingRequest}
                  disabled={sendingRequest}
                >
                  {sendingRequest ? 'Sending Request…' : 'Send Booking Request'}
                </button>
              </div>
            )}

            {/* ── STEP 2: Awaiting Confirmation ── */}
            {activeStep === 2 && (
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, color: '#1E293B' }}>Booking Request Sent</h3>

                <div style={{ textAlign: 'center', padding: '24px 0' }}>
                  <div style={{
                    width: 72, height: 72, borderRadius: '50%', margin: '0 auto 14px',
                    background: status === 'rejected' ? '#FEE2E2' : status === 'confirmed' || status === 'active' ? '#ECFDF5' : '#FFFBEB',
                    display: 'grid', placeItems: 'center',
                  }}>
                    {status === 'rejected' ? (
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    ) : status === 'confirmed' || status === 'active' ? (
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                    ) : (
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    )}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: '#1E293B', marginBottom: 8 }}>
                    {status === 'rejected'
                      ? 'Booking Declined'
                      : status === 'confirmed' || status === 'active'
                      ? 'Booking Request Accepted!'
                      : 'Waiting for Owner Response'}
                  </div>
                  <div style={{ fontSize: 13, color: '#64748B', lineHeight: 1.6, maxWidth: 260, margin: '0 auto' }}>
                    {status === 'rejected'
                      ? 'The owner declined your request. You can submit a new request with different dates.'
                      : status === 'confirmed' || status === 'active'
                      ? 'The property owner has accepted your booking. Please proceed to payment.'
                      : 'Your booking request has been sent. The owner will review and respond shortly.'}
                  </div>
                </div>

                {/* Payment summary — only show when confirmed */}
                {currentBooking && (status === 'confirmed' || status === 'active') && !paySettled && (
                  <div style={{ background: '#F8FAFC', borderRadius: 10, padding: 14, border: '1px solid #E2E8F0', marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: '#1E293B' }}>Payment Details</div>
                    {details.isDaily ? (
                      <>
                        <InfoRow label={`${priceDetails.description} @ LKR ${details.priceAmount.toLocaleString()}/night`} value={`LKR ${priceDetails.rentAmount.toLocaleString()} Total`} bold />
                        {details.securityDeposit > 0 && (
                          <InfoRow label="Security Deposit" value={`LKR ${details.securityDeposit.toLocaleString()}`} />
                        )}
                      </>
                    ) : (
                      <>
                        <InfoRow label="1st Month Rent" value={`LKR ${priceDetails.rentAmount.toLocaleString()}`} />
                        <InfoRow label="Security Deposit" value={`LKR ${details.securityDeposit.toLocaleString()}`} />
                      </>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', marginTop: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#1E293B' }}>Total Due Today</span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: '#2563EB' }}>LKR {paymentDue.toLocaleString()}</span>
                    </div>
                  </div>
                )}

                {/* Proceed to Payment */}
                {(status === 'confirmed' || status === 'active') && !paySettled && (
                  <button
                    className="btn btn-primary btn-full"
                    style={{ height: 44, fontSize: 14, fontWeight: 600 }}
                    onClick={() => setActiveStep(3)}
                  >
                    Proceed to Payment
                  </button>
                )}

                {/* Pending state */}
                {status === 'pending' && (
                  <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#92400E', textAlign: 'center' }}>
                    ⏳ Waiting for the owner to respond…
                  </div>
                )}

                {/* Rejected state */}
                {status === 'rejected' && (
                  <button className="btn btn-primary btn-full" style={{ height: 44, fontSize: 14, marginTop: 8 }} onClick={() => { setCurrentBooking(null); setActiveStep(1); }}>
                    Submit New Request
                  </button>
                )}
              </div>
            )}

            {/* ── STEP 3: Payment ── */}
            {activeStep === 3 && (
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: '#1E293B' }}>Complete Payment</h3>
                <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16 }}>
                  Total Amount: <strong style={{ color: '#2563EB' }}>LKR {paymentDue.toLocaleString()}</strong>
                </p>

                <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#166534' }}>
                  🔒 Your payment is secured and encrypted
                </div>

                {paymentError && (
                  <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 12, color: '#991B1B' }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>❌ Payment Error</div>
                    <div>{paymentError}</div>
                    <div style={{ fontSize: 11, marginTop: 6, color: '#DC2626' }}>Please check your card details and try again.</div>
                  </div>
                )}

                <div style={{ display: 'grid', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, color: '#64748B', fontWeight: 500, display: 'block', marginBottom: 4 }}>Cardholder Name *</label>
                    <input className="form-input" placeholder="Name on card"
                      value={paymentForm.cardName}
                      onChange={e => { setPaymentForm(f => ({ ...f, cardName: e.target.value })); setPaymentError(''); }}
                      style={{ fontSize: 13 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: '#64748B', fontWeight: 500, display: 'block', marginBottom: 4 }}>Card Number *</label>
                    <input className="form-input" placeholder="1234 5678 9012 3456"
                      value={paymentForm.cardNumber}
                      maxLength={19}
                      onChange={e => {
                        const v = e.target.value.replace(/\D/g, '').slice(0, 16);
                        const formatted = v.match(/.{1,4}/g)?.join(' ') || v;
                        setPaymentForm(f => ({ ...f, cardNumber: formatted }));
                        setPaymentError('');
                      }}
                      style={{ fontSize: 13, letterSpacing: '0.05em' }}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 12, color: '#64748B', fontWeight: 500, display: 'block', marginBottom: 4 }}>Expiry Date *</label>
                      <input className="form-input" placeholder="MM/YY"
                        value={paymentForm.expiry}
                        maxLength={5}
                        onChange={e => {
                          let v = e.target.value.replace(/\D/g, '');
                          if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2, 4);
                          setPaymentForm(f => ({ ...f, expiry: v }));
                          setPaymentError('');
                        }}
                        style={{ fontSize: 13 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: '#64748B', fontWeight: 500, display: 'block', marginBottom: 4 }}>CVC *</label>
                      <input className="form-input" placeholder="123"
                        value={paymentForm.cvc}
                        maxLength={4}
                        onChange={e => {
                          setPaymentForm(f => ({ ...f, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) }));
                          setPaymentError('');
                        }}
                        style={{ fontSize: 13 }}
                      />
                    </div>
                  </div>
                </div>

                {/* Payment breakdown */}
                <div style={{ marginTop: 16, background: '#F8FAFC', borderRadius: 10, padding: 14, border: '1px solid #E2E8F0' }}>
                  {details.isDaily ? (
                    <>
                      <InfoRow label={`${priceDetails.description} @ LKR ${details.priceAmount.toLocaleString()}/night`} value={`LKR ${priceDetails.rentAmount.toLocaleString()} Total`} bold />
                      {details.securityDeposit > 0 && (
                        <InfoRow label="Security Deposit" value={`LKR ${details.securityDeposit.toLocaleString()}`} />
                      )}
                    </>
                  ) : (
                    <>
                      <InfoRow label="1st Month Rent" value={`LKR ${priceDetails.rentAmount.toLocaleString()}`} />
                      <InfoRow label="Security Deposit" value={`LKR ${details.securityDeposit.toLocaleString()}`} />
                    </>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', marginTop: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#1E293B' }}>Total</span>
                    <span style={{ fontSize: 15, fontWeight: 800, color: '#2563EB' }}>LKR {paymentDue.toLocaleString()}</span>
                  </div>
                </div>

                <button
                  className="btn btn-primary btn-full"
                  style={{ marginTop: 16, height: 46, fontSize: 14, fontWeight: 600 }}
                  onClick={processPayment}
                  disabled={processingPayment}
                >
                  {processingPayment ? 'Processing…' : `Pay LKR ${paymentDue.toLocaleString()}`}
                </button>
              </div>
            )}

            {/* ── STEP 4: Complete ── */}
            {activeStep === 4 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ padding: '20px 0 16px' }}>
                  <div style={{
                    width: 80, height: 80, borderRadius: '50%', margin: '0 auto 16px',
                    background: 'linear-gradient(135deg, #10B981, #059669)',
                    display: 'grid', placeItems: 'center',
                  }}>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E293B', marginBottom: 6 }}>Booking Confirmed!</h3>
                  <p style={{ fontSize: 13, color: '#64748B', lineHeight: 1.6 }}>
                    Your booking has been successfully processed. You will receive a confirmation email shortly.
                  </p>

                  {/* Payment confirmed by owner banner */}
                  {payStatus === 'payment_confirmed' && (
                    <div style={{ margin: '12px auto 0', maxWidth: 280, background: '#F0FDF4', border: '1px solid #DCFCE7', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#166534' }}>
                      ✅ Payment receipt confirmed by owner
                      {currentBooking?.paymentConfirmedAt && (
                        <div style={{ fontSize: 11, color: '#4ADE80', marginTop: 2 }}>
                          {new Date(currentBooking.paymentConfirmedAt).toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Professional Receipt */}
                <div id="receipt-content" style={{
                  background: '#ffffff',
                  borderRadius: 12,
                  padding: '14px 16px',
                  border: '1px solid #E2E8F0',
                  marginBottom: 16,
                  fontFamily: 'Arial, sans-serif',
                  width: '100%',
                  boxSizing: 'border-box',
                }}>
                  {/* Header with Brand */}
                  <div style={{ textAlign: 'center', marginBottom: 8, paddingBottom: 6, borderBottom: '2px solid #2563EB' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <img src="/logo.png" alt="Rent Zone" style={{ width: 24, height: 24 }} />
                      <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 2, fontSize: 16, fontWeight: 800, letterSpacing: '-0.3px' }}>
                        <span style={{ color: '#000000' }}>Rent</span>
                        <span style={{ color: '#2563EB' }}>Zone</span>
                      </div>
                    </div>
                    <h1 style={{ fontSize: 16, fontWeight: 800, color: '#1E293B', margin: '2px 0 1px 0', letterSpacing: '-0.5px' }}>BOOKING RECEIPT</h1>
                    <p style={{ fontSize: 9, color: '#64748B', margin: 0 }}>Your rental agreement confirmed</p>
                  </div>

                  {/* Receipt Number & Date */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid #E2E8F0' }}>
                    <div>
                      <p style={{ fontSize: 8, color: '#94A3B8', fontWeight: 700, margin: '0 0 1px 0', textTransform: 'uppercase', letterSpacing: '0.2px' }}>Receipt #</p>
                      <p style={{ fontSize: 11, fontWeight: 700, color: '#1E293B', margin: 0, wordBreak: 'break-word' }}>{currentBooking?.bookingCode || 'N/A'}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: 8, color: '#94A3B8', fontWeight: 700, margin: '0 0 1px 0', textTransform: 'uppercase', letterSpacing: '0.2px' }}>Date</p>
                      <p style={{ fontSize: 11, fontWeight: 700, color: '#1E293B', margin: 0 }}>{new Date().toLocaleDateString('en-LK', { month: 'short', day: 'numeric' })}</p>
                    </div>
                  </div>

                  {/* Renter & Property Info */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid #E2E8F0' }}>
                    <div>
                      <p style={{ fontSize: 8, color: '#94A3B8', fontWeight: 700, margin: '0 0 2px 0', textTransform: 'uppercase', letterSpacing: '0.2px' }}>Renter</p>
                      <p style={{ fontSize: 10, fontWeight: 700, color: '#1E293B', margin: '0 0 1px 0', lineHeight: 1.2 }}>{user?.name || (user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : 'Guest')}</p>
                      <p style={{ fontSize: 9, color: '#64748B', margin: '0 0 1px 0', wordBreak: 'break-all', lineHeight: 1.1 }}>{user?.email || 'N/A'}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: 8, color: '#94A3B8', fontWeight: 700, margin: '0 0 2px 0', textTransform: 'uppercase', letterSpacing: '0.2px' }}>Property</p>
                      <p style={{ fontSize: 10, fontWeight: 700, color: '#1E293B', margin: '0 0 1px 0', lineHeight: 1.2 }}>{property.title}</p>
                      <p style={{ fontSize: 9, color: '#64748B', margin: 0, lineHeight: 1.1 }}>{details.city}</p>
                    </div>
                  </div>

                  {/* Booking Details */}
                  <div style={{ marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid #E2E8F0' }}>
                    <h3 style={{ fontSize: 9, fontWeight: 700, color: '#1E293B', margin: '0 0 4px 0', textTransform: 'uppercase', letterSpacing: '0.2px' }}>Booking Details</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px' }}>
                      <div>
                        <p style={{ fontSize: 7, color: '#94A3B8', fontWeight: 600, margin: 0, textTransform: 'uppercase', letterSpacing: '0.1px' }}>Check-In</p>
                        <p style={{ fontSize: 10, fontWeight: 700, color: '#1E293B', margin: 0 }}>{formatDate(currentBooking?.moveInDate || currentBooking?.checkInDate)}</p>
                      </div>
                      {details.isDaily ? (
                        <>
                          <div>
                            <p style={{ fontSize: 7, color: '#94A3B8', fontWeight: 600, margin: 0, textTransform: 'uppercase', letterSpacing: '0.1px' }}>Nights</p>
                            <p style={{ fontSize: 10, fontWeight: 700, color: '#1E293B', margin: 0 }}>{priceDetails.days}n</p>
                          </div>
                          <div>
                            <p style={{ fontSize: 7, color: '#94A3B8', fontWeight: 600, margin: 0, textTransform: 'uppercase', letterSpacing: '0.1px' }}>Rate</p>
                            <p style={{ fontSize: 10, fontWeight: 700, color: '#1E293B', margin: 0 }}>LKR {details.priceAmount.toLocaleString()}</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <p style={{ fontSize: 7, color: '#94A3B8', fontWeight: 600, margin: 0, textTransform: 'uppercase', letterSpacing: '0.1px' }}>Lease</p>
                            <p style={{ fontSize: 10, fontWeight: 700, color: '#1E293B', margin: 0 }}>
                              {currentBooking?.duration ? `${currentBooking.duration}${currentBooking.durationType === 'months' ? 'm' : 'w'}` : 'N/A'}
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Payment Summary */}
                  <div style={{ marginBottom: 6, paddingBottom: 6, borderBottom: '2px solid #2563EB' }}>
                    <h3 style={{ fontSize: 9, fontWeight: 700, color: '#1E293B', margin: '0 0 3px 0', textTransform: 'uppercase', letterSpacing: '0.2px' }}>Payment Summary</h3>
                    <div style={{ display: 'grid', gap: 2 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
                        <span style={{ color: '#64748B' }}>{details.isDaily ? `Accommodation (${priceDetails.days}n)` : '1st Month'}</span>
                        <span style={{ fontWeight: 600, color: '#1E293B' }}>LKR {priceDetails.rentAmount.toLocaleString()}</span>
                      </div>
                      {details.securityDeposit > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
                          <span style={{ color: '#64748B' }}>Deposit</span>
                          <span style={{ fontWeight: 600, color: '#1E293B' }}>LKR {details.securityDeposit.toLocaleString()}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 2, fontSize: 11, fontWeight: 800, color: '#2563EB' }}>
                        <span>Total</span>
                        <span>LKR {paymentDue.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  {/* Payment Status & Footer */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ background: '#F0FDF4', borderRadius: 4, padding: '2px 8px', marginBottom: 4, border: '1px solid #DCFCE7' }}>
                      <p style={{ fontSize: 8, fontWeight: 600, color: '#166534', margin: 0 }}>
                        {payStatus === 'payment_confirmed' ? '✅ Payment Confirmed by Owner' : '✓ Payment Completed'}
                      </p>
                    </div>
                    <p style={{ fontSize: 8, color: '#64748B', lineHeight: 1.3, margin: '0 0 2px 0' }}>
                      This receipt confirms your booking with RentZone.
                    </p>
                    <p style={{ fontSize: 7, color: '#94A3B8', margin: 0 }}>
                      © 2026 RentZone
                    </p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                  <ReceiptDownloadButton
                    targetId="receipt-content"
                    bookingCode={currentBooking?.bookingCode}
                    className="btn btn-secondary"
                    style={{ fontSize: 13, height: 40 }}
                  />
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 13, height: 40 }}
                    onClick={() => { onClose(); navigate('/renter/bookings'); }}
                  >
                    Go to Bookings
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Map modal */}
      {showMap && (
        <div onClick={() => setShowMap(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'grid', placeItems: 'center', zIndex: 1300, padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: isMobile ? 12 : 16, padding: isMobile ? 8 : 12, width: 'min(1000px,96vw)', height: isMobile ? '94vh' : 'min(90vh, 800px)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 15 }}>Property Location</strong>
              <button onClick={() => setShowMap(false)} style={{ background: '#F1F5F9', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>Close</button>
            </div>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 10 }}>{details.address}</div>
            <div style={{ height: 'calc(100% - 64px)', borderRadius: 10, overflow: 'hidden' }}>
              <LocationMap
                city={details.city}
                district={property?.location?.district}
                markerPosition={details.centerCoords}
                address={details.address}
                userRole="renter"
              />
            </div>
          </div>
        </div>
      )}
    </ModalOverlay>
  );
}

/* ─── Overlay wrapper ─────────────────────────────────────── */
function ModalOverlay({ children, onClose }) {
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.6)',
        display: 'grid', placeItems: 'center', zIndex: 1200, padding: 16,
        backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 20, width: 'min(900px, 96vw)',
        height: 'min(680px, 92vh)', position: 'relative', overflow: 'hidden',
        boxShadow: '0 25px 60px rgba(0,0,0,0.35)',
        animation: 'modalIn 0.25s cubic-bezier(0.34,1.56,0.64,1)',
      }}>
        {children}
      </div>
      <style>{`@keyframes modalIn { from { opacity:0; transform:scale(0.92) } to { opacity:1; transform:scale(1) } }`}</style>
    </div>
  );
}