import React, { FormEvent, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';

type GatewayState = {
  gateway_url: string;
  payload: Record<string, string>;
};

const CHANNELS = [
  { id: 'esewa', label: 'eSewa', detail: 'Wallet' },
  { id: 'khalti', label: 'Khalti', detail: 'Wallet' },
  { id: 'imepay', label: 'IME Pay', detail: 'Wallet' },
  { id: 'banking', label: 'e-Banking', detail: 'All major Nepalese banks' },
] as const;

const newOrderId = () => {
  if (window.crypto?.randomUUID) return `MUNCH-${window.crypto.randomUUID()}`;
  return `MUNCH-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const PaymentCheckout: React.FC<{ planName?: string }> = ({ planName }) => {
  const [path, setPath] = useState<'gateway' | 'qr'>('gateway');
  const [orderId, setOrderId] = useState(newOrderId);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [channel, setChannel] = useState('esewa');
  const [busy, setBusy] = useState(false);
  const [gateway, setGateway] = useState<GatewayState | null>(null);
  const [qrAvailable, setQrAvailable] = useState(true);
  const gatewayForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!gateway || !gatewayForm.current) return;
    gatewayForm.current.submit();
  }, [gateway]);

  const submitGateway = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setBusy(true);
      const result = await apiClient.initiatePayment(orderId.trim(), amount, channel);
      setGateway(result);
    } catch (error: any) {
      toast.error(error.response?.data?.error ?? 'Could not start payment');
    } finally {
      setBusy(false);
    }
  };

  const submitManual = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setBusy(true);
      await apiClient.submitManualQrPayment(orderId.trim(), reference.trim());
      toast.success('Payment reference submitted for verification');
      setReference('');
    } catch (error: any) {
      toast.error(error.response?.data?.error ?? 'Could not submit payment reference');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-white border border-line rounded-[12px] p-6 mb-8">
      <div className="flex flex-col gap-2 mb-5">
        <h2 className="text-[20px] font-semibold text-head">Payment options</h2>
        <p className="text-[13px] text-body">
          {planName
            ? `Buy ${planName} securely through Nepal Payment Solution OnePG.`
            : 'Choose the automated gateway or pay with the merchant QR and submit your reference.'}
        </p>
      </div>

      <div className="flex gap-2 border-b border-line mb-5" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={path === 'gateway'}
          onClick={() => setPath('gateway')}
          className={`px-3 py-2 text-[13px] border-b-2 ${path === 'gateway' ? 'border-navy-800 text-navy-800 font-medium' : 'border-transparent text-subtle'}`}
        >
          Online Gateway Payment
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={path === 'qr'}
          onClick={() => setPath('qr')}
          className={`px-3 py-2 text-[13px] border-b-2 ${path === 'qr' ? 'border-navy-800 text-navy-800 font-medium' : 'border-transparent text-subtle'}`}
        >
          Scan Static QR
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="flex flex-col gap-3">
          <label className="text-[12px] font-medium text-body">
            Order ID
            <input
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              maxLength={100}
              className="mt-1 w-full border border-line rounded-[8px] px-3 py-2 text-[14px] text-head"
            />
          </label>

          {path === 'gateway' && (
            <div>
              <p className="text-[12px] font-medium text-body mb-2">Payment method</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CHANNELS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={channel === option.id}
                    onClick={() => setChannel(option.id)}
                    className={`rounded-[8px] border px-2 py-2 text-left ${channel === option.id ? 'border-navy-800 bg-[#EEF3FA]' : 'border-line'}`}
                  >
                    <span className="block text-[13px] font-medium text-head">{option.label}</span>
                    <span className="block text-[10px] text-subtle">{option.detail}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-subtle">
                The selected method opens inside the unified NPX-OnePG checkout.
              </p>
            </div>
          )}
          <label className="text-[12px] font-medium text-body">
            Amount (NPR)
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className="mt-1 w-full border border-line rounded-[8px] px-3 py-2 text-[14px] text-head"
            />
          </label>

          {path === 'gateway' ? (
            <>
              <form onSubmit={submitGateway}>
                <button
                  type="submit"
                  disabled={busy || !amount || !orderId.trim()}
                  className="bg-navy-800 hover:bg-navy-700 text-white rounded-[8px] px-4 py-2 text-[13px] font-medium disabled:opacity-50"
                >
                  {busy ? 'Starting…' : 'Continue to Nepal Payment'}
                </button>
              </form>
              {gateway && (
                <form ref={gatewayForm} method="post" action={gateway.gateway_url} className="hidden">
                  {Object.entries(gateway.payload).map(([name, value]) => (
                    <input key={name} type="hidden" name={name} value={value} />
                  ))}
                </form>
              )}
            </>
          ) : (
            <form onSubmit={submitManual} className="flex flex-col gap-3">
              <p className="text-[13px] text-body">
                Scan the merchant QR, pay the exact amount, then enter the wallet or bank transaction reference.
              </p>
              <label className="text-[12px] font-medium text-body">
                Reference number / TXN ID
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  maxLength={150}
                  required
                  className="mt-1 w-full border border-line rounded-[8px] px-3 py-2 text-[14px] text-head"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !reference.trim() || !orderId.trim()}
                className="self-start bg-navy-800 hover:bg-navy-700 text-white rounded-[8px] px-4 py-2 text-[13px] font-medium disabled:opacity-50"
              >
                {busy ? 'Submitting…' : 'Submit for verification'}
              </button>
            </form>
          )}
        </div>

        {path === 'qr' && (
          <div className="border border-line rounded-[10px] p-3 flex flex-col items-center gap-2">
            {qrAvailable ? (
              <img
                src="/merchant-payment-qr.png"
                alt="Addressgraphnepal merchant payment QR code"
                width={180}
                height={180}
                onError={() => setQrAvailable(false)}
                className="w-full max-w-[180px] aspect-square object-contain"
              />
            ) : (
              <p className="text-[12px] text-subtle text-center py-16">
                Merchant QR image is not installed yet.
              </p>
            )}
            <p className="text-[11px] text-subtle text-center">Addressgraphnepal Pvt Ltd</p>
          </div>
        )}
      </div>
    </section>
  );
};
