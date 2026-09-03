import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { apiClient } from '../services/api';
import { Meeting } from '../types';
import toast from 'react-hot-toast';
import { ShareMeetingDialog } from '../components/ShareMeetingDialog';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [sharing, setSharing] = useState<Meeting | null>(null);
  const [scheduledStart, setScheduledStart] = useState(() => {
    const date = new Date();
    date.setMinutes(date.getMinutes() + 5);
    return date.toISOString().slice(0, 16);
  });
  const [scheduledEnd, setScheduledEnd] = useState(() => {
    const date = new Date();
    date.setHours(date.getHours() + 1);
    date.setMinutes(date.getMinutes() + 5);
    return date.toISOString().slice(0, 16);
  });

  useEffect(() => {
    fetchMeetings();
  }, []);

  const fetchMeetings = async () => {
    try {
      setIsLoading(true);
      const data = await apiClient.listMeetings();
      setMeetings(data);
    } catch (error) {
      toast.error('Failed to load meetings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateMeeting = async () => {
    if (!title) {
      toast.error('Please enter a meeting title');
      return;
    }

    try {
      setIsLoading(true);
      const start = new Date(scheduledStart);
      const end = new Date(scheduledEnd);

      if (start >= end) {
        toast.error('End time must be after start time');
        setIsLoading(false);
        return;
      }

      const meeting = await apiClient.createMeeting({
        title,
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
      });

      toast.success('Meeting created!');
      setTitle('');
      setShowCreate(false);
      navigate(`/meeting/${meeting.meeting_code}`);
    } catch (error: any) {
      toast.error('Failed to create meeting: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinMeeting = async (meetingCode: string, meeting: Meeting) => {
    try {
      // If user is the host, skip join and go directly to meeting room
      if (meeting.host?.id === user?.id) {
        navigate(`/meeting/${meetingCode}`);
        return;
      }

      await apiClient.joinMeeting(meetingCode);
      navigate(`/meeting/${meetingCode}`);
    } catch (error: any) {
      toast.error('Failed to join meeting: ' + error.message);
    }
  };

  const handleJoinByCode = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      toast.error('Enter a meeting code');
      return;
    }

    try {
      setIsJoining(true);
      await apiClient.joinMeeting(code);
      navigate(`/meeting/${code}`);
    } catch (error: any) {
      const status = error.response?.status;
      const detail = error.response?.data?.error;
      toast.error(
        status === 404
          ? `No meeting found with code ${code}`
          : `Failed to join: ${detail ?? error.message}`
      );
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream font-sans text-ink">
      {/* Header */}
      <header className="bg-navy-900 text-white">
        <div className="max-w-7xl mx-auto px-5 py-3 flex items-center gap-3">
          <svg width="26" height="26" viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <rect x="18" y="18" width="28" height="28" rx="4" stroke="#fff" strokeWidth="2.6" />
            <rect x="26" y="26" width="12" height="12" rx="2" fill="#F0A22B" />
            <g stroke="#8FB0DC" strokeWidth="2">
              <path d="M32 8v8M32 48v8M8 32h8M48 32h8" />
            </g>
          </svg>
          <div className="leading-tight">
            <b className="text-[17px]">मञ्च</b>
            <span className="block text-[10.5px] text-[#9FB8DC]">Organizer</span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={() => navigate('/organizer')}
              className="text-[13px] px-3 py-1.5 rounded-lg bg-amber text-[#20160A] font-semibold hover:bg-[#FFB43F]"
            >
              Organizer panel
            </button>
            <button
              onClick={() => navigate('/pricing')}
              className="text-[13px] text-[#C7D8F0] hover:text-white underline underline-offset-4 hidden sm:block"
            >
              Plans
            </button>
            <span className="text-[13px] text-[#C7D8F0] hidden sm:block">{user?.email}</span>
            <button
              onClick={logout}
              className="text-[13px] px-3 py-1.5 rounded-lg border border-white/25 hover:bg-white/10"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-12">
        {/* Create or join */}
        <div className="mb-8 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="bg-amber hover:bg-[#FFB43F] text-[#20160A] px-6 py-3 rounded-lg font-semibold"
          >
            + New Meeting
          </button>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleJoinByCode();
              }}
              placeholder="Enter meeting code"
              className="px-4 py-3 border border-navy-800/20 rounded-lg uppercase tracking-wide bg-white focus:outline-none focus:ring-2 focus:ring-navy-500"
            />
            <button
              onClick={handleJoinByCode}
              disabled={isJoining || !joinCode.trim()}
              className="bg-navy-800 hover:bg-navy-700 text-white px-6 py-3 rounded-lg font-semibold disabled:opacity-50"
            >
              {isJoining ? 'Joining...' : 'Join'}
            </button>
          </div>
        </div>

        {/* Create Meeting Form */}
        {showCreate && (
          <div className="bg-white rounded-xl border border-navy-800/15 p-6 mb-8">
            <h2 className="text-xl font-semibold mb-4">Create a New Meeting</h2>
            <div className="space-y-4">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Meeting title"
                className="w-full px-4 py-2 border border-navy-800/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
              />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Start Time</label>
                  <input
                    type="datetime-local"
                    value={scheduledStart}
                    onChange={(e) => setScheduledStart(e.target.value)}
                    className="w-full px-4 py-2 border border-navy-800/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">End Time</label>
                  <input
                    type="datetime-local"
                    value={scheduledEnd}
                    onChange={(e) => setScheduledEnd(e.target.value)}
                    className="w-full px-4 py-2 border border-navy-800/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
                  />
                </div>
              </div>
              <button
                onClick={handleCreateMeeting}
                disabled={isLoading}
                className="bg-navy-800 hover:bg-navy-700 text-white px-6 py-2 rounded-lg disabled:opacity-50 w-full"
              >
                {isLoading ? 'Creating...' : 'Create Meeting'}
              </button>
            </div>
          </div>
        )}

        {/* Meetings List */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {meetings.map((meeting) => (
            <div key={meeting.id} className="bg-white rounded-xl border border-navy-800/15 hover:border-navy-500 transition p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-2">{meeting.title}</h3>
              <p className="text-gray-600 text-sm mb-4">Code: {meeting.meeting_code}</p>
              <div className="flex gap-2 mb-4">
                <span className={`px-3 py-1 rounded-full text-sm ${
                  meeting.status === 'active' ? 'bg-green-100 text-green-800' :
                  meeting.status === 'scheduled' ? 'bg-blue-100 text-blue-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {meeting.status}
                </span>
              </div>
              <p className="text-gray-600 text-sm mb-4">{meeting.participant_count} participants</p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleJoinMeeting(meeting.meeting_code, meeting)}
                  className="flex-1 bg-navy-800 hover:bg-navy-700 text-white py-2 rounded-lg transition"
                >
                  {meeting.host?.id === user?.id ? 'Enter Meeting' : 'Join Meeting'}
                </button>
                {meeting.host?.id === user?.id && (
                  <button
                    onClick={() => setSharing(meeting)}
                    title="Share link and count expected attendance"
                    className="px-4 border border-navy-800/20 hover:bg-cream-200 rounded-lg transition text-sm font-semibold"
                  >
                    Share
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {meetings.length === 0 && !showCreate && (
          <div className="text-center py-12">
            <p className="text-gray-600 text-lg">
              No meetings yet. Create one, or join an existing meeting with its code.
            </p>
          </div>
        )}
      </main>

      {sharing && (
        <ShareMeetingDialog
          meetingId={sharing.id}
          meetingCode={sharing.meeting_code}
          onClose={() => setSharing(null)}
        />
      )}
    </div>
  );
};
