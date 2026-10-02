import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { Event, HubKind, HubPost } from '../../types';
import { errorText } from '../../organizer/errors';
import { useOrganizer } from '../../organizer/i18n';
import { Switcher } from './PhoneShell';

const MOST = 500;

/** How long ago, in the words a board uses for it. */
const since = (iso: string, t: (pair: { ne: string; en: string }) => string) => {
  const minutes = Math.max(0, Math.round((Date.now() - +new Date(iso)) / 60000));
  if (minutes < 1) return t({ ne: 'भर्खरै', en: 'just now' });
  if (minutes < 60) return t({ ne: `${minutes} मिनेट अघि`, en: `${minutes} min ago` });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t({ ne: `${hours} घण्टा अघि`, en: `${hours} h ago` });
  return t({ ne: `${Math.floor(hours / 24)} दिन अघि`, en: `${Math.floor(hours / 24)} d ago` });
};

/**
 * The sheet that slides up to write one.
 *
 * A full screen would lose the list behind it, and the list is the
 * context: most people write after reading what has already been asked.
 */
const AskSheet: React.FC<{
  kind: 'question' | 'suggestion';
  busy: boolean;
  onClose: () => void;
  onSend: (body: string) => Promise<void>;
}> = ({ kind, busy, onClose, onSend }) => {
  const { t, num } = useOrganizer();
  const [body, setBody] = useState('');
  const left = MOST - body.length;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={kind === 'question'
        ? t({ ne: 'प्रश्न सोध्नुहोस्', en: 'Ask a question' })
        : t({ ne: 'सुझाव दिनुहोस्', en: 'Add a suggestion' })}
    >
      <div
        className="bg-white rounded-t-[18px] px-5 pt-3 pb-5"
        style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
      >
        <span
          className="block mx-auto w-9 h-1 rounded-full bg-[#d5d8de]"
          aria-hidden
        />

        <h2 className="pt-4 text-[17px] font-semibold text-[#111726]">
          {kind === 'question'
            ? t({ ne: 'प्रश्न सोध्नुहोस्', en: 'Ask a question' })
            : t({ ne: 'सुझाव दिनुहोस्', en: 'Add a suggestion' })}
        </h2>

        <label className="sr-only" htmlFor="manch-pwa-ask">
          {kind === 'question'
            ? t({ ne: 'तपाईंको प्रश्न', en: 'Your question' })
            : t({ ne: 'तपाईंको सुझाव', en: 'Your suggestion' })}
        </label>
        <textarea
          id="manch-pwa-ask"
          value={body}
          maxLength={MOST}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder={kind === 'question'
            ? t({ ne: 'के सोध्न चाहनुहुन्छ?', en: 'What would you like to ask?' })
            : t({ ne: 'के सुझाव दिन चाहनुहुन्छ?', en: 'What would you like to suggest?' })}
          className="mt-3 w-full border border-[#e2e5ea] rounded-[12px] px-3.5 py-3
            text-[14px] leading-6 text-[#111726] placeholder:text-[#9ba0ad]
            resize-none outline-none focus:border-[#2440c9]"
        />
        <p className="pt-1 text-right text-[11px] text-[#9ba0ad]">
          {t({ ne: `${num(left)} बाँकी`, en: `${left} remaining` })}
        </p>

        <button
          type="button"
          disabled={busy || body.trim() === ''}
          onClick={() => onSend(body.trim())}
          className="mt-2 w-full rounded-[12px] py-3.5 text-[15px] font-semibold
            text-white bg-[#12386e] disabled:bg-[#92A2B9]"
        >
          {busy
            ? t({ ne: 'पठाउँदै…', en: 'Sending…' })
            : kind === 'question'
            ? t({ ne: 'प्रश्न पठाउनुहोस्', en: 'Submit question' })
            : t({ ne: 'सुझाव पठाउनुहोस्', en: 'Submit suggestion' })}
        </button>
        <p className="pt-2 text-center text-[11px] text-[#9ba0ad]">
          {t({
            ne: 'स्वीकृत भएपछि देखिनेछ।',
            en: 'Your submission will appear after it is approved.',
          })}
        </p>
      </div>
    </div>
  );
};

/**
 * What the room has asked, and what it has suggested.
 *
 * Questions carry the room's vote, because a vote sorts a queue: it
 * says which one most wants answering and the host works down from the
 * top. Suggestions do not - nobody reads them in order, so a tally
 * against one measures nothing.
 */
export const BoardScreen: React.FC<{ event: Event }> = ({ event }) => {
  const { t, num } = useOrganizer();
  const [tab, setTab] = useState<'questions' | 'suggestions'>('questions');
  const [order, setOrder] = useState<'top' | 'newest'>('top');
  const [questions, setQuestions] = useState<HubPost[]>([]);
  const [suggestions, setSuggestions] = useState<HubPost[]>([]);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    try {
      const board = await apiClient.getHub(event.code);
      setQuestions(board.questions ?? []);
      setSuggestions(board.suggestions ?? []);
    } catch {
      setQuestions([]);
      setSuggestions([]);
    }
  }, [event.code]);

  useEffect(() => {
    read();
    const id = setInterval(read, 8000);
    return () => clearInterval(id);
  }, [read]);

  const rows = useMemo(() => {
    const list = tab === 'questions' ? [...questions] : [...suggestions];
    // Suggestions have no score to sort by, so they read newest first
    // whatever the switch says - and the switch is not shown for them.
    if (tab === 'suggestions' || order === 'newest') {
      return list.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    }
    return list.sort((a, b) => (b.score - a.score)
      || (+new Date(b.created_at) - +new Date(a.created_at)));
  }, [tab, questions, suggestions, order]);

  const send = async (body: string) => {
    setBusy(true);
    try {
      const kind: HubKind = tab === 'questions' ? 'question' : 'suggestion';
      await apiClient.addHubPost(event.code, { kind, body });
      toast.success(t({
        ne: 'पठाइयो — स्वीकृत भएपछि देखिनेछ।',
        en: 'Sent. It appears once it has been approved.',
      }));
      setAsking(false);
      await read();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'पठाउन सकिएन', en: 'Could not send it' })));
    } finally {
      setBusy(false);
    }
  };

  const vote = async (post: HubPost, value: 1 | -1) => {
    try {
      await apiClient.voteHubPost(event.code, post.id, value);
      await read();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'भोट पुगेन', en: 'That vote did not land' })));
    }
  };

  return (
    <div>
      <Switcher<'questions' | 'suggestions'>
        value={tab}
        onChange={setTab}
        options={[
          { id: 'questions', label: t({ ne: 'प्रश्न', en: 'Questions' }) },
          { id: 'suggestions', label: t({ ne: 'सुझाव', en: 'Suggestions' }) },
        ]}
      />

      {tab === 'questions' && (
        <div className="px-4 pt-3 flex items-center gap-2">
          <span className="text-[12px] text-[#8b90a0]">
            {t({ ne: 'क्रम:', en: 'Sort:' })}
          </span>
          {([
            ['top', t({ ne: 'माथिल्लो', en: 'Top' })],
            ['newest', t({ ne: 'नयाँ', en: 'Newest' })],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={order === id}
              onClick={() => setOrder(id)}
              className={`rounded-full px-3.5 py-1.5 text-[12px] ${
                order === id
                  ? 'bg-[#12386e] text-white font-medium'
                  : 'bg-[#e3ecfd] text-[#2b3140]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="px-4 pt-3">
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="w-full border border-dashed border-[#9fb0e4] rounded-[12px]
            py-3.5 text-[14px] font-medium text-[#194d97]"
        >
          +{'  '}
          {tab === 'questions'
            ? t({ ne: 'प्रश्न थप्नुहोस्', en: 'Ask a question' })
            : t({ ne: 'सुझाव थप्नुहोस्', en: 'Add a suggestion' })}
        </button>
      </div>

      {tab === 'suggestions' && (
        <p className="px-4 pt-3 text-[12px] text-[#8b90a0]">
          {t({
            ne: 'सुझाव आयोजकसम्म मात्र पुग्छ — यहाँ आफ्नै देखिन्छ।',
            en: 'A suggestion goes to the organizer alone, so this list is your own.',
          })}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="px-4 pt-8 text-center text-[13px] text-[#8b90a0]">
          {tab === 'questions'
            ? t({ ne: 'अझै कुनै प्रश्न छैन।', en: 'Nothing has been asked yet.' })
            : t({ ne: 'तपाईंले अझै सुझाव दिनुभएको छैन।', en: 'You have not suggested anything yet.' })}
        </p>
      ) : (
        <ul className="px-4 pt-3 pb-4 flex flex-col gap-3">
          {rows.map((one) => (
            <li
              key={one.id}
              className="border border-[#e8eaee] rounded-[12px] px-3.5 py-3"
            >
              <p className="text-[14px] leading-6 text-[#111726]">{one.body}</p>
              <div className="pt-2 flex items-center gap-3">
                <span className="flex-1 text-[11px] text-[#9ba0ad]">
                  {since(one.created_at, t)}
                  {one.status === 'pending' && (
                    <span className="ps-2 text-[#bb4d00]">
                      {t({ ne: 'स्वीकृतिको पर्खाइमा', en: 'waiting for approval' })}
                    </span>
                  )}
                </span>

                {/* Questions only. A vote sorts a queue, and nobody reads
                    suggestions in order. */}
                {tab === 'questions' && (
                  <span className="flex gap-1.5 flex-none">
                    <button
                      type="button"
                      onClick={() => vote(one, 1)}
                      aria-label={t({ ne: 'माथि भोट', en: 'Vote up' })}
                      aria-pressed={one.my_vote === 1}
                      className={`rounded-[8px] px-2.5 py-1 flex items-center gap-1
                        text-[12px] font-medium ${
                        one.my_vote === 1
                          ? 'bg-[#12386e] text-white'
                          : 'bg-[#f2f3f5] text-[#5b6070]'
                      }`}
                    >
                      ▲ {num(Math.max(0, one.score))}
                    </button>
                    <button
                      type="button"
                      onClick={() => vote(one, -1)}
                      aria-label={t({ ne: 'तल भोट', en: 'Vote down' })}
                      aria-pressed={one.my_vote === -1}
                      className={`rounded-[8px] px-2.5 py-1 text-[12px] font-medium ${
                        one.my_vote === -1
                          ? 'bg-[#12386e] text-white'
                          : 'bg-[#f2f3f5] text-[#5b6070]'
                      }`}
                    >
                      ▼ {num(Math.max(0, one.downvote_count ?? 0))}
                    </button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {asking && (
        <AskSheet
          kind={tab === 'questions' ? 'question' : 'suggestion'}
          busy={busy}
          onClose={() => setAsking(false)}
          onSend={send}
        />
      )}
    </div>
  );
};
