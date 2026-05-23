import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import RenterLayout from '../../components/common/RenterLayout';
import { bookingAPI, paymentAPI, propertyAPI } from '../../services/api';

const STEPS = [
  { key: 1, label: 'Property' },
  { key: 2, label: 'Request' },
  { key: 3, label: 'Payment' },
  { key: 4, label: 'Complete' },
];

function Stepper({ activeStep }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      {STEPS.map((step, idx) => (
        <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: idx === STEPS.length - 1 ? 0 : 1 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: '2px solid',
              borderColor: step.key <= activeStep ? 'var(--primary)' : '#CBD5E1',
              background: step.key <= activeStep ? 'var(--primary)' : 'white',
              color: step.key <= activeStep ? 'white' : '#64748B',
              display: 'grid',
              placeItems: 'center',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {step.key}
          </div>
          <div style={{ fontSize: 12, color: step.key <= activeStep ? 'var(--text-primary)' : '#94A3B8', fontWeight: 600 }}>
            {step.label}
          </div>
          {idx !== STEPS.length - 1 && (
            <div style={{ height: 2, flex: 1, background: step.key < activeStep ? 'var(--primary)' : '#E2E8F0' }} />
          )}
        </div>
      ))}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
      <span>{label}</span>
      <strong style={{ color: 'var(--text-primary)' }}>{value}</strong>
    </div>
  );
}

export default function PropertyDetails() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();

  const [property, setProperty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeStep, setActiveStep] = useState(1);
  const [showMap, setShowMap] = useState(false);
  const [sendingRequest, setSendingRequest] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [currentBooking, setCurrentBooking] = useState(null);

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

  const bookingIdFromUrl = searchParams.get('bookingId');

  const loadBookingsForProperty = useCallback(async () => {
    try {
      const res = await bookingAPI.getRenterBookings({ houseId: id, limit: 20 });
      const list = res.data?.bookings || res.data || [];
      if (!Array.isArray(list) || list.length === 0) {
        setCurrentBooking(null);
        return;
      }

      let picked = null;
      if (bookingIdFromUrl) {
        picked = list.find((b) => String(b._id || b.id) === String(bookingIdFromUrl));
      }

      if (!picked) {
        picked = [...list].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
      }

      setCurrentBooking(picked || null);
    } catch {
      setCurrentBooking(null);
    }
  }, [bookingIdFromUrl, id]);

  const loadProperty = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await propertyAPI.getProperty(id);
      const data = res.data?.house || res.data?.property || res.data;
      setProperty(data || null);
      await loadBookingsForProperty();
    } catch {
      setError('Failed to load property details.');
    } finally {
      setLoading(false);
    }
  }, [id, loadBookingsForProperty]);

  useEffect(() => {
    loadProperty();
  }, [loadProperty]);

  useEffect(() => {
    if (!currentBooking) {
      setActiveStep(1);
      return;
    }

    if (currentBooking.paymentStatus === 'paid' || currentBooking.status === 'payment_completed' || currentBooking.status === 'completed') {
      setActiveStep(4);
      return;
    }

    if (currentBooking.status === 'confirmed' || currentBooking.status === 'active') {
      setActiveStep(3);
      return;
    }

    if (currentBooking.status === 'pending' || currentBooking.status === 'rejected') {
      setActiveStep(2);
      return;
    }

    setActiveStep(1);
  }, [currentBooking]);

  const details = useMemo(() => {
    const images = property?.images || [];
    const mainImage = images?.[0]?.url || images?.[0] || 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1200&auto=format&fit=crop&q=60';
    const priceAmount = property?.price?.amount ?? property?.price ?? 0;
    const securityDeposit = property?.price?.securityDeposit ?? 0;
    const rentalUnit = property?.rentalType === 'daily' || property?.rentalType === 'short_stay' ? '/day' : '/month';
    const city = property?.location?.city || '';
    const district = property?.location?.district || '';
    const address = property?.location?.address || [city, district, 'Sri Lanka'].filter(Boolean).join(', ');
    const bedrooms = property?.propertyDetails?.bedrooms ?? property?.bedrooms ?? 0;
    const bathrooms = property?.propertyDetails?.bathrooms ?? property?.bathrooms ?? 0;
    const owner = property?.owner || property?.ownerDetails || property?.ownerInfo || {};

    return {
      mainImage,
      priceAmount: Number(priceAmount) || 0,
      securityDeposit: Number(securityDeposit) || 0,
      rentalUnit,
      city,
      district,
      address,
      bedrooms,
      bathrooms,
      ownerName: [owner.firstName, owner.lastName].filter(Boolean).join(' ') || property?.ownerName || 'Property Owner',
      ownerEmail: owner.email || property?.ownerEmail || property?.contact?.email || '',
      ownerPhone: owner.phone || property?.ownerPhone || property?.contact?.phone || '',
      coordinates: property?.location?.coordinates || null,
    };
  }, [property]);

  const estimatedRent = useMemo(() => {
    if (!requestForm.duration) return 0;
    const duration = Number(requestForm.duration) || 0;
    if (requestForm.durationType === 'days') return Math.round((details.priceAmount / 30) * duration);
    if (requestForm.durationType === 'weeks') return Math.round((details.priceAmount / 4) * duration);
    return details.priceAmount * duration;
  }, [details.priceAmount, requestForm.duration, requestForm.durationType]);

  const totalEstimate = estimatedRent + details.securityDeposit;

  const mapEmbedUrl = useMemo(() => {
    const [lng, lat] = Array.isArray(details.coordinates) ? details.coordinates : [];
    if (lat && lng) {
      return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.015}%2C${lat - 0.015}%2C${lng + 0.015}%2C${lat + 0.015}&layer=mapnik&marker=${lat}%2C${lng}`;
    }
    return `https://maps.google.com/maps?q=${encodeURIComponent(details.address || 'Sri Lanka')}&t=&z=14&ie=UTF8&iwloc=&output=embed`;
  }, [details.address, details.coordinates]);

  const submitBookingRequest = async () => {
    if (!requestForm.moveInDate || !requestForm.duration) {
      toast.error('Move-in date and duration are required');
      return;
    }

    setSendingRequest(true);
    try {
      const payload = {
        houseId: id,
        moveInDate: requestForm.moveInDate,
        duration: Number(requestForm.duration),
        durationType: requestForm.durationType,
        specialRequests: requestForm.specialRequests,
        renterPhone: requestForm.renterPhone,
      };

      const res = await bookingAPI.createBookingRequest(payload);
      const booking = res.data?.booking || null;
      setCurrentBooking(booking);
      setActiveStep(2);
      toast.success('Booking request sent to owner');
    } catch (err) {
      toast.error(err?.error || 'Failed to send booking request');
    } finally {
      setSendingRequest(false);
    }
  };

  const processPayment = async () => {
    const bookingId = currentBooking?._id || currentBooking?.id;
    if (!bookingId) {
      toast.error('Booking not found for payment');
      return;
    }

    if (!paymentForm.cardName || !paymentForm.cardNumber || !paymentForm.expiry || !paymentForm.cvc) {
      toast.error('Complete all payment fields');
      return;
    }

    setProcessingPayment(true);
    try {
      await paymentAPI.processPayment(bookingId, {
        paymentMethod: 'card',
        paymentType: 'full',
        amount: currentBooking.totalAmount || totalEstimate,
        cardDetails: {
          name: paymentForm.cardName,
          number: paymentForm.cardNumber,
          expiry: paymentForm.expiry,
          cvc: paymentForm.cvc,
        },
      });

      await loadBookingsForProperty();
      setActiveStep(4);
      toast.success('Payment successful');
    } catch (err) {
      toast.error(err?.error || 'Payment failed');
    } finally {
      setProcessingPayment(false);
    }
  };

  if (loading) {
    return (
      <RenterLayout>
        <div className="loading-spinner" style={{ paddingTop: 72 }}><div className="spinner" /></div>
      </RenterLayout>
    );
  }

  if (error || !property) {
    return (
      <RenterLayout>
        <div className="alert alert-error">{error || 'Property not found.'}</div>
        <Link to="/renter/search" className="btn btn-primary" style={{ marginTop: 16 }}>Back to Search</Link>
      </RenterLayout>
    );
  }

  const status = currentBooking?.status;
  const paymentStatus = currentBooking?.paymentStatus;

  return (
    <RenterLayout>
      <div style={{ marginBottom: 14 }}>
        <Link to="/renter/search" style={{ fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'none' }}>
          ← Back to search
        </Link>
      </div>

      <Stepper activeStep={activeStep} />

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18 }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <img src={details.mainImage} alt={property.title} style={{ width: '100%', height: 300, objectFit: 'cover' }} />
          <div style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{property.title}</h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{details.address}</p>
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--primary)', lineHeight: 1 }}>
                LKR {details.priceAmount.toLocaleString()}
                <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 500 }}>{details.rentalUnit}</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8, marginBottom: 12 }}>
              <div className="card" style={{ padding: 10, textAlign: 'center' }}><strong>{details.bedrooms}</strong><div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Bedrooms</div></div>
              <div className="card" style={{ padding: 10, textAlign: 'center' }}><strong>{details.bathrooms}</strong><div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Bathrooms</div></div>
              <div className="card" style={{ padding: 10, textAlign: 'center' }}><strong>{property.maxOccupancy || 1}</strong><div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Guests</div></div>
              <div className="card" style={{ padding: 10, textAlign: 'center' }}><strong>{property.isVerified ? 'Yes' : 'No'}</strong><div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Verified</div></div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Description</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
                {property.description || 'Property description is not available.'}
              </p>
            </div>

            <button type="button" className="btn btn-secondary" onClick={() => setShowMap(true)}>
              View Location on Map
            </button>
          </div>
        </div>

        <div className="card" style={{ height: 'fit-content' }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>Booking Request</h2>

          <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Move-in Date</label>
            <input type="date" className="form-input" value={requestForm.moveInDate} onChange={(e) => setRequestForm((f) => ({ ...f, moveInDate: e.target.value }))} />

            <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Duration</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="number" min={1} className="form-input" value={requestForm.duration} onChange={(e) => setRequestForm((f) => ({ ...f, duration: e.target.value }))} />
              <select className="form-input" value={requestForm.durationType} onChange={(e) => setRequestForm((f) => ({ ...f, durationType: e.target.value }))}>
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
                <option value="months">Months</option>
              </select>
            </div>

            <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Phone Number</label>
            <input type="text" className="form-input" placeholder="07X XXX XXXX" value={requestForm.renterPhone} onChange={(e) => setRequestForm((f) => ({ ...f, renterPhone: e.target.value }))} />

            <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Special Requests</label>
            <textarea className="form-input" rows={3} value={requestForm.specialRequests} onChange={(e) => setRequestForm((f) => ({ ...f, specialRequests: e.target.value }))} />
          </div>

          <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
            <InfoRow label="Estimated Rent" value={`LKR ${estimatedRent.toLocaleString()}`} />
            <InfoRow label="Security Deposit" value={`LKR ${details.securityDeposit.toLocaleString()}`} />
            <InfoRow label="Estimated Total" value={`LKR ${totalEstimate.toLocaleString()}`} />
          </div>

          {!currentBooking && (
            <button type="button" className="btn btn-primary btn-full" onClick={submitBookingRequest} disabled={sendingRequest}>
              {sendingRequest ? 'Sending Request…' : 'Send Booking Request'}
            </button>
          )}

          {status === 'pending' && (
            <div className="alert" style={{ marginTop: 10, background: '#FFFBEB', color: '#92400E' }}>
              Booking request sent. Waiting for owner response.
            </div>
          )}

          {status === 'rejected' && (
            <div className="alert alert-error" style={{ marginTop: 10 }}>
              This booking request was rejected. You can submit a new request with different dates.
            </div>
          )}

          {(status === 'confirmed' || status === 'active') && paymentStatus !== 'paid' && (
            <div style={{ marginTop: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Complete Payment</h3>
              <input className="form-input" placeholder="Cardholder name" value={paymentForm.cardName} onChange={(e) => setPaymentForm((f) => ({ ...f, cardName: e.target.value }))} style={{ marginBottom: 8 }} />
              <input className="form-input" placeholder="Card number" value={paymentForm.cardNumber} onChange={(e) => setPaymentForm((f) => ({ ...f, cardNumber: e.target.value }))} style={{ marginBottom: 8 }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <input className="form-input" placeholder="MM/YY" value={paymentForm.expiry} onChange={(e) => setPaymentForm((f) => ({ ...f, expiry: e.target.value }))} />
                <input className="form-input" placeholder="CVC" value={paymentForm.cvc} onChange={(e) => setPaymentForm((f) => ({ ...f, cvc: e.target.value }))} />
              </div>
              <button className="btn btn-primary btn-full" onClick={processPayment} disabled={processingPayment}>
                {processingPayment ? 'Processing…' : `Pay LKR ${(currentBooking?.totalAmount || totalEstimate).toLocaleString()}`}
              </button>
            </div>
          )}

          {(paymentStatus === 'paid' || status === 'payment_completed' || status === 'completed') && (
            <div className="alert" style={{ marginTop: 10, background: '#ECFDF5', color: '#065F46' }}>
              Booking confirmed and payment completed.
            </div>
          )}

          <div className="hidden sm:block" style={{ marginTop: 14, borderTop: '1px solid #E2E8F0', paddingTop: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Contact Owner</h3>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{details.ownerName}</div>
            {details.ownerEmail && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{details.ownerEmail}</div>}
            {details.ownerPhone && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{details.ownerPhone}</div>}
          </div>

          <div className="sm:hidden" style={{ marginTop: 14 }}>
            {details.ownerPhone ? (
              <a href={`tel:${details.ownerPhone}`} className="btn btn-secondary btn-full">Call Owner</a>
            ) : (
              <button className="btn btn-secondary btn-full" disabled>Owner phone unavailable</button>
            )}
          </div>
        </div>
      </div>

      {showMap && (
        <div
          onClick={() => setShowMap(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2,6,23,0.55)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1200,
            padding: 16,
          }}
        >
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(900px, 95vw)', padding: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 700 }}>Property Location</div>
              <button className="btn btn-sm" onClick={() => setShowMap(false)}>Close</button>
            </div>
            <iframe title="Property map" src={mapEmbedUrl} style={{ width: '100%', height: 420, border: '1px solid #E2E8F0', borderRadius: 10 }} loading="lazy" />
          </div>
        </div>
      )}
    </RenterLayout>
  );
}
