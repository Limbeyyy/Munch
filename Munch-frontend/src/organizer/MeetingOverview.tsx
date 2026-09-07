import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../services/api';
import {
  Artifact, EventProgramme, Meeting, Session, TranscriptionSegment,
} from '../types';
import { Pair, useOrganizer } from './i18n';
import { Modal } from './OrganizerShell';
import { Btn, Chip, Empty, Tabs } from './ui';
import {
  MEETING_STATE_LABEL, MEETING_STATE_TONE, meetingState,
  SESSION_STATE_LABEL, SESSION_STATE_TONE, sessionState,
} from './sessionState';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const formatSize = (bytes?: number | null) => {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes; let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size < 10 && unit > 0 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
};

const Line: React.FC<{ label: Pair; children: React.ReactNode }> = ({ label, children }) => {
  const { t } = useOrganizer();
  return (
    <div className="flex gap-3 py-1.5 text-[13px]">
      <span className="text-[#6E7C8E] w-[110px] flex-none">{t(label)}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
};

/**
 * Everything about one meeting in one place, to read rather than to edit.
 *
 * The pieces exist on their own screens - the programme, the files, the
 * transcripts - but somebody checking a meeting over should not have to
 * visit three of them and hold the answer in their head. Nothing here
 * changes anything; the screens that own each piece keep that job.
 */
export const MeetingOverview: React.FC<{
  meeting: Meeting;
  onClose: () => void;
}> = ({ meeting, onClose }) => {
  const { t, num } = useOrganizer();
  const [tab, setTab] = useState('details');
  const [event, setEvent] = useState<EventProgramme | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [files, setFiles] = useState<Artifact[]>([]);
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [events, ownSessions, resources, transcript] = await Promise.allSettled([
      apiClient.listEvents(),
      apiClient.listSessions(meeting.id),
      apiClient.getResources(meeting.id),
      apiClient.getMeetingSegments(meeting.meeting_code),
    ]);

    if (events.status === 'fulfilled') {
      setEvent(
        events.value.find((e) => e.meetings.some((m) => m.id === meeting.id)) ?? null
      );
    }
    if (ownSessions.status === 'fulfilled') setSessions(ownSessions.value);
    if (resources.status === 'fulfilled') setFiles(resources.value);
    if (transcript.status === 'fulfilled') setSegments(transcript.value);
    setLoading(false);
  }, [meeting.id, meeting.meeting_code]);

  useEffect(() => { load(); }, [load]);

  // A speaker is one person however many sessions they hold, so the list
  // is by person rather than by appearance.
  const speakers = sessions.reduce<Record<string, Session[]>>((found, session) => {
    const name = session.speaker_name?.trim();
    if (!name) return found;
    const key = session.speaker_contact?.email?.trim().toLowerCase() || `name:${name.toLowerCase()}`;
    (found[key] ||= []).push(session);
    return found;
  }, {});

  /** The transcript of one session, from the meeting's whole stream. */
  const segmentsOf = (session: Session) =>
    segments.filter((s) => s.session_id === session.id);

  const unattached = segments.filter((s) => !s.session_id);

  return (
    <Modal
      open
      onClose={onClose}
      title={meeting.title}
      lede={`${clock(meeting.scheduled_start)}–${clock(meeting.scheduled_end)} · ${meeting.meeting_code}`}
      footer={<Btn tone="solid" onClick={onClose}>{t({ ne: 'बन्द', en: 'Close' })}</Btn>}
    >
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'details', label: { ne: 'विवरण', en: 'Details' } },
          {
            id: 'files',
            label: { ne: `फाइल (${num(files.length)})`, en: `Files (${files.length})` },
          },
          {
            id: 'summaries',
            label: { ne: `सारांश (${num(sessions.length)})`, en: `Summaries (${sessions.length})` },
          },
        ]}
      />

      {loading ? (
        <Empty>{t({ ne: 'ल्याउँदै…', en: 'Loading…' })}</Empty>
      ) : tab === 'details' ? (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-[12px] text-[#6E7C8E] mb-1">
              {t({ ne: 'कार्यक्रम', en: 'Event' })}
            </p>
            {event ? (
              <div className="bg-cream rounded-lg px-3 py-2">
                <Line label={{ ne: 'नाम', en: 'Title' }}>{event.title}</Line>
                <Line label={{ ne: 'मिति', en: 'Date' }}>
                  {new Date(event.event_date).toLocaleDateString(undefined, {
                    weekday: 'long', day: 'numeric', month: 'long',
                  })}
                </Line>
                {event.venue && (
                  <Line label={{ ne: 'स्थान', en: 'Venue' }}>{event.venue}</Line>
                )}
                <Line label={{ ne: 'बैठक', en: 'Meetings' }}>
                  {t({
                    ne: `${num(event.meeting_count)} बैठक · ${num(event.session_count)} सत्र`,
                    en: `${event.meeting_count} meetings · ${event.session_count} sessions`,
                  })}
                </Line>
              </div>
            ) : (
              <p className="text-[12.5px] text-[#6E7C8E]">
                {t({
                  ne: 'यो बैठक कुनै कार्यक्रमभित्र छैन।',
                  en: 'This meeting stands outside any programme.',
                })}
              </p>
            )}
          </div>

          <div>
            <p className="text-[12px] text-[#6E7C8E] mb-1">
              {t({ ne: 'यो बैठक', en: 'This meeting' })}
            </p>
            <div className="bg-cream rounded-lg px-3 py-2">
              <Line label={{ ne: 'कोड', en: 'Code' }}>
                <span className="font-mono text-navy-700">{meeting.meeting_code}</span>
              </Line>
              <Line label={{ ne: 'समय', en: 'Runs' }}>
                <span className="tabular-nums">
                  {clock(meeting.scheduled_start)}–{clock(meeting.scheduled_end)}
                </span>
              </Line>
              <Line label={{ ne: 'अवस्था', en: 'State' }}>
                <Chip tone={MEETING_STATE_TONE[meetingState(meeting)]}>
                  {t(MEETING_STATE_LABEL[meetingState(meeting)])}
                </Chip>
              </Line>
            </div>
          </div>

          <div>
            <p className="text-[12px] text-[#6E7C8E] mb-1">
              {t({ ne: `सत्र (${num(sessions.length)})`, en: `Sessions (${sessions.length})` })}
            </p>
            {sessions.length === 0 ? (
              <Empty>{t({ ne: 'कुनै सत्र छैन।', en: 'No sessions.' })}</Empty>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center gap-2.5 py-2 border-b border-navy-800/[.08] last:border-0 text-[13px]"
                >
                  <span className="tabular-nums text-[#6E7C8E] w-[46px] flex-none">
                    {clock(session.starts_at)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{session.title}</span>
                    <span className="block text-[12px] text-[#6E7C8E]">
                      {[session.speaker_name, session.hall].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                  <span className="ml-auto flex-none">
                    <Chip tone={SESSION_STATE_TONE[sessionState(session, Date.now(), meeting)]}>
                      {t(SESSION_STATE_LABEL[sessionState(session, Date.now(), meeting)])}
                    </Chip>
                  </span>
                </div>
              ))
            )}
          </div>

          <div>
            <p className="text-[12px] text-[#6E7C8E] mb-1">
              {t({
                ne: `वक्ता (${num(Object.keys(speakers).length)})`,
                en: `Speakers (${Object.keys(speakers).length})`,
              })}
            </p>
            {Object.keys(speakers).length === 0 ? (
              <Empty>{t({ ne: 'वक्ता तोकिएको छैन।', en: 'No speaker named.' })}</Empty>
            ) : (
              Object.values(speakers).map((held) => (
                <div
                  key={held[0].id}
                  className="flex items-start gap-2.5 py-2 border-b border-navy-800/[.08] last:border-0 text-[13px]"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{held[0].speaker_name}</span>
                    {held[0].speaker_contact?.email && (
                      <span className="block text-[12px] text-[#6E7C8E] truncate">
                        {held[0].speaker_contact.email}
                      </span>
                    )}
                    <span className="block text-[12px] text-[#6E7C8E]">
                      {held.map((s) => s.title).join(' · ')}
                    </span>
                  </span>
                  <span className="ml-auto flex-none">
                    <Chip tone={held[0].speaker_visibility === 'public' ? 'ok' : 'draft'}>
                      {held[0].speaker_visibility === 'public'
                        ? t({ ne: 'सार्वजनिक', en: 'Public' })
                        : t({ ne: 'निजी', en: 'Private' })}
                    </Chip>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : tab === 'files' ? (
        files.length === 0 ? (
          <Empty>
            {t({
              ne: 'यो बैठकमा कुनै फाइल छैन।',
              en: 'Nothing has been uploaded to this meeting.',
            })}
          </Empty>
        ) : (
          <div>
            {files.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-3 py-2.5 border-b border-navy-800/[.08] last:border-0"
              >
                <div className="min-w-0">
                  <p className="text-[13px] truncate">{file.display_name}</p>
                  <p className="text-[12px] text-[#6E7C8E]">
                    {formatSize(file.file_size)}
                    {file.session_title && ` · ${file.session_title}`}
                    {file.created_at && ` · ${new Date(file.created_at).toLocaleDateString()}`}
                  </p>
                </div>
                {file.is_released === false && (
                  <span className="ml-auto flex-none">
                    <Chip tone="draft">
                      {t({ ne: 'सत्रपछि खुल्छ', en: 'opens after its session' })}
                    </Chip>
                  </span>
                )}
                {file.web_view_link && (
                  <a
                    href={file.web_view_link}
                    target="_blank"
                    rel="noreferrer"
                    className="ms-2 flex-none text-[12.5px] text-navy-700 underline underline-offset-4"
                  >
                    {t({ ne: 'खोल्नुहोस्', en: 'Open' })}
                  </a>
                )}
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="flex flex-col gap-3">
          {sessions.length === 0 && unattached.length === 0 ? (
            <Empty>
              {t({
                ne: 'अझै कुनै सारांश छैन। सत्र चलेपछि यहाँ देखिन्छ।',
                en: 'Nothing yet. A summary appears once a session has run.',
              })}
            </Empty>
          ) : (
            <>
              {sessions.map((session) => {
                const lines = segmentsOf(session);
                return (
                  <div key={session.id} className="bg-cream rounded-lg px-3 py-2.5">
                    <p className="text-[13px] font-medium">
                      <span className="tabular-nums text-[#6E7C8E]">
                        {clock(session.starts_at)}
                      </span>{' '}
                      {session.title}
                    </p>
                    {lines.length === 0 ? (
                      <p className="text-[12.5px] text-[#6E7C8E] mt-1">
                        {t({ ne: 'सारांश छैन।', en: 'No summary for this session.' })}
                      </p>
                    ) : (
                      <p className="text-[13px] font-read mt-1.5 leading-relaxed">
                        {lines.map((line) => line.text).join(' ')}
                      </p>
                    )}
                  </div>
                );
              })}

              {unattached.length > 0 && (
                <div className="bg-cream rounded-lg px-3 py-2.5">
                  <p className="text-[13px] font-medium">
                    {t({ ne: 'सत्रबाहिरको', en: 'Outside any session' })}
                  </p>
                  <p className="text-[13px] font-read mt-1.5 leading-relaxed">
                    {unattached.map((line) => line.text).join(' ')}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
};
