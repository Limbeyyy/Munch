import React, { useEffect, useRef, useState } from 'react';

/** Where a name is kept when somebody asks for it to be. */
const REMEMBERED = 'manch.guest.name';

interface Props {
  /** The code they typed, shown back so they can see it is the right one. */
  meetingCode: string;
  /** Whether the request is with the host already. */
  busy?: boolean;
  onCancel: () => void;
  onJoin: (name: string) => void;
}

/**
 * What a guest is asked for at the door: their name.
 *
 * That is the whole of it. A telephone number used to be required as well
 * and was never used for anything - the host decides on the name, the
 * register keeps the name - so it was a box on a form collecting personal
 * data for its own sake.
 *
 * The name reaches the host as a request to come in, and is kept for as
 * long as the meeting lasts. Afterwards nothing about the person remains
 * except their name on that meeting's attendance, which is what attendance
 * is. "Remember my name" keeps it in this browser and nowhere else, so the
 * next meeting does not ask again.
 */
export const GuestJoinDialog: React.FC<Props> = ({
  meetingCode, busy, onCancel, onJoin,
}) => {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(REMEMBERED) ?? '';
    } catch {
      // A browser that refuses storage is not a reason to refuse a guest.
      return '';
    }
  });
  const [remember, setRemember] = useState(() => {
    try {
      return !!localStorage.getItem(REMEMBERED);
    } catch {
      return false;
    }
  });

  const box = useRef<HTMLInputElement | null>(null);
  useEffect(() => { box.current?.focus(); }, []);

  const join = () => {
    const typed = name.trim();
    if (typed.length < 2 || busy) return;
    try {
      if (remember) localStorage.setItem(REMEMBERED, typed);
      else localStorage.removeItem(REMEMBERED);
    } catch {
      // Remembering is a convenience; not being able to is not a failure.
    }
    onJoin(typed);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Enter meeting info"
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-[#e3e8ef] rounded-[16px] w-full max-w-[576px]
          overflow-hidden text-[#0a090b]"
      >
        <div className="bg-[#fcfcfc] flex items-start gap-2 px-5 py-3">
          <span className="w-8 flex-none" aria-hidden />
          <div className="flex-1 min-w-0">
            <h2 className="text-[24px] font-bold text-black text-center tracking-[-0.12px]
              leading-[1.4]">
              Enter Meeting Info
            </h2>
            <p className="text-[16px] text-black tracking-[-0.08px] leading-[1.4]">
              Meeting {meetingCode}. The host will be asked to let you in.
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

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="w-5 h-5 rounded-[5px] border-2 border-[#dcdcde] accent-navy-800"
            />
            <span className="text-[16px] leading-[22px]">
              Remember my name for future meetings
            </span>
          </label>

          <button
            onClick={join}
            disabled={busy || name.trim().length < 2}
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
            Your name is kept for this meeting only. When it ends, all that
            remains is your name on its attendance.
          </p>
        </div>
      </div>
    </div>
  );
};
