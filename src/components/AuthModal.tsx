// src/components/AuthModal.tsx
import React, { useState, useEffect } from 'react';
import { X, Mail, Lock, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { AI_CONSENT_VERSION } from '../lib/constants';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: () => void; // used after successful *login*
  mode?: 'login' | 'signup';
  onSignupSuccess?: () => void; // optional callback after signup (before email confirm)
}

export function AuthModal({
  isOpen,
  onClose,
  onAuthSuccess,
  mode = 'login',
  onSignupSuccess,
}: AuthModalProps) {
  const [isLogin, setIsLogin] = useState(mode === 'login');
  const [showSuccess, setShowSuccess] = useState(false); // signup success (verify email screen)

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [password, setPassword] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Consent (signup only)
  const [aiConsent, setAiConsent] = useState(false);
  const [gdprConsent, setGdprConsent] = useState(false);

  // For “resend verification email”
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendMsg, setResendMsg] = useState('');
  const [pendingVerifyEmail, setPendingVerifyEmail] = useState<string | null>(null); // set if login failed due to unconfirmed email

  // Helpers
  function isEmailStrict(v: string) {
    // Case-insensitive; requires at least one dot and 2+ char TLD
    return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(v);
  }

  const emailRedirect = `${window.location.origin}/auth/callback`;

  // Reset form each time the modal opens or mode changes
  useEffect(() => {
    if (isOpen) {
      setIsLogin(mode === 'login');
      setShowSuccess(false);
      setEmail('');
      setEmailError('');
      setPassword('');
      setError('');
      setAiConsent(false);
      setGdprConsent(false);
      setResendState('idle');
      setResendMsg('');
      setPendingVerifyEmail(null);
    }
  }, [isOpen, mode]);

  // When user toggles between login/signup inside modal, clear errors/consents
  useEffect(() => {
    setError('');
    setEmailError('');
    setResendState('idle');
    setResendMsg('');
    setPendingVerifyEmail(null);
    if (isLogin) {
      setAiConsent(false);
      setGdprConsent(false);
    }
  }, [isLogin]);

  async function handleResend(targetEmail?: string) {
    const e = (targetEmail ?? email).trim();
    if (!isEmailStrict(e)) {
      setResendState('error');
      setResendMsg('Please enter a valid email first.');
      return;
    }
    try {
      setResendState('sending');
      setResendMsg('');
      const { error: resendErr } = await supabase.auth.resend({
        type: 'signup',
        email: e,
        options: { emailRedirectTo: emailRedirect },
      });
      if (resendErr) throw resendErr;
      setResendState('sent');
      setResendMsg('Verification email sent. Please check your inbox (and spam).');
    } catch (err: any) {
      setResendState('error');
      setResendMsg(err?.message || 'Could not resend the verification email.');
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setEmailError('');
    setResendState('idle');
    setResendMsg('');
    setPendingVerifyEmail(null);

    if (!isEmailStrict(email)) {
      setIsLoading(false);
      setEmailError('Enter a valid email (e.g., name@example.com).');
      return;
    }

    try {
      if (isLogin) {
        // LOGIN
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) {
          const msg = (signInError.message || '').toLowerCase();
          // Supabase returns variants like: "Email not confirmed"
          if (msg.includes('confirm') || msg.includes('not confirmed')) {
            setPendingVerifyEmail(email.trim());
            setError('Your email is not confirmed yet. Please verify to continue.');
          } else {
            setError(signInError.message || 'Sign-in failed.');
          }
          return;
        }
        // Success: parent will close & route
        onAuthSuccess();
        return;
      }

      // SIGNUP (consent required)
      if (!aiConsent) throw new Error('You must consent to AI processing to create an account.');
      if (!gdprConsent) throw new Error('You must acknowledge GDPR terms to create an account.');

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: emailRedirect },
      });
      if (signUpError) throw signUpError;

      // Best-effort: upsert consent flags immediately (may not have a session yet)
      try {
        const { data: sess } = await supabase.auth.getSession();
        const uid = sess?.session?.user?.id || signUpData.user?.id;
        if (uid) {
          await supabase
            .from('user_profiles')
            .upsert(
              {
                id: uid,
                ai_processing_consent: true,
                ai_consent_at: new Date().toISOString(),
                ai_consent_version: AI_CONSENT_VERSION,
                gdpr_acknowledged_at: new Date().toISOString(),
                // sensible defaults
                allow_training: false,
                content_retention_days: 365,
                log_retention_days: 90,
                default_visibility: 'private',
              },
              { onConflict: 'id' }
            );
        }
      } catch (consentErr) {
        // Non-fatal: server-side can enforce consent as well
        console.error('Failed to store consent:', consentErr);
      }

      // With "Confirm email" ON, there is no active session yet.
      setShowSuccess(true);
      onSignupSuccess?.();
    } catch (err: any) {
      setError(err?.message || 'Authentication failed.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const submitDisabled =
    isLoading ||
    (!isLogin && (!aiConsent || !gdprConsent)) ||
    !isEmailStrict(email) ||
    password.length < 6;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Close authentication modal"
        >
          <X className="w-6 h-6" />
        </button>

        {showSuccess ? (
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Mail className="w-8 h-8 text-blue-600" />
            </div>

            <h2 className="text-2xl font-bold text-gray-800 mb-2">Almost there—verify your email</h2>
            <p className="text-gray-600 mb-4">
              We’ve sent a verification link to <span className="font-medium">{email}</span>. Click the link to activate your account.
            </p>
            <p className="text-sm text-gray-500 mb-6">
              Didn’t get it? Check spam, or resend the email below.
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => handleResend(email)}
                disabled={resendState === 'sending'}
                className="w-full bg-gradient-to-r from-purple-500 to-blue-500 text-white py-3 rounded-lg font-semibold hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 flex items-center justify-center"
              >
                {resendState === 'sending' ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Resending…
                  </>
                ) : (
                  'Resend verification email'
                )}
              </button>

              <button
                onClick={onClose}
                className="w-full border border-gray-300 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
            </div>

            {resendMsg && (
              <p
                className={`mt-4 text-sm ${
                  resendState === 'sent' ? 'text-green-600' : resendState === 'error' ? 'text-red-600' : 'text-gray-600'
                }`}
              >
                {resendMsg}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-gray-800 mb-2">
                {isLogin ? 'Welcome Back' : 'Create Account'}
              </h2>
              <p className="text-gray-600">
                {isLogin ? 'Sign in to read the full book' : 'Join to unlock complete books'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (emailError) setEmailError('');
                    }}
                    // Require at least one dot and 2+ char TLD
                    pattern="^[^\s@]+@[^\s@]+\.[^\s@]{2,}$"
                    onInvalid={(e) =>
                      e.currentTarget.setCustomValidity('Please enter a valid email (e.g., name@example.com).')
                    }
                    onInput={(e) => e.currentTarget.setCustomValidity('')}
                    className={`w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent ${
                      emailError ? 'border-red-400' : 'border-gray-300'
                    }`}
                    placeholder="name@example.com"
                    required
                    aria-invalid={!!emailError}
                    aria-describedby={emailError ? 'auth-email-error' : undefined}
                  />
                </div>
                {emailError && (
                  <p id="auth-email-error" className="mt-1 text-sm text-red-600">
                    {emailError}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="password"
                    value={password}
                    autoComplete={isLogin ? 'current-password' : 'new-password'}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="At least 6 characters"
                    required
                    minLength={6}
                  />
                </div>
              </div>

              {/* Consent checkboxes - only for signup */}
              {!isLogin && (
                <div className="space-y-4 pt-4 border-t border-gray-200">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h4 className="font-medium text-blue-900 mb-2">Privacy & AI Processing</h4>
                    <p className="text-sm text-blue-800 mb-3">
                      Our service uses OpenAI (USA) to generate book content. Please review and accept:
                    </p>

                    <label className="flex items-start gap-3 text-sm mb-3">
                      <input
                        type="checkbox"
                        checked={aiConsent}
                        onChange={(e) => setAiConsent(e.target.checked)}
                        required
                        className="mt-1 flex-shrink-0"
                      />
                      <span>
                        <strong>AI Processing Consent:</strong> I consent to my book prompts and content being processed
                        by OpenAI (USA) for content generation. I understand that OpenAI may process this data according
                        to their privacy policy and I agree not to enter personal data.
                      </span>
                    </label>

                    <label className="flex items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={gdprConsent}
                        onChange={(e) => setGdprConsent(e.target.checked)}
                        required
                        className="mt-1 flex-shrink-0"
                      />
                      <span>
                        <strong>GDPR Acknowledgment:</strong> I acknowledge that my data will be processed according to
                        GDPR. I understand my rights regarding data access, portability, and deletion.
                      </span>
                    </label>
                  </div>

                  <div className="text-xs text-gray-500">
                    <p>By creating an account, you agree to our Terms of Service and Privacy Policy.</p>
                    <p className="mt-1">You can change these privacy settings or withdraw consent anytime in Settings.</p>
                  </div>
                </div>
              )}

              {error && (
                <div
                  className="bg-red-100 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm"
                  role="alert"
                  aria-live="polite"
                >
                  {error}
                </div>
              )}

              {/* Extra helper when login failed due to unconfirmed email */}
              {pendingVerifyEmail && (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-900 px-4 py-3 rounded-lg text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p>
                      We found an account for <span className="font-medium">{pendingVerifyEmail}</span> but it hasn’t
                      been verified yet. Click the email link we sent, or resend it below.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleResend(pendingVerifyEmail)}
                      className="shrink-0 underline hover:no-underline"
                      disabled={resendState === 'sending'}
                    >
                      {resendState === 'sending' ? 'Sending…' : 'Resend'}
                    </button>
                  </div>
                  {resendMsg && (
                    <p className={`mt-2 ${resendState === 'error' ? 'text-red-700' : 'text-yellow-800'}`}>{resendMsg}</p>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={submitDisabled}
                className="w-full bg-gradient-to-r from-purple-500 to-blue-500 text-white py-3 rounded-lg font-semibold hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 flex items-center justify-center"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    {isLogin ? 'Signing In...' : 'Creating Account...'}
                  </>
                ) : (
                  (isLogin ? 'Sign In' : 'Create Account')
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <button
                onClick={() => setIsLogin(!isLogin)}
                className="text-purple-600 hover:text-purple-700 font-medium"
              >
                {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
