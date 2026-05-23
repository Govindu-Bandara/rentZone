// src/components/common/UserProfile.jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { uploadAPI, userAPI } from '../../services/api';
import { User, Mail, Phone, Camera, Lock, Save, X, LogOut, Eye, EyeOff, CheckCircle, AlertCircle, ZoomIn, ZoomOut, RotateCw, RotateCcw, Move } from 'lucide-react';

/* ─────────────────────────────────────────────
   IMAGE CROP MODAL
   Canvas-based: drag to pan, slider to zoom,
   buttons to rotate. Produces a cropped Blob.
───────────────────────────────────────────── */
function ImageCropModal({ imageSrc, onConfirm, onCancel }) {
  const canvasRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef(null);
  const imageRef = useRef(null);
  const SIZE = 320; // crop circle diameter in px

  // Load image once
  useEffect(() => {
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => { imageRef.current = img; draw(); };
  }, [imageSrc]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, SIZE, SIZE);

    ctx.save();
    ctx.translate(SIZE / 2 + offset.x, SIZE / 2 + offset.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(zoom, zoom);

    const scale = Math.max(SIZE / img.width, SIZE / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();

    // Darken outside circle
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Circle border
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }, [zoom, rotation, offset]);

  useEffect(() => { draw(); }, [draw]);

  // Drag handlers
  const onMouseDown = (e) => {
    setDragging(true);
    dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };
  const onMouseMove = (e) => {
    if (!dragging) return;
    setOffset({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
  };
  const onMouseUp = () => setDragging(false);

  // Touch handlers
  const onTouchStart = (e) => {
    const t = e.touches[0];
    setDragging(true);
    dragStart.current = { x: t.clientX - offset.x, y: t.clientY - offset.y };
  };
  const onTouchMove = (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    setOffset({ x: t.clientX - dragStart.current.x, y: t.clientY - dragStart.current.y });
  };

  const handleConfirm = () => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    // Render final cropped circle to a clean canvas
    const out = document.createElement('canvas');
    out.width = SIZE;
    out.height = SIZE;
    const ctx = out.getContext('2d');

    // Clip to circle
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.save();
    ctx.translate(SIZE / 2 + offset.x, SIZE / 2 + offset.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(zoom, zoom);
    const scale = Math.max(SIZE / img.width, SIZE / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();

    out.toBlob((blob) => onConfirm(blob), 'image/jpeg', 0.92);
  };

  const btnBase = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 36, height: 36, borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(255,255,255,0.1)',
    color: 'white', cursor: 'pointer', transition: 'background 0.15s',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        background: '#0F172A',
        borderRadius: 20,
        padding: 28,
        width: '100%', maxWidth: 420,
        boxShadow: '0 30px 60px rgba(0,0,0,0.5)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'white', marginBottom: 2 }}>Adjust Photo</h3>
            <p style={{ fontSize: 12, color: '#64748B' }}>Drag to reposition · Scroll or slide to zoom</p>
          </div>
          <button onClick={onCancel} style={{ ...btnBase, width: 32, height: 32 }}>
            <X size={15} />
          </button>
        </div>

        {/* Canvas */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <canvas
            ref={canvasRef}
            width={SIZE}
            height={SIZE}
            style={{
              borderRadius: '50%',
              cursor: dragging ? 'grabbing' : 'grab',
              display: 'block',
              touchAction: 'none',
            }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onMouseUp}
            onWheel={(e) => {
              e.preventDefault();
              setZoom((z) => Math.min(4, Math.max(0.5, z - e.deltaY * 0.001)));
            }}
          />
        </div>

        {/* Zoom slider */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))} style={btnBase}>
              <ZoomOut size={15} />
            </button>
            <input
              type="range" min="50" max="400" step="1"
              value={Math.round(zoom * 100)}
              onChange={(e) => setZoom(Number(e.target.value) / 100)}
              style={{
                flex: 1, height: 4, borderRadius: 4,
                accentColor: '#2563EB', cursor: 'pointer',
              }}
            />
            <button onClick={() => setZoom((z) => Math.min(4, z + 0.1))} style={btnBase}>
              <ZoomIn size={15} />
            </button>
          </div>
          <div style={{ textAlign: 'center', fontSize: 11, color: '#475569', marginTop: 6 }}>
            {Math.round(zoom * 100)}% zoom
          </div>
        </div>

        {/* Rotation + reset */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          <button onClick={() => setRotation((r) => r - 90)} style={{ ...btnBase, flex: 1, gap: 6, fontSize: 12, color: 'white' }}>
            <RotateCcw size={14} /> Rotate Left
          </button>
          <button onClick={() => setRotation((r) => r + 90)} style={{ ...btnBase, flex: 1, gap: 6, fontSize: 12, color: 'white' }}>
            <RotateCw size={14} /> Rotate Right
          </button>
          <button
            onClick={() => { setZoom(1); setRotation(0); setOffset({ x: 0, y: 0 }); }}
            style={{ ...btnBase, flex: 1, fontSize: 12, color: '#94A3B8', gap: 6 }}
          >
            <Move size={14} /> Reset
          </button>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: '11px', borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'transparent', color: '#94A3B8',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            Cancel
          </button>
          <button onClick={handleConfirm} style={{
            flex: 2, padding: '11px', borderRadius: 10,
            border: 'none',
            background: 'linear-gradient(135deg, #2563EB, #14B8A6)',
            color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            Apply &amp; Use Photo
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────── */
const UserProfile = () => {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [profile, setProfile] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);

  // Crop modal state
  const [cropSrc, setCropSrc] = useState(null);        // raw data URL of selected file
  const [pendingFile, setPendingFile] = useState(null); // original File object (for name)

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    profileImage: '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  useEffect(() => { fetchProfile(); }, []);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const res = await userAPI.getProfile();
      const u = res.data?.user;
      setProfile(u);
      setFormData({
        firstName: u?.firstName || '',
        lastName: u?.lastName || '',
        phone: u?.phone || '',
        profileImage: u?.profileImage || '',
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      setPreviewImage(u?.profileImage || null);
    } catch (err) {
      setError('Failed to load profile. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /* ── Step 1: file selected → open crop modal ── */
  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError('Photo must be under 5MB.');
      return;
    }

    setError('');
    setPendingFile(file);

    // Read as data URL for the canvas
    const reader = new FileReader();
    reader.onload = (ev) => setCropSrc(ev.target.result);
    reader.readAsDataURL(file);

    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /* ── Step 2: user confirmed crop → upload blob ── */
  const handleCropConfirm = async (croppedBlob) => {
    setCropSrc(null);

    // Show cropped blob as local preview immediately
    const previewUrl = URL.createObjectURL(croppedBlob);
    setPreviewImage(previewUrl);

    setUploadingPhoto(true);
    try {
      // Canvas always outputs jpeg
      const fileName = (pendingFile?.name || 'profile.jpg').replace(/\.[^.]+$/, '.jpg');
      const fileType = 'image/jpeg';

      const { data } = await uploadAPI.getUploadUrl(fileName, fileType);
      const { uploadUrl, fileUrl, publicUrl } = data;
      const finalUrl = fileUrl || publicUrl;

      if (!finalUrl) throw new Error('No file URL returned from upload service');

      const s3Res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': fileType },
        body: croppedBlob,
      });

      if (!s3Res.ok) throw new Error('S3 upload failed');

      setFormData((prev) => ({ ...prev, profileImage: finalUrl }));
    } catch {
      setError('Failed to upload photo. Please try again.');
      setPreviewImage(profile?.profileImage || null);
      setFormData((prev) => ({ ...prev, profileImage: profile?.profileImage || '' }));
    } finally {
      setUploadingPhoto(false);
      setPendingFile(null);
    }
  };

  /* ── Step 2 alt: user cancelled crop ── */
  const handleCropCancel = () => {
    setCropSrc(null);
    setPendingFile(null);
  };

  /* ── Submit profile ── */
  const handleSubmit = async () => {
    setError('');
    setSuccess('');

    if (formData.newPassword && formData.newPassword !== formData.confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    if (formData.newPassword && formData.newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (formData.newPassword && !formData.currentPassword) {
      setError('Please enter your current password to set a new one.');
      return;
    }

    try {
      setLoading(true);

      const updateData = {
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        phone: formData.phone.trim(),
      };
      if (formData.profileImage && formData.profileImage.startsWith('http')) {
        updateData.profileImage = formData.profileImage;
      }
      if (formData.currentPassword && formData.newPassword) {
        updateData.currentPassword = formData.currentPassword;
        updateData.newPassword = formData.newPassword;
      }

      const res = await userAPI.updateProfile(updateData);
      const updated = res.data?.user;

      if (!updated) throw new Error('No user data returned from server.');

      const savedImage = updated.profileImage ?? formData.profileImage ?? profile?.profileImage ?? null;
      const mergedUser = { ...updated, profileImage: savedImage };

      setProfile(mergedUser);
      setPreviewImage(savedImage);
      setFormData((prev) => ({
        ...prev,
        profileImage: savedImage || '',
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      }));
      setSuccess('Profile updated successfully!');
      setEditMode(false);

      if (typeof updateUser === 'function') updateUser(mergedUser);

      try {
        const stored = JSON.parse(localStorage.getItem('user') || '{}');
        localStorage.setItem('user', JSON.stringify({
          ...stored,
          firstName: mergedUser.firstName,
          lastName: mergedUser.lastName,
          phone: mergedUser.phone,
          profileImage: savedImage,
        }));
      } catch { /* ignore */ }
    } catch (err) {
      const msg =
        err?.error || err?.data?.error || err?.data?.message ||
        err?.message || 'Failed to update profile. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setEditMode(false);
    setError('');
    setPreviewImage(profile?.profileImage || null);
    setFormData({
      firstName: profile?.firstName || '',
      lastName: profile?.lastName || '',
      phone: profile?.phone || '',
      profileImage: profile?.profileImage || '',
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    });
  };

  const handleLogout = () => { logout(); navigate('/login'); };

  const initials = `${profile?.firstName?.[0] || ''}${profile?.lastName?.[0] || ''}`.toUpperCase() || 'U';

  if (loading && !profile) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          <p style={{ color: '#64748B', fontSize: 14 }}>Loading profile…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 0 40px' }}>

      {/* ── Back button ── */}
      <button
        onClick={() => navigate(-1)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 12px', marginBottom: 24,
          background: 'transparent', border: 'none',
          color: '#475569', fontSize: 14, fontWeight: 600,
          cursor: 'pointer', transition: 'color 0.2s',
        }}
        onMouseEnter={(e) => e.target.style.color = '#1E293B'}
        onMouseLeave={(e) => e.target.style.color = '#475569'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back
      </button>

      {/* ── Crop Modal ── */}
      {cropSrc && (
        <ImageCropModal
          imageSrc={cropSrc}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}

      {/* ── Header card ── */}
      <div style={{
        background: 'linear-gradient(135deg, #2563EB 0%, #14B8A6 100%)',
        borderRadius: 20,
        padding: '36px 32px',
        marginBottom: 24,
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -40, right: -40,
          width: 200, height: 200, borderRadius: '50%',
          background: 'rgba(255,255,255,0.08)',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          {/* Avatar */}
          <label
            htmlFor="avatar-upload"
            style={{
              position: 'relative',
              width: 96, height: 96, borderRadius: '50%',
              border: '3px solid rgba(255,255,255,0.5)',
              cursor: editMode ? 'pointer' : 'default',
              flexShrink: 0,
              background: '#1D4ED8',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
              pointerEvents: editMode ? 'auto' : 'none',
            }}
          >
            {previewImage ? (
              <img src={previewImage} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontSize: 32, fontWeight: 700, color: 'white' }}>{initials}</span>
            )}
            {editMode && (
              <div style={{
                position: 'absolute', inset: 0,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '50%',
              }}>
                {uploadingPhoto
                  ? <div className="spinner" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'white' }} />
                  : <Camera size={22} color="white" />
                }
              </div>
            )}
            <input
              id="avatar-upload"
              ref={fileInputRef}
              type="file"
              accept="image/*"
              disabled={!editMode || uploadingPhoto}
              style={{ display: 'none' }}
              onChange={handlePhotoChange}
            />
          </label>

          {/* Name + role */}
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: 'white', marginBottom: 4 }}>
              {profile?.firstName} {profile?.lastName}
            </h1>
            <span style={{
              display: 'inline-block',
              background: 'rgba(255,255,255,0.2)',
              color: 'white',
              fontSize: 12, fontWeight: 600,
              borderRadius: 20, padding: '3px 12px',
              textTransform: 'capitalize', letterSpacing: '0.5px',
            }}>
              {profile?.role}
            </span>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 6 }}>
              Member since {profile?.createdAt
                ? new Date(profile.createdAt).toLocaleDateString('en-LK', { month: 'long', year: 'numeric' })
                : '—'}
            </p>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {editMode ? (
              <>
                <button onClick={handleCancel} style={btnStyle('ghost')}>
                  <X size={15} /> Cancel
                </button>
                <button onClick={handleSubmit} disabled={loading || uploadingPhoto} style={btnStyle('white')}>
                  {loading
                    ? <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2, borderColor: 'rgba(37,99,235,0.3)', borderTopColor: '#2563EB' }} />
                    : <Save size={15} />}
                  Save Changes
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setEditMode(true)} style={btnStyle('white')}>Edit Profile</button>
                <button onClick={() => setShowLogoutConfirm(true)} style={btnStyle('ghost')}>
                  <LogOut size={15} /> Logout
                </button>
              </>
            )}
          </div>
        </div>

        {editMode && (
          <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 16, marginBottom: 0 }}>
            📷 Click your avatar to change your photo — you can crop &amp; adjust it before saving
          </p>
        )}
      </div>

      {/* ── Alerts ── */}
      {success && (
        <div style={alertStyle('success')}>
          <CheckCircle size={16} /> {success}
        </div>
      )}
      {error && (
        <div style={alertStyle('error')}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* ── Info card ── */}
      <div style={cardStyle}>
        <h2 style={sectionTitle}>Personal Information</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
          <Field label="First Name" icon={<User size={15} />} value={formData.firstName} editMode={editMode} name="firstName"
            onChange={(e) => setFormData((p) => ({ ...p, firstName: e.target.value }))} />
          <Field label="Last Name" icon={<User size={15} />} value={formData.lastName} editMode={editMode} name="lastName"
            onChange={(e) => setFormData((p) => ({ ...p, lastName: e.target.value }))} />
          <Field label="Email Address" icon={<Mail size={15} />} value={profile?.email} editMode={false} name="email" />
          <Field label="Phone Number" icon={<Phone size={15} />} value={formData.phone} editMode={editMode} name="phone"
            type="tel" placeholder="Not provided"
            onChange={(e) => setFormData((p) => ({ ...p, phone: e.target.value }))} />
        </div>
      </div>

      {/* ── Password card ── */}
      {editMode && (
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <h2 style={sectionTitle}>
            <Lock size={16} style={{ display: 'inline', marginRight: 6 }} />
            Change Password
          </h2>
          <p style={{ fontSize: 13, color: '#94A3B8', marginBottom: 20 }}>
            Leave blank if you don't want to change your password.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
            <PasswordField label="Current Password" name="currentPassword" value={formData.currentPassword}
              show={showCurrentPw} onToggle={() => setShowCurrentPw((v) => !v)}
              onChange={(e) => setFormData((p) => ({ ...p, currentPassword: e.target.value }))} />
            <PasswordField label="New Password" name="newPassword" value={formData.newPassword}
              show={showNewPw} onToggle={() => setShowNewPw((v) => !v)}
              onChange={(e) => setFormData((p) => ({ ...p, newPassword: e.target.value }))} />
            <PasswordField label="Confirm New Password" name="confirmPassword" value={formData.confirmPassword}
              show={showConfirmPw} onToggle={() => setShowConfirmPw((v) => !v)}
              onChange={(e) => setFormData((p) => ({ ...p, confirmPassword: e.target.value }))} />
          </div>
        </div>
      )}

      {/* ── Account info card ── */}
      <div style={{ ...cardStyle, marginTop: 16 }}>
        <h2 style={sectionTitle}>Account Details</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          {[
            { label: 'Account ID', value: profile?._id?.slice(-8).toUpperCase() },
            { label: 'Role', value: profile?.role, cap: true },
            { label: 'Verified', value: profile?.isVerified ? '✅ Verified' : '⏳ Pending' },
            { label: 'Last Login', value: profile?.lastLogin ? new Date(profile.lastLogin).toLocaleString('en-LK') : '—' },
          ].map(({ label, value, cap }) => (
            <div key={label}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 14, color: '#1E293B', fontWeight: 500, textTransform: cap ? 'capitalize' : 'none' }}>{value || '—'}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Logout confirm modal ── */}
      {showLogoutConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 2000, padding: 20,
        }}>
          <div style={{
            background: 'white', borderRadius: 16, padding: 28,
            width: '100%', maxWidth: 360,
            boxShadow: '0 25px 50px rgba(0,0,0,0.2)',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%',
                background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 14px',
              }}>
                <LogOut size={22} color="#F59E0B" />
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>Confirm Logout</h3>
              <p style={{ fontSize: 14, color: '#64748B' }}>Are you sure you want to log out of your account?</p>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowLogoutConfirm(false)} style={{
                flex: 1, padding: '10px', borderRadius: 8,
                border: '1px solid #E2E8F0', background: 'white',
                color: '#475569', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}>Cancel</button>
              <button onClick={handleLogout} style={{
                flex: 1, padding: '10px', borderRadius: 8,
                border: 'none', background: '#EF4444',
                color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}>Logout</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Sub-components ── */
function Field({ label, icon, value, editMode, name, onChange, type = 'text', placeholder = '—' }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748B', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
        {label}
      </label>
      {editMode ? (
        <input type={type} name={name} value={value || ''} onChange={onChange} style={inputStyle} placeholder={placeholder} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#94A3B8', flexShrink: 0 }}>{icon}</span>
          <span style={{ fontSize: 15, color: value ? '#1E293B' : '#CBD5E1', fontWeight: value ? 500 : 400 }}>
            {value || placeholder}
          </span>
        </div>
      )}
    </div>
  );
}

function PasswordField({ label, name, value, show, onToggle, onChange }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748B', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type={show ? 'text' : 'password'} name={name} value={value} onChange={onChange}
          style={{ ...inputStyle, paddingRight: 40 }} placeholder="••••••••"
        />
        <button type="button" onClick={onToggle} style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8',
        }}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

/* ── Style helpers ── */
const inputStyle = {
  width: '100%', padding: '9px 12px', fontSize: 14,
  border: '1.5px solid #E2E8F0', borderRadius: 8,
  color: '#1E293B', background: '#F8FAFC',
  outline: 'none', boxSizing: 'border-box',
  transition: 'border-color 0.2s',
};

const cardStyle = {
  background: 'white', borderRadius: 16, padding: '24px 28px',
  border: '1px solid #F1F5F9', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
};

const sectionTitle = {
  fontSize: 15, fontWeight: 700, color: '#0F172A',
  marginBottom: 20, paddingBottom: 12, borderBottom: '1px solid #F1F5F9',
};

function btnStyle(variant) {
  const base = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 16px', borderRadius: 8,
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: 'none', transition: 'all 0.2s',
  };
  if (variant === 'white') return { ...base, background: 'white', color: '#2563EB' };
  if (variant === 'ghost') return { ...base, background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.3)' };
  return base;
}

function alertStyle(type) {
  const isSuccess = type === 'success';
  return {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '12px 16px', borderRadius: 10, marginBottom: 16,
    fontSize: 14, fontWeight: 500,
    background: isSuccess ? '#ECFDF5' : '#FEF2F2',
    color: isSuccess ? '#065F46' : '#991B1B',
    border: `1px solid ${isSuccess ? '#A7F3D0' : '#FECACA'}`,
  };
}

export default UserProfile;