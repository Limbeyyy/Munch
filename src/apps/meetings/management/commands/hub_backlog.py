"""What the room asked and no host ever saw.

Questions and suggestions written before the host's queues could show
them are still sitting at `pending`. Nothing is lost - the host can
open the moderation screen and decide them, on a finished event as
much as a running one - but on an instance with a few months of them
that is a long afternoon, so this lists them and can let them through
in one go.

Listing is the default. Deciding anything needs saying so outright.
"""
from django.core.management.base import BaseCommand

from src.apps.meetings.models import Event, HubPost

WAITING = [HubPost.Status.PENDING, HubPost.Status.LOOKING]


class Command(BaseCommand):
    help = 'List hub questions and suggestions still waiting on a host.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--event', help='One event, by its code. Default: all of them.'
        )
        parser.add_argument(
            '--approve', action='store_true',
            help='Let them through, rather than only listing them.',
        )
        parser.add_argument(
            '--file-under',
            help=(
                'An agenda id. Files every post that belongs to no agenda '
                'under it, so the moderation screen can filter to them. '
                'Needs --event.'
            ),
        )

    def handle(self, *args, **options):
        if options['file_under']:
            return self.file_under(options)

        waiting = HubPost.objects.filter(
            status__in=WAITING
        ).select_related('event').order_by('event__title', 'created_at')

        if options['event']:
            waiting = waiting.filter(event__code=options['event'])

        posts = list(waiting)
        if not posts:
            self.stdout.write('Nothing is waiting on a host.')
            return

        events = {post.event_id: post.event for post in posts}
        for event in events.values():
            mine = [p for p in posts if p.event_id == event.id]
            self.stdout.write(
                f'\n{event.title} ({event.code}) [{event.status}] '
                f'- {len(mine)} waiting'
            )
            for post in mine:
                self.stdout.write(f'    {post.kind:11} {post.body[:60]!r}')

        if not options['approve']:
            self.stdout.write(
                self.style.WARNING(
                    f'\n{len(posts)} waiting. Nothing changed. Decide them on '
                    'the moderation screen, or re-run with --approve to let '
                    'all of these through at once.'
                )
            )
            return

        # Same rule the endpoint uses: a suggestion is addressed rather
        # than published, because publishing is for what the room reads.
        from src.apps.meetings import hub_review

        for post in posts:
            hub_review.decide(post, 'approve')

        self.stdout.write(
            self.style.SUCCESS(f'\nLet {len(posts)} through.')
        )

    def file_under(self, options):
        """Give an agenda to the posts that were never given one.

        A question asked before this was fixed carries no agenda, so
        the host's filter cannot reach it. Nothing can work out which
        talk it was meant for from here - only the host knows - so the
        agenda is named rather than guessed.
        """
        from src.apps.meetings.models import Event, Session

        if not options['event']:
            self.stderr.write('--file-under needs --event as well.')
            return

        event = Event.objects.filter(code=options['event']).first()
        if event is None:
            self.stderr.write(f"No event with code {options['event']}.")
            return

        session = Session.objects.filter(
            id=options['file_under'], event=event
        ).first()
        if session is None:
            self.stderr.write(
                f"No agenda {options['file_under']} on {event.code}. "
                'Its agendas are:'
            )
            for one in event.sessions.order_by('starts_at'):
                self.stderr.write(f'    {one.id}  {one.title}')
            return

        moved = HubPost.objects.filter(
            event=event, session__isnull=True
        ).update(session=session)

        self.stdout.write(self.style.SUCCESS(
            f'Filed {moved} post(s) under "{session.title}".'
        ))
