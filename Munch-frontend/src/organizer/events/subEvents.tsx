import React, { useState } from 'react';
import { Event, Session, SubEvent } from '../../types';
import { groupSessions } from '../../attendee/pwa/grouping';
import { useOrganizer } from '../i18n';
import { AgendaBoard } from './AgendaBoard';

/**
 * The named parts of an event, on the host's side of it.
 *
 * A long day is rarely one list. It is a morning on technology and an
 * afternoon on climate, and reading it as twelve talks in a row loses
 * that. So the host names the parts here, and every screen that shows
 * the running order shows it under those names.
 *
 * Optional throughout. An event with no named parts is one list, which
 * is what most events are, and a talk filed under nothing is still on
 * the programme.
 */

/** The row style the design draws a named part in. */
const ROW =
  'w-full flex items-center gap-2 border-[0.6px] border-[#b3b3b3] rounded-[8px] '
  + 'px-4 py-2.5 min-h-[41px]';

/** Its ordinal, as the design numbers them: 01, 02, 03. */
const ordinal = (at: number) => `${String(at + 1).padStart(2, '0')}.`;

/**
 * Writing the named parts, on the step where the event is described.
 *
 * The list is the whole control: there is no separate dialog, because
 * a part is only a name and asking for a modal to type one in is more
 * ceremony than the thing deserves.
 */
export const SubcategoryEditor: React.FC<{
  /** The parts already written, in the order they are read. */
  titles: string[];
  onAdd: (title: string) => void;
  onRemove: (at: number) => void;
  /** Off while the event is being written, so nothing is half-saved. */
  disabled?: boolean;
}> = ({ titles, onAdd, onRemove, disabled }) => {
  const { t, num } = useOrganizer();
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');

  const heading = t({
    ne: 'कार्यक्रमका उपवर्ग', en: 'Event Subcategories',
  });
  const hint = t({
    ne: 'एक वा बढी छान्नुहोस्। यो वैकल्पिक हो।',
    en: 'Select one or more sessions. This is optional.',
  });
  const addLabel = t({ ne: '+ नयाँ उपवर्ग', en: '+ New Subcategories' });

  /**
   * Finish the row being typed.
   *
   * An empty one is not a heading, so it closes rather than staying
   * open: a blank row left behind after clicking away looks like a
   * thing that was added and reads as broken.
   */
  const keep = () => {
    const name = draft.trim();
    if (name) onAdd(name);
    setDraft('');
    setTyping(false);
  };

  const anything = titles.length > 0 || typing;

  return (
    <div className="w-full flex flex-col gap-3 border-b-[0.6px] border-[#b3b3b3] py-3">
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] leading-[19.5px] text-[#172033]">{heading}</h3>
          <p className="pt-[3px] text-[12px] leading-[13.5px] text-[#8791A1]">{hint}</p>
        </div>
        {/* Once there is a list, adding to it is a quiet link beside the
            heading; with nothing there yet it is the only thing to do,
            so it is the button below instead. */}
        {anything && (
          <button
            type="button"
            onClick={() => setTyping(true)}
            disabled={disabled}
            className="flex-none text-[12px] leading-4 text-[#155DFC] text-center
              hover:underline disabled:opacity-50"
          >
            {addLabel}
          </button>
        )}
      </div>

      {anything ? (
        <div className="flex flex-col gap-2 w-full max-w-[464px]">
          {titles.map((title, at) => (
            <div key={`${at}-${title}`} className={ROW}>
              <span className="flex-none w-8 pt-0.5 text-[16px] font-light
                leading-8 text-[#959595] tabular-nums">
                {num(ordinal(at))}
              </span>
              <span className="flex-1 min-w-0 text-[14px] leading-5 font-medium
                text-[#071529] truncate">
                {title}
              </span>
              <button
                type="button"
                onClick={() => onRemove(at)}
                disabled={disabled}
                aria-label={t({ ne: `${title} हटाउनुहोस्`, en: `Remove ${title}` })}
                className="flex-none w-7 h-7 rounded-md text-faint
                  hover:text-live hover:bg-live/[.08] disabled:opacity-40"
              >
                ×
              </button>
            </div>
          ))}

          {typing && (
            <div className={ROW}>
              <span className="flex-none w-8 pt-0.5 text-[16px] font-light
                leading-8 text-[#959595] tabular-nums">
                {num(ordinal(titles.length))}
              </span>
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={keep}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); keep(); }
                  if (e.key === 'Escape') { setDraft(''); setTyping(false); }
                }}
                placeholder={t({
                  ne: 'सूचना, सञ्चार तथा प्रविधि',
                  en: 'Information, Communication and Technology',
                })}
                aria-label={t({ ne: 'उपवर्गको नाम', en: 'Subcategory name' })}
                className="flex-1 min-w-0 bg-transparent text-[14px] leading-5
                  font-medium text-[#071529] placeholder:text-faint
                  placeholder:font-normal focus:outline-none"
              />
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setTyping(true)}
          disabled={disabled}
          className="w-[166px] h-[41px] flex items-center justify-center gap-1
            bg-[#E1E1E1] border-[0.6px] border-[#b3b3b3] rounded-[8px]
            text-[14px] leading-5 font-medium text-[#071529] disabled:opacity-50"
        >
          {addLabel}
        </button>
      )}
    </div>
  );
};

/**
 * Choosing which named part a talk belongs to, on the form that writes it.
 *
 * Nothing is the ordinary answer and so it is the first one offered: a
 * day that has not been divided up has nothing to choose between, and
 * the block is left off the form entirely rather than drawn empty.
 */
export const SubcategoryPicker: React.FC<{
  groups: SubEvent[];
  value: string;
  onChange: (id: string) => void;
}> = ({ groups, value, onChange }) => {
  const { t } = useOrganizer();
  if (groups.length === 0) return null;

  return (
    <div className="w-full flex flex-col gap-3 border-b-[0.6px] border-[#b3b3b3] px-6 pb-3">
      <div className="flex items-start gap-2.5 pt-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] leading-[19.5px] text-[#172033]">
            {t({
              ne: 'कार्यक्रमको उपवर्गमा राख्नुहोस्',
              en: 'Assign to Event’s Subcategory',
            })}
          </h3>
          <p className="pt-[3px] text-[12px] leading-[13.5px] text-[#8791A1]">
            {t({
              ne: 'एक वा बढी छान्नुहोस्। यो वैकल्पिक हो।',
              en: 'Select one or more sessions. This is optional.',
            })}
          </p>
        </div>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t({
          ne: 'कार्यक्रमको उपवर्ग छान्नुहोस्',
          en: 'Select Event’s Subcategory',
        })}
        className="w-full bg-white border-[0.6px] border-line rounded-[8px]
          px-4 h-[37px] text-[14px] text-head focus:outline-none focus:border-navy-800"
      >
        <option value="">
          {t({ ne: 'उपवर्ग छान्नुहोस्', en: 'Select Event’s Subcategory' })}
        </option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>{group.title}</option>
        ))}
      </select>
    </div>
  );
};

/**
 * The running order, read under the event's own headings.
 *
 * One board per named part, each in its own container, rather than one
 * board with headings down it: the board already knows how to arrange a
 * list, and a part is a list. It also keeps rearranging honest, since a
 * talk dragged about stays inside the part it was filed under.
 *
 * With no named parts at all this is exactly the board it always was.
 */
export const GroupedAgenda: React.FC<{
  event: Event;
  groups: SubEvent[];
  /** Already narrowed to one day, where the event runs over several. */
  sessions?: Session[];
  onChanged: () => Promise<void> | void;
  onAdd?: () => void;
  onEdit?: (sessionId: string) => void;
}> = ({ event, groups, sessions, onChanged, onAdd, onEdit }) => {
  const { t, num } = useOrganizer();
  const shown = sessions ?? event.sessions ?? [];

  if (groups.length === 0) {
    return (
      <AgendaBoard
        event={sessions ? { ...event, sessions } : event}
        onChanged={onChanged}
        onAdd={onAdd}
        onEdit={onEdit}
      />
    );
  }

  const parts = groupSessions(
    shown, groups, t({ ne: 'अन्य कार्यसूची', en: 'Other agendas' }), true
  );

  return (
    <div className="flex flex-col gap-4">
      {parts.map((part) => (
        <section
          key={part.id || 'loose'}
          className="bg-white border-[0.6px] border-line rounded-[12px] overflow-hidden"
        >
          <header className="bg-sheet border-b-[0.6px] border-line px-4 py-3
            flex items-baseline gap-3 flex-wrap">
            <h3 className="text-[14px] font-medium text-head">{part.title}</h3>
            <span className="text-[12px] text-subtle">
              {t({
                ne: `${num(part.sessions.length)} सत्र`,
                en: `${part.sessions.length} session${part.sessions.length === 1 ? '' : 's'}`,
              })}
            </span>
            {part.description && (
              <p className="w-full text-[12px] leading-4 text-subtle">
                {part.description}
              </p>
            )}
          </header>
          <div className="px-4 py-3">
            {part.sessions.length === 0 ? (
              <p className="py-2 text-[13px] text-subtle">
                {t({
                  ne: 'यो उपवर्गमा अझै केही छैन।',
                  en: 'Nothing has been filed under this subcategory yet.',
                })}
              </p>
            ) : (
              <AgendaBoard
                event={{ ...event, sessions: part.sessions }}
                onChanged={onChanged}
                onAdd={onAdd}
                onEdit={onEdit}
              />
            )}
          </div>
        </section>
      ))}
    </div>
  );
};
