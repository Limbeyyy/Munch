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
}

const OrganizerCtx = createContext<Ctx | null>(null);

export const useOrganizer = () => {
  const ctx = useContext(OrganizerCtx);
  if (!ctx) throw new Error('useOrganizer must be used inside OrganizerProvider');
  return ctx;
};

const STORE_KEY = 'manch.organizer.prefs';

export const OrganizerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLang] = useState<Lang>('ne');
  const [a11y, setA11y] = useState({ big: false, contrast: false, calm: false });

  // Language and accessibility are per-person conveniences, so they live in
  // this browser rather than on the account.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.lang === 'ne' || saved.lang === 'en') setLang(saved.lang);
        if (saved.a11y) setA11y({ big: false, contrast: false, calm: false, ...saved.a11y });
      }
    } catch {
      // No stored preference, or storage is blocked; defaults are fine.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ lang, a11y }));
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
  }, [lang, a11y]);

  const value = useMemo<Ctx>(
    () => ({
      lang,
      setLang,
      t: (pair) => (lang === 'en' ? pair.en || pair.ne : pair.ne),
      num: (n) => (lang === 'ne' ? NEP(n) : String(n)),
      a11y,
      setA11y,
    }),
    [lang, a11y]
  );

  return <OrganizerCtx.Provider value={value}>{children}</OrganizerCtx.Provider>;
};
