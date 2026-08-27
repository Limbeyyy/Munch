import { useCallback, useEffect, useRef, useState } from 'react';

export interface RemotePeer {
  peerId: string;
  name: string;
  isGuest: boolean;
  stream: MediaStream | null;
}

interface Options {
  /** Meeting code, or null to stay disconnected. */
  meetingCode: string | null;
  /** JWT for an account holder. */
  token?: string | null;
  /** Signed token for a guest. */
  guestToken?: string | null;
  /** Local camera/mic to publish. */
  localStream: MediaStream | null;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const signallingUrl = (
  meetingCode: string,
  token?: string | null,
  guestToken?: string | null
): string => {
  const api = new URL(
    process.env.REACT_APP_API_URL || 'http://localhost:8000/api/v1'
  );
  const protocol = api.protocol === 'https:' ? 'wss:' : 'ws:';
  const auth = guestToken
    ? `guest_token=${encodeURIComponent(guestToken)}`
    : token
    ? `token=${encodeURIComponent(token)}`
    : '';
  return `${protocol}//${api.host}/ws/signaling/${meetingCode}/?${auth}`;
};

/** Per-connection negotiation bookkeeping, as in the perfect-negotiation pattern. */
interface PeerRecord {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** Assembled locally: tracks published via replaceTrack carry no stream. */
  stream: MediaStream;
}

/**
 * A mesh of peer connections, one per remote participant.
 *
 * Runs on its own signalling socket, separate from the meeting socket that
 * carries chat. Uses perfect negotiation so that adding tracks later - the
 * camera arriving after the connection, or a screen share starting - triggers
 * a fresh offer instead of silently never reaching the far side.
 */
export const useWebRTC = ({
  meetingCode,
  token,
  guestToken,
  localStream,
}: Options) => {
  const wsRef = useRef<WebSocket | null>(null);
  const peersRef = useRef<Map<string, PeerRecord>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const selfIdRef = useRef<string | null>(null);

  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  localStreamRef.current = localStream;

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const upsertPeer = useCallback(
    (peer: Partial<RemotePeer> & { peerId: string }) => {
      setRemotePeers((prev) => {
        const existing = prev.find((p) => p.peerId === peer.peerId);
        if (!existing) {
          return [
            ...prev,
            {
              name: peer.name ?? 'Participant',
              isGuest: peer.isGuest ?? false,
              stream: peer.stream ?? null,
              peerId: peer.peerId,
            },
          ];
        }
        return prev.map((p) => (p.peerId === peer.peerId ? { ...p, ...peer } : p));
      });
    },
    []
  );

  const dropPeer = useCallback((peerId: string) => {
    peersRef.current.get(peerId)?.pc.close();
    peersRef.current.delete(peerId);
    setRemotePeers((prev) => prev.filter((p) => p.peerId !== peerId));
  }, []);

  const getPeer = useCallback(
    (peerId: string, name?: string, isGuest?: boolean): PeerRecord => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection(ICE_SERVERS);
      // Deterministic and opposite on each side: exactly one peer yields.
      const polite = (selfIdRef.current ?? '') < peerId;
      const record: PeerRecord = {
        pc,
        polite,
        makingOffer: false,
        ignoreOffer: false,
        stream: new MediaStream(),
      };
      peersRef.current.set(peerId, record);
      upsertPeer({ peerId, name: name ?? 'Participant', isGuest: !!isGuest });

      const local = localStreamRef.current;
      if (local && local.getTracks().length > 0) {
        local.getTracks().forEach((track) => pc.addTrack(track, local));
      } else {
        // Nothing to send yet. Declare receive-only slots so negotiation can
        // start anyway, otherwise nobody ever offers and no one sees anyone.
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
      }

      pc.ontrack = (event) => {
        /*
         * A track published later with replaceTrack arrives with an empty
         * streams list, so taking streams[0] would store nothing and the tile
         * would sit on "Connecting..." forever. Collect the tracks into a
         * stream of our own instead.
         */
        const stream = record.stream;
        if (!stream.getTracks().includes(event.track)) {
          stream.addTrack(event.track);
        }
        event.track.addEventListener('ended', () => {
          stream.removeTrack(event.track);
        });
        upsertPeer({ peerId, stream });
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          send({
            type: 'ice_candidate',
            to_user_id: peerId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      // Anything that changes the media on this connection lands here:
      // tracks added once the camera is ready, or a screen share swapped in.
      pc.onnegotiationneeded = async () => {
        try {
          record.makingOffer = true;
          await pc.setLocalDescription();
          send({
            type: 'offer',
            to_user_id: peerId,
            offer: pc.localDescription,
          });
        } catch {
          // A failed negotiation round is retried by the next event.
        } finally {
          record.makingOffer = false;
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') pc.restartIce();
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'closed') dropPeer(peerId);
      };

      return record;
    },
    [send, upsertPeer, dropPeer]
  );

  useEffect(() => {
    // Connect straight away. A device still sitting on the permission prompt
    // must still join the mesh - onnegotiationneeded publishes its tracks
    // later, and it can receive everyone else's in the meantime.
    if (!meetingCode || (!token && !guestToken)) return;

    const ws = new WebSocket(signallingUrl(meetingCode, token, guestToken));
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'peers') {
        selfIdRef.current = data.self_id;
        // Creating the connection and attaching tracks fires
        // onnegotiationneeded, which sends the offer.
        (data.peers as Array<{ peer_id: string; name: string; is_guest: boolean }>)
          .forEach((p) => getPeer(p.peer_id, p.name, p.is_guest));
        return;
      }

      if (data.type === 'peer_joined') {
        upsertPeer({
          peerId: data.peer_id,
          name: data.name ?? 'Participant',
          isGuest: !!data.is_guest,
        });
        return;
      }

      if (data.type === 'peer_left') {
        dropPeer(data.peer_id);
        return;
      }

      if (data.type === 'offer' || data.type === 'answer') {
        const description = data.type === 'offer' ? data.offer : data.answer;
        const record = getPeer(data.from_user_id, data.from_name);
        const { pc, polite } = record;

        const offerCollision =
          data.type === 'offer' &&
          (record.makingOffer || pc.signalingState !== 'stable');

        record.ignoreOffer = !polite && offerCollision;
        if (record.ignoreOffer) return;

        try {
          await pc.setRemoteDescription(new RTCSessionDescription(description));
          if (data.type === 'offer') {
            await pc.setLocalDescription();
            send({
              type: 'answer',
              to_user_id: data.from_user_id,
              answer: pc.localDescription,
            });
          }
        } catch {
          // Ignore a description the connection has already moved past.
        }
        return;
      }

      if (data.type === 'ice_candidate') {
        const record = peersRef.current.get(data.from_user_id);
        if (!record) return;
        try {
          await record.pc.addIceCandidate(data.candidate);
        } catch {
          if (!record.ignoreOffer) {
            // Only surfaced when the candidate mattered.
          }
        }
      }
    };

    const peers = peersRef.current;
    return () => {
      ws.close();
      peers.forEach((record) => record.pc.close());
      peers.clear();
      setRemotePeers([]);
    };
  }, [meetingCode, token, guestToken, getPeer, dropPeer, send, upsertPeer]);

  /** Publish local tracks to connections opened before the camera was ready. */
  useEffect(() => {
    if (!localStream) return;
    peersRef.current.forEach(({ pc }) => {
      localStream.getTracks().forEach((track) => {
        if (pc.getSenders().some((s) => s.track === track)) return;

        // Reuse the receive-only slot reserved earlier, so the connection
        // gains a direction instead of growing a second m-line.
        const spare = pc
          .getTransceivers()
          .find((t) => !t.sender.track && t.receiver.track?.kind === track.kind);

        if (spare) {
          spare.direction = 'sendrecv';
          spare.sender.replaceTrack(track);
        } else {
          pc.addTrack(track, localStream);
        }
      });
    });
  }, [localStream]);

  /**
   * Swap the outgoing video track on every connection, for screen sharing.
   * replaceTrack needs no renegotiation when the kind is unchanged.
   */
  const replaceVideoTrack = useCallback(async (track: MediaStreamTrack | null) => {
    const swaps: Promise<void>[] = [];
    peersRef.current.forEach(({ pc }) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) swaps.push(sender.replaceTrack(track));
    });
    await Promise.all(swaps);
  }, []);

  return { remotePeers, isConnected, replaceVideoTrack };
};
