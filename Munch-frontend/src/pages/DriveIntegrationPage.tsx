import React from 'react';
import { useDriveStore } from '../store/driveStore';

export const DriveIntegrationPage: React.FC = () => {
  const {
    isConnected,
    loading,
    error,
    syncStatus,
    connectDrive,
    disconnectDrive,
    setSyncEnabled,
  } = useDriveStore();

  const handleConnect = async () => {
    await connectDrive();
  };

  const handleDisconnect = async () => {
    if (window.confirm('Disconnect Google Drive?')) {
      await disconnectDrive();
    }
  };

  const handleToggleSync = async (meetingId: string, enabled: boolean) => {
    await setSyncEnabled(meetingId, !enabled);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Google Drive Integration</h1>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Connection Status */}
        <div className="bg-white rounded-lg shadow p-8 mb-8">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                Connection Status
              </h2>
              <p className="text-gray-600">
                {isConnected
                  ? '✓ Connected to Google Drive'
                  : '✗ Not connected to Google Drive'}
              </p>
            </div>
            <button
              onClick={isConnected ? handleDisconnect : handleConnect}
              disabled={loading}
              className={`px-6 py-3 rounded-lg font-medium text-white ${
                isConnected
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              } disabled:opacity-50`}
            >
              {loading ? 'Processing...' : isConnected ? 'Disconnect' : 'Connect'}
            </button>
          </div>
        </div>

        {/* Sync Settings */}
        {isConnected && (
          <div className="bg-white rounded-lg shadow p-8 mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-6">Sync Settings</h2>

            <div className="space-y-6">
              <div className="border-l-4 border-blue-500 pl-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Auto-sync Meeting Artifacts
                </h3>
                <p className="text-gray-600 mb-4">
                  Automatically sync meeting documents, recordings, and transcripts to Google Drive.
                </p>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    defaultChecked={syncStatus?.sync_enabled}
                    onChange={(e) =>
                      syncStatus &&
                      handleToggleSync(syncStatus.meeting_id, !syncStatus.sync_enabled)
                    }
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  <span className="text-gray-700">Enable automatic sync</span>
                </label>
              </div>

              {syncStatus && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600 mb-2">
                    <strong>Folder:</strong> {syncStatus.folder_name || 'Not set'}
                  </p>
                  <p className="text-sm text-gray-600">
                    <strong>Status:</strong>{' '}
                    <span
                      className={`font-medium ${
                        syncStatus.status === 'active' ? 'text-green-600' : 'text-yellow-600'
                      }`}
                    >
                      {syncStatus.status}
                    </span>
                  </p>
                  {syncStatus.last_sync && (
                    <p className="text-sm text-gray-600">
                      <strong>Last sync:</strong>{' '}
                      {new Date(syncStatus.last_sync).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Feature Info */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">
            Why integrate with Google Drive?
          </h3>
          <ul className="space-y-2 text-gray-700">
            <li>✓ Automatically backup all meeting artifacts</li>
            <li>✓ Easy access to documents from any device</li>
            <li>✓ Collaborative editing with team members</li>
            <li>✓ Centralized storage for all meetings</li>
            <li>✓ Version history and recovery options</li>
          </ul>
        </div>
      </div>
    </div>
  );
};
