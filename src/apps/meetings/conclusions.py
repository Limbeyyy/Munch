"""What a day came to, read by the people who sat through it.

A summary is prose. What an attendee actually leaves with is shorter than
that: the few things each session settled, and the ones with their own
name against them. So this reads the published summaries and presents
them as findings and actions rather than as paragraphs.

Nothing here decides what a summary says - the host writes that, and
until they publish it nobody else sees it. This only reshapes what has
already been let out.
"""
import logging

logger = logging.getLogger(__name__)

#: Enough for a session's worth of decisions; more than this is minutes.
MAX_ACTIONS = 25

#: The bullet characters a person is likely to have typed.
MARKERS = '-*•‣◦–—·'


def tidy_actions(raw) -> list:
    """Check and clean an action list on its way in.

    Each row is a task, whose it is, and when it is due. The owner and the
    date are free text on purpose: "before the next meeting" and "Asoj 9"
    are both real answers, and a date picker that insists on a calendar
    day would turn one of them into a lie.
    """
    if not isinstance(raw, list):
        raise ValueError('actions must be a list of {task, owner, due} rows.')
    if len(raw) > MAX_ACTIONS:
        raise ValueError(f'That is more than {MAX_ACTIONS} actions for one session.')

    tidy = []
    for row in raw:
        if not isinstance(row, dict):
            raise ValueError('Each action is a {task, owner, due} row.')
        task = str(row.get('task', '')).strip()
        if not task:
            continue
        tidy.append({
            'task': task[:300],
            'owner': str(row.get('owner', '')).strip()[:120],
            'due': str(row.get('due', '')).strip()[:60],
        })
    return tidy


def findings_from(body: str) -> list:
    """The lines of a summary, as the points they were written as.

    A leading bullet is stripped where somebody typed one, and numbering
    with it, so the page can draw its own marks and they all match. Lines
    that are only a heading - short and ending in a colon - are kept, since
    dropping them would lose the shape of somebody's notes.
    """
    points = []
    for line in (body or '').splitlines():
        text = line.strip()
        if not text:
            continue
        while text and text[0] in MARKERS:
            text = text[1:].strip()
        # "1." or "2)" at the front of a line is the same intent.
        if len(text) > 2 and text[0].isdigit():
            head = text.split(' ', 1)
            if head[0].rstrip('.)').isdigit() and head[0][-1] in '.)':
                text = head[1].strip() if len(head) > 1 else ''
        if text:
            points.append(text)
    return points


def for_reader(user):
    """Every published conclusion this person is entitled to read.

    Grouped by session and ordered as the day ran, because that is the
    order somebody remembers it in.
    """
    from src.apps.meetings.access import sessions_visible_to
    from src.apps.meetings.models import Session, SessionSummary

    summaries = (
        SessionSummary.objects.filter(
            status=SessionSummary.Status.PUBLISHED,
            session__in=Session.objects.filter(sessions_visible_to(user)),
        )
        .select_related('session', 'session__meeting', 'session__meeting__event')
        .order_by('session__starts_at')
    )

    out = []
    for summary in summaries:
        session = summary.session
        meeting = session.meeting
        out.append({
            'session_id': str(session.id),
            'session_title': session.title,
            'session_starts_at': session.starts_at,
            'speaker_name': session.speaker_name,
            'hall': session.hall,
            'meeting_id': str(meeting.id),
            'meeting_title': meeting.title,
            'event_id': str(meeting.event_id) if meeting.event_id else '',
            'event_title': meeting.event.title if meeting.event else '',
            'findings': findings_from(summary.body),
            'actions': summary.actions or [],
            'published_at': summary.published_at,
        })
    return out


def mine_from(conclusions, *, name='', email='') -> list:
    """The actions with this person's name against them.

    Matched on the name as written, because that is what the host typed
    against the task. Loose on purpose: an action list that silently
    excludes somebody because of a middle initial is worse than one that
    occasionally offers a line to the wrong Sunita, who can see at a
    glance that it is not hers.
    """
    wanted = {part for part in (name or '').lower().split() if len(part) > 2}
    address = (email or '').lower().strip()

    mine = []
    for entry in conclusions:
        for action in entry['actions']:
            owner = str(action.get('owner', '')).lower()
            if not owner:
                continue
            hit = (address and address in owner) or (
                wanted and any(part in owner for part in wanted)
            )
            if hit:
                mine.append({**action, 'session_title': entry['session_title']})
    return mine
