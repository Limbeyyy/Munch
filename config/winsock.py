"""Windows: a peer that vanishes should not leak the socket.

Every so often a phone in the hall closes its websocket without a
handshake - the screen locks, the browser is swiped away, the wi-fi
drops. On Windows that makes the next `shutdown()` on the socket raise
ConnectionResetError, WinError 10054.

CPython's proactor transport does its teardown like this::

    try:
        self._protocol.connection_lost(exc)
    finally:
        if hasattr(self._sock, 'shutdown') and self._sock.fileno() != -1:
            self._sock.shutdown(socket.SHUT_RDWR)   # <- raises 10054
        self._sock.close()                          # <- never reached
        self._sock = None
        ...

The `shutdown()` is unguarded and sits ahead of `close()` inside the
`finally`, so a reset peer costs a socket handle as well as a wall of
traceback in the log. A hall of phones does that all afternoon.

So this finishes the teardown the raise interrupted. It is not about
quietening the log - the log is the symptom. Left alone, the handles
accumulate for as long as the server runs.

Only on Windows, and only ever around the original: if a future CPython
guards the shutdown itself, this wrapper simply never sees the error.
"""
import sys


def quieted(original):
    """Wrap `_call_connection_lost` so a reset peer still gets closed."""

    def _call_connection_lost(self, exc):
        try:
            original(self, exc)
        except ConnectionResetError:
            # Upstream raised out of its own `finally`, so everything
            # after the shutdown() was skipped. Do it here, in the same
            # order, and swallow nothing else.
            sock, self._sock = getattr(self, '_sock', None), None
            if sock is not None:
                try:
                    sock.close()
                except OSError:
                    # Already gone underneath us; nothing left to free.
                    pass
            server, self._server = getattr(self, '_server', None), None
            if server is not None:
                server._detach()
            self._called_connection_lost = True

    return _call_connection_lost


def install():
    """Apply it, on Windows only. Safe to call more than once."""
    if sys.platform != 'win32':
        return False

    from asyncio.proactor_events import _ProactorBasePipeTransport

    original = _ProactorBasePipeTransport._call_connection_lost
    if getattr(original, '_munch_quieted', False):
        return False

    wrapped = quieted(original)
    wrapped._munch_quieted = True
    _ProactorBasePipeTransport._call_connection_lost = wrapped
    return True
