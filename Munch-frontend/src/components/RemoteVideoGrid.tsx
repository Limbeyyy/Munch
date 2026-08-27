import React, { useEffect, useRef, useState } from 'react';
import { RemotePeer } from '../hooks/useWebRTC';

const RemoteTile: React.FC<{ peer: RemotePeer }> = ({ peer }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hasFrames, setHasFrames] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    const stream = peer.stream;
    if (!el || !stream) return;

    if (el.srcObject !== stream) el.srcObject = stream;

    // Autoplay with sound is refused until the page has been interacted
    // with; say so rather than staying silent.
    el.play().catch(() => setBlocked(true));

    /*
     * Ask the element whether frames are actually arriving, rather than
     * reading track flags. A remote track is reported muted until media
     * flows, and the unmute may land on a track object that appeared after
     * any listener was attached - which leaves the picture hidden while the
     * video is in fact playing.
     */
    const check = () => setHasFrames(el.videoWidth > 0 && el.videoHeight > 0);

    check();
    el.addEventListener('loadedmetadata', check);
    el.addEventListener('resize', check);
    el.addEventListener('playing', check);
    el.addEventListener('emptied', check);

    // Cheap backstop for transitions that fire no event at all.
    const poll = setInterval(check, 1000);

    return () => {
      el.removeEventListener('loadedmetadata', check);
      el.removeEventListener('resize', check);
      el.removeEventListener('playing', check);
      el.removeEventListener('emptied', check);
      clearInterval(poll);
    };
  }, [peer.stream]);

  const unblock = () => {
    videoRef.current?.play().then(() => setBlocked(false)).catch(() => undefined);
  };

  return (
    <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video">
      {/*
        Always mounted and never display:none - hiding the element stops the
        audio, which must keep flowing when someone's camera is off.
      */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover"
        style={{ visibility: hasFrames ? 'visible' : 'hidden' }}
      />

      {!hasFrames && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-400 pointer-events-none">
          <div className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center text-lg font-semibold text-white">
            {(peer.name || '?').charAt(0).toUpperCase()}
          </div>
          <p className="text-xs">{peer.stream ? 'Camera off' : 'Connecting...'}</p>
        </div>
      )}

      {blocked && (
        <button
          onClick={unblock}
          className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-1 text-xs"
        >
          <span className="text-xl" aria-hidden="true">&#128266;</span>
          Tap to hear
        </button>
      )}

      <div className="absolute bottom-1 left-1 right-1 flex items-center gap-1">
        <span className="truncate text-[11px] bg-black/70 px-2 py-0.5 rounded">
          {peer.name}
        </span>
        {peer.isGuest && (
          <span className="text-[10px] bg-purple-600/90 px-1.5 py-0.5 rounded">
            guest
          </span>
        )}
      </div>
    </div>
  );
};

/** The other people in the call, one tile each. */
export const RemoteVideoGrid: React.FC<{ peers: RemotePeer[] }> = ({ peers }) => {
  if (peers.length === 0) return null;

  return (
    <div className="absolute top-4 right-4 w-56 space-y-2 max-h-[70%] overflow-y-auto z-20">
      {peers.map((peer) => (
        <RemoteTile key={peer.peerId} peer={peer} />
      ))}
    </div>
  );
};
