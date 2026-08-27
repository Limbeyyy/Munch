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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
        <h1 className="text-3xl font-bold text-center mb-2 text-gray-800">Munch</h1>
        <p className="text-center text-gray-600 mb-8">Meeting Platform</p>

        <button
          onClick={handleGoogleLogin}
          disabled={isLoading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Signing in...' : 'Sign in with Google'}
        </button>

        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs uppercase tracking-wide text-gray-400">or</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {!showGuest ? (
          <button
            onClick={() => setShowGuest(true)}
            className="w-full border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold py-3 px-4 rounded-lg"
          >
            Join with a meeting code
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Joining as a guest. The host will review your details before
              letting you in.
            </p>

            <input
              type="text"
              value={guestCode}
              onChange={(e) => setGuestCode(e.target.value)}
              placeholder="Meeting code"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg uppercase tracking-wide focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Full name (required)"
              autoComplete="name"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <button
              onClick={handleGuestJoin}
              disabled={isKnocking}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-4 rounded-lg disabled:opacity-50"
            >
              {isKnocking ? 'Asking the host...' : 'Ask to join'}
            </button>
            <button
              onClick={() => setShowGuest(false)}
              className="w-full text-gray-500 text-sm py-1 hover:text-gray-700"
            >
              Back
            </button>
          </div>
        )}

        <p className="text-center text-gray-600 text-sm mt-6">
          Secure. Encrypted. Simple.
        </p>
      </div>
    </div>
  );
};
