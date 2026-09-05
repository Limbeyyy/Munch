import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';

export const LoginPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { googleLogin, isLoading } = useAuthStore();

  // Guest join: no account, host must admit.
  const [showGuest, setShowGuest] = useState(false);
  const [guestCode, setGuestCode] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [isKnocking, setIsKnocking] = useState(false);

  // A guest who scanned the QR at the door arrives with the code already
  // in the address, so they only have to say who they are.
  useEffect(() => {
    const scanned = searchParams.get('join');
    if (scanned) {
      setGuestCode(scanned.toUpperCase());
      setShowGuest(true);
    }
  }, [searchParams]);

  useEffect(() => {
    const handleGoogleCallback = async (code: string) => {
      try {
        const redirectUri = `${window.location.origin}/login`;
        await googleLogin(code, redirectUri);
        toast.success('Logged in successfully!');
        navigate('/dashboard');
      } catch (error: any) {
        toast.error('Login failed: ' + error.message);
      }
    };

    const code = searchParams.get('code');
    if (code) {
      handleGoogleCallback(code);
    }
  }, [searchParams, googleLogin, navigate]);

  const handleGoogleLogin = async () => {
    try {
      const redirectUri = `${window.location.origin}/login`;
      const response = await apiClient.googleConnect(redirectUri);
      window.location.href = response.auth_url;
    } catch (error: any) {
      toast.error('Failed to initiate login: ' + error.message);
    }
  };

  const handleGuestJoin = async () => {
    const code = guestCode.trim().toUpperCase();
    const name = guestName.trim();
    const phone = guestPhone.trim();

    if (!code) return toast.error('Enter the meeting code');
    if (name.length < 2) return toast.error('Enter your full name');
    if (phone.replace(/\D/g, '').length < 7) {
      return toast.error('Enter a valid phone number');
    }

    try {
      setIsKnocking(true);
      const session = await apiClient.guestKnock({
        meeting_code: code,
        full_name: name,
        phone,
      });

      sessionStorage.setItem('guest_token', session.guest_token);
      sessionStorage.setItem('guest_meeting_code', session.meeting.meeting_code);
      sessionStorage.setItem('guest_meeting_title', session.meeting.title);
      sessionStorage.setItem('guest_name', session.guest.full_name);

      // Already approved earlier - go straight in rather than showing a
      // waiting screen for a decision that has already been made.
      if (session.guest.status === 'admitted') {
        toast.success('Welcome back');
        navigate('/guest/meeting');
      } else {
        navigate('/guest/waiting');
      }
    } catch (error: any) {
      const detail =
        error.response?.data?.error ??
        error.response?.data?.phone?.[0] ??
        error.response?.data?.full_name?.[0] ??
        error.message;
      toast.error(detail);
    } finally {
      setIsKnocking(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-5 py-10 bg-navy-800"
      style={{
        backgroundImage:
          'radial-gradient(circle at 50% 30%, rgba(240,162,43,.20), transparent 46%)',
      }}
    >
      <div className="w-full max-w-md text-center">
        {/* The mark: a stage inside a frame, lit amber */}
        <svg
          width="60" height="60" viewBox="0 0 64 64" fill="none"
          className="mx-auto" aria-hidden="true"
        >
          <g stroke="#8FB0DC" strokeWidth="2">
            <path d="M32 8v8M32 48v8M8 32h8M48 32h8" />
          </g>
          <rect x="18" y="18" width="28" height="28" rx="4" stroke="#fff" strokeWidth="2.4" />
          <rect x="26" y="26" width="12" height="12" rx="2" fill="#F0A22B" />
        </svg>

        <h1 className="text-4xl font-bold text-white mt-3">मञ्च</h1>
        <p className="font-read text-sm text-[#BFD1EC] mb-7">
          Meeting &amp; Agenda Network for Collaboration Hub
        </p>

        <div className="bg-white/[.07] border border-white/20 rounded-[22px] p-6 text-left backdrop-blur">

        <button
          onClick={handleGoogleLogin}
          disabled={isLoading}
          className="w-full bg-amber hover:bg-[#FFB43F] text-[#20160A] font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Signing in...' : 'Sign in with Google'}
        </button>

        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-white/20" />
          <span className="text-xs uppercase tracking-wide text-[#9FB8DC]">or</span>
          <div className="flex-1 h-px bg-white/20" />
        </div>

        {!showGuest ? (
          <button
            onClick={() => setShowGuest(true)}
            className="w-full border border-white/30 hover:bg-white/10 text-white font-semibold py-3 px-4 rounded-lg"
          >
            Join with a meeting code
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[#BFD1EC]">
              Joining as a guest. The host will review your details before
              letting you in.
            </p>

            <input
              type="text"
              value={guestCode}
              onChange={(e) => setGuestCode(e.target.value)}
              placeholder="Meeting code"
              className="w-full px-4 py-3 rounded-lg uppercase tracking-wide bg-navy-900/50 border border-white/25 text-white placeholder-[#8FA6C6] focus:outline-none focus:ring-2 focus:ring-amber"
            />
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Full name (required)"
              autoComplete="name"
              className="w-full px-4 py-3 rounded-lg bg-navy-900/50 border border-white/25 text-white placeholder-[#8FA6C6] focus:outline-none focus:ring-2 focus:ring-amber"
            />
            <input
              type="tel"
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleGuestJoin();
              }}
              placeholder="Phone number (required)"
              autoComplete="tel"
              className="w-full px-4 py-3 rounded-lg bg-navy-900/50 border border-white/25 text-white placeholder-[#8FA6C6] focus:outline-none focus:ring-2 focus:ring-amber"
            />

            <button
              onClick={handleGuestJoin}
              disabled={isKnocking}
              className="w-full bg-ok hover:bg-[#166F4C] text-white font-semibold py-3 px-4 rounded-lg disabled:opacity-50"
            >
              {isKnocking ? 'Asking the host...' : 'Ask to join'}
            </button>
            <button
              onClick={() => setShowGuest(false)}
              className="w-full text-[#9FB8DC] text-sm py-1 hover:text-white"
            >
              Back
            </button>
          </div>
        )}

        </div>

        <p className="text-[12.5px] text-[#A9C0E2] mt-5 leading-relaxed">
          <span className="inline-block border-t border-white/20 pt-3">
            We keep no personal data beyond your account. No profiling, nothing
            sold on.
          </span>
        </p>

        <button
          onClick={() => navigate('/pricing')}
          className="text-[#BFD1EC] text-sm underline underline-offset-4 mt-4 hover:text-white"
        >
          See plans and pricing
        </button>
      </div>
    </div>
  );
};
