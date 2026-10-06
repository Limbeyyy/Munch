"""Turning a speech recogniser's stream into readable transcript.

A recogniser does not emit sentences. It emits the same sentence over
and over as it hears more of it:

    के
    के
    के गर्दैछौ
    के गर्दैछौ तिमी
    के गर्दैछौ तिमी के

Each of those is the whole phrase so far, not a new phrase. Stored and
shown one per line, which is what happened, the transcript becomes a
column of overlapping fragments that nobody can read and that says the
speaker stammered when they did not.

Two things fix it, and they are separate.

**Overlap.** A line that begins with the line before it is the same
line, grown. Only the new tail is kept. A line that does not is a
fresh phrase, and is appended.

**Cadence.** Even de-duplicated, a word or two arriving every second
is not a transcript, it is a ticker. Text is held for a window - a
quarter of a minute by default - and released as one block. The result
reads the way a transcript should: a few sentences at a time, each
picking up where the last left off.

The state is per event and lives in the cache rather than in a process,
because lines arrive down two different doors - a socket held open, and
one HTTP request per line - and may reach different workers. It is
small, it is rebuilt from nothing if lost, and the worst a lost buffer
costs is one window of text.
"""
import logging
import time

from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

#: How long text is gathered before it is released as one block.
DEFAULT_WINDOW_SECONDS = 15

#: Long enough to outlive any pause a speaker takes, short enough that
#: a forgotten buffer does not follow an event around all day.
BUFFER_TTL_SECONDS = 60 * 60

#: The tail kept for spotting that the next line continues this one.
#: Only the end can overlap, and holding a whole talk to compare
#: against would grow without limit.
OVERLAP_TAIL = 400


def window_seconds() -> int:
    """The window, which a deployment may shorten or lengthen."""
    try:
        value = int(getattr(settings, 'TRANSCRIPT_WINDOW_SECONDS',
                            DEFAULT_WINDOW_SECONDS))
    except (TypeError, ValueError):
        return DEFAULT_WINDOW_SECONDS
    # Zero or less would mean no batching at all, which is the
    # behaviour this exists to replace.
    return value if value > 0 else DEFAULT_WINDOW_SECONDS


def _key(event_id) -> str:
    return f'transcript:buffer:{event_id}'


def merge(last: str, pending: str, text: str) -> tuple[str, str]:
    """Fold one incoming line into what is already held.

    Returns the new ``(pending, last)``.

    ``last`` is the previous line exactly as it arrived, which is what
    makes growth recognisable; ``pending`` is the readable text built
    out of the lines so far and not yet released.

    They are kept apart on purpose. After a block is released,
    ``pending`` starts again from nothing while ``last`` stays - so a
    recogniser that goes on repeating the whole phrase is still
    understood to be repeating it, and the released text is not
    released a second time.
    """
    text = (text or '').strip()
    if not text:
        return pending, last

    if last:
        if text.startswith(last):
            # The same phrase, heard further. Only the tail is new, and
            # it is appended exactly as it came: the tail carries
            # whatever separated it, so adding a space of our own
            # breaks a word the recogniser was still in the middle of -
            # "Sixty-nine dist" growing into "Sixty-nine districts"
            # must not become "Sixty-nine dist ricts".
            return pending + text[len(last):], text
        if last.startswith(text):
            # A shorter re-send of what we already have. Nothing new,
            # and `last` must not shrink or the next line's tail would
            # be measured against the wrong thing and come back
            # doubled.
            return pending, last

    # Something else: a new phrase.
    return (f'{pending} {text}'.strip() if pending else text), text


def _load(event_id) -> dict:
    held = cache.get(_key(event_id))
    if not isinstance(held, dict):
        return {'pending': '', 'last': '', 'opened': time.monotonic(),
                'start_time': None, 'end_time': 0.0, 'language': ''}
    return held


def _save(event_id, held: dict) -> None:
    # Only the tail of `last` is worth keeping; it exists to be
    # compared against the front of the next line.
    held = dict(held)
    if len(held.get('last') or '') > OVERLAP_TAIL:
        held['last'] = held['last'][-OVERLAP_TAIL:]
    try:
        cache.set(_key(event_id), held, timeout=BUFFER_TTL_SECONDS)
    except Exception as e:
        # A cache that will not hold the buffer means no batching, not
        # no transcript: the line was already dealt with by the caller.
        logger.warning(f"Could not hold transcript buffer for {event_id}: {e}")


def add(event_id, text: str, start_time=None, end_time=None,
        language: str = '') -> dict | None:
    """Take one line. Return a block if the window has closed.

    The returned dict carries the text to store and publish, and the
    span it covers. ``None`` means the line was folded in and there is
    nothing to say yet.
    """
    held = _load(event_id)
    pending, last = merge(held.get('last', ''), held.get('pending', ''), text)

    if pending == held.get('pending') and last == held.get('last'):
        # Nothing new in that line at all - a repeat, or empty.
        return None

    if held.get('start_time') is None and start_time is not None:
        held['start_time'] = float(start_time)
    if end_time is not None:
        held['end_time'] = float(end_time)
    # The block is spoken in whatever the lines were spoken in. Kept
    # on the buffer because a block released later - at the end of a
    # talk, say - is built without any line in front of it to ask.
    if language:
        held['language'] = language

    held['pending'] = pending
    held['last'] = last

    if not pending.strip() or time.monotonic() - held.get('opened', 0) < window_seconds():
        _save(event_id, held)
        return None

    block = {
        'text': pending.strip(),
        'start_time': held.get('start_time') or 0.0,
        'end_time': held.get('end_time') or 0.0,
        'language': held.get('language') or '',
    }
    # The window reopens empty, but `last` carries over: the speaker has
    # not stopped talking just because we have stopped listening for a
    # moment, and the next line is very likely this one continued.
    _save(event_id, {'pending': '', 'last': last, 'opened': time.monotonic(),
                     'start_time': None, 'end_time': held.get('end_time') or 0.0,
                     'language': held.get('language') or ''})
    return block


def flush(event_id) -> dict | None:
    """Release whatever is held, window or no window.

    For the end of a talk or of the event. Without it the last words
    of every session would sit in a buffer waiting for a line that is
    never coming.
    """
    held = _load(event_id)
    pending = (held.get('pending') or '').strip()
    try:
        cache.delete(_key(event_id))
    except Exception:
        pass
    if not pending:
        return None
    return {
        'text': pending,
        'start_time': held.get('start_time') or 0.0,
        'end_time': held.get('end_time') or 0.0,
        'language': held.get('language') or '',
    }
