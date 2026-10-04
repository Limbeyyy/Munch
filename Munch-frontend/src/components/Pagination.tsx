import React from 'react';
import { useOrganizer } from '../organizer/i18n';

export const Pagination: React.FC<{
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  theme: 'host' | 'attendee';
}> = ({ page, pageSize, totalItems, onPageChange, theme }) => {
  const { t, num } = useOrganizer();
  const pageCount = Math.ceil(totalItems / pageSize);

  if (pageCount < 2) return null;

  const attendee = theme === 'attendee';
  const buttonClass = attendee
    ? 'min-h-9 rounded-full border border-[#d6e4f8] bg-white px-3 text-[12px] font-medium text-[#194d97] disabled:opacity-40'
    : 'min-h-9 rounded-[8px] border border-line bg-white px-3 text-[13px] font-medium text-head hover:bg-[#f9fafb] disabled:opacity-40';

  return (
    <nav
      aria-label={t({ ne: 'पृष्ठहरू', en: 'Pagination' })}
      className={`flex items-center justify-center gap-3 ${
        attendee
          ? 'px-4 py-4 text-[12px] text-[#5b6070]'
          : 'pt-2 text-[13px] text-subtle'
      }`}
    >
      <button
        type="button"
        className={buttonClass}
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        {t({ ne: 'अघिल्लो', en: 'Previous' })}
      </button>
      <span aria-live="polite">
        {t({
          ne: `पृष्ठ ${num(page)} / ${num(pageCount)}`,
          en: `Page ${page} of ${pageCount}`,
        })}
      </span>
      <button
        type="button"
        className={buttonClass}
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        {t({ ne: 'अर्को', en: 'Next' })}
      </button>
    </nav>
  );
};
