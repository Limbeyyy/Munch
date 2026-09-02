import React, { useEffect, useRef } from 'react';
import { TranscriptionSegment } from '../types';

interface Props {
  transcript: TranscriptionSegment[];
  /** Words the room device has not finalised yet, shown greyed. */
  interim?: string;
}

const formatClock = (iso?: string) => {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleTimeString('en-GB', { hour12: false });
};

/**
 * The meeting stage: a running transcript rather than video.
 *
 * The text arrives from the capture device in the hall, which does the
 * listening; this view only renders what the server broadcasts, so every
 * screen shows the same lines.
 */
export const LiveTranscriptStage: React.FC<Props> = ({
  transcript,
  interim = '',
}) => {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, interim]);

  const empty = transcript.length === 0 && !interim;

  return (
    <div className="flex-1 overflow-y-auto p-6 min-h-0">
      {empty ? (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-500">
          <span className="text-5xl" aria-hidden="true">&#127908;</span>
          <p className="text-sm max-w-sm text-center">
            Waiting for the room device. Whatever is said in the hall will
            appear here.
          </p>
        </div>
      ) : (
        <div className="max-w-3xl mx-auto space-y-3">
          {transcript.map((seg, i) => (
            <p
              key={`${seg.speaker_name}-${seg.start_time}-${i}`}
              className="leading-relaxed"
            >
              <span className="text-blue-400 text-xs font-mono mr-2">
                [{formatClock()}]
              </span>
              <span className="text-gray-400 text-sm mr-2">
                {seg.speaker_name}:
              </span>
              <span className="text-gray-100">{seg.text}</span>
            </p>
          ))}

          {interim && (
            <p className="leading-relaxed text-gray-500 italic">{interim}</p>
          )}

          <div ref={endRef} />
        </div>
      )}
    </div>
  );
};
