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
      {/* Who the bill is for, and which saved method pays it. */}
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
            <div
              className="flex flex-col gap-3"
              role="radiogroup"
              aria-label="Saved payment methods"
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
                    <span className="block text-body whitespace-pre-line">
                      {method.detail}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </Block>
      </div>

      {/* The order itself, filled in from the two above and the plan. */}
      <section className="border border-line rounded-[12px] p-5 flex flex-col gap-5">
        <div>
          <h4 className="text-[16px] font-semibold text-head">Payment options</h4>
          <div className="pt-2 flex items-center gap-4" role="tablist">
            {([
              ['gateway', 'Online Payment'],
              ['qr', 'Scan QR'],
            ] as const).map(([id, label], at) => (
              <React.Fragment key={id}>
                {at > 0 && <span className="text-line" aria-hidden>|</span>}
                <button
                  type="button"
                  role="tab"
                  aria-selected={path === id}
                  onClick={() => setPath(id)}
                  className={`text-[14px] leading-5 ${
                    path === id
                      ? 'text-navy-800 font-medium underline underline-offset-4'
                      : 'text-subtle hover:text-body'
                  }`}
                >
                  {label}
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[12px] font-medium text-body leading-4">Order ID</p>
          <p className="pt-1 font-mono text-[13px] text-head break-all">{orderId}</p>
        </div>

        <div>
          <p className="text-[12px] font-medium text-body leading-4 pb-1.5">
            Billing information
          </p>
          <div className="flex flex-col gap-1.5">
            <Line label="Name">{billing?.name || '—'}</Line>
            <Line label="Email">{billing?.email || '—'}</Line>
            <Line label="Address">{billing?.address || 'Not given'}</Line>
          </div>
        </div>

        <div>
          <p className="text-[12px] font-medium text-body leading-4">Payment method</p>
          <p className="pt-1 text-[14px] text-head leading-5">
            {methodName || (
              <span className="text-subtle">No saved payment method chosen</span>
            )}
          </p>
          <p className="pt-1 text-[12px] text-subtle leading-4">
            Chosen above. Up to {MAX_SAVED_METHODS} saved payments at a time.
          </p>
        </div>

        <div>
          <p className="text-[12px] font-medium text-body leading-4">Amount (NPR)</p>
          <p className="pt-1 text-[18px] font-semibold text-head leading-6 tabular-nums">
            रू {Number(amount || 0).toLocaleString('en-IN')}
          </p>
          {planName && (
            <p className="pt-1 text-[12px] text-subtle leading-4">
              From the {planName} plan.
            </p>
          )}
        </div>

        {path === 'qr' && (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px] items-start">
            <form onSubmit={submitReference} className="flex flex-col gap-2" id="manch-qr">
              <label className="text-[12px] font-medium text-body leading-4">
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
              <p className="text-[12px] text-subtle leading-4">
                Scan the merchant QR, pay the exact amount, then enter the reference
                the wallet or bank gave you.
              </p>
            </form>
            <img
              src="/merchant-payment-qr.png"
              alt="Merchant payment QR code"
              className="w-full max-w-[180px] aspect-square object-contain rounded-[8px]
                border border-line bg-[#F5F7FA]"
            />
          </div>
        )}

        <div className="flex gap-3 pt-1">
          {path === 'gateway' ? (
            <form onSubmit={start}>
              <button
                type="submit"
                disabled={busy || !amount || !chosen}
                className="bg-navy-800 hover:bg-navy-700 text-white rounded-[8px]
                  px-6 py-2 text-[14px] font-medium disabled:opacity-50"
              >
                {busy ? 'Starting…' : 'Continue'}
              </button>
            </form>
          ) : (
            <button
              type="submit"
              form="manch-qr"
              disabled={busy || !reference.trim()}
              className="bg-navy-800 hover:bg-navy-700 text-white rounded-[8px]
                px-6 py-2 text-[14px] font-medium disabled:opacity-50"
            >
              {busy ? 'Submitting…' : 'Continue'}
            </button>
          )}
          <button
            type="button"
            onClick={onBack}
            className="border border-line rounded-[8px] px-6 py-2 text-[14px] text-body
              hover:border-navy-800"
          >
            Back
          </button>
        </div>

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
