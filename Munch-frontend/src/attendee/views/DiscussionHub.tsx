import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { ACTIVE_POLL_MS } from '../../services/polling';
import { EventMeeting, HubBoard, HubKind, HubPost } from '../../types';
import { PhotoAlbums } from '../../organizer/Photos';
import { errorText } from '../../organizer/errors';
import { Pair, useOrganizer } from '../../organizer/i18n';
import { Btn, Card, Chip, Empty, Tabs } from '../../organizer/ui';

/** The headings a suggestion can be filed under. */
const CATEGORIES: { id: string; label: Pair }[] = [
  { id: 'programme', label: { ne: 'कार्यक्रम व्यवस्थापन', en: 'Programme' } },
  { id: 'halls', label: { ne: 'हल र ध्वनि', en: 'Halls and sound' } },
  { id: 'catering', label: { ne: 'खाना/बसाइ', en: 'Food and seating' } },
  { id: 'materials', label: { ne: 'सामग्री', en: 'Materials' } },
];

const STATUS_LABEL: Record<string, Pair> = {
  pending: { ne: 'मोडेरेसन लाइनमा', en: 'In moderation' },
  published: { ne: 'देखियो', en: 'Shown' },
  declined: { ne: 'राखिएन', en: 'Not shown' },
  looking: { ne: 'हेर्दै', en: 'Being looked at' },
  addressed: { ne: 'सम्बोधन भयो', en: 'Addressed' },
};

/**
 * How a person votes on one post.
 *
 * Pressing the same arrow twice takes the vote back, which is what a thing
 * shaped like a toggle should do. The count is the server's, not a guess
 * made locally, so two people voting at once cannot drift apart.
 */
const Vote: React.FC<{
  post: HubPost;
  busy: boolean;
  onVote: (value: 1 | -1) => void;
}> = ({ post, busy, onVote }) => {
  const { num } = useOrganizer();
  const chosen = post.my_vote;

  const arrow = (value: 1 | -1, glyph: string, label: string) => (
    <button
      type="button"
      disabled={busy}
      aria-label={label}
      aria-pressed={chosen === value}
      onClick={() => onVote(value)}
      className={`w-7 h-6 grid place-items-center rounded text-[13px] leading-none transition disabled:opacity-50 ${
        chosen === value ? 'text-amber font-bold' : 'text-[#6E7C8E] hover:text-navy-700'
      }`}
    >
      {glyph}
    </button>
  );

  return (
    <div
      className={`flex flex-col items-center rounded-lg border px-1 py-1 flex-none ${
        chosen !== 0 ? 'border-amber bg-amber/[.08]' : 'border-navy-800/15 bg-white'
      }`}
    >
      {arrow(1, '↑', 'Upvote')}
      <span className="text-[12.5px] tabular-nums font-medium">{num(post.score)}</span>
      {arrow(-1, '↓', 'Downvote')}
    </div>
  );
};

interface Props {
  meetings: EventMeeting[];
  guestToken?: string;
}

/**
 * The attendee hub: questions, ideas, and a private word with the organizer.
 *
 * The room decides what most wants answering by voting, so the questions
 * the organizer sees at the top are the ones people actually care about.
 * Suggestions are the exception - they go to the organizer alone, and are
 * not something to be voted on in public.
 */
export const DiscussionHub: React.FC<Props> = ({ meetings, guestToken }) => {
  const { t, num } = useOrganizer();

  const [meetingCode, setMeetingCode] = useState(meetings[0]?.meeting_code ?? '');
  const meeting = meetings.find((m) => m.meeting_code === meetingCode) ?? meetings[0];

  // 'photo' is not a kind of post, so it sits alongside the board's kinds
  // rather than inside them.
  const [tab, setTab] = useState<HubKind | 'photo'>('question');
  const [board, setBoard] = useState<HubBoard | null>(null);
  const [draft, setDraft] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [category, setCategory] = useState(CATEGORIES[0].id);
  const [sending, setSending] = useState(false);
  const [voting, setVoting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!meeting) { setBoard(null); return; }
    try {
      setBoard(await apiClient.getHub(meeting.meeting_code, guestToken));
    } catch {
      setBoard({ questions: [], ideas: [], suggestions: [] });
    }
  }, [meeting, guestToken]);

  useEffect(() => {
    load();
    const id = setInterval(load, ACTIVE_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const send = async () => {
    // The photo tab has no composer, so nothing to send from it.
    if (!meeting || tab === 'photo') return;
    if (!draft.trim()) {
      toast.error(t({ ne: 'केही लेख्नुहोस्', en: 'Write something first' }));
      return;
    }
    try {
      setSending(true);
      await apiClient.addHubPost(
        meeting.meeting_code,
        {
          kind: tab,
          body: draft.trim(),
          anonymous,
          ...(tab === 'suggestion' ? { category } : {}),
        },
        guestToken
      );
      setDraft('');
      toast.success(
        tab === 'suggestion'
          ? t({ ne: 'सुझाव आयोजककहाँ पुग्यो', en: 'Your suggestion has gone to the organizer' })
          : t({ ne: 'पठाइयो — मोडेरेसनपछि देखिन्छ', en: 'Sent. It appears once the organizer lets it through.' })
      );
      await load();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'पठाउन सकिएन', en: 'Could not send it' })));
    } finally { setSending(false); }
  };

  const vote = async (post: HubPost, value: 1 | -1) => {
    if (!meeting) return;
    try {
      setVoting(post.id);
      const updated = await apiClient.voteHubPost(
        meeting.meeting_code, post.id, value, guestToken
      );
      setBoard((prev) => {
        if (!prev) return prev;
        const swap = (rows: HubPost[]) =>
          rows.map((r) => (r.id === updated.id ? updated : r));
        return {
          questions: swap(prev.questions),
          ideas: swap(prev.ideas),
          suggestions: prev.suggestions,
        };
      });
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'भोट दिन सकिएन', en: 'Could not vote' })));
    } finally { setVoting(null); }
  };

  if (!meeting) {
    return (
      <Card className="text-center py-10">
        <p className="text-[#6E7C8E]">
          {t({ ne: 'कुनै बैठक छैन।', en: 'No meeting to discuss yet.' })}
        </p>
      </Card>
    );
  }

  const field =
    'w-full border border-navy-800/15 rounded-[10px] px-3 py-2.5 text-[14px] bg-white';

  const composer = (
    <Card className="mb-3.5">
      <h3 className="text-[15px] font-semibold">
        {tab === 'question'
          ? t({ ne: 'अहिलेको सत्रमा प्रश्न सोध्नुहोस्', en: 'Ask a question about this session' })
          : tab === 'idea'
          ? t({ ne: 'विचार बोर्डमा थप्नुहोस्', en: 'Add to the idea board' })
          : t({ ne: 'आयोजकलाई सुझाव', en: 'A word with the organizer' })}
      </h3>
      <p className="text-[12.5px] text-[#6E7C8E] mt-0.5">
        {tab === 'question'
          ? t({
              ne: 'धेरै भोट पाएको प्रश्न माथि देखिन्छ।',
              en: 'The questions with the most votes rise to the top.',
            })
          : tab === 'idea'
          ? t({
              ne: 'एक वाक्यमा — अरूले भोट दिन सक्छन्।',
              en: 'One sentence. Other people can vote it up.',
            })
          : t({
              ne: 'सुझाव सिधै आयोजककहाँ जान्छ — अरू सहभागीले देख्दैनन्।',
              en: 'This goes to the organizer alone. No other attendee sees it.',
            })}
      </p>

      {tab === 'suggestion' && (
        <div className="mt-3 flex gap-1.5 flex-wrap">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={`px-2.5 py-1 rounded-full text-[12.5px] border transition ${
                category === c.id
                  ? 'bg-navy-900 text-white border-navy-900'
                  : 'bg-white text-ink-2 border-navy-800/15 hover:border-navy-500'
              }`}
            >
              {t(c.label)}
            </button>
          ))}
        </div>
      )}

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={tab === 'idea' ? 2 : 3}
        placeholder={
          tab === 'question'
            ? t({ ne: 'जस्तै: कोष खर्च गर्न कति दिनमा स्वीकृति आउँछ?', en: 'For example: how long does approval take?' })
            : tab === 'idea'
            ? t({ ne: 'तपाईंको विचार एक वाक्यमा', en: 'Your idea, in one sentence' })
            : t({ ne: 'जस्तै: दोस्रो हलमा माइक राम्रोसँग सुनिँदैन।', en: 'For example: the microphone in the second hall is hard to hear.' })
        }
        className={`${field} mt-3 font-read`}
      />

      <div className="mt-2.5 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          role="switch"
          aria-checked={anonymous}
          onClick={() => setAnonymous((v) => !v)}
          className="inline-flex items-center gap-2 text-[13px]"
        >
          <span
            className={`w-9 h-5 rounded-full transition relative ${
              anonymous ? 'bg-ok' : 'bg-navy-800/20'
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                anonymous ? 'left-[1.15rem]' : 'left-0.5'
              }`}
            />
          </span>
          {t({ ne: 'नाम नदेखाई', en: 'Without my name' })}
        </button>

        <Btn tone="solid" className="ms-auto" disabled={sending} onClick={send}>
          {tab === 'question'
            ? t({ ne: 'प्रश्न पठाउनुहोस्', en: 'Send the question' })
            : tab === 'idea'
            ? t({ ne: 'बोर्डमा टाँस्नुहोस्', en: 'Pin it to the board' })
            : t({ ne: 'सुझाव पठाउनुहोस्', en: 'Send the suggestion' })}
        </Btn>
      </div>
    </Card>
  );

  const rows = tab === 'question' ? board?.questions
    : tab === 'idea' ? board?.ideas
    : board?.suggestions;

  return (
    <>
      <Tabs
        active={tab}
        onChange={(id) => { setTab(id as HubKind | 'photo'); setDraft(''); }}
        tabs={[
          {
            id: 'question',
            label: {
              ne: `प्रश्नोत्तर (${num(board?.questions.length ?? 0)})`,
              en: `Q&A (${board?.questions.length ?? 0})`,
            },
          },
          {
            id: 'idea',
            label: {
              ne: `विचार बोर्ड (${num(board?.ideas.length ?? 0)})`,
              en: `Idea board (${board?.ideas.length ?? 0})`,
            },
          },
          { id: 'photo', label: { ne: 'फोटो', en: 'Photos' } },
          { id: 'suggestion', label: { ne: 'आयोजकलाई सुझाव', en: 'To the organizer' } },
        ]}
      />

      {meetings.length > 1 && (
        <div className="mb-3.5">
          <label className="block text-[12.5px] text-[#6E7C8E] mb-1.5">
            {t({ ne: 'कुन बैठक', en: 'Which meeting' })}
          </label>
          <select
            value={meetingCode}
            onChange={(e) => setMeetingCode(e.target.value)}
            className={`${field} max-w-md`}
          >
            {meetings.map((m) => (
              <option key={m.id} value={m.meeting_code}>{m.title}</option>
            ))}
          </select>
        </div>
      )}

      {tab === 'photo' ? (
        meeting ? (
          <PhotoAlbums meetingRef={meeting.meeting_code} canManage={!guestToken} />
        ) : (
          <Card><Empty>{t({ ne: 'कुनै बैठक छैन।', en: 'No meeting yet.' })}</Empty></Card>
        )
      ) : (
      <>
      {composer}

      {!board ? (
        <Card><Empty>{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</Empty></Card>
      ) : (rows?.length ?? 0) === 0 ? (
        <Card>
          <Empty>
            {tab === 'question'
              ? t({ ne: 'अझै कुनै प्रश्न छैन। पहिलो सोध्नुहोस्।', en: 'No questions yet. Ask the first one.' })
              : tab === 'idea'
              ? t({ ne: 'बोर्ड खाली छ। पहिलो विचार टाँस्नुहोस्।', en: 'The board is empty. Pin the first idea.' })
              : t({ ne: 'तपाईंले अझै कुनै सुझाव पठाउनुभएको छैन।', en: 'You have not sent a suggestion yet.' })}
          </Empty>
        </Card>
      ) : tab === 'idea' ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' }}>
          {rows!.map((post) => (
            <Card key={post.id} className={post.mine ? 'border-s-[3px] border-s-amber' : ''}>
              <p className="text-[13.5px] font-read">{post.body}</p>
              <div className="mt-2.5 flex items-center gap-2.5">
                <Vote post={post} busy={voting === post.id} onVote={(v) => vote(post, v)} />
                <span className="text-[12.5px] text-[#6E7C8E] truncate">{post.author}</span>
                {post.status === 'pending' && (
                  <span className="ms-auto flex-none">
                    <Chip tone="warn">{t(STATUS_LABEL.pending)}</Chip>
                  </span>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : tab === 'question' ? (
        <Card className="p-0 overflow-hidden">
          {rows!.map((post) => (
            <div key={post.id} className="flex gap-3 p-4 border-b border-navy-800/[.08] last:border-0">
              <Vote post={post} busy={voting === post.id} onVote={(v) => vote(post, v)} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-navy-900">{post.body}</p>
                <p className="text-[12.5px] text-[#6E7C8E] mt-0.5">
                  {post.author}
                  {post.mine && ` (${t({ ne: 'तपाईं', en: 'you' })})`}
                  {post.session_title && ` · ${post.session_title}`}
                </p>
                {post.status === 'pending' && (
                  <p className="text-[12.5px] text-[#6E7C8E] mt-0.5">
                    {t(STATUS_LABEL.pending)}
                  </p>
                )}
                {post.answer && (
                  <div className="mt-2.5 bg-cream rounded-lg px-3 py-2.5">
                    <p className="text-[12px] font-semibold text-navy-900">
                      {t({ ne: 'जवाफ', en: 'Answer' })}
                    </p>
                    <p className="text-[13px] font-read text-ink-2 mt-0.5">
                      {post.answer}
                      {post.answered_by && (
                        <span className="text-[#6E7C8E]"> — {post.answered_by}</span>
                      )}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 pt-3.5 pb-1">
            <h3 className="text-[14px] font-semibold">
              {t({ ne: 'तपाईंका पुराना सुझाव', en: 'Your suggestions so far' })}
            </h3>
          </div>
          {rows!.map((post) => (
            <div key={post.id} className="px-4 py-3 border-b border-navy-800/[.08] last:border-0">
              <p className="text-[13.5px] font-read">“{post.body}”</p>
              <p className="mt-1 flex items-center gap-1.5 flex-wrap">
                <Chip tone={post.status === 'addressed' ? 'ok' : 'warn'}>
                  {t(STATUS_LABEL[post.status] ?? STATUS_LABEL.looking)}
                </Chip>
                {post.category && (
                  <span className="text-[12.5px] text-[#6E7C8E]">
                    {t(CATEGORIES.find((c) => c.id === post.category)?.label ?? { ne: post.category, en: post.category })}
                  </span>
                )}
                <span className="text-[12px] text-[#6E7C8E] tabular-nums">
                  · {new Date(post.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                </span>
              </p>
            </div>
          ))}
        </Card>
      )}
      </>
      )}
    </>
  );
};
