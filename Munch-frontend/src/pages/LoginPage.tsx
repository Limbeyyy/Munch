import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';
import { GuestJoinDialog } from '../components/GuestJoinDialog';
import { forgetPortal, markFreshSignIn } from './HomeRedirect';
import { apiClient } from '../services/api';

export const LoginPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { googleLogin, isLoading } = useAuthStore();

  // Guest join: no account, host must admit.
  const [showGuest, setShowGuest] = useState(false);
  const [guestCode, setGuestCode] = useState('');
  /** The name is asked for in its own step, once there is a code. */
  const [askingName, setAskingName] = useState(false);
  const [isKnocking, setIsKnocking] = useState(false);

  /**
   * Somebody who followed the link, or scanned the square at the door.
   *
   * The code is in the address they arrived at, so it is filled in and
   * the guest door is already open: there is nothing left to type. What
   * is left is a decision, and that is theirs - a guest presses the
   * button, and anybody with an account signs in above instead and needs
   * no code at all.
   */
  const [arrivedByLink, setArrivedByLink] = useState(false);
  useEffect(() => {
    const scanned = searchParams.get('join');
    if (scanned) {
      setGuestCode(scanned.toUpperCase());
      setShowGuest(true);
      setArrivedByLink(true);
    }
  }, [searchParams]);

  useEffect(() => {
    const handleGoogleCallback = async (code: string) => {
      try {
        const redirectUri = `${window.location.origin}/login`;
        await googleLogin(code, redirectUri);
        toast.success('Logged in successfully!');
        // Signing in afresh is where the host-or-attendee question belongs,
        // so drop any earlier answer and let the chooser at "/" ask again.
        forgetPortal();
        markFreshSignIn();
        navigate('/');
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

  const handleGuestJoin = async (typedName: string) => {
    const code = guestCode.trim().toUpperCase();
    const name = typedName.trim();

    if (!code) return toast.error('Enter the event code');
    if (name.length < 2) return toast.error('Enter your name');

    try {
      setIsKnocking(true);
      const session = await apiClient.guestKnock({
        code: code,
        full_name: name,
        // What a guest already inside holds, if this is a reload rather
        // than a new arrival: it puts them back in their seat without the
        // host being asked twice.
        token: sessionStorage.getItem('guest_token') ?? undefined,
      });

      sessionStorage.setItem('guest_token', session.guest_token);
      sessionStorage.setItem('guest_event_code', session.event.code);
      sessionStorage.setItem('guest_event_title', session.event.title);
      sessionStorage.setItem('guest_name', session.guest.full_name);

      // Already approved earlier - go straight in rather than showing a
      // waiting screen for a decision that has already been made.
      if (session.guest.status === 'admitted') {
        toast.success('Welcome back');
        navigate('/guest/event');
      } else {
        navigate('/guest/waiting');
      }
    } catch (error: any) {
      const refusal = error.response?.data;

      // Somebody down to present arriving at the guest door. It is not a
      // mistake to scold them for - they are expected, just not here - so
      // say where they belong and put the sign-in button back in view.
      if (refusal?.code === 'presenter_must_sign_in') {
        setAskingName(false);
        setShowGuest(false);
        toast(refusal.error, { icon: '\uD83C\uDF99\uFE0F', duration: 9000 });
        return;
      }

      // Somebody who already has an account, typing their address at the
      // guest door. Same treatment: not a scolding, just a pointer back to
      // the sign-in button, which is where that address works.
      if (refusal?.code === 'account_must_sign_in') {
        setAskingName(false);
        setShowGuest(false);
        toast(refusal.error, { icon: '\uD83D\uDD11', duration: 9000 });
        return;
      }

      // A guest has nowhere else to be: no dashboard, no programme to
      // browse. So when there is nothing to come in for, that is the whole
      // answer, and it is worth saying at length rather than in passing.
      if (refusal?.code === 'no_session_live' || refusal?.code === 'too_early') {
        toast(refusal.error, { icon: '\uD83D\uDD53', duration: 10000 });
        return;
      }

      const detail =
        refusal?.error ??
        refusal?.full_name?.[0] ??
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
          Event &amp; Agenda Network for Collaboration Hub
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
            Join with a event code
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[#BFD1EC]">
              {arrivedByLink
                ? 'The event code came with your link. Press below to go in as a guest — you give a name at the door and the host decides.'
                : 'Joining as a guest. You give a name at the door and the host decides; nothing else is asked for, and nothing is kept afterwards but your name on the attendance.'}
            </p>

            <input
              type="text"
              value={guestCode}
              onChange={(e) => setGuestCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && guestCode.trim()) setAskingName(true);
              }}
              placeholder="Event code"
              aria-label="Event code"
              className="w-full px-4 py-3 rounded-lg uppercase tracking-wide bg-navy-900/50 border border-white/25 text-white placeholder-[#8FA6C6] focus:outline-none focus:ring-2 focus:ring-amber"
            />

            <button
              onClick={() =>
                guestCode.trim()
                  ? setAskingName(true)
                  : toast.error('Enter the event code')
              }
              className="w-full bg-ok hover:bg-[#166F4C] text-white font-semibold py-3 px-4 rounded-lg disabled:opacity-50"
            >
              Enter event room
            </button>
            <button
              onClick={() => setShowGuest(false)}
              className="w-full text-[#9FB8DC] text-sm py-1 hover:text-white"
            >
              Have an account? Go back and sign in
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

        {askingName && (
          <GuestJoinDialog
            eventCode={guestCode.trim().toUpperCase()}
            busy={isKnocking}
            onCancel={() => setAskingName(false)}
            onJoin={handleGuestJoin}
          />
        )}

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
