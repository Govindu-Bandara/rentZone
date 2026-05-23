import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { authAPI } from '../../services/api';

export default function VerifyEmail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  // userId and email come from Register via navigation state
  const { userId, email } = location.state || {};

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [countdown, setCountdown] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const inputRefs = useRef([]);

  // Redirect if no userId in state
  useEffect(() => {
    if (!userId) navigate('/register');
  }, [userId, navigate]);

  // Countdown timer for resend
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setCanResend(true);
    }
  }, [countdown]);

  const handleOtpChange = (index, value) => {
    if (!/^\d*$/.test(value)) return; // digits only
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1); // one digit per box
    setOtp(newOtp);
    setError('');

    // Auto-advance
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all filled
    if (newOtp.every(d => d !== '') && value) {
      handleVerify(newOtp.join(''));
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && index > 0) inputRefs.current[index - 1]?.focus();
    if (e.key === 'ArrowRight' && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      const digits = pasted.split('');
      setOtp(digits);
      inputRefs.current[5]?.focus();
      handleVerify(pasted);
    }
  };

  const handleVerify = async (code) => {
    const otpCode = code || otp.join('');
    if (otpCode.length !== 6) {
      setError('Please enter the complete 6-digit code.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await authAPI.verifyEmail({ userId, otp: otpCode });
      const { accessToken, refreshToken, user } = res.data;

      setSuccess('Email verified! Redirecting to your dashboard…');
      login(user, accessToken, refreshToken);

      setTimeout(() => {
        const role = user.role === 'landlord' ? 'owner' : user.role;
        if (role === 'admin') navigate('/admin/dashboard');
        else if (role === 'owner') navigate('/owner/dashboard');
        else navigate('/renter/dashboard');
      }, 1500);

    } catch (err) {
      const msg = err?.response?.data?.error || err?.data?.error || 'Invalid or expired code.';
      setError(msg);
      // Clear OTP inputs on error
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!canResend) return;
    setResending(true);
    setError('');
    setSuccess('');

    try {
      await authAPI.resendOTP({ userId });
      setSuccess('New verification code sent! Check your inbox.');
      setCountdown(60);
      setCanResend(false);
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } catch (err) {
      const msg = err?.response?.data?.error || err?.data?.error || 'Failed to resend. Please try again.';
      setError(msg);
    } finally {
      setResending(false);
    }
  };

  const maskedEmail = email
    ? email.replace(/(.{2})(.*)(?=@)/, (_, a, b) => a + '*'.repeat(b.length))
    : 'your email';

  return (
    <div className="auth-page">
      {/* Hero */}
      <div className="auth-hero">
        <img
          src="https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=900&auto=format&fit=crop&q=60"
          alt="Building"
          className="auth-hero-bg"
        />
        <div className="auth-hero-overlay" />
        <div className="auth-hero-content">
          <div className="auth-hero-logo">
            <img src="/logo.png" alt="Rent Zone" style={{ width: 72, height: 72, borderRadius: 12 }} />
            <span className="auth-hero-logo-text">Rent Zone</span>
          </div>
          <h1 className="auth-hero-title">Almost There!</h1>
          <p className="auth-hero-subtitle">
            We sent a 6-digit verification code to your email. Enter it below to activate your account.
          </p>
          <div className="auth-hero-features">
            <div className="auth-hero-feature"><div className="auth-hero-feature-dot" />Code expires in 15 minutes</div>
            <div className="auth-hero-feature"><div className="auth-hero-feature-dot" />Check your spam folder too</div>
            <div className="auth-hero-feature"><div className="auth-hero-feature-dot" />One-time use only</div>
          </div>
        </div>
      </div>

      {/* Form Panel */}
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
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
            </div>
            <h2 className="auth-form-title">Verify Your Email</h2>
            <p className="auth-form-subtitle" style={{ marginTop: 8 }}>
              We sent a code to <strong>{maskedEmail}</strong>
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

          {success && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '12px 16px', borderRadius: 10, marginBottom: 16,
              background: '#ECFDF5', color: '#065F46',
              border: '1px solid #A7F3D0', fontSize: 14, fontWeight: 500
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              {success}
            </div>
          )}

          {/* OTP Inputs */}
          <div style={{ marginBottom: 28 }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 20 }}>
              Enter the 6-digit code below
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }} onPaste={handlePaste}>
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={el => inputRefs.current[i] = el}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleOtpChange(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)}
                  disabled={loading}
                  style={{
                    width: 52, height: 60,
                    textAlign: 'center',
                    fontSize: 24, fontWeight: 700,
                    border: `2px solid ${digit ? '#2563EB' : '#E2E8F0'}`,
                    borderRadius: 12,
                    background: digit ? '#EFF6FF' : '#F8FAFC',
                    color: '#1E293B',
                    outline: 'none',
                    transition: 'all 0.15s',
                    cursor: loading ? 'not-allowed' : 'text'
                  }}
                  onFocus={e => { e.target.style.borderColor = '#2563EB'; e.target.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.15)'; }}
                  onBlur={e => { e.target.style.borderColor = digit ? '#2563EB' : '#E2E8F0'; e.target.style.boxShadow = 'none'; }}
                />
              ))}
            </div>
          </div>

          {/* Verify Button */}
          <button
            onClick={() => handleVerify()}
            disabled={loading || otp.some(d => !d)}
            className={`btn btn-primary btn-lg btn-full${loading ? ' btn-loading' : ''}`}
            style={{ marginBottom: 20 }}
          >
            {!loading && (
              <>
                Verify Email
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </>
            )}
          </button>

          {/* Resend */}
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Didn't receive the code?
            </p>
            {canResend ? (
              <button
                onClick={handleResend}
                disabled={resending}
                style={{
                  background: 'none', border: 'none',
                  color: resending ? '#94A3B8' : '#2563EB',
                  fontSize: 14, fontWeight: 600, cursor: resending ? 'not-allowed' : 'pointer',
                  textDecoration: 'underline'
                }}
              >
                {resending ? 'Sending…' : 'Resend Code'}
              </button>
            ) : (
              <p style={{ fontSize: 13, color: '#94A3B8' }}>
                Resend available in <strong style={{ color: '#475569' }}>{countdown}s</strong>
              </p>
            )}
          </div>

          <p className="auth-form-footer" style={{ marginTop: 24 }}>
            Wrong email?{' '}
            <button
              onClick={() => navigate('/register')}
              style={{ background: 'none', border: 'none', color: '#2563EB', fontWeight: 600, cursor: 'pointer', fontSize: 'inherit' }}
            >
              Go back to Register
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}