import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { authAPI } from '../../services/api';

const PASSWORD_RULES = [
  { label: '8+ characters', test: p => p.length >= 8 },
  { label: 'Uppercase letter', test: p => /[A-Z]/.test(p) },
  { label: 'Lowercase letter', test: p => /[a-z]/.test(p) },
  { label: 'Number', test: p => /\d/.test(p) },
  { label: 'Special character', test: p => /[!@#$%^&*(),.?":{}|<>]/.test(p) },
];

function getPasswordStrength(password) {
  const passed = PASSWORD_RULES.filter(r => r.test(password)).length;
  if (passed <= 2) return { score: passed, label: 'Weak', cls: 'weak' };
  if (passed <= 3) return { score: passed, label: 'Fair', cls: 'medium' };
  if (passed === 4) return { score: passed, label: 'Good', cls: 'strong' };
  return { score: passed, label: 'Strong', cls: 'strong' };
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [validToken, setValidToken] = useState(true);

  useEffect(() => {
    // Extract token and email from URL query parameters
    const params = new URLSearchParams(location.search);
    const urlToken = params.get('token');
    const urlEmail = params.get('email');

    if (!urlToken || !urlEmail) {
      setValidToken(false);
      setError('Invalid reset link. Please request a new password reset.');
    } else {
      setToken(urlToken);
      setEmail(decodeURIComponent(urlEmail));
    }
  }, [location]);

  const validatePassword = () => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return false;
    }
    
    const failedRules = PASSWORD_RULES.filter(r => !r.test(password));
    if (failedRules.length > 0) {
      setError(`Password must contain: ${failedRules.map(r => r.label.toLowerCase()).join(', ')}`);
      return false;
    }
    
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return false;
    }
    
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!validatePassword()) {
      return;
    }
    
    setLoading(true);
    
    try {
      await authAPI.resetPassword(token, email, password);
      setSuccess(true);
      
      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate('/login');
      }, 3000);
      
    } catch (err) {
      const msg = err?.response?.data?.error || err?.data?.error || 'Failed to reset password. Please try again.';
      setError(msg);
      if (msg.includes('expired') || msg.includes('Invalid')) {
        setValidToken(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const strength = getPasswordStrength(password);

  if (!validToken) {
    return (
      <div className="auth-page">
        <div className="auth-hero">
          <img
            src="https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=900&auto=format&fit=crop&q=60"
            alt="Modern apartment building"
            className="auth-hero-bg"
          />
          <div className="auth-hero-overlay" />
          <div className="auth-hero-content">
            <div className="auth-hero-logo">
              <img src="/logo.png" alt="Rent Zone" style={{ width: 72, height: 72, borderRadius: 12 }} />
              <span className="auth-hero-logo-text">Rent Zone</span>
            </div>
            <h1 className="auth-hero-title">Invalid Reset Link</h1>
            <p className="auth-hero-subtitle">
              This password reset link is invalid or has expired.
            </p>
          </div>
        </div>
        
        <div className="auth-panel">
          <div className="auth-form-container">
            <div className="auth-form-header">
              <div style={{
                width: 64, height: 64, borderRadius: '50%',
                background: '#EF4444',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 16px'
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <h2 className="auth-form-title">Link Expired or Invalid</h2>
              <p className="auth-form-subtitle">
                Password reset links expire after 15 minutes for security reasons.
              </p>
            </div>
            
            <div style={{ textAlign: 'center', marginTop: 24 }}>
              <Link to="/forgot-password" className="btn btn-primary btn-lg btn-full">
                Request New Reset Link
              </Link>
            </div>
            
            <p className="auth-form-footer" style={{ marginTop: 20 }}>
              <Link to="/login">Back to Login</Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-hero">
        <img
          src="https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=900&auto=format&fit=crop&q=60"
          alt="Modern apartment building"
          className="auth-hero-bg"
        />
        <div className="auth-hero-overlay" />
        <div className="auth-hero-content">
          <div className="auth-hero-logo">
            <img src="/logo.png" alt="Rent Zone" style={{ width: 72, height: 72, borderRadius: 12 }} />
            <span className="auth-hero-logo-text">Rent Zone</span>
          </div>
          <h1 className="auth-hero-title">Create New Password</h1>
          <p className="auth-hero-subtitle">
            Choose a strong, unique password for your account.
          </p>
          <div className="auth-hero-features">
            <div className="auth-hero-feature">
              <div className="auth-hero-feature-dot" />
              Use a mix of characters
            </div>
            <div className="auth-hero-feature">
              <div className="auth-hero-feature-dot" />
              Don't reuse old passwords
            </div>
            <div className="auth-hero-feature">
              <div className="auth-hero-feature-dot" />
              Keep it memorable
            </div>
          </div>
        </div>
      </div>

      <div className="auth-panel">
        <div className="auth-form-container">
          <div className="auth-form-header">
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'linear-gradient(135deg,#2563EB,#14B8A6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px'
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <h2 className="auth-form-title">Reset Password</h2>
            <p className="auth-form-subtitle">
              For <strong>{email}</strong>
            </p>
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

          {success ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '16px', borderRadius: 10, marginBottom: 24,
                background: '#ECFDF5', color: '#065F46',
                border: '1px solid #A7F3D0'
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span>Password reset successful! Redirecting to login...</span>
              </div>
              <Link to="/login" className="btn btn-primary btn-lg btn-full">
                Go to Login
              </Link>
            </div>
          ) : (
            <form className="auth-form" onSubmit={handleSubmit}>
              {/* New Password */}
              <div className="form-group">
                <label className="form-label required">New Password</label>
                <div className="input-wrapper">
                  <span className="input-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  </span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="form-input has-icon"
                    placeholder="Create a strong password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="input-toggle"
                    onClick={() => setShowPassword(v => !v)}
                  >
                    {showPassword ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
                {password && (
                  <div className="password-strength">
                    <div className="password-strength-bars">
                      {[1,2,3,4,5].map(i => (
                        <div key={i} className={`strength-bar${i <= strength.score ? ` ${strength.cls}` : ''}`} />
                      ))}
                    </div>
                    <span className="strength-label">Strength: {strength.label}</span>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div className="form-group">
                <label className="form-label required">Confirm New Password</label>
                <div className="input-wrapper">
                  <span className="input-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  </span>
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    className="form-input has-icon"
                    placeholder="Confirm your new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="input-toggle"
                    onClick={() => setShowConfirm(v => !v)}
                  >
                    {showConfirm ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Password Requirements */}
              <div style={{ marginBottom: 24 }}>
                <p style={{ fontSize: 12, color: '#64748B', marginBottom: 8 }}>Password requirements:</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {PASSWORD_RULES.map(rule => (
                    <span
                      key={rule.label}
                      style={{
                        fontSize: 11,
                        padding: '4px 8px',
                        borderRadius: 4,
                        background: rule.test(password) ? '#D1FAE5' : '#FEE2E2',
                        color: rule.test(password) ? '#065F46' : '#991B1B'
                      }}
                    >
                      {rule.test(password) ? '✓' : '✗'} {rule.label}
                    </span>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className={`btn btn-primary btn-lg btn-full${loading ? ' btn-loading' : ''}`}
                disabled={loading || !password || !confirmPassword}
              >
                {!loading && (
                  <>
                    Reset Password
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="5" y1="12" x2="19" y2="12"/>
                      <polyline points="12 5 19 12 12 19"/>
                    </svg>
                  </>
                )}
              </button>
            </form>
          )}

          {!success && (
            <p className="auth-form-footer" style={{ marginTop: 20 }}>
              <Link to="/login">Back to Login</Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}