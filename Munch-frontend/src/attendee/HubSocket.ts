/** Opens the meeting's own websocket so the hub can speak into the room.

The chat path is the meeting socket; the hub is simply another client of
it, exactly as the meeting room is. History is read over HTTP; only
sending needs the socket.
*/
export interface HubSocket {
  send: (message: string, recipientId?: string) => boolean;
  close: () => void;
}

export const openHubSocket = (
  meetingCode: string,
  onMessage: () => void,
  guestToken?: string
): HubSocket => {
  const apiUrl = new URL(process.env.REACT_APP_API_URL || 'http://localhost:8000/api/v1');
  const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';

  // A websocket handshake cannot carry an Authorization header, so the
  // credential travels in the query string.
  const credential = guestToken
    ? `?guest_token=${encodeURIComponent(guestToken)}`
    : (() => {
        const token = localStorage.getItem('access_token');
        return token ? `?token=${encodeURIComponent(token)}` : '';
      })();

  const socket = new WebSocket(
    `${protocol}//${apiUrl.host}/ws/meeting/${meetingCode}/${credential}`
  );

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'chat_message' || data.type === 'chat_pending') onMessage();
    } catch {
      // Not a frame this view cares about.
    }
  };

  return {
    send: (message, recipientId) => {
      if (socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify({
        type: 'chat_message',
        message,
        recipient_id: recipientId || undefined,
      }));
      return true;
    },
    close: () => socket.close(),
  };
};
