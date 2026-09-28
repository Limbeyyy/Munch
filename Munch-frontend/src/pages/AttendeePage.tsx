import React from 'react';
import { OrganizerProvider } from '../organizer/i18n';
import { AttendeeApp } from '../attendee/pwa/AttendeeApp';

/**
 * What somebody attending an event sees.
 *
 * This used to be the host's screens with the ones an attendee may not
 * touch taken out: a rail down the side, a page of cards, a drawer.
 * That is a desk layout, and an attendee is in a hall holding a phone -
 * so it is now a phone app, installable, with five things along the
 * bottom.
 *
 * The host's side is untouched and stays as it is: a desk needs the
 * rail, the tables and the forms.
 */
export const AttendeePage: React.FC = () => (
  <OrganizerProvider>
    <AttendeeApp />
  </OrganizerProvider>
);
