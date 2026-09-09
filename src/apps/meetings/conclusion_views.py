"""The day's conclusions, for the people who attended it."""
import logging

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from src.apps.meetings import conclusions as service

logger = logging.getLogger(__name__)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_conclusions(request):
    """What each session settled, and what is owed by whom.

    Only published summaries: a draft is the host's working copy, and an
    unreviewed conclusion going out would be worse than none at all.
    """
    found = service.for_reader(request.user)

    return Response({
        'conclusions': found,
        # Pulled out separately so the page can offer somebody their own
        # list without them reading every session to find their name.
        'mine': service.mine_from(
            found,
            name=request.user.display_name or '',
            email=request.user.email or '',
        ),
    })
