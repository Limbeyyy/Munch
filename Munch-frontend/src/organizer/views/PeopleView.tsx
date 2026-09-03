import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { Meeting, MeetingParticipant } from '../../types';
import { useOrganizer } from '../i18n';
import { Chip, Empty, Head, Panel, Tabs } from '../ui';

interface Props { meetings: Meeting[]; currentUserId?: string; }

type Role = 'host' | 'co_host' | 'presenter' | 'attendee';

const ROLE_LABEL: Record<Role, { ne: string; en: string }> = {
  host: { ne: 'आयोजक', en: 'Host' },
  co_host: { ne: 'सह-आयोजक', en: 'Co-host' },
  presenter: { ne: 'प्रस्तोता', en: 'Presenter' },
  attendee: { ne: 'सहभागी', en: 'Attendee' },
};

/** Who is in the event and what each of them is allowed to do. */
export const PeopleView: React.FC<Props> = ({ meetings, currentUserId }) => {
  const { t, num } = useOrganizer();
  const [tab, setTab] = useState('speakers');
  const [selected, setSelected] = useState(meetings[0]?.id ?? '');
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  const [changing, setChanging] = useState<string | null>(null);

  const meeting = meetings.find((m) => m.id === selected) ?? meetings[0];

  const load = React.useCallback(async () => {
    if (!meeting) return;
    try {
      setParticipants(await apiClient.getParticipants(meeting.id));
    } catch {
      toast.error(t({ ne: 'सूची ल्याउन सकिएन', en: 'Could not load the list' }));
    }
  }, [meeting, t]);

  useEffect(() => { load(); }, [load]);

  const isHost = !!meeting && meeting.host?.id === currentUserId;

  const changeRole = async (participant: MeetingParticipant, role: Role) => {
    if (!meeting || role === participant.role) return;

    if (role === 'host') {
      const ok = window.confirm(
        t({
          ne: `${participant.user.email} लाई आयोजक बनाउने?\n\nतपाईं सह-आयोजक हुनुहुनेछ र आयोजकका नियन्त्रण गुमाउनुहुनेछ।`,
          en: `Make ${participant.user.email} the host?\n\nYou become a co-host and lose the organizer controls.`,
        })
      );
      if (!ok) return;
    }

    try {
      setChanging(participant.id);
      await apiClient.updateParticipantRole(meeting.id, participant.user.id, role);
      await load();
      toast.success(
        t({
          ne: `${participant.user.email} अब ${ROLE_LABEL[role].ne}`,
          en: `${participant.user.email} is now ${ROLE_LABEL[role].en.toLowerCase()}`,
        })
      );
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? t({ ne: 'भूमिका बदल्न सकिएन', en: 'Could not change the role' }));
    } finally { setChanging(null); }
  };

  const speakers = participants.filter((p) => ['host', 'co_host', 'presenter'].includes(p.role));
  const rows = tab === 'speakers' ? speakers : participants;

  return (
    <>
      <Head
        title={{ ne: 'वक्ता र टोली', en: 'Speakers and team' }}
        lede={{
          ne: 'भूमिका फेर्दा त्यही बेला लागू हुन्छ — प्रस्तोताले सिधा सन्देश पाउँछन्।',
          en: 'Roles apply straight away — presenters can be messaged directly.',
        }}
      />

      {meetings.length > 1 && (
        <div className="mb-4">
          <label className="block text-[12.5px] text-[#6E7C8E] mb-1.5">
            {t({ ne: 'कुन सत्र', en: 'Which session' })}
          </label>
          <select
            value={meeting?.id ?? ''}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full max-w-md border border-navy-800/15 rounded-[9px] px-3 py-2 bg-white text-[14px]"
          >
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>{m.title} · {m.meeting_code}</option>
            ))}
          </select>
        </div>
      )}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'speakers', label: { ne: `वक्ता (${num(speakers.length)})`, en: `Speakers (${speakers.length})` } },
          { id: 'team', label: { ne: `सबै सहभागी (${num(participants.length)})`, en: `Everyone (${participants.length})` } },
        ]}
      />

      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[620px]">
            <thead>
              <tr className="bg-[#FBFAF6]">
                {[
                  { ne: 'नाम', en: 'Name' },
                  { ne: 'भूमिका', en: 'Role' },
                  { ne: 'अवस्था', en: 'Status' },
                  { ne: 'भित्रिएको', en: 'Joined' },
                  { ne: 'भूमिका बदल्ने', en: 'Change role' },
                ].map((h, i) => (
                  <th key={i} className="text-left text-xs text-[#6E7C8E] font-medium px-3 py-2.5 border-b border-navy-800/15">
                    {t(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5}><Empty>{t({ ne: 'अहिलेसम्म कोही छैन।', en: 'Nobody here yet.' })}</Empty></td></tr>
              )}
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-[#FBFAF6]">
                  <td className="px-3 py-2.5 border-b border-navy-800/[.08]">
                    <div className="flex items-center gap-2.5">
                      <span className="w-8 h-8 rounded-full bg-navy-700 text-white grid place-items-center text-xs font-semibold flex-none">
                        {(p.user?.email ?? '?').charAt(0).toUpperCase()}
                      </span>
                      <span className="text-[13.5px] font-medium truncate">{p.user?.email}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 border-b border-navy-800/[.08]">
                    <Chip tone={p.role === 'host' ? 'ok' : p.role === 'attendee' ? 'draft' : 'default'}>
                      {t(ROLE_LABEL[p.role as Role])}
                    </Chip>
                  </td>
                  <td className="px-3 py-2.5 border-b border-navy-800/[.08]">
                    {p.is_active
                      ? <Chip tone="live">{t({ ne: 'हलमा', en: 'In the room' })}</Chip>
                      : <Chip tone="draft">{t({ ne: 'बाहिर', en: 'Away' })}</Chip>}
                  </td>
                  <td className="px-3 py-2.5 border-b border-navy-800/[.08] text-[13px] tabular-nums">
                    {p.joined_at
                      ? new Date(p.joined_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : '—'}
                  </td>
                  <td className="px-3 py-2.5 border-b border-navy-800/[.08]">
                    <select
                      value={p.role}
                      disabled={!isHost || changing === p.id || p.user?.id === currentUserId}
                      onChange={(e) => changeRole(p, e.target.value as Role)}
                      title={
                        !isHost
                          ? t({ ne: 'आयोजकले मात्र भूमिका बदल्न सक्छन्', en: 'Only the host can change roles' })
                          : p.user?.id === currentUserId
                          ? t({ ne: 'आफ्नो भूमिका आफैँ बदल्न मिल्दैन', en: 'You cannot change your own role' })
                          : undefined
                      }
                      className="border border-navy-800/15 rounded-md px-2 py-1 text-[13px] bg-white disabled:opacity-50"
                    >
                      {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                        <option key={r} value={r}>{t(ROLE_LABEL[r])}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {!isHost && meeting && (
        <p className="text-[12.5px] text-[#6E7C8E] mt-2.5">
          {t({
            ne: 'यो सत्रका आयोजक तपाईं नभएकाले भूमिका हेर्न मात्र मिल्छ।',
            en: 'You are not the host of this session, so roles are read-only here.',
          })}
        </p>
      )}
    </>
  );
};
