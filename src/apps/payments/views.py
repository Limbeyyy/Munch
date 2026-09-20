import hashlib
import hmac
import json
import os
import uuid
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import PaymentOrder


def _setting(name, default=''):
    return os.environ.get(name, default).strip()


def _gateway_signature(amount, merchant_id, transaction_id):
    key = _setting('NEPALPAYMENT_KEY')
    if not key:
        raise RuntimeError('NEPALPAYMENT_KEY is not configured')
    canonical = f'{Decimal(amount):.2f}|{merchant_id}|{transaction_id}'
    return hmac.new(key.encode('utf-8'), canonical.encode('utf-8'), hashlib.sha256).hexdigest()


def _gateway_payload(order):
    merchant_id = _setting('NEPALPAYMENT_MERCHANT_ID')
    username = _setting('NEPALPAYMENT_API_USERNAME')
    password = _setting('NEPALPAYMENT_API_PASSWORD')
    if not merchant_id or not username or not password:
        raise RuntimeError('Nepal Payment gateway credentials are not configured')

    signature = _gateway_signature(order.amount, merchant_id, order.transaction_id)
    return {
        'MerchantId': merchant_id,
        'ApiUsername': username,
        'ApiPassword': password,
        'Amount': f'{order.amount:.2f}',
        'TransactionId': order.transaction_id,
        'OrderId': order.order_id,
        'Signature': signature,
        'ReturnUrl': _setting('NEPALPAYMENT_CALLBACK_URL'),
        'Currency': order.currency,
        'PaymentChannel': order.payment_channel,
    }


def _request_data(request):
    if request.content_type and 'application/json' in request.content_type:
        try:
            return json.loads(request.body.decode('utf-8') or '{}')
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {}
    return request.POST.dict()


def _amount(value):
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError('Amount must be a valid number')
    if parsed <= 0 or parsed.as_tuple().exponent < -2:
        raise ValueError('Amount must be positive with at most two decimal places')
    return parsed.quantize(Decimal('0.01'))


def _channel(value):
    channel = str(value or 'esewa').strip().lower()
    if channel not in {'esewa', 'khalti', 'imepay', 'banking'}:
        raise ValueError('Unsupported payment channel')
    return channel


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def initiate(request):
    order_id = str(request.data.get('order_id', '')).strip()
    if not order_id or len(order_id) > 100:
        return Response({'error': 'A valid order_id is required'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        amount = _amount(request.data.get('amount'))
        payment_channel = _channel(request.data.get('payment_channel'))
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    try:
        with transaction.atomic():
            order, created = PaymentOrder.objects.get_or_create(
                order_id=order_id,
                defaults={
                    'user': request.user,
                    'amount': amount,
                    'payment_channel': payment_channel,
                    'transaction_id': f'MNCH-{uuid.uuid4().hex.upper()}',
                },
            )
            if not created and order.user_id != request.user.id:
                return Response({'error': 'Order does not belong to this account'}, status=status.HTTP_403_FORBIDDEN)
            if not created and order.status == PaymentOrder.Status.SUCCESS:
                return Response({'error': 'This order has already been paid'}, status=status.HTTP_409_CONFLICT)
            if not created and order.amount != amount:
                return Response({'error': 'Order amount cannot be changed'}, status=status.HTTP_409_CONFLICT)
            if not created:
                order.payment_channel = payment_channel
            payload = _gateway_payload(order)
            order.gateway_signature = payload['Signature']
            order.save(update_fields=['payment_channel', 'gateway_signature', 'updated_at'])
    except RuntimeError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    return Response({
        'order_id': order.order_id,
        'transaction_id': order.transaction_id,
        'gateway_url': _setting('NEPALPAYMENT_CHECKOUT_URL', 'https://eg-uat.nepalpayment.com/'),
        'payload': payload,
    })


@csrf_exempt
@api_view(['POST'])
@permission_classes([AllowAny])
def callback(request):
    data = _request_data(request)
    order_id = str(data.get('OrderId') or data.get('order_id') or '').strip()
    transaction_id = str(data.get('TransactionId') or data.get('transaction_id') or '').strip()
    received_signature = str(data.get('Signature') or data.get('signature') or data.get('hash') or '').strip()
    order = PaymentOrder.objects.filter(order_id=order_id, transaction_id=transaction_id).first()
    if not order:
        return HttpResponse('unknown order', status=404)

    try:
        expected = _gateway_signature(order.amount, _setting('NEPALPAYMENT_MERCHANT_ID'), transaction_id)
    except RuntimeError:
        return HttpResponse('gateway is not configured', status=503)
    if not received_signature or not hmac.compare_digest(received_signature.lower(), expected.lower()):
        return HttpResponse('invalid signature', status=400)

    state = str(data.get('Status') or data.get('status') or data.get('ResponseCode') or '').upper()
    success = state in {'SUCCESS', 'SUCCESSFUL', '00', 'COMPLETED'}
    with transaction.atomic():
        locked = PaymentOrder.objects.select_for_update().get(pk=order.pk)
        locked.callback_payload = data
        locked.gateway_signature = received_signature
        locked.transaction_reference = str(data.get('ReferenceNumber') or data.get('Reference') or transaction_id)[:150]
        locked.status = PaymentOrder.Status.SUCCESS if success else PaymentOrder.Status.FAILED
        if success and locked.paid_at is None:
            locked.paid_at = timezone.now()
        locked.save(update_fields=['callback_payload', 'gateway_signature', 'transaction_reference', 'status', 'paid_at', 'updated_at'])
    return HttpResponse('OK', status=200)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def submit_manual_qr(request):
    order_id = str(request.data.get('order_id', '')).strip()
    reference = str(request.data.get('reference_number') or request.data.get('reference') or '').strip()
    if not order_id or not reference or len(reference) > 150:
        return Response({'error': 'order_id and reference_number are required'}, status=status.HTTP_400_BAD_REQUEST)
    order = PaymentOrder.objects.filter(order_id=order_id, user=request.user).first()
    if not order:
        return Response({'error': 'Order not found'}, status=status.HTTP_404_NOT_FOUND)
    if order.status == PaymentOrder.Status.SUCCESS:
        return Response({'error': 'This order has already been paid'}, status=status.HTTP_409_CONFLICT)
    order.transaction_reference = reference
    order.status = PaymentOrder.Status.PENDING_MANUAL_VERIFICATION
    order.save(update_fields=['transaction_reference', 'status', 'updated_at'])
    return Response({'order_id': order.order_id, 'status': order.status}, status=status.HTTP_202_ACCEPTED)
