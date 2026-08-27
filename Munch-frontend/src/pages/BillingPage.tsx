import React, { useEffect, useState } from 'react';
import { useBillingStore } from '../store/billingStore';

export const BillingPage: React.FC = () => {
  const {
    invoices,
    paymentMethods,
    loading,
    error,
    fetchInvoices,
    fetchPaymentMethods,
    downloadInvoice,
    updateSubscription,
    cancelSubscription,
  } = useBillingStore();

  const [orgId, setOrgId] = useState('');
  const [selectedTier, setSelectedTier] = useState('pro');

  useEffect(() => {
    if (orgId) {
      fetchInvoices(orgId);
      fetchPaymentMethods(orgId);
    }
  }, [orgId, fetchInvoices, fetchPaymentMethods]);

  const handleUpgrade = async () => {
    if (orgId) {
      await updateSubscription(orgId, selectedTier);
    }
  };

  const handleCancel = async () => {
    if (orgId && window.confirm('Cancel subscription?')) {
      await cancelSubscription(orgId);
    }
  };

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Billing & Subscription</h1>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Organization Selector */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Organization
          </label>
          <input
            type="text"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            placeholder="Enter organization ID"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {orgId && (
          <>
            {/* Subscription Plans */}
            <div className="bg-white rounded-lg shadow p-8 mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-6">
                Subscription Plans
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {['free', 'pro', 'enterprise'].map((tier) => (
                  <div
                    key={tier}
                    className={`border rounded-lg p-6 ${
                      selectedTier === tier
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-300'
                    }`}
                  >
                    <h3 className="text-xl font-semibold text-gray-900 mb-2 capitalize">
                      {tier} Plan
                    </h3>
                    <p className="text-3xl font-bold text-gray-900 mb-4">
                      {tier === 'free'
                        ? '$0'
                        : tier === 'pro'
                        ? '$99'
                        : 'Custom'}
                      {tier !== 'free' && <span className="text-lg">/mo</span>}
                    </p>
                    <ul className="space-y-2 text-gray-600 mb-6">
                      <li>✓ Up to {tier === 'free' ? '10' : tier === 'pro' ? '100' : 'Unlimited'} meetings/month</li>
                      <li>✓ {tier === 'free' ? '1GB' : tier === 'pro' ? '100GB' : 'Unlimited'} storage</li>
                      <li>✓ {tier === 'enterprise' ? 'Priority' : 'Standard'} support</li>
                      {tier !== 'free' && <li>✓ Advanced analytics</li>}
                      {tier === 'enterprise' && <li>✓ Custom integrations</li>}
                    </ul>
                    <button
                      onClick={() => setSelectedTier(tier)}
                      className={`w-full px-4 py-2 rounded-lg font-medium ${
                        selectedTier === tier
                          ? 'bg-blue-600 text-white'
                          : 'border border-gray-300 text-gray-900'
                      }`}
                    >
                      {selectedTier === tier ? 'Current' : 'Select'}
                    </button>
                  </div>
                ))}
              </div>
              {selectedTier !== 'free' && (
                <div className="mt-6 flex gap-2">
                  <button
                    onClick={handleUpgrade}
                    disabled={loading}
                    className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {loading ? 'Updating...' : 'Upgrade Plan'}
                  </button>
                  <button
                    onClick={handleCancel}
                    className="border border-red-300 text-red-600 px-6 py-2 rounded-lg hover:bg-red-50"
                  >
                    Cancel Subscription
                  </button>
                </div>
              )}
            </div>

            {/* Payment Methods */}
            {paymentMethods.length > 0 && (
              <div className="bg-white rounded-lg shadow p-8 mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-6">
                  Payment Methods
                </h2>
                <div className="space-y-4">
                  {paymentMethods.map((method) => (
                    <div
                      key={method.id}
                      className="border border-gray-300 rounded-lg p-4 flex justify-between items-center"
                    >
                      <div>
                        <p className="font-medium text-gray-900">
                          {method.type === 'card' ? '💳' : '🏦'} ••••{method.last_four}
                        </p>
                        {method.expires_at && (
                          <p className="text-sm text-gray-600">
                            Expires: {new Date(method.expires_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      {method.is_default && (
                        <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-medium">
                          Default
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Invoices */}
            {invoices.length > 0 && (
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="p-8 border-b">
                  <h2 className="text-2xl font-semibold text-gray-900">Invoices</h2>
                </div>
                <table className="min-w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">
                        Date
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">
                        Amount
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => (
                      <tr key={invoice.id} className="border-t">
                        <td className="px-6 py-4">
                          {new Date(invoice.issue_date).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 font-medium">
                          {formatCurrency(invoice.amount_cents)}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-medium ${
                              invoice.status === 'paid'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}
                          >
                            {invoice.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => downloadInvoice(invoice.id)}
                            className="text-blue-600 hover:underline"
                          >
                            Download
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
