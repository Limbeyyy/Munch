import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { OrganizerProvider } from '../../i18n';
import { Event } from '../../../types';
import { EventsDashboard, deckOf, whenLine } from '../EventsDashboard';
import { BackLink, DeckTabs, Stepper } from '../chrome';

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
});

const day = '2026-09-15';

const anEvent = (over: Partial<Event> = {}): Event => ({
  id: 'e1',
  title: 'Emergency Service Event',
  description: '',
  venue: 'Kathmandu Convention Center',
  event_date: day,
  status: 'scheduled',
  host_email: 'host@example.com',
  code: 'MXC-DOX',
  scheduled_start: `${day}T10:00:00`,
  scheduled_end: `${day}T12:00:00`,
  participant_count: 0,
  sessions: [],
  session_count: 3,
  created_at: '', updated_at: '',
  ...over,
});

const show = (events: Event[], spies: Partial<Record<string, jest.Mock>> = {}) =>
  render(
    <OrganizerProvider>
      <EventsDashboard
        events={events}
        counts={{ e1: { coHosts: 2, attendees: 21 } }}
        loading={false}
        onOpen={spies.onOpen ?? jest.fn()}
        onEdit={spies.onEdit ?? jest.fn()}
        onCreate={spies.onCreate ?? jest.fn()}
        onImport={spies.onImport ?? jest.fn()}
        onReadBack={spies.onReadBack ?? jest.fn()}
      />
    </OrganizerProvider>
  );

/**
 * Three decks, and which one an event is on.
 *
 * An event is either still being written, coming up, or over. Nothing is
 * on two decks at once, and the count beside each tab is what is actually
 * under it - a host reading "Draft 3" and finding one card would stop
 * trusting the other two numbers too.
 */
describe('sorting events onto decks', () => {
  it('puts an unfinished event on the drafts', () => {
    expect(deckOf(anEvent({ status: 'draft' }))).toBe('draft');
  });

  it('puts one that has been run, and one called off, behind', () => {
    expect(deckOf(anEvent({ status: 'ended' }))).toBe('done');
    expect(deckOf(anEvent({ status: 'cancelled' }))).toBe('done');
  });

  it('puts a scheduled one ahead', () => {
    expect(deckOf(anEvent({ status: 'scheduled' }))).toBe('upcoming');
  });

  /**
   * One that is running has a deck of its own.
   *
   * It used to sit under Upcoming, which is true of an event nobody has
   * opened and false of one people are in the room for. The design gives
   * it its own tab, and a host looking for the event happening now should
   * not have to pick it out of the ones that have not started.
   */
  it('puts one under way on its own deck', () => {
    expect(deckOf(anEvent({ status: 'active' }))).toBe('live');
  });

  it('counts each deck by what is on it', () => {
    show([
      anEvent({ id: 'e1' }),
      anEvent({ id: 'e2', status: 'draft' }),
      anEvent({ id: 'e3', status: 'draft' }),
      anEvent({ id: 'e4', status: 'ended' }),
    ]);

    const tab = (name: RegExp) => screen.getByRole('tab', { name });
    expect(within(tab(/Upcoming/)).getByText('1')).toBeInTheDocument();
    expect(within(tab(/Draft/)).getByText('2')).toBeInTheDocument();
    expect(within(tab(/Completed/)).getByText('1')).toBeInTheDocument();
  });

  it('shows only the deck that is selected', () => {
    show([anEvent({ id: 'e1' }), anEvent({ id: 'e2', status: 'ended', title: 'Last year' })]);

    expect(screen.getByText('Emergency Service Event')).toBeInTheDocument();
    expect(screen.queryByText('Last year')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Completed/ }));

    expect(screen.getByText('Last year')).toBeInTheDocument();
    expect(screen.queryByText('Emergency Service Event')).toBeNull();
  });
});

/**
 * What a card says about an event without being opened.
 */
describe('an event card', () => {
  // The day itself is written in the reader's own locale, so these look
  // for the day, month and year rather than one country's order for them.
  it('says when it runs, from the events inside it', () => {
    const line = whenLine(anEvent());
    expect(line).toMatch(/September/);
    expect(line).toMatch(/\b15\b/);
    expect(line).toMatch(/2026/);
    expect(line).toMatch(/10:00.*12:00/);
  });

  it('runs from its own opening hour to its own closing one', () => {
    const late = anEvent({ scheduled_end: `${day}T16:30:00` });
    // Formatted the way the reader's clock formats it, 12-hour or not.
    const closing = new Date(`${day}T16:30:00`)
      .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(whenLine(late)).toMatch(new RegExp(`10:00.*${closing}`));
  });

  it('carries the three numbers that say whether it is ready', () => {
    show([anEvent()]);

    expect(screen.getByText('3 sessions')).toBeInTheDocument();
    expect(screen.getByText('2 co-hosts')).toBeInTheDocument();
    expect(screen.getByText('21 attendees')).toBeInTheDocument();
  });

  it('opens the event when the card is pressed, and the form when the pencil is', () => {
    const onOpen = jest.fn();
    const onEdit = jest.fn();
    show([anEvent()], { onOpen, onEdit });

    fireEvent.click(screen.getByText('Emergency Service Event'));
    expect(onOpen).toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    expect(onEdit).toHaveBeenCalled();
  });

  it('offers the way to make a new one', () => {
    const onCreate = jest.fn();
    show([], { onCreate });

    fireEvent.click(screen.getByRole('button', { name: /Create New Event/ }));
    expect(onCreate).toHaveBeenCalled();
  });
});

/**
 * How far through the form you are.
 *
 * A step behind you is a tick rather than its number, so the step you are
 * on is the only number in navy and there is never a question about which
 * one that is.
 */
describe('the stepper', () => {
  const steps = [
    { ne: '', en: 'Event Details' },
    { ne: '', en: 'Sessions' },
    { ne: '', en: 'Peoples' },
  ];

  const at = (i: number) =>
    render(<OrganizerProvider><Stepper steps={steps} at={i} /></OrganizerProvider>);

  it('numbers the step being filled in and the ones after it', () => {
    at(0);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('drops the number of a step already done', () => {
    at(1);
    expect(screen.queryByText('1')).toBeNull();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('lets you go back to a step you have been through, but not skip ahead', () => {
    const onGo = jest.fn();
    render(<OrganizerProvider><Stepper steps={steps} at={1} onGo={onGo} /></OrganizerProvider>);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);

    fireEvent.click(buttons[0]);
    expect(onGo).toHaveBeenCalledWith(0);
  });
});

/**
 * The strip of tabs above an event.
 *
 * It used to scroll rather than wrap, which is how a row three tabs wide
 * ended up with a pair of stepper arrows in the corner - and why the
 * selected tab's underline was invisible: the one-pixel overhang it
 * needs was clipped by the scroll container.
 */
describe('the tab strip', () => {
  const strip = (active = 'people') =>
    render(
      <OrganizerProvider>
        <DeckTabs
          active={active}
          onChange={jest.fn()}
          tabs={[
            { id: 'overview', label: { ne: '', en: 'Overview' } },
            { id: 'agenda', label: { ne: '', en: 'Agenda' } },
            { id: 'people', label: { ne: '', en: 'People' } },
          ]}
        />
      </OrganizerProvider>
    );

  it('wraps rather than scrolling, so it grows no stepper arrows', () => {
    strip();

    const row = screen.getByRole('tablist');
    expect(row.className).not.toContain('overflow-x-auto');
    expect(row.className).toContain('flex-wrap');
  });

  it('underlines the tab being read, and only that one', () => {
    strip('people');

    expect(screen.getByRole('tab', { name: 'People' }).className)
      .toContain('border-head');
    expect(screen.getByRole('tab', { name: 'Agenda' }).className)
      .toContain('border-transparent');
  });

  it('moves the underline with the selection', () => {
    strip('agenda');

    expect(screen.getByRole('tab', { name: 'Agenda' }).className)
      .toContain('border-head');
    expect(screen.getByRole('tab', { name: 'People' }).className)
      .toContain('border-transparent');
  });
});

/**
 * The way back out of an opened event.
 *
 * A button is block-level, so in a column it filled the whole row and
 * every inch of empty space beside the word was a way off the page.
 */
describe('the back link', () => {
  it('is only as wide as the word, not the whole row', () => {
    render(
      <OrganizerProvider>
        <BackLink label={{ ne: '', en: 'Event' }} onClick={jest.fn()} />
      </OrganizerProvider>
    );

    const back = screen.getByRole('button', { name: 'Event' });
    expect(back.className).toContain('w-fit');
    expect(back.className).toContain('self-start');
  });

  it('still goes back when it is the word that is pressed', () => {
    const onClick = jest.fn();
    render(
      <OrganizerProvider>
        <BackLink label={{ ne: '', en: 'Event' }} onClick={onClick} />
      </OrganizerProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Event' }));
    expect(onClick).toHaveBeenCalled();
  });
});

/**
 * When an event runs, in one line.
 *
 * One date and two clock times is right for the afternoon most events
 * are, and silently wrong for one running over more than a day: an event
 * opening on the 23rd and closing on the 25th read as an hour on the
 * 23rd, and saving a later end date appeared to do nothing at all.
 */
describe('the line that says when', () => {
  const runs = (start: string, end: string) =>
    whenLine({ scheduled_start: start, scheduled_end: end } as any);

  // Written the way the line writes it, so the test does not assert a
  // locale. Whether the day or the month comes first is the reader's
  // business; that the date appears at all is this test's.
  const asDay = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      day: 'numeric', month: 'long', year: 'numeric',
    });

  it('gives one date to an event inside a day', () => {
    const said = runs('2026-09-23T18:10:00', '2026-09-23T19:05:00');

    expect(said).toContain(asDay('2026-09-23T18:10:00'));
    expect(said.match(/September/g)).toHaveLength(1);
  });

  it('gives the closing date too where it differs', () => {
    const said = runs('2026-09-23T18:10:00', '2026-09-25T19:05:00');

    expect(said).toContain(asDay('2026-09-23T18:10:00'));
    expect(said).toContain(asDay('2026-09-25T19:05:00'));
  });

  /** The hours are the truth; event_date is a separate field that lags. */
  it('reads the day off the hours rather than the stored date', () => {
    const said = whenLine({
      event_date: '2026-09-01',
      scheduled_start: '2026-09-23T18:10:00',
      scheduled_end: '2026-09-23T19:05:00',
    } as any);

    expect(said).toContain(asDay('2026-09-23T18:10:00'));
    expect(said).not.toContain(asDay('2026-09-01T00:00:00'));
  });

  it('says the day alone where there are no hours', () => {
    expect(whenLine({ event_date: '2026-09-23' } as any))
      .toContain(asDay('2026-09-23'));
  });
});
