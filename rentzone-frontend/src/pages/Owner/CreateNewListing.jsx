import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import OwnerLayout from '../../components/common/OwnerLayout';
import LocationMap from '../../components/common/LocationMap';
import { propertyAPI, uploadAPI } from '../../services/api';
import { Upload } from 'lucide-react';
import toast from 'react-hot-toast';

export default function CreateNewListing() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [markerPosition, setMarkerPosition] = useState([7.8731, 80.7718]); // Sri Lanka center default

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    propertyType: '',
    basePrice: '',
    securityDeposit: '',
    bedrooms: '',
    bathrooms: '',
    squareFeet: '',
    address: '',
    city: '',
    district: '',
    postalCode: '',
    amenities: {
      wifi: false,
      parking: false,
      ac: false,
      heating: false,
      kitchen: false,
      washerDryer: false,
      petFriendly: false,
      gym: false,
      pool: false,
      balcony: false,
      garden: false,
      securitySystem: false,
    },
    images: [],
    mainImageIndex: null,
  });

  const [errors, setErrors] = useState({});

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    // Clear error on change
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const handleAmenityChange = (amenity) => {
    setFormData(prev => ({
      ...prev,
      amenities: {
        ...prev.amenities,
        [amenity]: !prev.amenities[amenity]
      }
    }));
  };

  // Shared logic for adding image files, used by both the file input
  // and drag-and-drop. Filters out non-images and oversized files,
  // and enforces the 10-image cap.
  const addImageFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    // Only allow actual image files (covers drag-and-drop from sources
    // that might include non-image files alongside images)
    const imageOnly = files.filter(file => file.type.startsWith('image/'));
    if (imageOnly.length !== files.length) {
      toast.error('Only image files are allowed');
    }

    if (imageOnly.length === 0) return;

    if (imageOnly.length + formData.images.length > 10) {
      toast.error('Maximum 10 images allowed');
      return;
    }

    const validFiles = imageOnly.filter(file => {
      const isValidType = file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/jpg';
      const isValidSize = file.size <= 10 * 1024 * 1024; // 10MB
      return isValidType && isValidSize;
    });

    if (validFiles.length !== imageOnly.length) {
      toast.error('Some files were skipped — only PNG/JPG up to 10MB are allowed');
    }

    if (validFiles.length === 0) return;

    setFormData(prev => ({
      ...prev,
      images: [...prev.images, ...validFiles]
    }));
  };

  const handleImageUpload = (e) => {
    addImageFiles(e.target.files);
    // Reset the input so the same file can be re-selected later if removed
    e.target.value = '';
  };

  const removeImage = (idxToRemove) => {
    setFormData(prev => {
      const nextImages = prev.images.filter((_, i) => i !== idxToRemove);
      let nextMainIndex = prev.mainImageIndex;
      if (nextMainIndex === idxToRemove) {
        // The cover photo was removed — fall back to the first remaining image, if any
        nextMainIndex = nextImages.length > 0 ? 0 : null;
      } else if (nextMainIndex !== null && nextMainIndex > idxToRemove) {
        nextMainIndex = nextMainIndex - 1;
      }
      return { ...prev, images: nextImages, mainImageIndex: nextMainIndex };
    });
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (e) => {
    // Required to allow dropping — browsers block drop by default
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only clear dragging state when leaving the drop zone itself,
    // not when moving between its children
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    addImageFiles(e.dataTransfer.files);
  };

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.title.trim()) newErrors.title = 'Property title is required';
    if (!formData.description.trim()) newErrors.description = 'Description is required';
    if (!formData.propertyType) newErrors.propertyType = 'Property type is required';
    if (!formData.basePrice || formData.basePrice <= 0) newErrors.basePrice = 'Valid base price is required';
    if (!formData.bedrooms || formData.bedrooms < 0) newErrors.bedrooms = 'Number of bedrooms is required';
    if (!formData.bathrooms || formData.bathrooms < 0) newErrors.bathrooms = 'Number of bathrooms is required';
    if (!formData.address.trim()) newErrors.address = 'Address is required';
    if (!formData.city) newErrors.city = 'City is required';
    if (!formData.district) newErrors.district = 'District is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setLoading(true);

    try {
      // 1. Upload all images to S3 first, get back real public URLs
      const uploadedImages = await Promise.all(
        formData.images.map(async (file, idx) => {
          // Ask your Lambda for a pre-signed upload URL
          const { data } = await uploadAPI.getUploadUrl(file.name, file.type);

          // Upload the file directly to S3 using the pre-signed URL
          await fetch(data.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type },
            body: file,
          });

          // Return the permanent public S3 URL
          return {
            url: data.publicUrl,
            key: data.key,
            isPrimary: idx === 0,
          };
        })
      );

      // 2. Determine rental type
      const rentalType = formData.propertyType === 'Short-Stay Rental' ? 'daily' : 'monthly';

      // 3. Build the listing payload — now with real S3 image URLs
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
          address: formData.address.trim(),
          city: formData.city.trim(),
          district: formData.district.trim(),
          country: 'Sri Lanka',
          zipCode: formData.postalCode?.trim() || null,
          coordinates: {
            latitude: markerPosition[0],
            longitude: markerPosition[1],
          },
        },
        propertyDetails: {
          bedrooms: parseInt(formData.bedrooms),
          bathrooms: parseInt(formData.bathrooms),
          squareFeet: formData.squareFeet ? parseFloat(formData.squareFeet) : null,
        },
        amenities: Object.entries(formData.amenities)
          .filter(([_, v]) => v)
          .map(([k]) => k),
        images: uploadedImages, // ✅ Real S3 URLs now
        mainImage: formData.mainImageIndex !== null ? uploadedImages[formData.mainImageIndex] : uploadedImages[0], // Set mainImage
        rules: [],
        tags: [],
        availability: {
          isAvailable: true,
          minStay: 1,
        },
      };

      const response = await propertyAPI.createProperty(propertyData);

      if (response.data) {
        toast.success('Listing created successfully!');
        navigate('/owner/dashboard');
      }

    } catch (error) {
      console.error('Error creating listing:', error);
      toast.error(error?.response?.data?.error || 'Failed to create listing. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (window.confirm('Are you sure you want to cancel? All changes will be lost.')) {
      navigate('/owner/dashboard');
    }
  };

  return (
    <OwnerLayout>
      <div className="dashboard-header" style={{ marginBottom: 32 }}>
        <h1 className="dashboard-title">Create New Listing</h1>
      </div>

      <form onSubmit={handleSubmit} style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Basic Information */}
        <div className="card" style={{ marginBottom: 28, padding: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 24, color: 'var(--text-primary)', borderBottom: '1px solid #E2E8F0', paddingBottom: 12 }}>
            Basic Information
          </h2>

          <div style={{ display: 'grid', gap: 24 }}>
            {/* Property Title */}
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                Property Title <span style={{ color: 'var(--error)' }}>*</span>
              </label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleInputChange}
                placeholder="e.g., Modern Apartment in Colombo 07"
                style={{
                  width: '100%',
                  padding: '11px 14px',
                  border: `1px solid ${errors.title ? 'var(--error)' : '#E2E8F0'}`,
                  borderRadius: 8,
                  fontSize: 14,
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
              />
              {errors.title && <span style={{ display: 'block', color: 'var(--error)', fontSize: 12, marginTop: 6 }}>{errors.title}</span>}
            </div>

            {/* Description */}
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                Description <span style={{ color: 'var(--error)' }}>*</span>
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="Describe your property..."
                rows={4}
                style={{
                  width: '100%',
                  padding: '11px 14px',
                  border: `1px solid ${errors.description ? 'var(--error)' : '#E2E8F0'}`,
                  borderRadius: 8,
                  fontSize: 14,
                  outline: 'none',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  transition: 'border-color 0.2s'
                }}
              />
              {errors.description && <span style={{ display: 'block', color: 'var(--error)', fontSize: 12, marginTop: 6 }}>{errors.description}</span>}
            </div>

            {/* Property Type, Rental Price and Security Deposit */}
            <div className="listing-three-col-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                  Property Type <span style={{ color: 'var(--error)' }}>*</span>
                </label>
                <select
                  name="propertyType"
                  value={formData.propertyType}
                  onChange={handleInputChange}
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    border: `1px solid ${errors.propertyType ? 'var(--error)' : '#E2E8F0'}`,
                    borderRadius: 8,
                    fontSize: 14,
                    outline: 'none',
                    background: '#fff',
                    cursor: 'pointer',
                    transition: 'border-color 0.2s'
                  }}
                >
                  <option value="">Select Property Type</option>
                  <option value="Apartment">Apartment</option>
                  <option value="House">House</option>
                  <option value="Boarding Place">Boarding Place</option>
                  <option value="Short-Stay Rental">Short-Stay Rental</option>
                </select>
                {errors.propertyType && <span style={{ display: 'block', color: 'var(--error)', fontSize: 12, marginTop: 6 }}>{errors.propertyType}</span>}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                  Security Deposit
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 500 }}>
                    LKR
                  </span>
                  <input
                    type="number"
                    name="securityDeposit"
                    value={formData.securityDeposit}
                    onChange={handleInputChange}
                    placeholder="Enter refundable deposit"
                    min="0"
                    style={{
                      width: '100%',
                      padding: '11px 14px 11px 54px',
                      border: '1px solid #E2E8F0',
                      borderRadius: 8,
                      fontSize: 14,
                      outline: 'none',
                      transition: 'border-color 0.2s'
                    }}
                  />
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
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 500 }}>
                    LKR
                  </span>
                  <input
                    type="number"
                    name="basePrice"
                    value={formData.basePrice}
                    onChange={handleInputChange}
                    placeholder={formData.propertyType === 'Short-Stay Rental' ? 'Enter daily rate' : 'Enter monthly rent'}
                    style={{
                      width: '100%',
                      padding: '11px 14px 11px 54px',
                      border: `1px solid ${errors.basePrice ? 'var(--error)' : '#E2E8F0'}`,
                      borderRadius: 8,
                      fontSize: 14,
                      outline: 'none',
                      transition: 'border-color 0.2s'
                    }}
                  />
                </div>
                {errors.basePrice && <span style={{ display: 'block', color: 'var(--error)', fontSize: 12, marginTop: 6 }}>{errors.basePrice}</span>}
              </div>
            </div>

            {/* Bedrooms, Bathrooms, Square Feet */}
            <div className="listing-three-col-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                  Bedrooms <span style={{ color: 'var(--error)' }}>*</span>
                </label>
                <input
                  type="number"
                  name="bedrooms"
                  value={formData.bedrooms}
                  onChange={handleInputChange}
                  placeholder="Enter number of bedrooms"
                  min="0"
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    border: `1px solid ${errors.bedrooms ? 'var(--error)' : '#E2E8F0'}`,
                    borderRadius: 8,
                    fontSize: 14,
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                />
                {errors.bedrooms && <span style={{ display: 'block', color: 'var(--error)', fontSize: 12, marginTop: 6 }}>{errors.bedrooms}</span>}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                  Bathrooms <span style={{ color: 'var(--error)' }}>*</span>
                </label>
                <input
                  type="number"
                  name="bathrooms"
                  value={formData.bathrooms}
                  onChange={handleInputChange}
                  placeholder="Enter number of bathrooms"
                  min="0"
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    border: `1px solid ${errors.bathrooms ? 'var(--error)' : '#E2E8F0'}`,
                    borderRadius: 8,
                    fontSize: 14,
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                />
                {errors.bathrooms && <span style={{ display: 'block', color: 'var(--error)', fontSize: 12, marginTop: 6 }}>{errors.bathrooms}</span>}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                  Square Feet
                </label>
                <input
                  type="number"
                  name="squareFeet"
                  value={formData.squareFeet}
                  onChange={handleInputChange}
                  placeholder="Enter property size in sq ft"
                  min="0"
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    border: '1px solid #E2E8F0',
                    borderRadius: 8,
                    fontSize: 14,
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Location */}
        <div className="card" style={{ marginBottom: 28, padding: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 24, color: 'var(--text-primary)', borderBottom: '1px solid #E2E8F0', paddingBottom: 12 }}>
            Location
          </h2>

          <div style={{ display: 'grid', gap: 24 }}>
            {/* Address */}
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                Address <span style={{ color: 'var(--error)' }}>*</span>
              </label>
              <input
                type="text"
                name="address"
                value={formData.address}
                onChange={handleInputChange}
                placeholder="eg., 123 Flower Road, Colombo 7, Sri Lanka"
                style={{
                  width: '100%',
                  padding: '11px 14px',
                  border: `1px solid ${errors.address ? 'var(--error)' : '#E2E8F0'}`,
                  borderRadius: 8,
                  fontSize: 14,
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
              />
              {errors.address && <span style={{ display: 'block', color: 'var(--error)', fontSize: 12, marginTop: 6 }}>{errors.address}</span>}
            </div>

            {/* City, District, Postal Code */}
            <div className="listing-three-col-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                  City <span style={{ color: 'var(--error)' }}>*</span>
                </label>
                <input
                  type="text"
                  name="city"
                  value={formData.city}
                  onChange={handleInputChange}
                  placeholder="Enter city name"
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    border: `1px solid ${errors.city ? 'var(--error)' : '#E2E8F0'}`,
                    borderRadius: 8,
                    fontSize: 14,
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                />
                {errors.city && <span style={{ display: 'block', color: 'var(--error)', fontSize: 12, marginTop: 6 }}>{errors.city}</span>}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                  District <span style={{ color: 'var(--error)' }}>*</span>
                </label>
                <select
                  name="district"
                  value={formData.district}
                  onChange={handleInputChange}
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    border: `1px solid ${errors.district ? 'var(--error)' : '#E2E8F0'}`,
                    borderRadius: 8,
                    fontSize: 14,
                    outline: 'none',
                    background: '#fff',
                    cursor: 'pointer',
                    transition: 'border-color 0.2s'
                  }}
                >
                  <option value="">Select District</option>
                  <option value="Ampara">Ampara</option>
                  <option value="Anuradhapura">Anuradhapura</option>
                  <option value="Badulla">Badulla</option>
                  <option value="Batticaloa">Batticaloa</option>
                  <option value="Colombo">Colombo</option>
                  <option value="Galle">Galle</option>
                  <option value="Gampaha">Gampaha</option>
                  <option value="Hambantota">Hambantota</option>
                  <option value="Jaffna">Jaffna</option>
                  <option value="Kalutara">Kalutara</option>
                  <option value="Kandy">Kandy</option>
                  <option value="Kegalle">Kegalle</option>
                  <option value="Kilinochchi">Kilinochchi</option>
                  <option value="Kurunegala">Kurunegala</option>
                  <option value="Mannar">Mannar</option>
                  <option value="Matale">Matale</option>
                  <option value="Matara">Matara</option>
                  <option value="Monaragala">Monaragala</option>
                  <option value="Mullaitivu">Mullaitivu</option>
                  <option value="Nuwara Eliya">Nuwara Eliya</option>
                  <option value="Polonnaruwa">Polonnaruwa</option>
                  <option value="Puttalam">Puttalam</option>
                  <option value="Ratnapura">Ratnapura</option>
                  <option value="Trincomalee">Trincomalee</option>
                  <option value="Vavuniya">Vavuniya</option>
                </select>
                {errors.district && <span style={{ display: 'block', color: 'var(--error)', fontSize: 12, marginTop: 6 }}>{errors.district}</span>}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                  Postal Code
                </label>
                <input
                  type="text"
                  name="postalCode"
                  value={formData.postalCode}
                  onChange={handleInputChange}
                  placeholder="12345"
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    border: '1px solid #E2E8F0',
                    borderRadius: 8,
                    fontSize: 14,
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                />
              </div>
            </div>

            {/* Interactive Map */}
            <div>
              <LocationMap
                city={formData.city}
                district={formData.district}
                onCityChange={(val) => setFormData(prev => ({ ...prev, city: val }))}
                onDistrictChange={(val) => setFormData(prev => ({ ...prev, district: val }))}
                markerPosition={markerPosition}
                onMarkerPositionChange={setMarkerPosition}
              />
            </div>
          </div>
        </div>

        {/* Property Images */}
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
            onClick={() => document.getElementById('image-upload').click()}
          >
            <div style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              background: '#14B8A6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              pointerEvents: 'none'
            }}>
              <Upload size={32} color="#fff" />
            </div>
            <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 8, pointerEvents: 'none' }}>
              {isDragging ? 'Drop images here' : 'Drag images here or click to upload'}
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', pointerEvents: 'none' }}>
              PNG, JPG up to 10MB each (Max 10 images)
            </p>
            <input
              id="image-upload"
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              multiple
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
          </div>

          {formData.images.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>
                Select a cover photo (this will appear in property cards)
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 16 }}>
                {formData.images.map((img, idx) => (
                  <div
                    key={idx}
                    style={{
                      position: 'relative',
                      paddingTop: '100%',
                      borderRadius: 10,
                      overflow: 'hidden',
                      border: formData.mainImageIndex === idx ? '3px solid #2563EB' : '2px solid #E2E8F0',
                      boxShadow: formData.mainImageIndex === idx ? '0 4px 12px rgba(37,99,235,0.25)' : '0 1px 3px rgba(0,0,0,0.05)',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onClick={() => setFormData(prev => ({ ...prev, mainImageIndex: idx }))}
                  >
                    <img
                      src={URL.createObjectURL(img)}
                      alt={`Upload ${idx + 1}`}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    {formData.mainImageIndex === idx && (
                      <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(37, 99, 235, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <span style={{
                          background: '#2563EB',
                          color: '#fff',
                          padding: '4px 12px',
                          borderRadius: 20,
                          fontSize: 11,
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                        }}>
                          ★ Cover Photo
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeImage(idx); }}
                      style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        background: '#EF4444',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        padding: '4px 8px',
                        cursor: 'pointer',
                        fontSize: 12,
                        zIndex: 10,
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Amenities */}
        <div className="card" style={{ marginBottom: 32, padding: 28 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 24, color: 'var(--text-primary)', borderBottom: '1px solid #E2E8F0', paddingBottom: 12 }}>
            Amenities
          </h2>

          <div className="amenities-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {[
              { key: 'wifi', label: 'WiFi' },
              { key: 'parking', label: 'Parking' },
              { key: 'ac', label: 'Air Conditioning' },
              { key: 'heating', label: 'Heating' },
              { key: 'kitchen', label: 'Kitchen' },
              { key: 'washerDryer', label: 'Washer/Dryer' },
              { key: 'petFriendly', label: 'Pet Friendly' },
              { key: 'gym', label: 'Gym' },
              { key: 'pool', label: 'Swimming Pool' },
              { key: 'balcony', label: 'Balcony' },
              { key: 'garden', label: 'Garden' },
              { key: 'securitySystem', label: 'Security System' },
            ].map(amenity => (
              <label key={amenity.key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 0' }}>
                <input
                  type="checkbox"
                  checked={formData.amenities[amenity.key]}
                  onChange={() => handleAmenityChange(amenity.key)}
                  style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#14B8A6' }}
                />
                <span style={{ fontSize: 14, color: 'var(--text-primary)', userSelect: 'none' }}>{amenity.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="listing-form-actions" style={{ display: 'flex', gap: 16, justifyContent: 'flex-end', paddingTop: 8 }}>
          <button
            type="button"
            onClick={handleCancel}
            className="btn"
            style={{ background: '#F1F5F9', color: '#64748B', border: 'none', padding: '12px 32px', fontSize: 14, fontWeight: 500 }}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ minWidth: 180, padding: '12px 32px', fontSize: 14, fontWeight: 500 }}
          >
            {loading ? 'Uploading images...' : 'Publish Listing'}
          </button>
        </div>
      </form>
    </OwnerLayout>
  );
}