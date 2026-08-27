import React, { useState } from 'react';
import { useOrganizationStore } from '../store/organizationStore';

export const MembersPage: React.FC = () => {
  const {
    members,
    invites,
    loading,
    error,
    inviteMember,
    removeMember,
  } = useOrganizationStore();

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteData, setInviteData] = useState({ email: '', role: 'member' });

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    await inviteMember(inviteData.email, inviteData.role);
    setInviteData({ email: '', role: 'member' });
    setShowInviteForm(false);
  };

  const handleRemoveMember = async (memberId: string) => {
    if (window.confirm('Are you sure you want to remove this member?')) {
      await removeMember(memberId);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Team Members</h1>
          <button
            onClick={() => setShowInviteForm(!showInviteForm)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Invite Member
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {showInviteForm && (
          <form
            onSubmit={handleInvite}
            className="bg-white rounded-lg shadow p-6 mb-8"
          >
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <input
                type="email"
                value={inviteData.email}
                onChange={(e) =>
                  setInviteData({ ...inviteData, email: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Role
              </label>
              <select
                value={inviteData.role}
                onChange={(e) =>
                  setInviteData({ ...inviteData, role: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="guest">Guest</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Inviting...' : 'Send Invite'}
            </button>
          </form>
        )}

        <div className="grid gap-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900">Active Members</h2>
          {members.filter((m) => m.status === 'active').map((member) => (
            <div
              key={member.id}
              className="bg-white rounded-lg shadow p-6 flex justify-between items-center"
            >
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {member.user.first_name} {member.user.last_name}
                </h3>
                <p className="text-gray-600">{member.user.email}</p>
                <p className="text-sm text-gray-500 mt-2">
                  Role: <span className="font-medium capitalize">{member.role}</span>
                </p>
              </div>
              <button
                onClick={() => handleRemoveMember(member.id)}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        {invites.length > 0 && (
          <div className="grid gap-6">
            <h2 className="text-xl font-semibold text-gray-900">
              Pending Invitations
            </h2>
            {invites.filter((i) => i.status === 'pending').map((invite) => (
              <div
                key={invite.id}
                className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 flex justify-between items-center"
              >
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {invite.email}
                  </h3>
                  <p className="text-sm text-gray-600">
                    Role: <span className="font-medium capitalize">{invite.role}</span>
                  </p>
                  <p className="text-xs text-gray-500 mt-2">
                    Expires: {new Date(invite.expires_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
