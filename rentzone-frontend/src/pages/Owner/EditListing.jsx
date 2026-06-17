import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import OwnerLayout from '../../components/common/OwnerLayout';
import LocationMap from '../../components/common/LocationMap';
import { propertyAPI, uploadAPI } from '../../services/api';
import { Upload } from 'lucide-react';
import toast from 'react-hot-toast';

const DEFAULT_POSITION = [7.8731, 80.7718];

const EMPTY_AMENITIES = {
  wifi: false, parking: false, ac: false, heating: false,
  kitchen: false, washerDryer: false, petFriendly: false,
  gym: false, pool: false, balcony: false, garden: false, securitySystem: false,
};

const INITIAL_FORM = {
  title: '', description: '', propertyType: '', basePrice: '',
  securityDeposit: '', bedrooms: '', bathrooms: '', squareFeet: '',
  address: '', city: '', district: '', postalCode: '',
  amenities: EMPTY_AMENITIES, images: [], mainImageIndex: null,
};

const getImageUrl = (image) => {
  if (!image) return '';
  if (typeof image === 'string') return image;
  return image.url || image.publicUrl || image.imageUrl || '';
};

const getImageKey = (image) => {
  if (!image || typeof image === 'string') return null;
  return image.key || null;
};

export default function EditListing() {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();

  const [loading, setLoading] = useState(false);
  const [loadingListing, setLoadingListing] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [markerPosition, setMarkerPosition] = useState(DEFAULT_POSITION);
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [existingImages, setExistingImages] = useState([]);
  const [errors, setErrors] = useState({});

  const hydrateListing = (listing) => {
    const amenityMap = { ...EMPTY_AMENITIES };
    (listing.amenities || []).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(amenityMap, key)) amenityMap[key] = true;
    });

    const normalizedExisting = Array.isArray(listing.images)
      ? listing.images.map((img) => ({ url: getImageUrl(img), key: getImageKey(img) })).filter((img) => Boolean(img.url))
      : [];

    const selectedMainUrl = getImageUrl(listing.mainImage);
    const mainIdx = normalizedExisting.findIndex((img) => img.url === selectedMainUrl);
    const resolvedMainIdx = mainIdx >= 0 ? mainIdx : (normalizedExisting.length > 0 ? 0 : null);

    setExistingImages(normalizedExisting);
    setFormData({
      title: listing.title || '',
      description: listing.description || '',
      propertyType: listing.propertyType || '',
      basePrice: listing.price?.amount ?? '',
      securityDeposit: listing.price?.securityDeposit ?? '',
      bedrooms: listing.propertyDetails?.bedrooms ?? '',
      bathrooms: listing.propertyDetails?.bathrooms ?? '',
      squareFeet: listing.propertyDetails?.squareFeet ?? '',
      address: listing.location?.address || '',
      city: listing.location?.city || '',
      district: listing.location?.district || '',
      postalCode: listing.location?.zipCode || '',
      amenities: amenityMap,
      images: [],
      mainImageIndex: resolvedMainIdx,
    });

    const lat = listing.location?.coordinates?.latitude;
    const lng = listing.location?.coordinates?.longitude;
    setMarkerPosition(typeof lat === 'number' && typeof lng === 'number' ? [lat, lng] : DEFAULT_POSITION);
  };

  useEffect(() => { loadListing(); }, [id]);

  const loadListing = async () => {
    if (!id) return;
    setLoadingListing(true);
    try {
      const fromState = location.state?.listing;
      if (fromState?._id === id) { hydrateListing(fromState); return; }

      const response = await propertyAPI.getOwnerListings({ page: 1, limit: 1000, sortBy: 'updated' });
      const listing = (response.data?.listings || []).find((item) => item._id === id);
      if (!listing?._id) throw new Error('Listing not found');
      hydrateListing(listing);
    } catch (error) {
      console.error('Error loading listing:', error);
      toast.error('Failed to load listing details');
      navigate('/owner/listings');
    } finally {
      setLoadingListing(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
  };

  const handleAmenityChange = (amenity) => {
    setFormData(prev => ({ ...prev, amenities: { ...prev.amenities, [amenity]: !prev.amenities[amenity] } }));
  };

  // Shared logic for adding image files, used by both the file input
  // and drag-and-drop. Filters out non-images and oversized files,
  // and enforces the 10-image cap (existing + new combined).
  const addImageFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const imageOnly = files.filter(f => f.type.startsWith('image/'));
    if (imageOnly.length !== files.length) {
      toast.error('Only image files are allowed');
    }
    if (imageOnly.length === 0) return;

    const currentTotal = existingImages.length + formData.images.length;
    if (imageOnly.length + currentTotal > 10) {
      toast.error('Maximum 10 images allowed');
      return;
    }

    const validFiles = imageOnly.filter(f => {
      const ok = (f.type === 'image/png' || f.type === 'image/jpeg' || f.type === 'image/jpg') && f.size <= 10 * 1024 * 1024;
      return ok;
    });
    if (validFiles.length !== imageOnly.length) toast.error('Some files skipped — only PNG/JPG up to 10MB allowed.');
    if (validFiles.length === 0) return;

    setFormData(prev => ({ ...prev, images: [...prev.images, ...validFiles] }));
  };

  const handleImageUpload = (e) => {
    addImageFiles(e.target.files);
    e.target.value = '';
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    addImageFiles(e.dataTransfer.files);
  };

  const removeExistingImage = (idxToRemove) => {
    setExistingImages(prev => prev.filter((_, i) => i !== idxToRemove));
    setFormData(prev => {
      let next = prev.mainImageIndex;
      if (next === idxToRemove) {
        next = null;
      } else if (next !== null && next > idxToRemove) {
        next = next - 1;
      }
      return { ...prev, mainImageIndex: next };
    });
  };

  const removeNewImage = (idxToRemove) => {
    setFormData(prev => {
      const globalIdx = existingImages.length + idxToRemove;
      const nextImages = prev.images.filter((_, i) => i !== idxToRemove);
      let next = prev.mainImageIndex;
      if (next === globalIdx) {
        next = null;
      } else if (next !== null && next > globalIdx) {
        next = next - 1;
      }
      return { ...prev, images: nextImages, mainImageIndex: next };
    });
  };

  const validateForm = () => {
    const e = {};
    if (!formData.title.trim()) e.title = 'Property title is required';
    if (!formData.description.trim()) e.description = 'Description is required';
    if (!formData.propertyType) e.propertyType = 'Property type is required';
    if (!formData.basePrice || Number(formData.basePrice) <= 0) e.basePrice = 'Valid base price is required';
    if (formData.bedrooms === '' || Number(formData.bedrooms) < 0) e.bedrooms = 'Number of bedrooms is required';
    if (formData.bathrooms === '' || Number(formData.bathrooms) < 0) e.bathrooms = 'Number of bathrooms is required';
    if (!formData.address.trim()) e.address = 'Address is required';
    if (!formData.city.trim()) e.city = 'City is required';
    if (!formData.district) e.district = 'District is required';
    if (existingImages.length + formData.images.length === 0) e.images = 'At least one property image is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!validateForm()) return;
    setLoading(true);
    try {
      const uploadedNew = await Promise.all(
        formData.images.map(async (file) => {
          const { data } = await uploadAPI.getUploadUrl(file.name, file.type);
          await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
          return { url: data.publicUrl, key: data.key };
        })
      );

      const mergedImages = [
        ...existingImages.map(img => ({ url: getImageUrl(img), key: getImageKey(img) })),
        ...uploadedNew,
      ].filter(img => Boolean(img.url)).map((img, i) => ({ ...img, isPrimary: i === 0 }));

      const mainImage =
        formData.mainImageIndex !== null && mergedImages[formData.mainImageIndex]
          ? mergedImages[formData.mainImageIndex]
          : mergedImages[0] || null;

      const rentalType = formData.propertyType === 'Short-Stay Rental' ? 'daily' : 'monthly';

      const propertyData = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        propertyType: formData.propertyType,
        rentalType,
        price: {
          amount: parseFloat(formData.basePrice),
          currency: 'LKR',
          period: rentalType === 'daily' ? 'per day' : 'per month',
          securityDeposit: formData.securityDeposit ? parseFloat(formData.securityDeposit) : null,
        },
        location: {
          address: formData.address.trim(), city: formData.city.trim(),
          district: formData.district.trim(), country: 'Sri Lanka',
          zipCode: formData.postalCode?.trim() || null,
          coordinates: { latitude: markerPosition[0], longitude: markerPosition[1] },
        },
        propertyDetails: {
          bedrooms: parseInt(formData.bedrooms),
          bathrooms: parseInt(formData.bathrooms),
          squareFeet: formData.squareFeet ? parseFloat(formData.squareFeet) : null,
        },
        amenities: Object.entries(formData.amenities).filter(([, v]) => v).map(([k]) => k),
        images: mergedImages,
        mainImage,
        rules: [], tags: [],
        availability: { isAvailable: true, minStay: 1 },
      };

      const response = await propertyAPI.updateProperty(id, propertyData);
      if (response.data) { toast.success('Listing updated successfully!'); navigate('/owner/listings'); }
    } catch (error) {
      console.error('Error updating listing:', error);
      toast.error(error?.response?.data?.error || 'Failed to update listing. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (window.confirm('Discard your changes?')) navigate('/owner/listings');
  };

  if (loadingListing) {
    return (
      <OwnerLayout>
        <div className="card" style={{ padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Loading listing details...</div>
        </div>
      </OwnerLayout>
    );
  }

  return (
    <OwnerLayout>
      <div className="dashboard-header" style={{ marginBottom: 32 }}>
        <h1 className="dashboard-title">Edit Listing</h1>
      </div>

      <form onSubmit={handleSubmit} style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* ── Basic Information ── */}
        <div className="card" style={{ marginBottom: 28, padding: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 24, color: 'var(--text-primary)', borderBottom: '1px solid #E2E8F0', paddingBottom: 12 }}>
            Basic Information
          </h2>
          <div style={{ display: 'grid', gap: 24 }}>
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                Property Title <span style={{ color: 'var(--error)' }}>*</span>
              </label>
              <input type="text" name="title" value={formData.title} onChange={handleInputChange}
                placeholder="e.g., Modern Apartment in Colombo 07"
                style={{ width: '100%', padding: '11px 14px', border: `1px solid ${errors.title ? 'var(--error)' : '#E2E8F0'}`, borderRadius: 8, fontSize: 14, outline: 'none' }} />
              {errors.title && <span style={{ display: 'block', color: 'var(--error)', fontSize: 12, marginTop: 6 }}>{errors.title}</span>}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                Description <span style={{ color: 'var(--error)' }}>*</span>
              </label>
              <textarea name="description" value={formData.description} onChange={handleInputChange}
                placeholder="Describe your property..." rows={4}
                style={{ width: '100%', padding: '11px 14px', border: `1px solid ${errors.description ? 'var(--error)' : '#E2E8F0'}`, borderRadius: 8, fontSize: 14, outline: 'none', fontFamily: 'inherit', resize: 'vertical' }} />
              {errors.description && <span style={{ display: 'block', color: 'var(--error)', fontSize: 12, marginTop: 6 }}>{errors.description}</span>}
            </div>

            <div className="listing-three-col-grid" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 20
            }}>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                  Property Type <span style={{ color: 'var(--error)' }}>*</span>
                </label>
                <select name="propertyType" value={formData.propertyType} onChange={handleInputChange}
                  style={{ width: '100%', padding: '11px 14px', border: `1px solid ${errors.propertyType ? 'var(--error)' : '#E2E8F0'}`, borderRadius: 8, fontSize: 14, outline: 'none', background: '#fff', cursor: 'pointer' }}>
                  <option value="">Select Property Type</option>
                  <option value="Apartment">Apartment</option>
                  <option value="House">House</option>
                  <option value="Boarding Place">Boarding Place</option>
                  <option value="Short-Stay Rental">Short-Stay Rental</option>
                </select>
                {errors.propertyType && <span style={{ display: 'block', color: 'var(--error)', fontSize: 12, marginTop: 6 }}>{errors.propertyType}</span>}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>Security Deposit</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 500 }}>LKR</span>
                  <input type="number" name="securityDeposit" value={formData.securityDeposit} onChange={handleInputChange}
                    placeholder="Enter refundable deposit" min="0"
                    style={{ width: '100%', padding: '11px 14px 11px 54px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, outline: 'none' }} />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                  Rental Price <span style={{ color: 'var(--error)' }}>*</span>
                  {formData.propertyType && (
                    <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400 }}>
                      ({formData.propertyType === 'Short-Stay Rental' ? 'per day' : 'per month'})
                    </span>
                  )}
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 500 }}>LKR</span>
                  <input type="number" name="basePrice" value={formData.basePrice} onChange={handleInputChange}
                    placeholder={formData.propertyType === 'Short-Stay Rental' ? 'Enter daily rate' : 'Enter monthly rent'}
                    style={{ width: '100%', padding: '11px 14px 11px 54px', border: `1px solid ${errors.basePrice ? 'var(--error)' : '#E2E8F0'}`, borderRadius: 8, fontSize: 14, outline: 'none' }} />
                </div>
                {errors.basePrice && <span style={{ display: 'block', color: 'var(--error)', fontSize: 12, marginTop: 6 }}>{errors.basePrice}</span>}
              </div>
            </div>

            <div className="listing-three-col-grid" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 20
            }}>
              {[
                { name: 'bedrooms', label: 'Bedrooms', required: true },
                { name: 'bathrooms', label: 'Bathrooms', required: true },
                { name: 'squareFeet', label: 'Square Feet', required: false },
              ].map(({ name, label, required }) => (
                <div key={name}>
                  <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                    {label} {required && <span style={{ color: 'var(--error)' }}>*</span>}
                  </label>
                  <input type="number" name={name} value={formData[name]} onChange={handleInputChange}
                    placeholder={`Enter ${label.toLowerCase()}`} min="0"
                    style={{ width: '100%', padding: '11px 14px', border: `1px solid ${errors[name] ? 'var(--error)' : '#E2E8F0'}`, borderRadius: 8, fontSize: 14, outline: 'none' }} />
                  {errors[name] && <span style={{ display: 'block', color: 'var(--error)', fontSize: 12, marginTop: 6 }}>{errors[name]}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Location ── */}
        <div className="card" style={{ marginBottom: 28, padding: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 24, color: 'var(--text-primary)', borderBottom: '1px solid #E2E8F0', paddingBottom: 12 }}>
            Location
          </h2>
          <div style={{ display: 'grid', gap: 24 }}>
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                Address <span style={{ color: 'var(--error)' }}>*</span>
              </label>
              <input type="text" name="address" value={formData.address} onChange={handleInputChange}
                placeholder="eg., 123 Flower Road, Colombo 7, Sri Lanka"
                style={{ width: '100%', padding: '11px 14px', border: `1px solid ${errors.address ? 'var(--error)' : '#E2E8F0'}`, borderRadius: 8, fontSize: 14, outline: 'none' }} />
              {errors.address && <span style={{ display: 'block', color: 'var(--error)', fontSize: 12, marginTop: 6 }}>{errors.address}</span>}
            </div>

            <div className="listing-three-col-grid" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 20
            }}>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                  City <span style={{ color: 'var(--error)' }}>*</span>
                </label>
                <input type="text" name="city" value={formData.city} onChange={handleInputChange}
                  placeholder="Enter city name"
                  style={{ width: '100%', padding: '11px 14px', border: `1px solid ${errors.city ? 'var(--error)' : '#E2E8F0'}`, borderRadius: 8, fontSize: 14, outline: 'none' }} />
                {errors.city && <span style={{ display: 'block', color: 'var(--error)', fontSize: 12, marginTop: 6 }}>{errors.city}</span>}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                  District <span style={{ color: 'var(--error)' }}>*</span>
                </label>
                <select name="district" value={formData.district} onChange={handleInputChange}
                  style={{ width: '100%', padding: '11px 14px', border: `1px solid ${errors.district ? 'var(--error)' : '#E2E8F0'}`, borderRadius: 8, fontSize: 14, outline: 'none', background: '#fff', cursor: 'pointer' }}>
                  <option value="">Select District</option>
                  {['Ampara','Anuradhapura','Badulla','Batticaloa','Colombo','Galle','Gampaha','Hambantota','Jaffna','Kalutara','Kandy','Kegalle','Kilinochchi','Kurunegala','Mannar','Matale','Matara','Monaragala','Mullaitivu','Nuwara Eliya','Polonnaruwa','Puttalam','Ratnapura','Trincomalee','Vavuniya'].map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                {errors.district && <span style={{ display: 'block', color: 'var(--error)', fontSize: 12, marginTop: 6 }}>{errors.district}</span>}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>Postal Code</label>
                <input type="text" name="postalCode" value={formData.postalCode} onChange={handleInputChange}
                  placeholder="12345"
                  style={{ width: '100%', padding: '11px 14px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, outline: 'none' }} />
              </div>
            </div>

            <div>
              <LocationMap
                city={formData.city} district={formData.district}
                onCityChange={(val) => setFormData(prev => ({ ...prev, city: val }))}
                onDistrictChange={(val) => setFormData(prev => ({ ...prev, district: val }))}
                markerPosition={markerPosition} onMarkerPositionChange={setMarkerPosition} />
            </div>
          </div>
        </div>

        {/* ── Property Images ── */}
        <div className="card" style={{ marginBottom: 28, padding: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 24, color: 'var(--text-primary)', borderBottom: '1px solid #E2E8F0', paddingBottom: 12 }}>
            Property Images <span style={{ color: 'var(--error)' }}>*</span>
          </h2>

          <div
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${isDragging ? '#14B8A6' : '#CBD5E1'}`,
              borderRadius: 12,
              padding: 56,
              textAlign: 'center',
              background: isDragging ? '#F0FDFA' : '#F8FAFC',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onClick={() => document.getElementById('edit-image-upload').click()}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#14B8A6', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', pointerEvents: 'none' }}>
              <Upload size={32} color="#fff" />
            </div>
            <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 8, pointerEvents: 'none' }}>
              {isDragging ? 'Drop images here' : 'Add more images or replace old ones'}
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', pointerEvents: 'none' }}>PNG, JPG up to 10MB each (Max 10 images)</p>
            <input id="edit-image-upload" type="file" accept="image/png,image/jpeg,image/jpg" multiple onChange={handleImageUpload} style={{ display: 'none' }} />
          </div>

          {errors.images && <span style={{ display: 'block', color: 'var(--error)', fontSize: 12, marginTop: 8 }}>{errors.images}</span>}

          {existingImages.length > 0 && (
            <>
              <h3 style={{ marginTop: 20, marginBottom: 12, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                Existing Images — click to set as cover photo
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 16 }}>
                {existingImages.map((img, idx) => {
                  const isCover = formData.mainImageIndex === idx;
                  return (
                    <div key={`existing-${idx}`}
                      style={{ position: 'relative', paddingTop: '100%', borderRadius: 10, overflow: 'hidden', border: isCover ? '3px solid #2563EB' : '2px solid #E2E8F0', boxShadow: isCover ? '0 4px 12px rgba(37,99,235,0.25)' : '0 1px 3px rgba(0,0,0,0.05)', cursor: 'pointer', transition: 'all 0.2s' }}
                      onClick={() => setFormData(prev => ({ ...prev, mainImageIndex: idx }))}>
                      <img src={getImageUrl(img)} alt={`Existing ${idx + 1}`}
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                      {isCover && (
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(37,99,235,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ background: '#2563EB', color: '#fff', padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>★ Cover Photo</span>
                        </div>
                      )}
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); removeExistingImage(idx); }}
                        style={{ position: 'absolute', top: 8, right: 8, background: '#EF4444', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, zIndex: 10 }}>
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {formData.images.length > 0 && (
            <>
              <h3 style={{ marginTop: 20, marginBottom: 12, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                New Images — click to set as cover photo
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 16 }}>
                {formData.images.map((img, idx) => {
                  const globalIdx = existingImages.length + idx;
                  const isCover = formData.mainImageIndex === globalIdx;
                  return (
                    <div key={`new-${idx}`}
                      style={{ position: 'relative', paddingTop: '100%', borderRadius: 10, overflow: 'hidden', border: isCover ? '3px solid #2563EB' : '2px solid #E2E8F0', boxShadow: isCover ? '0 4px 12px rgba(37,99,235,0.25)' : '0 1px 3px rgba(0,0,0,0.05)', cursor: 'pointer', transition: 'all 0.2s' }}
                      onClick={() => setFormData(prev => ({ ...prev, mainImageIndex: globalIdx }))}>
                      <img src={URL.createObjectURL(img)} alt={`New upload ${idx + 1}`}
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                      {isCover && (
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(37,99,235,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ background: '#2563EB', color: '#fff', padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>★ Cover Photo</span>
                        </div>
                      )}
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); removeNewImage(idx); }}
                        style={{ position: 'absolute', top: 8, right: 8, background: '#EF4444', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, zIndex: 10 }}>
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ── Amenities ── */}
        <div className="card" style={{ marginBottom: 32, padding: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 24, color: 'var(--text-primary)', borderBottom: '1px solid #E2E8F0', paddingBottom: 12 }}>Amenities</h2>
          <div className="amenities-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 20
          }}>
            {[
              { key: 'wifi', label: 'WiFi' }, { key: 'parking', label: 'Parking' },
              { key: 'ac', label: 'Air Conditioning' }, { key: 'heating', label: 'Heating' },
              { key: 'kitchen', label: 'Kitchen' }, { key: 'washerDryer', label: 'Washer/Dryer' },
              { key: 'petFriendly', label: 'Pet Friendly' }, { key: 'gym', label: 'Gym' },
              { key: 'pool', label: 'Swimming Pool' }, { key: 'balcony', label: 'Balcony' },
              { key: 'garden', label: 'Garden' }, { key: 'securitySystem', label: 'Security System' },
            ].map(({ key, label }) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 0' }}>
                <input type="checkbox" checked={formData.amenities[key]} onChange={() => handleAmenityChange(key)}
                  style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#14B8A6' }} />
                <span style={{ fontSize: 14, color: 'var(--text-primary)', userSelect: 'none' }}>{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="listing-form-actions" style={{ display: 'flex', gap: 16, justifyContent: 'flex-end', paddingTop: 8 }}>
          <button type="button" onClick={handleCancel} className="btn"
            style={{ background: '#F1F5F9', color: '#64748B', border: 'none', padding: '12px 32px', fontSize: 14, fontWeight: 500 }}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}
            style={{ minWidth: 180, padding: '12px 32px', fontSize: 14, fontWeight: 500 }}>
            {loading ? 'Saving changes...' : 'Update Listing'}
          </button>
        </div>
      </form>
    </OwnerLayout>
  );
}