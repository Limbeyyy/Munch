import React, { FormEvent, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api';

type GatewayState = {
  gateway_url: string;
  payload: Record<string, string>;
};

export interface SavedMethod {
  id: string;
  kind: 'wallet' | 'bank';
  /** "Wallet eSewa", "Bank Global IME Bank". */
  label: string;
  /** The name and the number under it. */
  detail: string;
}

/**
 * How many payment methods an account may keep.
 *
 * Two, which is what the sketch says: one wallet and one bank is the
 * whole of how anybody here pays, and a list that grows is a list
 * somebody picks the wrong row from.
 */
export const MAX_SAVED_METHODS = 2;

const newOrderId = () => {
  if (window.crypto?.randomUUID) return `MUNCH-${window.crypto.randomUUID()}`;
  return `MUNCH-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

/** Which gateway channel a saved method pays through. */
const channelFor = (method?: SavedMethod) => {
  if (!method) return 'esewa';
  if (method.kind === 'bank') return 'banking';
  const name = method.label.toLowerCase();
  if (name.includes('khalti')) return 'khalti';
  if (name.includes('ime')) return 'imepay';
  return 'esewa';
};

/** One labelled fact, stated rather than asked for. */
const Line: React.FC<{ label: string; children: React.ReactNode }> = ({
  label, children,
}) => (
  <div className="flex items-start gap-3 text-[13px] leading-5">
    <span className="w-[68px] flex-none text-subtle">{label}</span>
    <span className="min-w-0 text-head break-words">{children}</span>
  </div>
);

/** A value that was written elsewhere, shown in the box it belongs in. */
const ReadOnlyField: React.FC<{
  label: string;
  value: string;
  mono?: boolean;
}> = ({ label, value, mono }) => (
  <label className="block text-[12px] font-medium text-body">
    {label}
    <input
      value={value}
      readOnly
      className={`mt-1 w-full border border-line rounded-[8px] px-3 py-2 text-[13px]
        text-head bg-[#F9FAFB] ${mono ? 'font-mono' : ''}`}
    />
  </label>
);

/** The mark beside a saved method, so a wallet reads as one at a glance. */
const MethodIcon: React.FC<{ kind: SavedMethod['kind'] }> = ({ kind }) => (
  <span
    aria-hidden
    className="w-8 h-8 rounded-[8px] bg-[#EEF3FA] text-navy-800 grid place-items-center
      flex-none"
  >
    <svg
      width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    >
      {kind === 'wallet'
        ? <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 9h18M16 14h3" /></>
        : <path d="M3 10h18M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18M2 10l10-7 10 7" />}
    </svg>
  </span>
);

const Block: React.FC<{ title: string; children: React.ReactNode }> = ({
  title, children,
}) => (
  <section className="border border-line rounded-[12px] p-4">
    <h4 className="text-[14px] font-semibold text-head pb-3">{title}</h4>
    {children}
  </section>
);

/**
 * Paying for a plan.
 *
 * One dialog, read top to bottom: who the bill is for, which saved method
 * pays it, and then the order itself with everything already filled in
 * from the two above. Nothing on the lower half is typed twice - the
 * method and the amount are chosen up there and on the plan, and shown
 * here so what is about to happen can be read before it does.
 */
export const PaymentCheckout: React.FC<{
  planName?: string;
  initialAmount?: string;
  billing?: { name: string; email: string; address: string };
  savedMethods?: SavedMethod[];
  onBack?: () => void;
  onSuccess?: (details: { orderId: string; amount: string; method: string }) => void;
}> = ({ planName, initialAmount = '', billing, savedMethods = [], onBack, onSuccess }) => {
  const [path, setPath] = useState<'gateway' | 'qr'>('gateway');
  const [orderId] = useState(newOrderId);
  const [amount] = useState(initialAmount);
  const [reference, setReference] = useState('');
  const [selectedMethod, setSelectedMethod] = useState(savedMethods[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [gateway, setGateway] = useState<GatewayState | null>(null);
  const gatewayForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!gateway || !gatewayForm.current) return;
    gatewayForm.current.submit();
  }, [gateway]);

  const chosen = savedMethods.find((m) => m.id === selectedMethod) ?? savedMethods[0];
  const channel = channelFor(chosen);
  const methodName = chosen ? `${chosen.label} · ${chosen.detail}` : '';

  const start = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setBusy(true);
      setGateway(await apiClient.initiatePayment(orderId, amount, channel));
    } catch (error: any) {
      toast.error(error.response?.data?.error ?? error.message ?? 'Could not start payment');
    } finally {
      setBusy(false);
    }
  };

  const submitReference = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setBusy(true);
      await apiClient.submitManualQrPayment(orderId, reference.trim());
      toast.success('Payment reference submitted for verification');
      onSuccess?.({ orderId, amount, method: methodName || 'Static QR' });
      setReference('');
    } catch (error: any) {
      toast.error(
        error.response?.data?.error ?? error.message ?? 'Could not submit the reference'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Who the bill is for, and what is saved to pay it with. */}
      <div className="grid gap-4 md:grid-cols-2">
        <Block title="Billing information">
          <div className="flex flex-col gap-1.5">
            <Line label="Name">{billing?.name || '—'}</Line>
            <Line label="Email">{billing?.email || '—'}</Line>
            <Line label="Address">{billing?.address || 'Not given'}</Line>
          </div>
        </Block>

        <Block title="Saved payment methods">
          {savedMethods.length === 0 ? (
            <p className="text-[13px] text-subtle leading-5">
              Nothing saved yet. Add a wallet or a bank account first.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {savedMethods.slice(0, MAX_SAVED_METHODS).map((method) => (
                <li key={method.id} className="flex items-start gap-2.5">
                  <MethodIcon kind={method.kind} />
                  <span className="min-w-0 text-[13px] leading-5">
                    <span className="block font-medium text-head">{method.label}</span>
                    <span className="block text-body whitespace-pre-line">
                      {method.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>

      {/* The order, on whichever of the two paths is chosen. */}
      <section className="border border-line rounded-[12px] p-5">
        <h4 className="text-[16px] font-semibold text-head">Payment options</h4>
        <p className="pt-1 text-[13px] text-body leading-5">
          {planName
            ? `Choose the Payment Type for ${planName} Plan to complete the purchase.`
            : 'Choose the payment path you want to complete the purchase.'}
        </p>

        <div className="mt-4 flex gap-2 border-b border-line" role="tablist">
          {([
            ['gateway', 'Pay Online'],
            ['qr', 'Pay via QR'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={path === id}
              onClick={() => setPath(id)}
              className={`px-3 py-2 text-[13px] border-b-2 -mb-px ${
                path === id
                  ? 'border-navy-800 text-navy-800 font-medium'
                  : 'border-transparent text-subtle hover:text-body'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {path === 'gateway' ? (
          <div className="pt-5 flex flex-col gap-3">
            {/* Stated back in the boxes they were typed into elsewhere, so
                what is about to be charged can be read before it is. */}
            <div className="border border-line rounded-[10px] p-4 flex flex-col gap-3">
              <ReadOnlyField label="Order ID" value={orderId} mono />
              <ReadOnlyField label="Name" value={billing?.name || ''} />
              <ReadOnlyField label="Email" value={billing?.email || ''} />
              <ReadOnlyField label="Address" value={billing?.address || 'Not given'} />
            </div>

            <div className="border border-line rounded-[10px] p-4">
              <p className="text-[12px] font-medium text-body pb-2">Payment method</p>
              {savedMethods.length === 0 ? (
                <p className="text-[13px] text-subtle">No saved payments yet.</p>
              ) : (
                <div
                  className="flex flex-col gap-2.5"
                  role="radiogroup"
                  aria-label="Payment method"
                >
                  {savedMethods.slice(0, MAX_SAVED_METHODS).map((method) => (
                    <label
                      key={method.id}
                      className="flex items-start gap-2.5 text-[13px] leading-5 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="saved-payment-method"
                        className="mt-1 accent-navy-800"
                        checked={chosen?.id === method.id}
                        onChange={() => setSelectedMethod(method.id)}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-head">{method.label}</span>
                        <span className="block text-subtle whitespace-pre-line">
                          {method.detail}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <p className="pt-2 text-[12px] text-subtle leading-4">
                Up to {MAX_SAVED_METHODS} saved payments at a time.
              </p>
            </div>

            <div className="border border-line rounded-[10px] p-4">
              <p className="text-[12px] font-medium text-body">Amount (NPR)</p>
              <p className="mt-1 text-[16px] font-semibold text-head tabular-nums">
                रू {Number(amount || 0).toLocaleString('en-IN')}
              </p>
            </div>

            <form onSubmit={start} className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={busy || !amount || !chosen}
                className="bg-navy-800 hover:bg-navy-700 text-white rounded-[8px]
                  px-4 py-2 text-[13px] font-medium disabled:opacity-50"
              >
                {busy ? 'Starting…' : 'Continue to Payment'}
              </button>
              <button
                type="button"
                onClick={onBack}
                className="border border-line rounded-[8px] px-4 py-2 text-[13px]
                  text-body hover:border-navy-800"
              >
                Back
              </button>
            </form>
          </div>
        ) : (
          <div className="pt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_200px] items-start">
            <form
              onSubmit={submitReference}
              className="flex flex-col gap-3 border border-line rounded-[10px] p-4"
            >
              <p className="text-[13px] text-body leading-5">
                Scan the merchant QR, pay the exact amount, then enter the wallet or
                bank transaction reference.
              </p>
              <label className="text-[12px] font-medium text-body">
                Reference number / TXN ID
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  maxLength={150}
                  required
                  className="mt-1 w-full border border-line rounded-[8px] px-3 py-2
                    text-[14px] text-head"
                />
              </label>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={busy || !reference.trim()}
                  className="bg-navy-800 hover:bg-navy-700 text-white rounded-[8px]
                    px-4 py-2 text-[13px] font-medium disabled:opacity-50"
                >
                  {busy ? 'Submitting…' : 'Submit for verification'}
                </button>
                <button
                  type="button"
                  onClick={onBack}
                  className="border border-line rounded-[8px] px-4 py-2 text-[13px]
                    text-body hover:border-navy-800"
                >
                  Back
                </button>
              </div>
            </form>

            <div className="border border-line rounded-[10px] p-3 flex flex-col
              items-center gap-2">
              <img
                src="/merchant-payment-qr.png"
                alt="Merchant payment QR code"
                className="w-full max-w-[180px] aspect-square object-contain rounded-[8px]
                  border border-line bg-[#F5F7FA]"
              />
              <p className="text-[11px] text-subtle text-center">
                Scan to Pay Manch Plans
              </p>
            </div>
          </div>
        )}

        {gateway && (
          <form ref={gatewayForm} method="post" action={gateway.gateway_url} className="hidden">
            {Object.entries(gateway.payload).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
          </form>
        )}
      </section>
    </div>
  );
};
