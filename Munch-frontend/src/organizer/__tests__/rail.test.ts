import { NAV } from '../OrganizerShell';

/**
 * What the rail offers.
 *
 * Sessions was its own page while an event was only a container for
 * them. An event holds its own running order now - arranged on its
 * Agenda tab and in the setup form - so a second page listing the same
 * sessions was two places to change one thing.
 */
describe('the organizer rail', () => {
  it('offers events', () => {
    expect(NAV.map((n) => n.id)).toContain('events');
  });

  it('does not offer a separate sessions page beside it', () => {
    expect(NAV.map((n) => n.id)).not.toContain('agenda');
    expect(NAV.map((n) => n.label.en)).not.toContain('Sessions');
  });
});
