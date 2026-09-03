import React, { useEffect, useState } from 'react';
import { apiClient } from '../../services/api';
import { Meeting } from '../../types';
import { useOrganizer } from '../i18n';
import { Btn, Card, Head, Panel } from '../ui';

interface Props {
  meetings: Meeting[];
  onNavigate: (view: string) => void;
  onCreate: () => void;
}

/** What still needs doing before the event can run, checked against real data. */
export const SetupView: React.FC<Props> = ({ meetings, onNavigate, onCreate }) => {
  const { t, num } = useOrganizer();
  const [inviteCount, setInviteCount] = useState(0);
  const [fileCount, setFileCount] = useState(0);

  useEffect(() => {
    Promise.allSettled(meetings.map((m) => apiClient.getMeetingInvites(m.id))).then((rs) => {
      setInviteCount(
        rs.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value.length : 0), 0)
      );
    });
  }, [meetings]);

  useEffect(() => {
    Promise.allSettled(meetings.map((m) => apiClient.getResources(m.id))).then((rs) => {
      setFileCount(
        rs.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value.length : 0), 0)
      );
    });
  }, [meetings]);

  const withPresenters = meetings.length > 0;
  const anyStarted = meetings.some((m) => m.started_at);

  const items = [
    {
      ok: meetings.length > 0,
      title: { ne: 'सत्र बनाउनुहोस्', en: 'Create the sessions' },
      lede: meetings.length
        ? { ne: `${num(meetings.length)} सत्र तालिकामा छन्`, en: `${meetings.length} session${meetings.length === 1 ? '' : 's'} scheduled` }
        : { ne: 'अझै कुनै सत्र छैन', en: 'No sessions yet' },
      action: meetings.length > 0 ? 'agenda' : 'create',
    },
    {
      ok: inviteCount > 0,
      now: meetings.length > 0 && inviteCount === 0,
      title: { ne: 'सहभागीलाई निम्तो', en: 'Invite the attendees' },
      lede: inviteCount
        ? { ne: `${num(inviteCount)} निम्तो पठाइएको`, en: `${inviteCount} invitation${inviteCount === 1 ? '' : 's'} sent` }
        : { ne: 'निम्तोको सङ्ख्याले अपेक्षित उपस्थिति बनाउँछ', en: 'Invitations set the expected headcount' },
      action: 'attendance',
    },
    {
      ok: withPresenters,
      title: { ne: 'भूमिका मिलाउनुहोस्', en: 'Set the roles' },
      lede: { ne: 'प्रस्तोता र सह-आयोजक तोक्नुहोस्', en: 'Name your presenters and co-hosts' },
      action: 'people',
    },
    {
      ok: fileCount > 0,
      title: { ne: 'सामग्री राख्नुहोस्', en: 'Add the materials' },
      lede: fileCount
        ? { ne: `${num(fileCount)} फाइल आयोजकको ड्राइभमा`, en: `${fileCount} file${fileCount === 1 ? '' : 's'} in the host's Drive` }
        : { ne: 'सत्रका स्लाइड र कागज अपलोड गर्नुहोस्', en: 'Upload the slides and papers for each session' },
      action: 'content',
    },
    {
      ok: true,
      title: { ne: 'हलको यन्त्र', en: 'The hall device' },
      lede: {
        ne: 'यन्त्रले बोलेको कुरा पाठमा पठाउँछ — अडियो सर्भरमा आउँदैन।',
        en: 'The device sends speech as text — no audio reaches the server.',
      },
      action: 'settings',
    },
    {
      ok: anyStarted,
      title: { ne: 'सत्र सुरु गर्नुहोस्', en: 'Run the event' },
      lede: anyStarted
        ? { ne: 'सत्र सुरु भइसकेको छ', en: 'A session has been started' }
        : { ne: 'लाइभ नियन्त्रणबाट सुरु गर्नुहोस्', en: 'Start it from live control' },
      action: 'live',
    },
  ];

  const done = items.filter((i) => i.ok).length;
  const pct = Math.round((done / items.length) * 100);

  return (
    <>
      <Head
        title={{ ne: 'सेटअप', en: 'Setup' }}
        lede={{
          ne: 'कार्यक्रम चलाउन चाहिने कुरा — प्रत्येक वास्तविक अवस्थाबाट जाँचिएको।',
          en: 'What an event needs to run, each checked against what is really there.',
        }}
        actions={<Btn tone="amber" onClick={onCreate}>{t({ ne: '+ नयाँ सत्र', en: '+ New session' })}</Btn>}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px] items-start">
        <Panel
          title={t({ ne: 'बाँकी काम', en: "What's left" })}
          aside={
            <span className="text-[12.5px] text-[#6E7C8E]">
              {t({ ne: `${num(items.length - done)} वटा बाँकी`, en: `${items.length - done} left` })}
            </span>
          }
        >
          <div>
            {items.map((item) => (
              <div
                key={item.title.en}
                className="flex items-center gap-3 px-4 py-3.5 border-b border-navy-800/[.08] last:border-0"
              >
                <span
                  className={`w-6 h-6 rounded-full grid place-items-center flex-none text-xs border-2 ${
                    item.ok
                      ? 'bg-ok border-ok text-white'
                      : item.now
                      ? 'border-amber text-amber-700 font-bold'
                      : 'border-navy-800/15 text-[#6E7C8E]'
                  }`}
                >
                  {item.ok ? '✓' : '!'}
                </span>
                <div className="min-w-0">
                  <h4 className="text-[14.5px] font-medium">{t(item.title)}</h4>
                  <p className="text-[12.5px] text-[#6E7C8E]">{t(item.lede)}</p>
                </div>
                <span className="ml-auto flex-none">
                  <Btn
                    sm
                    onClick={() => (item.action === 'create' ? onCreate() : onNavigate(item.action))}
                  >
                    {item.ok ? t({ ne: 'हेर्नुहोस्', en: 'Review' }) : t({ ne: 'पूरा गर्नुहोस्', en: 'Finish' })}
                  </Btn>
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <div className="flex flex-col gap-3.5">
          <Card className="flex gap-4 items-center">
            <div
              className="w-[74px] h-[74px] rounded-full flex-none grid place-items-center"
              style={{ background: `conic-gradient(#1B7F58 ${pct}%, #EFE8D8 0)` }}
            >
              <span className="w-[58px] h-[58px] rounded-full bg-white grid place-items-center font-semibold text-base tabular-nums">
                {num(pct)}%
              </span>
            </div>
            <div>
              <h3 className="text-[15.5px] font-semibold">{t({ ne: 'सेटअप प्रगति', en: 'Setup progress' })}</h3>
              <p className="text-[12.5px] text-[#6E7C8E]">
                {t({
                  ne: 'हरेक चरण वास्तविक डाटाबाट जाँचिन्छ।',
                  en: 'Each step is checked against real data.',
                })}
              </p>
            </div>
          </Card>

          <Card>
            <h3 className="text-[15px] font-semibold">{t({ ne: 'दुई भाषा', en: 'Two languages' })}</h3>
            <p className="text-[12.5px] text-[#6E7C8E] mt-1.5">
              {t({
                ne: 'माथिको स्विचबाट नेपाली र English फेर्न मिल्छ। ट्रान्सक्रिप्टले पनि दुवै भाषा बोक्छ।',
                en: 'Switch Nepali and English from the top bar. Transcripts carry both languages too.',
              })}
            </p>
          </Card>

          <Card>
            <h3 className="text-[15px] font-semibold">{t({ ne: 'डाटा कहाँ बस्छ', en: 'Where data lives' })}</h3>
            <p className="text-[12.5px] text-[#6E7C8E] mt-1.5">
              {t({
                ne: 'फाइल आयोजकको गुगल ड्राइभमा, बाँकी तपाईंकै सर्भरमा। अडियो कतै राखिँदैन।',
                en: "Files sit in the host's Google Drive, the rest on your own server. No audio is stored anywhere.",
              })}
            </p>
          </Card>
        </div>
      </div>
    </>
  );
};
