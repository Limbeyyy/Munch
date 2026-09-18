import React from 'react';

/**
 * What a file is, said in a few letters and a colour.
 *
 * The design draws a small square chip per document rather than an icon
 * set, so the kind is read off the name: there is no field for it, and a
 * name is what the file was uploaded under.
 */
export interface FileKind {
  label: string;
  paint: string;
}

const KINDS: { match: RegExp; kind: FileKind }[] = [
  { match: /\.pdf$/i, kind: { label: 'PDF', paint: '#EF4444' } },
  { match: /\.(xlsx?|csv)$/i, kind: { label: 'XLSX', paint: '#16A34A' } },
  { match: /\.pptx?$/i, kind: { label: 'PPT', paint: '#F25219' } },
  { match: /\.docx?$/i, kind: { label: 'DOX', paint: '#4378E1' } },
];

export const kindOf = (name: string): FileKind =>
  KINDS.find((one) => one.match.test(name))?.kind
  ?? { label: 'DOC', paint: '#6A7282' };

/** The chip itself. The two places it appears draw it at two sizes. */
export const FileBadge: React.FC<{
  name: string;
  /** Tailwind for the box and the lettering, since the sizes differ. */
  className?: string;
}> = ({ name, className = 'w-5 h-5 text-[7px] leading-[10.5px]' }) => {
  const kind = kindOf(name);
  return (
    <span
      aria-hidden
      style={{ backgroundColor: kind.paint }}
      className={`rounded-[4px] grid place-items-center flex-none
        font-bold text-white ${className}`}
    >
      {kind.label}
    </span>
  );
};
