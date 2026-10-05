"""Serving the built frontend from Django itself.

Only for the standalone deployment, where there is no nginx or IIS to
do it. A proxy should answer these paths before Django ever sees them.

A single-page application is one HTML file and a pile of assets beside
it. The browser may ask for any route in the application - somebody
reloads the page on /events/3, or opens a link straight to it - and
every one of those has to come back as that same HTML file, because
the route is resolved in the browser afterwards. So: send the file if
one exists at that path, and otherwise send index.html.
"""
import mimetypes
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse


def _within(root: Path, path: str) -> Path | None:
    """The file that path names, if it really is inside root.

    ``root / path`` is not enough on its own. A request for
    ``../../.env.prod`` is a perfectly ordinary string until it is
    resolved, at which point it is a path to the deployment's secrets
    - so the answer is resolved first and then checked to be under the
    directory it was supposed to be under.
    """
    try:
        candidate = (root / path.lstrip('/')).resolve()
    except (OSError, ValueError):
        return None
    if not candidate.is_file():
        return None
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    return candidate


def spa(request, path=''):
    """One of the frontend's own files, or the page that boots it."""
    root = Path(settings.SPA_ROOT)

    found = _within(root, path) if path else None
    if found is None:
        found = root / 'index.html'
        if not found.is_file():
            raise Http404(
                'The frontend has not been built. Run `npm run build` in '
                'Munch-frontend, or point SPA_ROOT at the build output.'
            )

    kind, encoding = mimetypes.guess_type(found.name)

    if found.name == 'index.html':
        # Read rather than streamed. A FileResponse wraps a
        # synchronous iterator, and under ASGI Django warns about
        # that on every single request - which, for the file served
        # to every client-side route, is every page view. It is a few
        # kilobytes.
        response = HttpResponse(found.read_bytes(), content_type='text/html')
    else:
        response = FileResponse(
            found.open('rb'), content_type=kind or 'application/octet-stream'
        )
        if encoding:
            response['Content-Encoding'] = encoding

    if found.name == 'index.html':
        # Never cached. It is what names the current bundle, so a
        # cached copy keeps pointing at the previous deploy's files -
        # which are gone, and the application does not load at all.
        response['Cache-Control'] = 'no-store, must-revalidate'
    elif '/static/' in request.path:
        # Create React App puts a content hash in these names, so a
        # changed file is a different URL and this can be as long as
        # we like.
        response['Cache-Control'] = 'public, max-age=31536000, immutable'

    return response
