import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { LIST_POLL_MS } from '../../services/polling';
import { Event } from '../../types';
import { useOrganizer } from '../../organizer/i18n';
import { HomeSection, HomeShell } from './HomeShell';
import { HomeScreen } from './HomeScreen';
import { EventsScreen } from './EventsScreen';
import { EventDetail } from './EventDetail';
import { NotificationsScreen } from './NotificationsScreen';
import { Settings } from './profile/Settings';
import { LiveRoom } from './LiveRoom';

/**
 * The attendee's app, on a phone.
 *
 * Two flows, not one. Most of the time somebody is outside any room -
 * looking at what is coming, what they have been told, what was said
 * at the thing they went to last week - and that is this shell: four
 * tabs and an event you can open and read. Stepping into a live room
 * replaces the whole screen, because in a hall the room is the only
 * thing you are doing.
 *
 * The host's screens are a different app in the same bundle and are
 * left exactly as they were: a host works at a desk and needs the rail,
 * the tables and the forms.
 */
export const AttendeeApp: React.FC = () => {
  const { t } = useOrganizer();

  const [at, setAt] = useState<HomeSection>('home');
  const [events, setEvents] = useState<Event[]>([]);
  const [eventsDeck, setEventsDeck] = useState<'upcoming' | 'completed'>('upcoming');
  const [openId, setOpenId] = useState('');
  const [profileSubpageOpen, setProfileSubpageOpen] = useState(false);
  const [inRoom, setInRoom] = useState(false);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const initialRoomChosen = useRef(false);

  const load = useCallback(async () => {
    try {
      const listed = await apiClient.listEvents('attendee');
      setEvents(listed);
      if (!initialRoomChosen.current) {
        initialRoomChosen.current = true;
        let preferredCode = '';
        try {
          preferredCode = sessionStorage.getItem('manch.pending_live_event') ?? '';
        } catch {
          // The list still tells us whether a live event is available.
        }
        const preferred = listed.find(
          (one) => one.code.toUpperCase() === (preferredCode ?? '').toUpperCase()
            && one.status === 'active'
        );
        if (preferred || listed.some((one) => one.status === 'active')) {
          setInRoom(true);
          try {
            sessionStorage.removeItem('manch.pending_live_event');
          } catch {
            // Selecting the live room does not depend on storage.
          }
        }
      }
    } catch {
      toast.error(t({ ne: 'कार्यक्रम ल्याउन सकिएन', en: 'Could not load your events' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const id = setInterval(load, LIST_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const countUnread = useCallback(async () => {
    try {
      setUnread((await apiClient.getReminders('attendee')).unread);
    } catch {
      /* A badge is not worth a message. */
    }
  }, []);

  useEffect(() => { countUnread(); }, [countUnread]);

  if (inRoom) return <LiveRoom onLeave={() => setInRoom(false)} />;

  const open = events.find((one) => one.id === openId) ?? null;

  if (loading) {
    return (
      <div className="min-h-[100dvh] grid place-items-center bg-white">
        <p className="text-[14px] text-[#8b90a0]">
          {t({ ne: 'ल्याउँदै…', en: 'Loading…' })}
        </p>
      </div>
    );
  }

  return (
    <HomeShell
      at={at}
      onGo={(to) => {
        setOpenId('');
        setProfileSubpageOpen(false);
        setAt(to);
      }}
      unread={unread}
      showNav={!open && !profileSubpageOpen}
    >
      {open ? (
        <EventDetail
          event={open}
          fromHome={at === 'home'}
          onBack={() => setOpenId('')}
          onEnterRoom={() => setInRoom(true)}
        />
      ) : (
        <>
          {at === 'home' && (
            <HomeScreen
              events={events}
              onOpen={(one) => setOpenId(one.id)}
              onSeeAll={(deck) => {
                setEventsDeck(deck);
                setAt('events');
              }}
              onJoinLive={() => setInRoom(true)}
            />
          )}
          {at === 'events' && (
            <EventsScreen
              events={events}
              deck={eventsDeck}
              onOpen={(one) => setOpenId(one.id)}
            />
          )}
          {at === 'notifications' && (
            <NotificationsScreen onRead={() => setUnread(0)} />
          )}
          {at === 'profile' && (
            <Settings onSubpageChange={setProfileSubpageOpen} />
          )}
        </>
      )}
    </HomeShell>
  );
};
