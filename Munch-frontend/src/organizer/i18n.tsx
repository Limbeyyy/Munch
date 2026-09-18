import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type Lang = 'ne' | 'en';
export type Pair = { ne: string; en?: string };

/** Devanagari digits, so numbers read naturally in Nepali. */
export const NEP = (n: number | string) =>
  String(n).replace(/\d/g, (d) => '०१२३४५६७८९'[Number(d)]);

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Nepali is the source language; English falls back to it when absent. */
  t: (pair: Pair) => string;
  /** A number in the reader's own digits. */
  num: (n: number | string) => string;
  a11y: { big: boolean; contrast: boolean; calm: boolean };
  setA11y: React.Dispatch<React.SetStateAction<{ big: boolean; contrast: boolean; calm: boolean }>>;
  /** How the place looks, and how a transcript reads inside it. */
  look: Look;
  setLook: React.Dispatch<React.SetStateAction<Look>>;
}

export type Theme = 'light' | 'dark' | 'system';
export type TextSize = 'small' | 'medium' | 'large';
export type LineSpacing = 'comfortable' | 'relaxed';

export interface Look {
  theme: Theme;
  transcriptSize: TextSize;
  transcriptSpacing: LineSpacing;
}

const DEFAULT_LOOK: Look = {
  theme: 'light',
  transcriptSize: 'medium',
  transcriptSpacing: 'comfortable',
};

const OrganizerCtx = createContext<Ctx | null>(null);

export const useOrganizer = () => {
  const ctx = useContext(OrganizerCtx);
  if (!ctx) throw new Error('useOrganizer must be used inside OrganizerProvider');
  return ctx;
};

const STORE_KEY = 'manch.organizer.prefs';

export const OrganizerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  /*
   * English until somebody says otherwise.
   *
   * Nepali is the source language and every string is written in it
   * first, which is why it used to be the default as well - but most
   * people arriving here read the English, and the ones who want Nepali
   * are the ones who reach for the switch. A stored choice always wins;
   * this is only what a browser that has never chosen is shown.
   */
  const [lang, setLang] = useState<Lang>('en');
  const [a11y, setA11y] = useState({ big: false, contrast: false, calm: false });
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);

  // Language and accessibility are per-person conveniences, so they live in
  // this browser rather than on the account.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.lang === 'ne' || saved.lang === 'en') setLang(saved.lang);
        if (saved.a11y) setA11y({ big: false, contrast: false, calm: false, ...saved.a11y });
        if (saved.look) setLook({ ...DEFAULT_LOOK, ...saved.look });
      }
    } catch {
      // No stored preference, or storage is blocked; defaults are fine.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ lang, a11y, look }));
    } catch {
      // Preferences simply will not persist.
    }
    document.documentElement.lang = lang;

    // Accessibility is applied at the document root rather than on a
    // wrapper, for two reasons: the styling has to reach dialogs and
    // anything else rendered outside the panel, and it has to outrank the
    // explicit sizes and faint greys the design sets on individual
    // elements. The rules themselves live in index.css.
    const root = document.documentElement;
    root.toggleAttribute('data-a11y-big', a11y.big);
    root.toggleAttribute('data-a11y-contrast', a11y.contrast);
    root.toggleAttribute('data-a11y-calm', a11y.calm);

    // The look goes on the root for the same reasons: it has to reach
    // dialogs, and it has to outrank the explicit colours and sizes the
    // design sets on individual elements. The rules live in index.css.
    // "system" is resolved here rather than stored, so a machine that
    // changes its mind at dusk is followed without anybody choosing again.
    const dark = look.theme === 'dark'
      || (look.theme === 'system'
          && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-transcript-size', look.transcriptSize);
    root.setAttribute('data-transcript-spacing', look.transcriptSpacing);
  }, [lang, a11y, look]);

  // A machine set to follow the hour changes its mind without being asked.
  useEffect(() => {
    if (look.theme !== 'system' || !window.matchMedia) return;
    const watch = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => {
      document.documentElement.setAttribute(
        'data-theme', watch.matches ? 'dark' : 'light'
      );
    };
    watch.addEventListener?.('change', follow);
    return () => watch.removeEventListener?.('change', follow);
  }, [look.theme]);

  const value = useMemo<Ctx>(
    () => ({
      lang,
      setLang,
      t: (pair) => (lang === 'en' ? pair.en || pair.ne : pair.ne),
      num: (n) => (lang === 'ne' ? NEP(n) : String(n)),
      a11y,
      setA11y,
      look,
      setLook,
    }),
    [lang, a11y, look]
  );

  return <OrganizerCtx.Provider value={value}>{children}</OrganizerCtx.Provider>;
};
