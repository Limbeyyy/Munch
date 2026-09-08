"""When a shared file becomes readable.

A file belongs to the part of the running order it was shared during, and
it stays with that session until the session is over. Handing out slides
while the talk is still going lets the room read ahead of the speaker, so
the material waits until the session closes.

Organizers are exempt: they are the ones who put the files there and have
to be able to see what they have staged.
"""
from src.apps.artifacts.models import Artifact, ArtifactType


def is_released(artifact) -> bool:
    """True when everyone in the meeting may read this file.

    Four answers, and the uploader picks which:

    * visible now, and public to all - readable as soon as it is there;
    * after the session - held until the session it belongs to has
      finished, so the room cannot read ahead of the speaker;
    * organizers only - never released to the room at all.

    A file marked "after the session" with no session attached is not
    waiting on anything, so it is readable straight away.
    """
    choice = getattr(artifact, 'visibility', None)

    if choice == Artifact.Visibility.ORGANIZERS:
        return False
    if choice in (Artifact.Visibility.NOW, Artifact.Visibility.PUBLIC):
        return True

    if artifact.session_id is None:
        return True
    return artifact.session.status == 'done'


def resources_for(meeting, *, include_unreleased: bool):
    """The meeting's shared files, newest first.

    ``include_unreleased`` is for organizers, who need to see the files
    they have staged against sessions that have not run yet.
    """
    resources = (
        Artifact.objects.filter(meeting=meeting, artifact_type=ArtifactType.RESOURCE)
        .select_related('session')
        # The order the organizer set, then newest first among equals.
        .order_by('position', '-created_at')
    )
    if include_unreleased:
        return resources
    return [artifact for artifact in resources if is_released(artifact)]


def is_public(artifact) -> bool:
    """Whether a guest may read it as well as the account holders."""
    return getattr(artifact, 'visibility', None) == Artifact.Visibility.PUBLIC


def can_organize(meeting, user) -> bool:
    """Whether this person runs the meeting, rather than attends it."""
    if not user or not user.is_authenticated:
        return False
    if str(user.id) == str(meeting.host_id):
        return True
    if meeting.participants.filter(user=user, role__in=['host', 'co_host']).exists():
        return True

    # Being named a co-host is enough; it should not also require having
    # walked into the room, which is what a participant row records.
    from src.apps.meetings.roles import is_co_host

    return is_co_host(meeting, user)
