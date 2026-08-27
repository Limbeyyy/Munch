"""
WebRTC signaling handlers for the meeting platform.
"""
import json
import logging
from channels.generic.websocket import AsyncWebsocketConsumer
from django.core.exceptions import ObjectDoesNotExist
from src.apps.meetings.models import Meeting, MeetingParticipant
from src.utilities.logger import get_logger

logger = get_logger(__name__)

class SignalingHandler:
    """
    Handles WebRTC signaling messages between participants.
    """
    
    @staticmethod
    async def handle_offer(consumer: AsyncWebsocketConsumer, data: dict):
        """
        Handle SDP offer from a participant.
        """
        target_user_id = data.get('target_user')
        sdp = data.get('sdp')
        
        if not target_user_id or not sdp:
            await consumer.send_error("Missing target_user or sdp")
            return
        
        # Forward the offer to the target participant
        await consumer.channel_layer.group_send(
            consumer.meeting_group_name,
            {
                'type': 'signal_message',
                'sender': consumer.user.id,
                'target': target_user_id,
                'signal_type': 'offer',
                'sdp': sdp,
                'sender_name': consumer.user.display_name
            }
        )
        logger.debug(f"Forwarded offer from {consumer.user.id} to {target_user_id}")
    
    @staticmethod
    async def handle_answer(consumer: AsyncWebsocketConsumer, data: dict):
        """
        Handle SDP answer from a participant.
        """
        target_user_id = data.get('target_user')
        sdp = data.get('sdp')
        
        if not target_user_id or not sdp:
            await consumer.send_error("Missing target_user or sdp")
            return
        
        await consumer.channel_layer.group_send(
            consumer.meeting_group_name,
            {
                'type': 'signal_message',
                'sender': consumer.user.id,
                'target': target_user_id,
                'signal_type': 'answer',
                'sdp': sdp,
                'sender_name': consumer.user.display_name
            }
        )
        logger.debug(f"Forwarded answer from {consumer.user.id} to {target_user_id}")
    
    @staticmethod
    async def handle_ice_candidate(consumer: AsyncWebsocketConsumer, data: dict):
        """
        Handle ICE candidate from a participant.
        """
        target_user_id = data.get('target_user')
        candidate = data.get('candidate')
        
        if not target_user_id or not candidate:
            await consumer.send_error("Missing target_user or candidate")
            return
        
        await consumer.channel_layer.group_send(
            consumer.meeting_group_name,
            {
                'type': 'signal_message',
                'sender': consumer.user.id,
                'target': target_user_id,
                'signal_type': 'ice_candidate',
                'candidate': candidate,
                'sender_name': consumer.user.display_name
            }
        )
        logger.debug(f"Forwarded ICE candidate from {consumer.user.id} to {target_user_id}")
    
    @staticmethod
    async def handle_disconnect(consumer: AsyncWebsocketConsumer, data: dict):
        """
        Handle a participant disconnecting.
        """
        target_user_id = data.get('target_user')
        
        await consumer.channel_layer.group_send(
            consumer.meeting_group_name,
            {
                'type': 'signal_message',
                'sender': consumer.user.id,
                'target': target_user_id,
                'signal_type': 'disconnect',
                'sender_name': consumer.user.display_name
            }
        )
        logger.debug(f"Forwarded disconnect from {consumer.user.id} to {target_user_id}")
    
    @staticmethod
    async def send_signal_to_client(consumer: AsyncWebsocketConsumer, event: dict):
        """
        Send a signal message to the client.
        """
        # Only send if the message is for this participant (if targeted)
        target = event.get('target')
        if target and str(target) != str(consumer.user.id):
            return  # Skip if not for this user
        
        await consumer.send(text_data=json.dumps({
            'type': 'signal',
            'sender': str(event.get('sender')),
            'sender_name': event.get('sender_name', 'Unknown'),
            'signal_type': event.get('signal_type'),
            'data': {
                'sdp': event.get('sdp'),
                'candidate': event.get('candidate'),
            }
        }))