"""Telling Django the connection was secure when only the proxy knows.

A reverse proxy terminates TLS and speaks plain HTTP to the
application, so Django cannot see what the browser used. Normally the
proxy says so in ``X-Forwarded-Proto`` and
``SECURE_PROXY_SSL_HEADER`` reads it, which is the right arrangement:
Django believes the proxy rather than the client.

Some proxies do not send it. Tailscale Funnel is the case this was
written for - it serves HTTPS and nothing else, so the information is
certain, and it is simply not in the request. Without it Django
builds ``http://`` absolute URLs for uploaded images, and a browser on
an HTTPS page refuses to load them: avatars and speaker photographs
vanish, with nothing in any log to say why.
"""


class AssumeTLS:
    """Mark every request as having arrived over TLS.

    Only correct where nothing can reach the application except a
    proxy that serves HTTPS exclusively - which means the application
    is bound to loopback, so there is no other route to it. Anywhere
    else this is a lie that turns off real protections, which is why
    it is opt-in and named after what it does rather than after what
    it is for.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # The same header SECURE_PROXY_SSL_HEADER reads, so everything
        # downstream - is_secure, build_absolute_uri, the security
        # middleware - agrees without any of them being special-cased.
        request.META['HTTP_X_FORWARDED_PROTO'] = 'https'
        return self.get_response(request)
