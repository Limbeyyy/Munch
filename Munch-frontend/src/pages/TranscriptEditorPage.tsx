import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranscriptionStore } from '../store/transcriptionStore';

export const TranscriptEditorPage: React.FC = () => {
  const { meetingId } = useParams<{ meetingId: string }>();
  const {
    summary,
    segments,
    loading,
    error,
    editMode,
    setEditMode,
    fetchTranscript,
    fetchSummary,
    editSegment,
    exportTranscript,
  } = useTranscriptionStore();

  const [editingSegmentId, setEditingSegmentId] = useState<number | null>(null);
  const [editedText, setEditedText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);

  useEffect(() => {
    if (meetingId) {
      fetchTranscript(meetingId);
      fetchSummary(meetingId);
    }
  }, [meetingId, fetchTranscript, fetchSummary]);

  const handleEditClick = (index: number, text: string) => {
    setEditingSegmentId(index);
    setEditedText(text);
  };

  const handleSaveEdit = async () => {
    if (editingSegmentId !== null) {
      await editSegment(editingSegmentId, editedText);
      setEditingSegmentId(null);
      setEditedText('');
    }
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.trim()) {
      const results = segments
        .map((seg, idx) =>
          seg.text.toLowerCase().includes(query.toLowerCase()) ? idx : -1
        )
        .filter((idx) => idx !== -1);
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  };

  const handleExport = async (format: 'pdf' | 'docx' | 'txt') => {
    await exportTranscript(format);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Transcript Editor</h1>
          <div className="flex gap-2">
            <button
              onClick={() => setEditMode(!editMode)}
              className={`px-4 py-2 rounded-lg font-medium ${
                editMode
                  ? 'bg-red-600 text-white'
                  : 'bg-blue-600 text-white'
              }`}
            >
              {editMode ? 'Exit Edit Mode' : 'Enable Edit Mode'}
            </button>
            <select
              onChange={(e) =>
                handleExport(e.target.value as 'pdf' | 'docx' | 'txt')
              }
              className="px-4 py-2 border border-gray-300 rounded-lg"
              defaultValue=""
            >
              <option value="">Export As...</option>
              <option value="pdf">PDF</option>
              <option value="docx">DOCX</option>
              <option value="txt">TXT</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Summary Section */}
        {summary && (
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Summary</h2>
            <p className="text-gray-700 mb-4">{summary.summary_text}</p>

            {summary.key_points.length > 0 && (
              <div className="mb-4">
                <h3 className="font-semibold text-gray-900 mb-2">Key Points:</h3>
                <ul className="list-disc list-inside space-y-1">
                  {summary.key_points.map((point, idx) => (
                    <li key={idx} className="text-gray-700">{point}</li>
                  ))}
                </ul>
              </div>
            )}

            {summary.action_items.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Action Items:</h3>
                <ul className="list-disc list-inside space-y-1">
                  {summary.action_items.map((item, idx) => (
                    <li key={idx} className="text-gray-700">{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Search Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <input
            type="text"
            placeholder="Search transcript..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {searchResults.length > 0 && (
            <p className="text-sm text-gray-600 mt-2">
              Found {searchResults.length} matches
            </p>
          )}
        </div>

        {/* Transcript Section */}
        {loading ? (
          <div className="text-center text-gray-600">Loading transcript...</div>
        ) : segments.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600">
            No transcript available yet.
          </div>
        ) : (
          <div className="space-y-4">
            {segments.map((segment, idx) => (
              <div
                key={idx}
                className={`bg-white rounded-lg shadow p-6 ${
                  searchResults.includes(idx) ? 'ring-2 ring-yellow-400' : ''
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {segment.speaker_name}
                    </h3>
                    <p className="text-xs text-gray-500">
                      {new Date(segment.start_time * 1000).toLocaleTimeString()} -{' '}
                      {new Date(segment.end_time * 1000).toLocaleTimeString()}
                    </p>
                  </div>
                  <span className="text-xs text-gray-600">
                    Confidence: {(segment.confidence * 100).toFixed(0)}%
                  </span>
                </div>

                {editingSegmentId === idx ? (
                  <div>
                    <textarea
                      value={editedText}
                      onChange={(e) => setEditedText(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
                      rows={3}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveEdit}
                        className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingSegmentId(null)}
                        className="bg-gray-600 text-white px-3 py-1 rounded hover:bg-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-gray-700 mb-2">{segment.text}</p>
                    {editMode && (
                      <button
                        onClick={() => handleEditClick(idx, segment.text)}
                        className="text-blue-600 hover:underline text-sm"
                      >
                        Edit
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
