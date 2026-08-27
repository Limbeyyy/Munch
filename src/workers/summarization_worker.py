"""LLM-based transcript summarization"""
import logging
from celery import shared_task
from django.conf import settings
from django.utils import timezone
from src.apps.meetings.models import Meeting
from src.apps.transcription.models import Transcript, TranscriptSummary
from src.apps.monitoring.models import ErrorLog, MeetingEvent

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=2, default_retry_delay=120)
def summarize_transcript(self, meeting_id, llm_provider=None):
    """
    Summarize transcript using LLM (Claude, OpenAI, etc)
    Generates summary, key points, action items
    """
    try:
        meeting = Meeting.objects.get(id=meeting_id)
        transcript = Transcript.objects.get(meeting=meeting)

        logger.info(f"Summarizing transcript for meeting {meeting_id}")

        if not transcript.is_complete or not transcript.full_text:
            logger.warning(f"Transcript not ready for meeting {meeting_id}")
            return {'error': 'Transcript not complete'}

        # Determine LLM provider
        if not llm_provider:
            llm_provider = settings.DEFAULT_LLM_PROVIDER

        if llm_provider == 'claude':
            summary_result = _summarize_with_claude(transcript.full_text)
        elif llm_provider == 'openai':
            summary_result = _summarize_with_openai(transcript.full_text)
        else:
            raise ValueError(f"Unknown LLM provider: {llm_provider}")

        # Save summary
        summary, created = TranscriptSummary.objects.get_or_create(
            meeting=meeting,
            defaults={
                'transcript': transcript,
                'llm_provider': llm_provider,
                'llm_model': summary_result.get('model'),
            }
        )

        summary.summary_text = summary_result.get('summary', '')
        summary.key_points = summary_result.get('key_points', [])
        summary.action_items = summary_result.get('action_items', [])
        summary.attendee_summary = summary_result.get('attendee_summary', {})
        summary.tokens_used = summary_result.get('tokens_used', 0)
        summary.is_complete = True
        summary.completed_at = timezone.now()
        summary.save()

        logger.info(f"Successfully summarized transcript for {meeting_id}")

        # Log event
        MeetingEvent.objects.create(
            meeting=meeting,
            event_type=MeetingEvent.EventType.SUMMARY_GENERATED,
            description=f"Summary generated with {len(summary.key_points)} key points",
            user='system',
            data={
                'key_points_count': len(summary.key_points),
                'action_items_count': len(summary.action_items),
                'tokens_used': summary.tokens_used
            }
        )

        return {
            'meeting_id': str(meeting_id),
            'status': 'success',
            'provider': llm_provider,
            'key_points': len(summary.key_points),
            'action_items': len(summary.action_items)
        }

    except Transcript.DoesNotExist:
        logger.error(f"Transcript not found for meeting {meeting_id}")
        return {'error': 'Transcript not found'}

    except Exception as e:
        logger.error(f"Failed to summarize transcript: {str(e)}")
        try:
            ErrorLog.objects.create(
                meeting_id=meeting_id,
                error_type='llm',
                severity='error',
                error_message=str(e),
                context={'task': 'summarize_transcript', 'provider': llm_provider}
            )
        except:
            pass

        self.retry(exc=e)


def _summarize_with_claude(transcript_text):
    """Summarize using Anthropic Claude"""
    try:
        from anthropic import Anthropic

        client = Anthropic()

        prompt = f"""Please analyze this meeting transcript and provide:

1. A concise 2-3 paragraph summary of the meeting
2. 5-7 key discussion points (as a bullet list)
3. 3-5 action items with assigned owners (if mentioned)
4. Brief summary of each participant's contributions

Transcript:
{transcript_text}

Return the analysis in JSON format with keys: summary, key_points, action_items, attendee_summary"""

        message = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=2048,
            messages=[
                {"role": "user", "content": prompt}
            ]
        )

        response_text = message.content[0].text

        # Parse JSON response
        import json
        result = json.loads(response_text)

        return {
            'summary': result.get('summary', ''),
            'key_points': result.get('key_points', []),
            'action_items': result.get('action_items', []),
            'attendee_summary': result.get('attendee_summary', {}),
            'tokens_used': message.usage.output_tokens,
            'model': 'claude-3-5-sonnet'
        }

    except Exception as e:
        logger.error(f"Claude summarization failed: {str(e)}")
        raise


def _summarize_with_openai(transcript_text):
    """Summarize using OpenAI GPT"""
    try:
        import openai
        from django.conf import settings

        openai.api_key = settings.OPENAI_API_KEY

        prompt = f"""Please analyze this meeting transcript and provide:

1. A concise 2-3 paragraph summary of the meeting
2. 5-7 key discussion points (as a bullet list)
3. 3-5 action items with assigned owners (if mentioned)
4. Brief summary of each participant's contributions

Transcript:
{transcript_text}

Return the analysis in JSON format with keys: summary, key_points, action_items, attendee_summary"""

        response = openai.ChatCompletion.create(
            model="gpt-4-turbo",
            messages=[
                {"role": "system", "content": "You are a meeting analyst. Analyze transcripts and provide structured insights."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=2048
        )

        response_text = response.choices[0].message.content

        # Parse JSON response
        import json
        result = json.loads(response_text)

        return {
            'summary': result.get('summary', ''),
            'key_points': result.get('key_points', []),
            'action_items': result.get('action_items', []),
            'attendee_summary': result.get('attendee_summary', {}),
            'tokens_used': response.usage.completion_tokens,
            'model': 'gpt-4-turbo'
        }

    except Exception as e:
        logger.error(f"OpenAI summarization failed: {str(e)}")
        raise
