import React from 'react';

export interface InvoiceLine {
  description: string;
  /** What one of them costs, already formatted. */
  rate: string;
  quantity: number;
  amount: number;
}

export interface InvoiceDetails {
  number: string;
  issuedAt: string;
  billedTo: { name: string; email: string; phone?: string; address?: string };
  lines: InvoiceLine[];
  /** Per cent. Nothing charges tax yet, so it is nought and says so. */
  taxRate: number;
  paidWith: string;
  orderId: string;
  seller: { name: string; email: string; address?: string };
}

const rupees = (n: number) => `रू ${n.toLocaleString('en-IN')}`;

const Rule = () => <div className="h-px bg-[#c9c4b0]" aria-hidden />;

/**
 * The bill for a payment that went through.
 *
 * A receipt is a record, so it is laid out to be read on paper as well as
 * on a screen: one column, generous rules, and nothing that depends on a
 * colour surviving a printer. `print:` keeps it off the page furniture
 * around it when it is actually printed.
 */
export const Invoice: React.FC<{ details: InvoiceDetails }> = ({ details }) => {
  const subtotal = details.lines.reduce((sum, line) => sum + line.amount, 0);
  const tax = Math.round((subtotal * details.taxRate) / 100);

  return (
    <article
      data-invoice
      className="bg-[#fbf9ef] text-[#111111] px-8 py-10 sm:px-12 rounded-[8px]
        print:rounded-none print:px-0"
    >
      <header className="flex items-start justify-between gap-6">
        <h1 className="text-[48px] sm:text-[64px] font-bold leading-[0.9] tracking-[-0.02em]">
          Invoice
        </h1>
        <div className="text-right text-[12px] leading-5 pt-2">
          <p>{new Date(details.issuedAt).toLocaleDateString(undefined, {
            day: 'numeric', month: 'long', year: 'numeric',
          })}</p>
          <p className="font-bold">Invoice No. {details.number}</p>
        </div>
      </header>

      <div className="pt-8"><Rule /></div>

      <section className="py-4 text-[12px] leading-5">
        <p className="font-bold">Billed to:</p>
        <p>{details.billedTo.name}</p>
        {details.billedTo.phone && <p>{details.billedTo.phone}</p>}
        <p>{details.billedTo.email}</p>
        {details.billedTo.address && <p>{details.billedTo.address}</p>}
      </section>

      <Rule />

      <table className="w-full text-[12px] leading-5 border-collapse">
        <thead>
          <tr className="text-left">
            <th className="font-bold py-3">Description</th>
            <th className="font-bold py-3 text-right w-[90px]">Rate</th>
            <th className="font-bold py-3 text-right w-[70px]">Qty</th>
            <th className="font-bold py-3 text-right w-[110px]">Amount</th>
          </tr>
        </thead>
        <tbody>
          {details.lines.map((line) => (
            <tr key={line.description} className="border-t border-[#dedad0]">
              <td className="py-3">{line.description}</td>
              <td className="py-3 text-right tabular-nums">{line.rate}</td>
              <td className="py-3 text-right tabular-nums">{line.quantity}</td>
              <td className="py-3 text-right tabular-nums">{rupees(line.amount)}</td>
            </tr>
          ))}
          <tr className="border-t border-[#dedad0]">
            <td colSpan={2} />
            <td className="py-2 text-right font-bold">Subtotal</td>
            <td className="py-2 text-right tabular-nums">{rupees(subtotal)}</td>
          </tr>
          <tr>
            <td colSpan={2} />
            <td className="py-2 text-right font-bold">Tax ({details.taxRate}%)</td>
            <td className="py-2 text-right tabular-nums">{rupees(tax)}</td>
          </tr>
          <tr>
            <td colSpan={2} />
            <td className="py-2 text-right font-bold">Total</td>
            <td className="py-2 text-right font-bold tabular-nums">
              {rupees(subtotal + tax)}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="pt-10"><Rule /></div>

      <footer className="pt-4 grid gap-6 sm:grid-cols-2 text-[12px] leading-5">
        <div>
          <p className="font-bold pb-1">Payment Information</p>
          <p>{details.paidWith}</p>
          <p className="font-mono text-[11px] break-all">Order {details.orderId}</p>
        </div>
        <div>
          <p className="font-bold pb-1">{details.seller.name}</p>
          <p>{details.seller.email}</p>
          {details.seller.address && <p>{details.seller.address}</p>}
        </div>
      </footer>
    </article>
  );
};
