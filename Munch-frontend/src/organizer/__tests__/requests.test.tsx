import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { OrganizerProvider } from '../i18n';
import { RequestButton, RequestCard, RequestRow } from '../RequestCard';

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
});

const show = (count: number, children: React.ReactNode = <p>a waiting row</p>) =>
  render(
    <OrganizerProvider>
      <RequestCard
        title={{ ne: 'भित्र आउन अनुरोध', en: 'Join Request' }}
        count={count}
        empty={{ ne: '', en: 'Nobody waiting.' }}
      >
        {children}
      </RequestCard>
    </OrganizerProvider>
  );

/**
 * A queue the host works through, folded away until it has something in it.
 *
 * Both of these are usually empty and occasionally urgent, so the count
 * rides on the outside where it can be seen without opening anything, and
 * a queue with something in it does not make the host ask for it.
 */
describe('a request card', () => {
  it('says how many are waiting without being opened', () => {
    show(3);

    const head = screen.getByRole('button', { expanded: true });
    expect(within(head).getByText('Join Request')).toBeInTheDocument();
    expect(within(head).getByText('3')).toBeInTheDocument();
  });

  it('shows them, since somebody is waiting', () => {
    show(3);

    expect(screen.getByText('a waiting row')).toBeInTheDocument();
  });

  it('folds away when there is nobody', () => {
    show(0);

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('a waiting row')).toBeNull();
    expect(screen.queryByText('3')).toBeNull();
  });

  it('opens on the press, and says so plainly when it is empty', () => {
    show(0);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Nobody waiting.')).toBeInTheDocument();
  });
});

describe('a row in one', () => {
  it('carries what it is about, who it is from, and what to do', () => {
    const accepted = jest.fn();
    render(
      <OrganizerProvider>
        <RequestRow
          name="Sumin Maharjan"
          under="Joining as Guest"
          actions={
            <RequestButton tone="accept" onClick={accepted}>Accept</RequestButton>
          }
        />
      </OrganizerProvider>
    );

    expect(screen.getByText('Sumin Maharjan')).toBeInTheDocument();
    expect(screen.getByText('Joining as Guest')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(accepted).toHaveBeenCalled();
  });

  it('draws the quiet button differently from the firm one', () => {
    render(
      <OrganizerProvider>
        <RequestRow
          name="What is Kataho?"
          under="Sumin"
          actions={
            <>
              <RequestButton tone="accept" onClick={jest.fn()}>Question</RequestButton>
              <RequestButton tone="quiet" onClick={jest.fn()}>Suggestions</RequestButton>
            </>
          }
        />
      </OrganizerProvider>
    );

    expect(screen.getByRole('button', { name: 'Question' }).className)
      .toContain('bg-navy-800');
    expect(screen.getByRole('button', { name: 'Suggestions' }).className)
      .toContain('border');
  });

  /*
   * A long question is the whole decision.
   *
   * The ordinary row truncates its subject, which is right for a name
   * and wrong for something somebody wrote: a host asked to accept or
   * reject "I am testing this quest…" has not been shown the thing they
   * are deciding about. The stacked row shows it whole and moves the
   * buttons underneath to make the width.
   */
  const LONG = 'I am testing this question ul for long form of questions '
    + 'about the same as last time I was there to help you out with that one';

  it('truncates a long subject in the ordinary row', () => {
    render(
      <OrganizerProvider>
        <RequestRow name={LONG} under="Prabhat Karmacharya" actions={null} />
      </OrganizerProvider>
    );

    expect(screen.getByText(LONG).className).toContain('truncate');
  });

  it('shows it whole in the stacked one', () => {
    render(
      <OrganizerProvider>
        <RequestRow stacked name={LONG} under="Prabhat Karmacharya" actions={null} />
      </OrganizerProvider>
    );

    const said = screen.getByText(LONG);
    expect(said.className).not.toContain('truncate');
    // Still the asker underneath it, and still the initial beside it.
    expect(screen.getByText('Prabhat Karmacharya')).toBeInTheDocument();
    expect(screen.getByText('I')).toBeInTheDocument();
  });
});
