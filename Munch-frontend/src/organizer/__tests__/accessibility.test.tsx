import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { OrganizerProvider, useOrganizer } from '../i18n';

/**
 * The accessibility settings are applied by putting attributes on <html>,
 * which index.css keys its rules off. Testing that contract is what these
 * cover: whether the rules themselves look right is a matter for the eye,
 * but whether they are switched on at all is not.
 */
const Probe: React.FC = () => {
  const { a11y, setA11y, lang, setLang } = useOrganizer();
  return (
    <div>
      <button onClick={() => setA11y((v) => ({ ...v, big: !v.big }))}>big</button>
      <button onClick={() => setA11y((v) => ({ ...v, contrast: !v.contrast }))}>contrast</button>
      <button onClick={() => setA11y((v) => ({ ...v, calm: !v.calm }))}>calm</button>
      <button onClick={() => setLang(lang === 'ne' ? 'en' : 'ne')}>lang</button>
      <span data-testid="state">{JSON.stringify(a11y)}</span>
    </div>
  );
};

const root = () => document.documentElement;

const show = () =>
  render(
    <OrganizerProvider>
      <Probe />
    </OrganizerProvider>
  );

beforeEach(() => {
  window.localStorage.clear();
  ['data-a11y-big', 'data-a11y-contrast', 'data-a11y-calm'].forEach((a) =>
    root().removeAttribute(a)
  );
});

describe('accessibility settings reach the document', () => {
  it('starts with nothing switched on', () => {
    show();
    expect(root().hasAttribute('data-a11y-big')).toBe(false);
    expect(root().hasAttribute('data-a11y-contrast')).toBe(false);
    expect(root().hasAttribute('data-a11y-calm')).toBe(false);
  });

  it.each([
    ['big', 'data-a11y-big'],
    ['contrast', 'data-a11y-contrast'],
    ['calm', 'data-a11y-calm'],
  ])('switching %s on marks the document root', (button, attribute) => {
    show();

    fireEvent.click(screen.getByText(button));

    expect(root().hasAttribute(attribute)).toBe(true);
  });

  it.each([
    ['big', 'data-a11y-big'],
    ['contrast', 'data-a11y-contrast'],
    ['calm', 'data-a11y-calm'],
  ])('switching %s off again clears it', (button, attribute) => {
    show();

    fireEvent.click(screen.getByText(button));
    fireEvent.click(screen.getByText(button));

    expect(root().hasAttribute(attribute)).toBe(false);
  });

  it('keeps the three independent of one another', () => {
    show();

    fireEvent.click(screen.getByText('contrast'));

    expect(root().hasAttribute('data-a11y-contrast')).toBe(true);
    expect(root().hasAttribute('data-a11y-big')).toBe(false);
    expect(root().hasAttribute('data-a11y-calm')).toBe(false);
  });

  it('remembers the choice for next time', () => {
    const first = show();
    fireEvent.click(screen.getByText('big'));
    first.unmount();
    root().removeAttribute('data-a11y-big');

    show();

    // The provider restores it from storage on the way up.
    expect(root().hasAttribute('data-a11y-big')).toBe(true);
  });

  it('applies a stored setting in a panel that never touched the switch', () => {
    // Organizer and attendee mount their own providers; the setting has to
    // hold across both, which is the point of keeping it in storage.
    window.localStorage.setItem(
      'manch.organizer.prefs',
      JSON.stringify({ lang: 'ne', a11y: { big: false, contrast: true, calm: false } })
    );

    show();

    expect(root().hasAttribute('data-a11y-contrast')).toBe(true);
  });

  it('sets the document language too', () => {
    show();
    expect(root().lang).toBe('ne');

    act(() => { fireEvent.click(screen.getByText('lang')); });

    expect(root().lang).toBe('en');
  });
});
