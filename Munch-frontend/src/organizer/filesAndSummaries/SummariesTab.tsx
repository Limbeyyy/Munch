import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { Event, Session, SessionSummary } from '../../types';
import { errorText } from '../errors';
import { Pair, useOrganizer } from '../i18n';
import { Modal } from '../OrganizerShell';
import {
  FilterPills, NothingYet, QuietButton, SearchInput, StatCard, clockOf,
} from './shared';

/** What a summary is, as the list files it. */
type State = 'published' | 'draft' | 'missing';

const STATE_LABEL: Record<State, Pair> = {
  published: { ne: 'प्रकाशित', en: 'Published' },
  draft: { ne: 'मस्यौदा', en: 'Draft' },
  missing: { ne: 'उपलब्ध छैन', en: 'Not available' },
};

/** The badge's own colours, which the design gives one set each. */
const STATE_TINT: Record<State, { bg: string; ink: string }> = {
  published: { bg: '#f0fdf4', ink: '#008236' },
  draft: { bg: '#fffbeb', ink: '#bb4d00' },
  missing: { bg: '#f3f4f6', ink: '#6a7282' },
};

type Filter = 'all' | State;

/**
 * One agenda's summary, and what may be done with it.
 *
 * Three states, and the buttons differ by state because the decisions
 * do. A published one can be withdrawn; a draft can go out; one that was
 * never written has nothing to preview, only a transcript to read and a
 * first draft to make from it.
 */
interface Row {
  session: Session;
  summary?: SessionSummary;
  state: State;
}

const stateOf = (summary?: SessionSummary): State => {
  if (!summary || !summary.saved) return 'missing';
  return summary.is_published ? 'published' : 'draft';
};

export const SummariesTab: React.FC<{ event: Event }> = ({ event }) => {
  const { t, num } = useOrganizer();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [summaries, setSummaries] = useState<Record<string, SessionSummary>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState('');

  /** The agenda whose summary is open for rewriting, and the words in it. */
  const [editing, setEditing] = useState<Row | null>(null);
  const [draft, setDraft] = useState('');
  /** An agenda whose summary or transcript is open to be read, not changed. */
  const [reading, setReading] = useState<{ row: Row; body: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let own: Session[] = [];
    try {
      own = await apiClient.listSessions(event.id);
    } catch {
      own = [];
    }
    setSessions(own);

    const results = await Promise.allSettled(
      own.map((one) =>
        apiClient.getSessionSummary(one.id).then((got) => [one.id, got] as const)
      )
    );
    const next: Record<string, SessionSummary> = {};
    results.forEach((one) => {
      if (one.status === 'fulfilled') next[one.value[0]] = one.value[1];
    });
    setSummaries(next);
    setLoading(false);
  }, [event.id]);

  useEffect(() => { load(); }, [load]);

  const rows: Row[] = useMemo(
    () => sessions.map((session) => {
      const summary = summaries[session.id];
      return { session, summary, state: stateOf(summary) };
    }),
    [sessions, summaries]
  );

  const shown = rows.filter((row) => {
    if (filter !== 'all' && row.state !== filter) return false;
    return row.session.title.toLowerCase()
      .includes(search.trim().toLowerCase());
  });

  const counted = (state: State) => rows.filter((r) => r.state === state).length;

  const decide = async (row: Row, what: 'publish' | 'unpublish') => {
    setBusy(row.session.id);
    try {
      if (what === 'publish') {
        await apiClient.publishSessionSummary(row.session.id);
        toast.success(t({ ne: 'सारांश प्रकाशित भयो', en: 'Summary published' }));
      } else {
        await apiClient.unpublishSessionSummary(row.session.id);
        toast.success(t({ ne: 'सारांश फिर्ता लियो', en: 'Summary taken back' }));
      }
      await load();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'भएन', en: 'That did not go through' })));
    } finally {
      setBusy('');
    }
  };

  /**
   * Make a first draft out of what was said.
   *
   * An unwritten summary already comes back as a draft of the transcript,
   * which is what somebody writing one starts from. Generating it is
   * saving that draft, so it stops being a suggestion and becomes a
   * thing with a state.
   */
  const generate = async (row: Row) => {
    const body = (row.summary?.body ?? '').trim();
    if (!body) {
      toast.error(t({
        ne: 'यो सत्रको ट्रान्सक्रिप्ट छैन, त्यसैले लेख्ने केही छैन',
        en: 'There is no transcript for this agenda to write one from',
      }));
      return;
    }
    setBusy(row.session.id);
    try {
      await apiClient.saveSessionSummary(row.session.id, body);
      toast.success(t({ ne: 'मस्यौदा बन्यो', en: 'Draft written' }));
      await load();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'भएन', en: 'That did not go through' })));
    } finally {
      setBusy('');
    }
  };

  const save = async (andPublish: boolean) => {
    if (!editing) return;
    setBusy(editing.session.id);
    try {
      await apiClient.saveSessionSummary(editing.session.id, draft);
      if (andPublish) await apiClient.publishSessionSummary(editing.session.id);
      toast.success(
        andPublish
          ? t({ ne: 'सारांश प्रकाशित भयो', en: 'Summary published' })
          : t({ ne: 'मस्यौदा सेभ भयो', en: 'Draft saved' })
      );
      setEditing(null);
      await load();
    } catch (e: any) {
      toast.error(errorText(e, t({ ne: 'सेभ भएन', en: 'Could not save it' })));
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return <NothingYet title={t({ ne: 'ल्याउँदै…', en: 'Loading…' })} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-3">
        <StatCard
          label={t({ ne: 'कार्यसूची', en: 'Agendas' })}
          value={num(sessions.length)}
        />
        <StatCard
          label={t({ ne: 'प्रकाशित', en: 'Published' })}
          value={num(counted('published'))}
        />
        <StatCard
          label={t({ ne: 'मस्यौदा', en: 'Draft' })}
          value={num(counted('draft'))}
        />
      </div>

      <div className="flex gap-4 items-center flex-wrap">
        <SearchInput
          value={search}
          onChange={setSearch}
          label={t({ ne: 'सारांश खोज्नुहोस्', en: 'Search summaries' })}
        />
        <FilterPills<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'all', label: { ne: 'सबै', en: 'All' } },
            { id: 'published', label: STATE_LABEL.published },
            { id: 'draft', label: STATE_LABEL.draft },
            { id: 'missing', label: STATE_LABEL.missing },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <NothingYet
          title={t({ ne: 'कुनै सारांश छैन', en: 'No summaries here' })}
          lede={t({
            ne: 'सत्र सकिएपछि तिनका सारांश यहाँ देखिनेछन्।',
            en: 'Summaries appear here once an agenda has run.',
          })}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((row) => {
            const tint = STATE_TINT[row.state];
            const working = busy === row.session.id;
            return (
              <article
                key={row.session.id}
                className="bg-white border-[0.6px] border-[#b3b3b3] rounded-[12px] p-5
                  shadow-[0px_4px_3px_rgba(0,0,0,0.1),0px_2px_2px_rgba(0,0,0,0.05)]"
              >
                <div className="flex gap-4 items-start">
                  <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex gap-2 items-center flex-wrap">
                      <span
                        className="rounded-[4px] px-2 py-0.5 text-[12px]
                          font-medium leading-4"
                        style={{ backgroundColor: tint.bg, color: tint.ink }}
                      >
                        {t(STATE_LABEL[row.state])}
                      </span>
                      {row.state === 'published' && row.summary?.published_at && (
                        <span className="text-[12px] text-faint leading-4">
                          {t({
                            ne: `${clockOf(row.summary.published_at)} मा प्रकाशित`,
                            en: `Published ${clockOf(row.summary.published_at)}`,
                          })}
                        </span>
                      )}
                      {row.state === 'draft' && row.summary?.updated_at && (
                        <span className="text-[12px] text-faint leading-4">
                          {t({
                            ne: `${clockOf(row.summary.updated_at)} मा सम्पादित`,
                            en: `Last edited ${clockOf(row.summary.updated_at)}`,
                          })}
                        </span>
                      )}
                    </div>

                    <h3 className="pt-1.5 text-[14px] font-semibold text-head
                      leading-5">
                      {row.session.title}
                    </h3>
                    <p className="pt-0.5 text-[12px] text-faint leading-4">
                      {[
                        clockOf(row.session.starts_at),
                        row.session.speaker_name,
                      ].filter(Boolean).join(' · ')}
                    </p>

                    {row.state === 'missing' ? (
                      <p className="pt-3 text-[14px] italic text-faint
                        leading-[22.75px]">
                        {t({
                          ne: 'अझै कुनै सारांश छैन।',
                          en: 'No summary available yet.',
                        })}
                      </p>
                    ) : (
                      <p className="pt-3 text-[14px] text-body leading-[22.75px]
                        line-clamp-2">
                        {row.summary?.body}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5 items-stretch shrink-0">
                    {row.state === 'missing' ? (
                      <>
                        <QuietButton
                          disabled={working}
                          onClick={() => setReading({
                            row, body: row.summary?.body ?? '',
                          })}
                        >
                          {t({ ne: 'ट्रान्सक्रिप्ट हेर्नुहोस्', en: 'View transcript' })}
                        </QuietButton>
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => generate(row)}
                          className="bg-navy-800 rounded-[8px] px-3 py-1.5
                            text-[12px] font-medium text-white leading-4
                            hover:bg-navy-900 disabled:opacity-50"
                        >
                          {t({ ne: 'सारांश बनाउनुहोस्', en: 'Generate summary' })}
                        </button>
                      </>
                    ) : (
                      <>
                        <QuietButton
                          disabled={working}
                          onClick={() => {
                            setDraft(row.summary?.body ?? '');
                            setEditing(row);
                          }}
                        >
                          {t({ ne: 'सम्पादन', en: 'Edit' })}
                        </QuietButton>
                        <QuietButton
                          disabled={working}
                          onClick={() => setReading({
                            row, body: row.summary?.body ?? '',
                          })}
                        >
                          {t({ ne: 'हेर्नुहोस्', en: 'Preview' })}
                        </QuietButton>
                        {row.state === 'published' ? (
                          <QuietButton
                            disabled={working}
                            onClick={() => decide(row, 'unpublish')}
                          >
                            {t({ ne: 'फिर्ता लिनुहोस्', en: 'Unpublish' })}
                          </QuietButton>
                        ) : (
                          <button
                            type="button"
                            disabled={working}
                            onClick={() => decide(row, 'publish')}
                            className="bg-navy-800 rounded-[8px] px-3 py-1.5
                              text-[12px] font-medium text-white leading-4
                              hover:bg-navy-900 disabled:opacity-50"
                          >
                            {t({ ne: 'प्रकाशित', en: 'Publish' })}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* 641-17972: the agenda and its speaker read-only above the words,
          because which summary is being rewritten is not itself editable. */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t({ ne: 'सारांश सम्पादन', en: 'Edit summary' })}
        wide
        divided
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="text-[14px] text-[#c0392b] underline underline-offset-4"
            >
              {t({ ne: 'रद्द', en: 'Cancel' })}
            </button>
            <span className="flex gap-3">
              <QuietButton
                className="!text-[14px] !px-4 !py-2"
                disabled={busy !== ''}
                onClick={() => save(false)}
              >
                {t({ ne: 'मस्यौदा सेभ', en: 'Save draft' })}
              </QuietButton>
              <button
                type="button"
                disabled={busy !== ''}
                onClick={() => save(true)}
                className="bg-navy-800 rounded-[8px] px-4 py-2 text-[14px]
                  font-medium text-white hover:bg-navy-900 disabled:opacity-50"
              >
                {t({ ne: 'सेभ र प्रकाशित', en: 'Save & publish' })}
              </button>
            </span>
          </div>
        }
      >
        <div className="flex gap-12 pb-4">
          <div>
            <p className="text-[12px] text-subtle leading-4">
              {t({ ne: 'कार्यसूची', en: 'Agenda' })}
            </p>
            <p className="pt-0.5 text-[14px] font-medium text-head">
              {editing?.session.title}
            </p>
          </div>
          {editing?.session.speaker_name && (
            <div>
              <p className="text-[12px] text-subtle leading-4">
                {t({ ne: 'वक्ता', en: 'Speaker' })}
              </p>
              <p className="pt-0.5 text-[14px] font-medium text-head">
                {editing.session.speaker_name}
              </p>
            </div>
          )}
        </div>
        <label
          htmlFor="manch-summary-body"
          className="block text-[12px] text-subtle leading-4 pb-1"
        >
          {t({ ne: 'सारांश', en: 'Summary' })}
        </label>
        <textarea
          id="manch-summary-body"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={10}
          className="w-full border border-line rounded-[8px] px-3 py-2.5
            text-[14px] text-head leading-6 resize-y"
        />
      </Modal>

      <Modal
        open={reading !== null}
        onClose={() => setReading(null)}
        title={reading?.row.session.title ?? ''}
        lede={
          reading?.row.state === 'missing'
            ? t({ ne: 'यो सत्रको ट्रान्सक्रिप्ट', en: 'The transcript of this agenda' })
            : t({ ne: 'प्रकाशित हुने सारांश', en: 'The summary as it reads' })
        }
        wide
      >
        {reading?.body?.trim() ? (
          <p className="text-[14px] text-body leading-[22.75px] whitespace-pre-wrap">
            {reading.body}
          </p>
        ) : (
          <p className="text-[14px] italic text-faint">
            {t({ ne: 'अझै केही छैन।', en: 'There is nothing here yet.' })}
          </p>
        )}
      </Modal>
    </div>
  );
};
