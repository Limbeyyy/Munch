"""A phone that vanishes mid-websocket should not cost a socket.

On Windows, CPython's proactor transport tears a connection down with
an unguarded `shutdown()` ahead of `close()`, both inside a `finally`.
A peer that has already gone makes the shutdown raise WinError 10054,
so the close never runs: the log fills with tracebacks and, less
visibly, the handle is never freed. A hall full of phones locking their
screens does that all afternoon.

Tested here rather than on Windows because the wrapper is ordinary
Python: what it has to do is finish the teardown that the raise
interrupted. The platform check lives in `install()`, which these do
not call.
"""
import socket
from unittest.mock import MagicMock

from django.test import SimpleTestCase

from config.winsock import quieted


class FakeTransport:
    """Just the attributes the teardown touches."""

    def __init__(self, sock, server=None):
        self._sock = sock
        self._server = server
        self._called_connection_lost = False


def upstream(self, exc):
    """CPython's teardown, in the shape that has the bug."""
    if self._called_connection_lost:
        return
    try:
        pass  # protocol.connection_lost(exc)
    finally:
        if hasattr(self._sock, 'shutdown') and self._sock.fileno() != -1:
            self._sock.shutdown(socket.SHUT_RDWR)
        self._sock.close()
        self._sock = None
        server = self._server
        if server is not None:
            server._detach()
            self._server = None
        self._called_connection_lost = True


class ResetPeerTests(SimpleTestCase):
    def sock(self, *, reset):
        one = MagicMock()
        one.fileno.return_value = 3
        if reset:
            one.shutdown.side_effect = ConnectionResetError(
                10054, 'An existing connection was forcibly closed'
            )
        return one

    def test_the_socket_is_closed_even_when_shutdown_refuses(self):
        """The whole point. Upstream leaks it; this must not."""
        sock = self.sock(reset=True)
        transport = FakeTransport(sock)

        quieted(upstream)(transport, None)

        sock.close.assert_called_once()
        self.assertIsNone(transport._sock)

    def test_upstream_really_does_leak_it(self):
        """So the test above is measuring something that was wrong."""
        sock = self.sock(reset=True)
        transport = FakeTransport(sock)

        with self.assertRaises(ConnectionResetError):
            upstream(transport, None)

        sock.close.assert_not_called()

    def test_the_server_is_let_go_of_too(self):
        """Or the server waits forever on a connection nobody holds."""
        sock = self.sock(reset=True)
        server = MagicMock()
        transport = FakeTransport(sock, server)

        quieted(upstream)(transport, None)

        server._detach.assert_called_once()
        self.assertIsNone(transport._server)
        self.assertTrue(transport._called_connection_lost)

    def test_an_ordinary_close_is_left_entirely_alone(self):
        sock = self.sock(reset=False)
        transport = FakeTransport(sock)

        quieted(upstream)(transport, None)

        sock.shutdown.assert_called_once()
        sock.close.assert_called_once()
        self.assertIsNone(transport._sock)

    def test_any_other_failure_still_surfaces(self):
        """Swallowing everything would hide a real fault."""
        sock = self.sock(reset=False)
        sock.shutdown.side_effect = OSError(9, 'Bad file descriptor')
        transport = FakeTransport(sock)

        with self.assertRaises(OSError):
            quieted(upstream)(transport, None)

    def test_a_socket_already_gone_is_not_an_error(self):
        sock = self.sock(reset=True)
        sock.close.side_effect = OSError(9, 'Bad file descriptor')
        transport = FakeTransport(sock)

        quieted(upstream)(transport, None)

        self.assertIsNone(transport._sock)
