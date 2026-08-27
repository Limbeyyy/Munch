import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useArtifactStore } from '../store/artifactStore';

export const ArtifactsPage: React.FC = () => {
  const { meetingId } = useParams<{ meetingId: string }>();
  const {
    artifacts,
    loading,
    error,
    fetchArtifacts,
    deleteArtifact,
    downloadArtifact,
  } = useArtifactStore();

  useEffect(() => {
    if (meetingId) {
      fetchArtifacts(meetingId);
    }
  }, [meetingId, fetchArtifacts]);

  const handleDownload = async (artifactId: string) => {
    try {
      await downloadArtifact(artifactId);
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  const handleDelete = async (artifactId: string) => {
    if (window.confirm('Delete this artifact?')) {
      try {
        await deleteArtifact(artifactId);
      } catch (error) {
        console.error('Delete failed:', error);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Meeting Artifacts</h1>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center text-gray-600">Loading artifacts...</div>
        ) : artifacts.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600">
            No artifacts generated yet for this meeting.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {artifacts.map((artifact) => (
              <div
                key={artifact.id}
                className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {artifact.display_name}
                    </h3>
                    <p className="text-sm text-gray-500">
                      Type: {artifact.artifact_type}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      artifact.sync_status === 'synced'
                        ? 'bg-green-100 text-green-800'
                        : artifact.sync_status === 'syncing'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {artifact.sync_status}
                  </span>
                </div>

                <p className="text-xs text-gray-500 mb-4">
                  Created: {new Date(artifact.created_at).toLocaleDateString()}
                </p>

                <div className="flex gap-2">
                  {artifact.web_view_link && (
                    <a
                      href={artifact.web_view_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 bg-blue-600 text-white text-center px-3 py-2 rounded hover:bg-blue-700 text-sm"
                    >
                      View
                    </a>
                  )}
                  <button
                    onClick={() => handleDownload(artifact.id)}
                    className="flex-1 bg-gray-600 text-white px-3 py-2 rounded hover:bg-gray-700 text-sm"
                  >
                    Download
                  </button>
                  <button
                    onClick={() => handleDelete(artifact.id)}
                    className="flex-1 bg-red-600 text-white px-3 py-2 rounded hover:bg-red-700 text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
