"""Taking a payment through Nepal Payment Solution's OnePG gateway.

The shape the gateway requires, and the reason for each step:

    initiate      asks OnePG for a process id and hands the browser a
                  form to post. The token has to exist before the
                  customer leaves, or the gateway refuses the
                  transaction outright.
    notification  OnePG calling us, server to server, to say something
                  happened. It carries no amount and no status, so it
                  is a nudge rather than news.
    response      the customer's own browser coming back, for a
                  receipt. Equally untrustworthy, and for the same
                  reason: anybody can type that URL.

What settles a payment is neither of those. Both only prompt a call to
CheckTransactionStatus, which is the one answer that comes from the
gateway over an authenticated, signed channel. An order is marked paid
on that and on nothing else.
"""
import logging
import uuid
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status as http
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from . import onepg
from .models import PaymentOrder

logger = logging.getLogger(__name__)

#: What OnePG calls a finished payment, in CheckTransactionStatus.
SUCCESS = 'success'
FAILED = 'fail'


def _amount(value):
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError('Amount must be a valid number')
    if parsed <= 0 or parsed.as_tuple().exponent < -2:
        raise ValueError('Amount must be positive with at most two decimal places')
    return parsed.quantize(Decimal('0.01'))


def _settle(order, data: dict) -> bool:
    """Record what the gateway says became of this order.

    Returns whether it had already been settled, so a second
    notification can be answered honestly rather than doing the work
    twice. Taken under a row lock because the customer coming back and
    the gateway's notification arrive at the same moment by design.
    """
    said = str(data.get('Status') or '').strip().lower()

    with transaction.atomic():
        locked = PaymentOrder.objects.select_for_update().get(pk=order.pk)
        already = locked.status == PaymentOrder.Status.SUCCESS

        locked.callback_payload = data
        reference = str(data.get('GatewayReferenceNo') or '')[:150]
        if reference:
            locked.transaction_reference = reference

        if said == SUCCESS:
            locked.status = PaymentOrder.Status.SUCCESS
            if locked.paid_at is None:
                locked.paid_at = timezone.now()
        elif said == FAILED:
            # Only ever downgrade something not already paid. A late
            # "Fail" for an order that succeeded is the gateway talking
            # about a different attempt, and acting on it would unpay a
            # paid order.
            if not already:
                locked.status = PaymentOrder.Status.FAILED
        # Anything else - "Pending", or a status nobody has seen
        # before - leaves it where it was. Guessing is how a payment
        # still in progress gets written off.

        locked.save(update_fields=[
            'callback_payload', 'transaction_reference', 'status',
            'paid_at', 'updated_at',
        ])
    return already


def _refresh(order) -> dict:
    """Ask the gateway what happened, and write it down."""
    data = onepg.status(order.transaction_id)
    _settle(order, data)
    return data


# -- what the browser calls --------------------------------------------

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def instruments(request):
    """The banks and wallets this merchant may send a customer to."""
    try:
        return Response({'instruments': onepg.instruments()})
    except onepg.NotConfigured as e:
        return Response({'error': str(e)}, status=http.HTTP_503_SERVICE_UNAVAILABLE)
    except onepg.OnePGError as e:
        return Response({'error': str(e)}, status=http.HTTP_502_BAD_GATEWAY)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def service_charge(request):
    """What the gateway will add, before the customer commits to it."""
    try:
        amount = _amount(request.data.get('amount'))
    except ValueError as e:
        return Response({'error': str(e)}, status=http.HTTP_400_BAD_REQUEST)

    code = str(request.data.get('instrument_code') or '').strip()
    if not code:
        return Response(
            {'error': 'instrument_code is required to quote a service charge'},
            status=http.HTTP_400_BAD_REQUEST,
        )
    try:
        return Response(onepg.service_charge(amount, code))
    except onepg.NotConfigured as e:
        return Response({'error': str(e)}, status=http.HTTP_503_SERVICE_UNAVAILABLE)
    except onepg.OnePGError as e:
        return Response({'error': str(e)}, status=http.HTTP_502_BAD_GATEWAY)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def initiate(request):
    """Open a payment and hand back the form that starts it."""
    order_id = str(request.data.get('order_id', '')).strip()
    if not order_id or len(order_id) > 100:
        return Response({'error': 'A valid order_id is required'},
                        status=http.HTTP_400_BAD_REQUEST)
    try:
        amount = _amount(request.data.get('amount'))
    except ValueError as e:
        return Response({'error': str(e)}, status=http.HTTP_400_BAD_REQUEST)

    instrument = str(request.data.get('instrument_code') or '').strip()
    remarks = str(request.data.get('remarks') or '')[:200]

    with transaction.atomic():
        order, made = PaymentOrder.objects.get_or_create(
            order_id=order_id,
            defaults={
                'user': request.user,
                'amount': amount,
                'payment_channel': 'onepg',
                # The gateway's own identifier for this payment, and
                # what every later question about it is asked by.
                'transaction_id': f'MNCH-{uuid.uuid4().hex.upper()}',
            },
        )
        if not made:
            if order.user_id != request.user.id:
                return Response({'error': 'Order does not belong to this account'},
                                status=http.HTTP_403_FORBIDDEN)
            if order.status == PaymentOrder.Status.SUCCESS:
                return Response({'error': 'This order has already been paid'},
                                status=http.HTTP_409_CONFLICT)
            if order.amount != amount:
                return Response({'error': 'Order amount cannot be changed'},
                                status=http.HTTP_409_CONFLICT)

    try:
        # A fresh token each time. The gateway ties one to a single
        # attempt, so re-sending an old one after an abandoned payment
        # is refused - and the customer would see the gateway reject a
        # payment they had not yet made.
        token = onepg.process_id(order.amount, order.transaction_id)
        form = onepg.checkout(
            order.amount, order.transaction_id, token,
            instrument_code=instrument, remarks=remarks,
        )
    except onepg.NotConfigured as e:
        return Response({'error': str(e)}, status=http.HTTP_503_SERVICE_UNAVAILABLE)
    except onepg.OnePGError as e:
        logger.warning(f'OnePG refused to open {order.order_id}: {e}')
        return Response({'error': str(e)}, status=http.HTTP_502_BAD_GATEWAY)

    order.process_id = token
    order.instrument_code = instrument
    order.gateway_signature = form['payload']['Signature']
    order.save(update_fields=[
        'process_id', 'instrument_code', 'gateway_signature', 'updated_at',
    ])

    return Response({
        'order_id': order.order_id,
        'transaction_id': order.transaction_id,
        'process_id': token,
        **form,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def order_status(request, order_id):
    """Where a payment has got to, for a page waiting on one.

    Asks the gateway rather than reading the row, because the row is
    only as fresh as the last notification - and a customer watching
    this page is usually waiting for exactly the one that has not
    arrived yet.
    """
    order = PaymentOrder.objects.filter(
        order_id=order_id, user=request.user
    ).first()
    if order is None:
        return Response({'error': 'Order not found'}, status=http.HTTP_404_NOT_FOUND)

    if order.status != PaymentOrder.Status.SUCCESS:
        try:
            _refresh(order)
            order.refresh_from_db()
        except onepg.OnePGError as e:
            # The stored status is still worth returning; it is simply
            # not confirmed just now.
            logger.info(f'Could not refresh {order.order_id}: {e}')

    return Response({
        'order_id': order.order_id,
        'status': order.status,
        'amount': str(order.amount),
        'transaction_id': order.transaction_id,
        'reference': order.transaction_reference,
        'paid_at': order.paid_at.isoformat() if order.paid_at else None,
    })


# -- what OnePG calls --------------------------------------------------

@api_view(['GET', 'POST'])
# The gateway holds no account here and presents no token: it is
# identified by naming a transaction we opened, and believed only
# after CheckTransactionStatus agrees. Without this the JWT
# authenticator would reject the call before the view ever ran.
@authentication_classes([])
@permission_classes([AllowAny])
def notification(request):
    """OnePG saying something happened to a transaction.

    It carries a transaction id and nothing else of substance - no
    amount, no status, no signature - so it is treated as a nudge and
    never as news. What it causes is a CheckTransactionStatus call,
    which is the authenticated, signed answer.

    Replies in plain text, as the integration document requires:
    "received" the first time, "already received" after that, so the
    gateway can stop retrying.
    """
    source = request.query_params if request.method == 'GET' else request.data
    merchant_txn_id = str(source.get('MerchantTxnId') or '').strip()
    if not merchant_txn_id:
        return HttpResponse('MerchantTxnId is required', status=400,
                            content_type='text/plain')

    order = PaymentOrder.objects.filter(transaction_id=merchant_txn_id).first()
    if order is None:
        # Said plainly rather than with a 404 page: the gateway reads
        # this body, and an HTML error would be retried forever.
        logger.warning(f'OnePG notified about an unknown transaction {merchant_txn_id}')
        return HttpResponse('unknown transaction', status=404,
                            content_type='text/plain')

    try:
        data = onepg.status(order.transaction_id)
    except onepg.OnePGError as e:
        # Not acknowledged, so the gateway tries again. Answering
        # "received" here would lose the payment quietly.
        logger.warning(f'Could not confirm {order.order_id} with OnePG: {e}')
        return HttpResponse('could not confirm', status=503,
                            content_type='text/plain')

    already = _settle(order, data)
    return HttpResponse(
        'already received' if already else 'received',
        status=200, content_type='text/plain',
    )


@api_view(['GET', 'POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def payment_response(request):
    """The customer coming back from the gateway, for a receipt.

    Proves nothing - anybody may open this URL with any transaction id
    on it - so it confirms with the gateway exactly as the notification
    does, and shows only what that answered.
    """
    source = request.query_params if request.method == 'GET' else request.data
    merchant_txn_id = str(source.get('MerchantTxnId') or '').strip()
    order = PaymentOrder.objects.filter(transaction_id=merchant_txn_id).first()
    if order is None:
        return Response({'error': 'Unknown transaction'}, status=http.HTTP_404_NOT_FOUND)

    try:
        _refresh(order)
        order.refresh_from_db()
    except onepg.OnePGError as e:
        logger.info(f'Could not confirm {order.order_id} on return: {e}')

    return Response({
        'order_id': order.order_id,
        'status': order.status,
        'amount': str(order.amount),
        'reference': order.transaction_reference,
        'paid_at': order.paid_at.isoformat() if order.paid_at else None,
    })


# -- unchanged ---------------------------------------------------------

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def submit_manual_qr(request):
    order_id = str(request.data.get('order_id', '')).strip()
    reference = str(
        request.data.get('reference_number') or request.data.get('reference') or ''
    ).strip()
    if not order_id or not reference or len(reference) > 150:
        return Response({'error': 'order_id and reference_number are required'},
                        status=http.HTTP_400_BAD_REQUEST)
    order = PaymentOrder.objects.filter(order_id=order_id, user=request.user).first()
    if not order:
        return Response({'error': 'Order not found'}, status=http.HTTP_404_NOT_FOUND)
    if order.status == PaymentOrder.Status.SUCCESS:
        return Response({'error': 'This order has already been paid'},
                        status=http.HTTP_409_CONFLICT)
    order.transaction_reference = reference
    order.status = PaymentOrder.Status.PENDING_MANUAL_VERIFICATION
    order.save(update_fields=['transaction_reference', 'status', 'updated_at'])
    return Response({'order_id': order.order_id, 'status': order.status},
                    status=http.HTTP_202_ACCEPTED)
