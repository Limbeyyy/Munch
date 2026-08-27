import React, { useEffect, useState } from 'react';
import { apiClient } from '../services/api';
import toast from 'react-hot-toast';

interface PlatformStats {
  total_meetings: number;
  active_meetings: number;
  total_participants: number;
  meetings_last_30_days: number;
  avg_engagement_score: number;
  platform_health: string;
}

export const AdminDashboard: React.FC = () => {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setIsLoading(true);
      const data = await apiClient.getPlatformStats();
      setStats(data);
    } catch (error: any) {
      toast.error('Failed to load stats: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-gray-800">Admin Dashboard</h1>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-12">
        {isLoading ? (
          <p className="text-gray-600">Loading...</p>
        ) : stats ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Total Meetings */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-gray-600 text-sm font-medium mb-2">Total Meetings</h3>
              <p className="text-3xl font-bold text-gray-800">{stats.total_meetings}</p>
            </div>

            {/* Active Meetings */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-gray-600 text-sm font-medium mb-2">Active Meetings</h3>
              <p className="text-3xl font-bold text-green-600">{stats.active_meetings}</p>
            </div>

            {/* Total Participants */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-gray-600 text-sm font-medium mb-2">Total Participants</h3>
              <p className="text-3xl font-bold text-blue-600">{stats.total_participants}</p>
            </div>

            {/* Last 30 Days */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-gray-600 text-sm font-medium mb-2">Meetings (Last 30 Days)</h3>
              <p className="text-3xl font-bold text-purple-600">{stats.meetings_last_30_days}</p>
            </div>

            {/* Avg Engagement */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-gray-600 text-sm font-medium mb-2">Avg Engagement Score</h3>
              <p className="text-3xl font-bold text-orange-600">{stats.avg_engagement_score.toFixed(1)}/100</p>
            </div>

            {/* Platform Health */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-gray-600 text-sm font-medium mb-2">Platform Health</h3>
              <p className={`text-3xl font-bold ${
                stats.platform_health === 'good' ? 'text-green-600' :
                stats.platform_health === 'fair' ? 'text-yellow-600' :
                'text-red-600'
              }`}>
                {stats.platform_health.charAt(0).toUpperCase() + stats.platform_health.slice(1)}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-gray-600">Failed to load stats</p>
        )}
      </main>
    </div>
  );
};
