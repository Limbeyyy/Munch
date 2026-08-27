import React, { useEffect, useState } from 'react';
import { useAnalyticsStore } from '../store/analyticsStore';

export const AnalyticsDashboardPage: React.FC = () => {
  const {
    orgAnalytics,
    loading,
    error,
    fetchOrgAnalytics,
    exportAnalytics,
  } = useAnalyticsStore();

  const [orgId, setOrgId] = useState('');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });

  useEffect(() => {
    if (orgId) {
      fetchOrgAnalytics(orgId, dateRange.from, dateRange.to);
    }
  }, [orgId, dateRange.from, dateRange.to, fetchOrgAnalytics]);

  const handleExport = async (format: 'csv' | 'pdf') => {
    await exportAnalytics(format);
  };

  const StatCard: React.FC<{ label: string; value: string | number }> = ({
    label,
    value,
  }) => (
    <div className="bg-white rounded-lg shadow p-6">
      <p className="text-gray-600 text-sm font-medium">{label}</p>
      <p className="text-3xl font-bold text-gray-900 mt-2">{value}</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Analytics Dashboard</h1>
          <div className="flex gap-2">
            <button
              onClick={() => handleExport('csv')}
              className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
            >
              Export CSV
            </button>
            <button
              onClick={() => handleExport('pdf')}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
            >
              Export PDF
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Organization ID
              </label>
              <input
                type="text"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                placeholder="Enter org ID"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                From Date
              </label>
              <input
                type="date"
                value={dateRange.from}
                onChange={(e) =>
                  setDateRange({ ...dateRange, from: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                To Date
              </label>
              <input
                type="date"
                value={dateRange.to}
                onChange={(e) =>
                  setDateRange({ ...dateRange, to: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        {loading ? (
          <div className="text-center text-gray-600">Loading analytics...</div>
        ) : orgAnalytics ? (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <StatCard label="Total Meetings" value={orgAnalytics.total_meetings} />
              <StatCard label="Total Hours" value={orgAnalytics.total_hours.toFixed(1)} />
              <StatCard label="Total Participants" value={orgAnalytics.total_participants} />
              <StatCard label="Active Users" value={orgAnalytics.active_users} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <StatCard
                label="Storage Used (GB)"
                value={orgAnalytics.storage_used_gb.toFixed(2)}
              />
              <StatCard
                label="Avg Meeting Duration"
                value={`${orgAnalytics.avg_meeting_duration}m`}
              />
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Performance Metrics
              </h2>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-gray-600 text-sm">Meetings This Month</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {orgAnalytics.meetings_this_month}
                  </p>
                </div>
                <div>
                  <p className="text-gray-600 text-sm">Growth Rate</p>
                  <p
                    className={`text-2xl font-bold ${
                      orgAnalytics.growth_rate >= 0
                        ? 'text-green-600'
                        : 'text-red-600'
                    }`}
                  >
                    {orgAnalytics.growth_rate >= 0 ? '+' : ''}
                    {orgAnalytics.growth_rate.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600">
            Enter an organization ID to view analytics
          </div>
        )}
      </div>
    </div>
  );
};
