import { ATTENDEE_NAV } from '../AttendeeShell';

/**
 * The agenda is the list of sessions.
 *
 * The portal used to offer both, side by side, which asked the reader to
 * work out the difference between a session and an agenda item. There
 * isn't one - they are the same rows - so only the agenda is offered.
 */
describe('what the attendee portal offers', () => {
  it('has an agenda', () => {
    expect(ATTENDEE_NAV.map((n) => n.id)).toContain('agenda');
  });

  it('does not offer a separate sessions list beside it', () => {
    expect(ATTENDEE_NAV.map((n) => n.id)).not.toContain('sessions');
    expect(ATTENDEE_NAV.map((n) => n.label.en)).not.toContain('Sessions');
  });
});
