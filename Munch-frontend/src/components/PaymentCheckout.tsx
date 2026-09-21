import React, { FormEvent, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';

type GatewayState = {
  gateway_url: string;
  payload: Record<string, string>;
};

const newOrderId = () => {
  if (window.crypto?.randomUUID) return `MUNCH-${window.crypto.randomUUID()}`;
  return `MUNCH-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const PaymentCheckout: React.FC<{
  planName?: string;
  initialAmount?: string;
  billing?: { name: string; email: string; address: string };
  savedMethods?: Array<{ id: string; kind: 'wallet' | 'bank'; label: string; detail: string }>;
  onSuccess?: (details: { orderId: string; amount: string; method: string }) => void;
}> = ({ planName, initialAmount = '', billing, savedMethods = [], onSuccess }) => {
  const [path, setPath] = useState<'gateway' | 'qr'>('gateway');
  const [orderId] = useState(newOrderId);
  const [amount] = useState(initialAmount);
  const [reference, setReference] = useState('');
  const [channel, setChannel] = useState('esewa');
  const [selectedMethod, setSelectedMethod] = useState(savedMethods[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [gateway, setGateway] = useState<GatewayState | null>(null);
  const gatewayForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!savedMethods.length) return;

    const selected = savedMethods.find((method) => method.id === selectedMethod) ?? savedMethods[0];
    const nextChannel = selected.kind === 'wallet'
      ? selected.label.toLowerCase().includes('khalti') ? 'khalti' : selected.label.toLowerCase().includes('ime') ? 'imepay' : 'esewa'
      : 'banking';

    setChannel(nextChannel);
  }, [savedMethods, selectedMethod]);

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
      const chosenMethod = savedMethods.find((method) => method.id === selectedMethod) ?? savedMethods[0];
      const invoiceMethod = chosenMethod ? `${chosenMethod.kind === 'wallet' ? 'Wallet' : 'Bank'} ${chosenMethod.label}` : 'Static QR';
      toast.success('Payment reference submitted for verification');
      onSuccess?.({ orderId: orderId.trim(), amount, method: invoiceMethod });
      setReference('');
    } catch (error: any) {
      toast.error(error.response?.data?.error ?? 'Could not submit payment reference');
    } finally {
      setBusy(false);
    }
  };

  const chosenMethod = savedMethods.find((method) => method.id === selectedMethod) ?? savedMethods[0];

  return (
    <section className="bg-white border border-line rounded-[12px] p-6 mb-8">
      <div className="flex flex-col gap-2 mb-5">
        <h2 className="text-[20px] font-semibold text-head">Payment options</h2>
        <p className="text-[13px] text-body">
          {planName
            ? `Choose the Payment Type for ${planName} Plan to complete the purchase.`
            : 'Choose the payment path you want to complete the purchase.'}
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
          Pay Online
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={path === 'qr'}
          onClick={() => setPath('qr')}
          className={`px-3 py-2 text-[13px] border-b-2 ${path === 'qr' ? 'border-navy-800 text-navy-800 font-medium' : 'border-transparent text-subtle'}`}
        >
          Pay via QR
        </button>
      </div>

      {path === 'gateway' ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="flex flex-col gap-3">
            <div className="border border-line rounded-[10px] p-4">
              <label className="block text-[12px] font-medium text-body">
                Order ID
                <input
                  value={orderId}
                  readOnly
                  className="mt-1 w-full border border-line rounded-[8px] px-3 py-2 text-[13px] text-head bg-[#F9FAFB]"
                />
              </label>

              <div className="mt-4 space-y-3">
                <label className="block text-[12px] font-medium text-body">
                  Name
                  <input
                    value={billing?.name || ''}
                    readOnly
                    className="mt-1 w-full border border-line rounded-[8px] px-3 py-2 text-[13px] text-head bg-[#F9FAFB]"
                  />
                </label>
                <label className="block text-[12px] font-medium text-body">
                  Email
                  <input
                    value={billing?.email || ''}
                    readOnly
                    className="mt-1 w-full border border-line rounded-[8px] px-3 py-2 text-[13px] text-head bg-[#F9FAFB]"
                  />
                </label>
                <label className="block text-[12px] font-medium text-body">
                  Address
                  <input
                    value={billing?.address || 'Not provided'}
                    readOnly
                    className="mt-1 w-full border border-line rounded-[8px] px-3 py-2 text-[13px] text-head bg-[#F9FAFB]"
                  />
                </label>
              </div>
            </div>

            <div className="border border-line rounded-[10px] p-4">
              <p className="text-[12px] font-medium text-body mb-2">Payment method</p>
              <div className="flex flex-col gap-2">
                {savedMethods.length > 0 ? savedMethods.map((method) => (
                  <label key={method.id} className="flex items-start gap-2 text-[13px] text-body">
                    <input type="radio" name="saved-payment-method" checked={selectedMethod === method.id} onChange={() => setSelectedMethod(method.id)} className="mt-1" />
                    <span>
                      <span className="font-medium text-head"> {method.label}</span><br />
                      {method.detail}
                    </span>
                  </label>
                )) : (
                  <span className="text-[13px] text-subtle">No saved payments yet.</span>
                )}
              </div>
            </div>

            <div className="border border-line rounded-[10px] p-4">
              <p className="text-[12px] font-medium text-body">Amount (NPR)</p>
              <p className="mt-1 text-[16px] font-semibold text-head">रू {Number(amount || 0).toLocaleString('en-IN')}</p>
            </div>

            <form onSubmit={submitGateway}>
              <button
                type="submit"
                disabled={busy || !amount || !orderId.trim() || !chosenMethod}
                className="bg-navy-800 hover:bg-navy-700 text-white rounded-[8px] px-4 py-2 text-[13px] font-medium disabled:opacity-50"
              >
                {busy ? 'Starting…' : 'Continue to Payment'}
              </button>
            </form>

            {gateway && (
              <form ref={gatewayForm} method="post" action={gateway.gateway_url} className="hidden">
                {Object.entries(gateway.payload).map(([name, value]) => (
                  <input key={name} type="hidden" name={name} value={value} />
                ))}
              </form>
            )}
          </div>

        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="flex flex-col gap-3">
            <form onSubmit={submitManual} className="flex flex-col gap-3 border border-line rounded-[10px] p-4">
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
          </div>

          <div className="border border-line rounded-[10px] p-3 flex flex-col items-center gap-2">
            <img
              src="/merchant-payment-qr.png"
              alt="Merchant payment QR code"
              className="w-full max-w-[180px] aspect-square object-contain rounded-[8px] border border-line bg-[#F5F7FA]"
            />
            <p className="text-[11px] text-subtle text-center">Scan to Pay Manch Plans</p>
          </div>
        </div>
      )}
    </section>
  );
};
