import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { OrganizerProvider } from '../../i18n';
import { Event } from '../../../types';
import { EventsDashboard, isSetUp } from '../EventsDashboard';
import { EVENT_STATE_LABEL, eventState } from '../../sessionState';

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
});

// Relative to now, so an event meant to be ahead stays ahead however
// long this suite outlives the date somebody typed into it.
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600000).toISOString();
const day = hoursFromNow(24).slice(0, 10);

const anEvent = (over: Partial<Event> = {}): Event => ({
  id: 'e1',
  title: 'Emergency Service Meeting',
  description: '',
  venue: 'Kathmandu Convention Center',
  event_date: day,
  status: 'scheduled',
  code: 'MXC-DOX',
  scheduled_start: hoursFromNow(24),
  scheduled_end: hoursFromNow(26),
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
      onReadBack={jest.fn()}
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

  /**
   * A finished event is read back rather than worked on.
   *
   * It used to be washed green like every other card, which said its
   * state twice on a deck where every card has the same state. 626-6477
   * draws it plain, with the way into the record where the pencil was.
   */
  it('gives a finished event the card that reads it back', () => {
    // Ran, then ended. One that ended without ever running is a
    // different thing, and reads as never started.
    show([anEvent({
      status: 'ended', started_at: hoursFromNow(-3), ended_at: hoursFromNow(-1),
      scheduled_start: hoursFromNow(-3), scheduled_end: hoursFromNow(-1),
    })]);

    const read = screen.getByRole('button', { name: 'View Summary' });
    // 'Completed' is also the deck's own tab, so the word is looked for
    // inside the card rather than anywhere on the page.
    const card = read.parentElement!.parentElement!.parentElement as HTMLElement;
    expect(within(card).getByText('Completed').className).toContain('text-[#018030]');
    expect(screen.queryByRole('button', { name: /Edit|Continue Setup/ })).toBeNull();
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

/**
 * What a card says about itself.
 *
 * Which deck an event is filed under and what state it is in are two
 * different questions. The card used to answer the first while appearing
 * to answer the second: an event whose hour had come and gone unopened
 * sat under Upcoming, so its tag said "Upcoming" while the agenda tab
 * beside it said "Not started".
 */
describe('the word on the tag', () => {
  const tagOn = (title = 'Emergency Service Meeting') => {
    const heading = screen.getByRole('heading', { name: title });
    const card = heading.closest('button')!.parentElement!.parentElement as HTMLElement;
    return within(card).getByText(
      /Upcoming|Not started|Live|Completed|Never started|Draft/
    );
  };

  it('says not started once the hour has come and nobody opened it', () => {
    show([anEvent({
      scheduled_start: hoursFromNow(-1), scheduled_end: hoursFromNow(1),
    })]);

    expect(tagOn()).toHaveTextContent('Not started');
  });

  it('agrees with what every other screen calls it', () => {
    const event = anEvent({
      scheduled_start: hoursFromNow(-1), scheduled_end: hoursFromNow(1),
    });
    show([event]);

    // Not started, here and on the agenda tab beside it.
    expect(eventState(event)).toBe('not-started');
    expect(tagOn()).toHaveTextContent(EVENT_STATE_LABEL[eventState(event)].en!);
  });

  it('still says upcoming while the hour is genuinely ahead', () => {
    show([anEvent()]);

    expect(tagOn()).toHaveTextContent('Upcoming');
  });

  it('says never started once the window has gone by unopened', () => {
    show([anEvent({
      scheduled_start: hoursFromNow(-3), scheduled_end: hoursFromNow(-1),
    })]);

    // Filed under Upcoming, since it never ended - but it did not happen.
    expect(tagOn()).toHaveTextContent('Never started');
  });

  it('keeps calling a draft a draft, which has no state to read', () => {
    show([anEvent({ status: 'draft' })]);

    fireEvent.click(screen.getByRole('tab', { name: /Draft/ }));
    expect(tagOn()).toHaveTextContent('Draft');
  });
});
