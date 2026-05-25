import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authAPI, uploadAPI } from '../../services/api';

const PASSWORD_RULES = [
  { label: '8+ characters',     test: p => p.length >= 8 },
  { label: 'Uppercase letter',  test: p => /[A-Z]/.test(p) },
  { label: 'Lowercase letter',  test: p => /[a-z]/.test(p) },
  { label: 'Number',            test: p => /\d/.test(p) },
  { label: 'Special character', test: p => /[!@#$%^&*(),.?":{}|<>]/.test(p) },
];

function getPasswordStrength(password) {
  const passed = PASSWORD_RULES.filter(r => r.test(password)).length;
  if (passed <= 1) return { score: passed, label: 'Weak',   cls: 'weak'   };
  if (passed <= 3) return { score: passed, label: 'Fair',   cls: 'medium' };
  if (passed === 4) return { score: passed, label: 'Good',  cls: 'strong' };
  return              { score: passed, label: 'Strong', cls: 'strong' };
}

const INITIAL_RENTER = {
  fullName: '', email: '', phone: '', password: '', confirmPassword: '', agreeTerms: false,
};
const INITIAL_OWNER = {
  fullName: '', email: '', phone: '', password: '', confirmPassword: '',
  bankAccountNumber: '', accountHolderName: '', bankName: '', branchName: '',
  agreeTerms: false,
};

function normalizePhoneNumber(phone) {
  const value = phone.replace(/[\s-]/g, '').trim();
  if (/^\+94\d{9}$/.test(value)) {
    return `0${value.slice(3)}`;
  }
  return value;
}

// Reusable NIC image uploader sub-component
function NICUploader({ label, side, onUploadComplete, preview, error }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState(preview || null);
  const [localError, setLocalError] = useState('');
  // Stable session ID for this registration attempt
  const sessionId = useRef(
    globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/jpg', 'image/webp'].includes(file.type)) {
      setLocalError('Only JPG, PNG, WEBP allowed.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setLocalError('Image must be under 5MB.');
      return;
    }

    setLocalError('');
    setUploading(true);

    // Show local preview immediately
    const previewUrl = URL.createObjectURL(file);
    setLocalPreview(previewUrl);

    try {
      const { data } = await uploadAPI.getNicUploadUrl(file.name, file.type, `nic_${side}`, sessionId.current);
      const { uploadUrl, publicUrl } = data;

      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!res.ok) throw new Error('Upload failed');
      onUploadComplete(publicUrl);
    } catch {
      setLocalError('Upload failed. Please try again.');
      setLocalPreview(null);
      onUploadComplete('');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="form-group">
      <label className="form-label required">{label}</label>
      <div
        onClick={() => !uploading && inputRef.current?.click()}
        style={{
          border: `2px dashed ${error || localError ? '#EF4444' : localPreview ? '#22C55E' : '#CBD5E1'}`,
          borderRadius: 10,
          padding: 16,
          cursor: uploading ? 'not-allowed' : 'pointer',
          background: localPreview ? '#F0FDF4' : '#F8FAFC',
          transition: 'all 0.2s',
          textAlign: 'center',
          minHeight: 100,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8
        }}
      >
        {uploading ? (
          <>
            <div style={{ width: 24, height: 24, border: '3px solid #CBD5E1', borderTopColor: '#2563EB', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ fontSize: 13, color: '#64748B' }}>Uploading…</span>
          </>
        ) : localPreview ? (
          <>
            <img src={localPreview} alt={label} style={{ width: '100%', maxHeight: 120, objectFit: 'cover', borderRadius: 6 }} />
            <span style={{ fontSize: 12, color: '#22C55E', fontWeight: 600 }}>✓ Uploaded — click to change</span>
          </>
        ) : (
          <>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5">
              <rect x="3" y="5" width="18" height="14" rx="2"/>
              <circle cx="8.5" cy="10.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <span style={{ fontSize: 13, color: '#64748B' }}>Click to upload {label}</span>
            <span style={{ fontSize: 11, color: '#94A3B8' }}>JPG, PNG, WEBP · Max 5MB</span>
          </>
        )}
      </div>
      {(error || localError) && (
        <span className="form-error">{error || localError}</span>
      )}
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
    </div>
  );
}

export default function Register() {
  const navigate = useNavigate();

  const [role, setRole] = useState('renter');
  const [form, setForm] = useState(INITIAL_RENTER);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [nicFrontUrl, setNicFrontUrl] = useState('');
  const [nicBackUrl, setNicBackUrl] = useState('');

  const handleRoleChange = (r) => {
    setRole(r);
    setForm(r === 'renter' ? INITIAL_RENTER : INITIAL_OWNER);
    setError('');
    setFieldErrors({});
    setNicFrontUrl('');
    setNicBackUrl('');
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    if (fieldErrors[name]) setFieldErrors(prev => ({ ...prev, [name]: '' }));
    if (error) setError('');
  };

  const validate = () => {
    const errs = {};
    if (!form.fullName.trim()) errs.fullName = 'Full name is required';
    if (!/\S+@\S+\.\S+/.test(form.email)) errs.email = 'Valid email is required';
    if (!/^(0\d{9}|\+94\d{9})$/.test(form.phone.replace(/[\s-]/g, '').trim())) {
      errs.phone = 'Enter a valid phone number starting with 0 or +94';
    }

    // Password: collect all failing rules and show them
    if (!form.password) {
      errs.password = PASSWORD_RULES.map(r => r.label);
    } else {
      const failedRules = PASSWORD_RULES.filter(r => !r.test(form.password)).map(r => r.label);
      if (failedRules.length > 0) errs.password = failedRules;
    }

    if (form.password !== form.confirmPassword) errs.confirmPassword = 'Passwords do not match';
    if (!form.agreeTerms) errs.agreeTerms = 'You must accept the terms';

    if (role === 'owner') {
      if (!form.bankAccountNumber.trim()) errs.bankAccountNumber = 'Bank account number required';
      if (!/^\d+$/.test(form.bankAccountNumber)) errs.bankAccountNumber = 'Must be numeric only';
      if (!form.accountHolderName.trim()) errs.accountHolderName = 'Account holder name required';
      if (!form.bankName.trim()) errs.bankName = 'Bank name required';
      if (!form.branchName.trim()) errs.branchName = 'Branch name required';
      if (!nicFrontUrl) errs.nicFront = 'NIC front image is required';
      if (!nicBackUrl) errs.nicBack = 'NIC back image is required';
    }

    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setFieldErrors(errs); return; }

    setLoading(true);
    setError('');

    const [firstName, ...rest] = form.fullName.trim().split(' ');
    const lastName = rest.join(' ') || firstName;

    const payload = {
      firstName, lastName,
      email: form.email,
      password: form.password,
      phone: normalizePhoneNumber(form.phone),
      role: role === 'owner' ? 'owner' : 'renter',
    };

    if (role === 'owner') {
      payload.bankAccountNumber = form.bankAccountNumber;
      payload.accountHolderName = form.accountHolderName;
      payload.bankName = form.bankName;
      payload.branchName = form.branchName;
      payload.nicFrontUrl = nicFrontUrl;
      payload.nicBackUrl = nicBackUrl;
    }

    try {
      const res = await authAPI.register(payload);
      const { userId, email } = res.data;

      // Navigate to email verification page
      navigate('/verify-email', { state: { userId, email: form.email } });

    } catch (err) {
      const msg = err?.response?.data?.error || err?.data?.error || err?.response?.data?.message || 'Registration failed. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const strength = getPasswordStrength(form.password);

  return (
    <div className="auth-page">
      {/* Hero */}
      <div className="auth-hero">
        <img
          src="https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=900&auto=format&fit=crop&q=60"
          alt="Modern building exterior"
          className="auth-hero-bg"
        />
        <div className="auth-hero-overlay" />
        <div className="auth-hero-content">
          <div className="auth-hero-logo">
            <img src="/logo.png" alt="Rent Zone" style={{ width: 72, height: 72, borderRadius: 12 }} />
            <span className="auth-hero-logo-text">Rent Zone</span>
          </div>
          <h1 className="auth-hero-title">Join Rent Zone Today</h1>
          <p className="auth-hero-subtitle">
            Create your account and start your rental journey. Whether you're looking for a home or listing your property, we've got you covered.
          </p>
          <div className="auth-hero-features">
            <div className="auth-hero-feature"><div className="auth-hero-feature-dot" />Verified listings only</div>
            <div className="auth-hero-feature"><div className="auth-hero-feature-dot" />Secure payment solutions</div>
            <div className="auth-hero-feature"><div className="auth-hero-feature-dot" />24/7 customer support</div>
          </div>
        </div>
      </div>

      {/* Form Panel */}
      <div className="auth-panel" style={{ width: 'clamp(320px, 42vw, 520px)' }}>
        <div className="auth-form-container" style={{ maxWidth: 460, width: '100%' }}>
          <div className="auth-form-header">
            <h2 className="auth-form-title">Create Account</h2>
            <p className="auth-form-subtitle">Get started with Rent Zone</p>
          </div>

          {/* Role Tabs */}
          <div className="role-tabs" style={{ marginBottom: 20 }}>
            <button type="button" className={`role-tab${role === 'renter' ? ' active' : ''}`} onClick={() => handleRoleChange('renter')}>
              I'm a Renter
            </button>
            <button type="button" className={`role-tab${role === 'owner' ? ' active' : ''}`} onClick={() => handleRoleChange('owner')}>
              I'm an Owner
            </button>
          </div>

          {error && (
            <div className="auth-error" style={{ marginBottom: 16 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            {/* Full Name */}
            <div className="form-group">
              <label className="form-label required">Full Name</label>
              <div className="input-wrapper">
                <span className="input-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                </span>
                <input type="text" name="fullName" className={`form-input has-icon${fieldErrors.fullName ? ' error' : ''}`}
                  placeholder="John Doe" value={form.fullName} onChange={handleChange} autoFocus />
              </div>
              {fieldErrors.fullName && <span className="form-error">{fieldErrors.fullName}</span>}
            </div>

            {/* Email */}
            <div className="form-group">
              <label className="form-label required">Email Address</label>
              <div className="input-wrapper">
                <span className="input-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                </span>
                <input type="email" name="email" className={`form-input has-icon${fieldErrors.email ? ' error' : ''}`}
                  placeholder="you@example.com" value={form.email} onChange={handleChange} />
              </div>
              {fieldErrors.email && <span className="form-error">{fieldErrors.email}</span>}
            </div>

            {/* Phone */}
            <div className="form-group">
              <label className="form-label required">Contact Number</label>
              <div className="input-wrapper">
                <span className="input-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.36a2 2 0 0 1 1.45-2.14l3-.76a2 2 0 0 1 2.09.91l1.47 2.36a2 2 0 0 1-.45 2.62l-1.39 1.4a16 16 0 0 0 6 6l1.4-1.39a2 2 0 0 1 2.62-.45l2.36 1.47a2 2 0 0 1 .91 2.09z"/>
                  </svg>
                </span>
                <input type="tel" name="phone" className={`form-input has-icon${fieldErrors.phone ? ' error' : ''}`}
                  placeholder="+94 77 234 5678" value={form.phone} onChange={handleChange} />
              </div>
              {fieldErrors.phone && <span className="form-error">{fieldErrors.phone}</span>}
            </div>

            {/* Password */}
            <div className="form-group">
              <label className="form-label required">Password</label>
              <div className="input-wrapper">
                <span className="input-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                </span>
                <input type={showPassword ? 'text' : 'password'} name="password"
                  className={`form-input has-icon${fieldErrors.password ? ' error' : ''}`}
                  placeholder="Create a strong password" value={form.password} onChange={handleChange} />
                <button type="button" className="input-toggle" onClick={() => setShowPassword(v => !v)}>
                  {showPassword
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
              {form.password && (
                <div className="password-strength">
                  <div className="password-strength-bars">
                    {[1,2,3,4,5].map(i => (
                      <div key={i} className={`strength-bar${i <= strength.score ? ` ${strength.cls}` : ''}`} />
                    ))}
                  </div>
                  <span className="strength-label">Strength: {strength.label}</span>
                </div>
              )}
              {fieldErrors.password && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="form-error" style={{ fontWeight: 600 }}>Password must include:</span>
                  {(Array.isArray(fieldErrors.password) ? fieldErrors.password : [fieldErrors.password]).map(req => (
                    <span key={req} className="form-error" style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 400 }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="13"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      {req}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div className="form-group">
              <label className="form-label required">Confirm Password</label>
              <div className="input-wrapper">
                <span className="input-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                </span>
                <input type={showConfirm ? 'text' : 'password'} name="confirmPassword"
                  className={`form-input has-icon${fieldErrors.confirmPassword ? ' error' : ''}`}
                  placeholder="Confirm your password" value={form.confirmPassword} onChange={handleChange} />
                <button type="button" className="input-toggle" onClick={() => setShowConfirm(v => !v)}>
                  {showConfirm
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
              {fieldErrors.confirmPassword && <span className="form-error">{fieldErrors.confirmPassword}</span>}
            </div>

            {/* ── Owner-only fields ── */}
            {role === 'owner' && (
              <>
                {/* Bank Details */}
                <div className="form-section-title" style={{ marginTop: 4 }}>Bank Details</div>
                <div className="auth-form-row">
                  <div className="form-group">
                    <label className="form-label required">Account Holder Name</label>
                    <input type="text" name="accountHolderName" className={`form-input${fieldErrors.accountHolderName ? ' error' : ''}`}
                      placeholder="John Doe" value={form.accountHolderName} onChange={handleChange} />
                    {fieldErrors.accountHolderName && <span className="form-error">{fieldErrors.accountHolderName}</span>}
                  </div>
                  <div className="form-group">
                    <label className="form-label required">Bank Account Number</label>
                    <input type="text" name="bankAccountNumber" className={`form-input${fieldErrors.bankAccountNumber ? ' error' : ''}`}
                      placeholder="Account number" value={form.bankAccountNumber} onChange={handleChange} inputMode="numeric" />
                    {fieldErrors.bankAccountNumber && <span className="form-error">{fieldErrors.bankAccountNumber}</span>}
                  </div>
                </div>
                <div className="auth-form-row">
                  <div className="form-group">
                    <label className="form-label required">Bank Name</label>
                    <input type="text" name="bankName" className={`form-input${fieldErrors.bankName ? ' error' : ''}`}
                      placeholder="e.g. Commercial Bank" value={form.bankName} onChange={handleChange} />
                    {fieldErrors.bankName && <span className="form-error">{fieldErrors.bankName}</span>}
                  </div>
                  <div className="form-group">
                    <label className="form-label required">Branch Name</label>
                    <input type="text" name="branchName" className={`form-input${fieldErrors.branchName ? ' error' : ''}`}
                      placeholder="e.g. Colombo 07" value={form.branchName} onChange={handleChange} />
                    {fieldErrors.branchName && <span className="form-error">{fieldErrors.branchName}</span>}
                  </div>
                </div>

                {/* NIC Images */}
                <div className="form-section-title" style={{ marginTop: 8 }}>
                  Identity Verification (NIC)
                </div>
                <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16, lineHeight: 1.6 }}>
                  Upload clear photos of both sides of your National Identity Card. These will be reviewed by our admin team to verify your identity.
                </p>
                <div className="auth-form-row">
                  <NICUploader
                    label="NIC Front Side"
                    side="front"
                    onUploadComplete={setNicFrontUrl}
                    preview={nicFrontUrl}
                    error={fieldErrors.nicFront}
                  />
                  <NICUploader
                    label="NIC Back Side"
                    side="back"
                    onUploadComplete={setNicBackUrl}
                    preview={nicBackUrl}
                    error={fieldErrors.nicBack}
                  />
                </div>
                <div style={{
                  background: '#FEF3C7', border: '1px solid #FDE68A',
                  borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#92400E'
                }}>
                  ⚠️ Your NIC images are stored securely and will only be viewed by Rent Zone administrators for identity verification.
                </div>
              </>
            )}

            {/* Terms */}
            <div>
              <label className="checkbox-wrapper">
                <input type="checkbox" name="agreeTerms" checked={form.agreeTerms} onChange={handleChange} />
                <span className="checkbox-label">
                  I agree to the <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> and{' '}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
                </span>
              </label>
              {fieldErrors.agreeTerms && <span className="form-error" style={{ marginTop: 4 }}>{fieldErrors.agreeTerms}</span>}
            </div>

            {/* Submit */}
            <button type="submit" className={`btn btn-primary btn-lg btn-full${loading ? ' btn-loading' : ''}`} disabled={loading}>
              {!loading && (
                <>
                  Create Account
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                  </svg>
                </>
              )}
            </button>
          </form>

          <p className="auth-form-footer" style={{ marginTop: 20 }}>
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}