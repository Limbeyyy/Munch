import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../services/api';

export const GuestMobileOnlyPage: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const token = sessionStorage.getItem('guest_token');
    if (token) {
      apiClient.guestLeave(token).catch((error) => {
        console.error('Failed to release guest pass on unsupported device', error);
      });
    }
    [
      'guest_token',
      'guest_event_code',
      'guest_event_title',
      'guest_name',
    ].forEach((key) => sessionStorage.removeItem(key));
  }, []);

  return (
    <div className="min-h-screen grid place-items-center bg-[#f1f4f8] px-4">
      <div className="w-full max-w-md rounded-[12px] border border-[#e3e8ef]
        bg-white p-6 text-center">
        <h1 className="text-[20px] font-semibold text-[#101828]">
          Guest mode is for mobile devices
        </h1>
        <p className="mt-2 text-[14px] text-[#4a5567]">
          For now, please open the event link on a phone or tablet to join as a guest.
          You can sign in on this device to use the regular attendee portal.
        </p>
        <button
          type="button"
          onClick={() => navigate('/login?guest-mobile-only=1', { replace: true })}
          className="mt-5 rounded-[8px] bg-navy-800 px-4 py-2 text-[14px]
            font-medium text-white hover:bg-navy-700"
        >
          Back to sign in
        </button>
      </div>
    </div>
  );
};
