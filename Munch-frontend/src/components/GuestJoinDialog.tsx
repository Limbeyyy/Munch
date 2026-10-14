import React, { useEffect, useRef, useState } from 'react';

/** Where the details are kept when somebody asks for them to be. */
const REMEMBERED = 'manch.guest.name';
const REMEMBERED_PHONE = 'manch.guest.phone';
const REMEMBERED_EMAIL = 'manch.guest.email';

/** Storage a browser may refuse; never a reason to refuse a guest. */
const recall = (key: string) => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};

/*
 * Enough of an address to be worth keeping.
 *
 * Deliberately loose. The server validates properly, and a door is the
 * wrong place to argue with somebody about their own email - this only
 * catches the slip where a whole field went in the wrong box.
 */
const looksLikeAnAddress = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

interface Props {
  /** The code they typed, shown back so they can see it is the right one. */
  eventCode: string;
  /** Whether the request is with the host already. */
  busy?: boolean;
  onCancel: () => void;
  onJoin: (details: { name: string; phone: string; email: string }) => void;
}

/**
 * What a guest is asked for at the door: a name, a number, an address.
 *
 * The number and the address were dropped once, on the reasoning that
 * the host decides on the name and the register keeps the name. They
 * are asked for again because an organizer running a real event has to
 * be able to reach the people who were in the hall once it is over.
 *
 * None of the three admits anybody. The name reaches the host as a
 * request to come in and the host decides, exactly as before; the other
 * two are written down beside it and consulted by nothing.
 *
 * All three are kept for as long as the event lasts and go with it when
 * it ends, leaving the name on that event's attendance, which is what
 * attendance is. "Remember me" keeps them in this browser and nowhere
 * else, so the next event does not ask again.
 */
export const GuestJoinDialog: React.FC<Props> = ({
  eventCode, busy, onCancel, onJoin,
}) => {
  const [name, setName] = useState(() => recall(REMEMBERED));
  const [phone, setPhone] = useState(() => recall(REMEMBERED_PHONE));
  const [email, setEmail] = useState(() => recall(REMEMBERED_EMAIL));
  const [remember, setRemember] = useState(() => !!recall(REMEMBERED));

  const box = useRef<HTMLInputElement | null>(null);
  useEffect(() => { box.current?.focus(); }, []);

  const typed = name.trim();
  const typedPhone = phone.trim();
  const typedEmail = email.trim();
  const ready = typed.length >= 2
    && typedPhone.length >= 7
    && looksLikeAnAddress(typedEmail);

  const join = () => {
    if (!ready || busy) return;
    try {
      if (remember) {
        localStorage.setItem(REMEMBERED, typed);
        localStorage.setItem(REMEMBERED_PHONE, typedPhone);
        localStorage.setItem(REMEMBERED_EMAIL, typedEmail);
      } else {
        [REMEMBERED, REMEMBERED_PHONE, REMEMBERED_EMAIL]
          .forEach((key) => localStorage.removeItem(key));
      }
    } catch {
      // Remembering is a convenience; not being able to is not a failure.
    }
    onJoin({ name: typed, phone: typedPhone, email: typedEmail });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Enter event info"
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-[#e3e8ef] rounded-[16px] w-full max-w-[576px]
          overflow-hidden text-[#0a090b]"
      >
        <div className="bg-[#fcfcfc] flex items-start gap-2 px-5 py-3">
          <span className="w-8 flex-none" aria-hidden />
          <div className="flex-1 min-w-0">
            <h2 className="text-[24px] font-bold text-black text-center tracking-[-0.12px]
              leading-[1.4]">
              Enter Event Info
            </h2>
            <p className="text-[16px] text-black tracking-[-0.08px] leading-[1.4]">
              Event {eventCode}. The host will be asked to let you in.
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="w-8 flex-none text-[#9ea8b7] hover:text-navy-800 text-[22px] leading-none"
          >
            &#10005;
          </button>
        </div>

        <div className="px-6 pt-3 pb-5 flex flex-col gap-3">
          <label className="flex flex-col gap-2">
            <span className="text-[20px] font-medium text-black tracking-[-0.1px] leading-[1.4]">
              Your Name
            </span>
            <input
              ref={box}
              type="text"
              value={name}
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') join(); }}
              className="w-full bg-[#f9fafb] border border-[#e5e7eb] rounded-[12px]
                px-[14px] py-3 text-[16px] text-[#101010] leading-6
                focus:outline-none focus:ring-2 focus:ring-navy-500"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[20px] font-medium text-black tracking-[-0.1px] leading-[1.4]">
              Phone Number
            </span>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              autoComplete="tel"
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') join(); }}
              className="w-full bg-[#f9fafb] border border-[#e5e7eb] rounded-[12px]
                px-[14px] py-3 text-[16px] text-[#101010] leading-6
                focus:outline-none focus:ring-2 focus:ring-navy-500"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[20px] font-medium text-black tracking-[-0.1px] leading-[1.4]">
              Email
            </span>
            <input
              type="email"
              inputMode="email"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') join(); }}
              className="w-full bg-[#f9fafb] border border-[#e5e7eb] rounded-[12px]
                px-[14px] py-3 text-[16px] text-[#101010] leading-6
                focus:outline-none focus:ring-2 focus:ring-navy-500"
            />
          </label>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="w-5 h-5 rounded-[5px] border-2 border-[#dcdcde] accent-navy-800"
            />
            <span className="text-[16px] leading-[22px]">
              Remember my details for future events
            </span>
          </label>

          <button
            onClick={join}
            disabled={busy || !ready}
            className="w-full bg-navy-800 hover:bg-navy-700 text-white rounded-[12px]
              px-6 py-3.5 text-[16px] font-medium leading-6
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Asking the host…' : 'Join'}
          </button>

          <p className="text-[16px] leading-[22px]">
            By clicking “Join”, you agree to our{' '}
            <a href="/terms" className="font-medium text-[#1a478b] hover:underline">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="/privacy" className="font-medium text-[#1a478b] hover:underline">
              Privacy Statement
            </a>
            .
          </p>

          <p className="text-[13px] text-[#6E7C8E] leading-[18px]">
            Your details are kept for this event only, so the organizer can
            reach you about it. When it ends, all that remains is your name
            on its attendance.
          </p>
        </div>
      </div>
    </div>
  );
};
