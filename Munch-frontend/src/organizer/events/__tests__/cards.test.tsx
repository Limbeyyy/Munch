import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { OrganizerProvider } from '../../i18n';
import { Event } from '../../../types';
import { EventsDashboard, isSetUp } from '../EventsDashboard';

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
});

const day = '2026-09-15';

const anEvent = (over: Partial<Event> = {}): Event => ({
  id: 'e1',
  title: 'Emergency Service Meeting',
  description: '',
  venue: 'Kathmandu Convention Center',
  event_date: day,
  status: 'scheduled',
  code: 'MXC-DOX',
  scheduled_start: `${day}T10:00:00`,
  scheduled_end: `${day}T12:00:00`,
  participant_count: 0,
  sessions: [],
  session_count: 3,
  created_at: '', updated_at: '',
  ...over,
});

const show = (events: Event[], counts = { e1: { coHosts: 2, attendees: 21 } }) =>
  render(
    <OrganizerProvider>
      <EventsDashboard
        events={events}
        counts={counts}
        loading={false}
        onOpen={jest.fn()}
        onEdit={jest.fn()}
        onCreate={jest.fn()}
        onImport={jest.fn()}
      />
    </OrganizerProvider>
  );

/**
 * Whether an event is ready to run, which decides what its button offers.
 *
 * A page of notes and an event differ in two things: something to run,
 * and somebody to run it for. Until both are there the card offers to
 * carry on setting it up.
 */
describe('whether an event is set up', () => {
  it('is not, with a running order but nobody asked', () => {
    expect(isSetUp(anEvent({ session_count: 3 }), { coHosts: 2, attendees: 0 })).toBe(false);
  });

  it('is not, with people asked but nothing to run', () => {
    expect(isSetUp(anEvent({ session_count: 0 }), { coHosts: 2, attendees: 21 })).toBe(false);
  });

  it('is, once it has both', () => {
    expect(isSetUp(anEvent({ session_count: 3 }), { coHosts: 0, attendees: 21 })).toBe(true);
  });

  it('is not, when nothing is known about who was asked', () => {
    expect(isSetUp(anEvent({ session_count: 3 }), undefined)).toBe(false);
  });
});

describe('the button an event card offers', () => {
  it('offers to carry on where the setup is unfinished', () => {
    show([anEvent()], { e1: { coHosts: 0, attendees: 0 } });

    expect(screen.getByRole('button', { name: /Continue Setup/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit$/ })).toBeNull();
  });

  it('offers to edit once it is ready', () => {
    show([anEvent()]);

    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue Setup/ })).toBeNull();
  });
});

/**
 * The colour a card is washed in is the colour of its state, so the deck
 * an event is on can be read without stopping to read the word.
 */
describe('the colour a card carries', () => {
  /** The card itself, found from the title it shows. */
  const theCard = () => {
    const heading = screen.getByRole('heading', { name: 'Emergency Service Meeting' });
    // heading -> the button wrapping the left column -> the row -> the card
    return heading.closest('button')!.parentElement!.parentElement as HTMLElement;
  };

  it('washes a finished event green, the colour of its tag', () => {
    show([anEvent({ status: 'ended' })]);

    const card = theCard();
    expect(card.className).toContain('bg-[#e1faea]');
    expect(within(card).getByText('Completed').className).toContain('text-[#019939]');
  });

  it('washes an unfinished one grey', () => {
    show([anEvent({ status: 'draft' })]);

    const card = theCard();
    expect(card.className).toContain('bg-[#f5f5f5]');
    expect(within(card).getByText('Draft').className).toContain('text-[#656565]');
  });

  it('washes one still to come blue', () => {
    show([anEvent()]);

    const card = theCard();
    expect(card.className).toContain('bg-[#eff6ff]');
    expect(within(card).getByText('Upcoming').className).toContain('text-[#1447e6]');
  });
});
