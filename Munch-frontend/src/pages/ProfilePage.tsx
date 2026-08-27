import React, { useState } from 'react';
import { useAuthStore } from '../store/authStore';

export const ProfilePage: React.FC = () => {
  const { user } = useAuthStore();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    email: user?.email || '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Call API to update profile
    setIsEditing(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Profile</h1>

        <div className="bg-white rounded-lg shadow p-8">
          {/* Avatar Section */}
          <div className="mb-8 text-center">
            {user?.avatar_url ? (
              <img
                src={user.avatar_url}
                alt={`${user.first_name} ${user.last_name}`}
                className="w-24 h-24 rounded-full mx-auto mb-4"
              />
            ) : (
              <div className="w-24 h-24 rounded-full mx-auto mb-4 bg-blue-500 flex items-center justify-center text-white text-2xl font-bold">
                {user?.first_name?.charAt(0)}{user?.last_name?.charAt(0)}
              </div>
            )}
            <h2 className="text-2xl font-semibold text-gray-900">
              {user?.first_name} {user?.last_name}
            </h2>
            <p className="text-gray-600">{user?.email}</p>
            {user?.is_verified && (
              <p className="text-green-600 text-sm mt-2">✓ Verified</p>
            )}
          </div>

          {/* Profile Form */}
          {isEditing ? (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  First Name
                </label>
                <input
                  type="text"
                  value={formData.first_name}
                  onChange={(e) =>
                    setFormData({ ...formData, first_name: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Last Name
                </label>
                <input
                  type="text"
                  value={formData.last_name}
                  onChange={(e) =>
                    setFormData({ ...formData, last_name: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  disabled
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-600"
                />
              </div>

              <div className="flex gap-4">
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                  Save Changes
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="flex-1 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="space-y-4 mb-6">
                <div>
                  <p className="text-sm text-gray-600">First Name</p>
                  <p className="text-lg font-medium text-gray-900">
                    {user?.first_name}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Last Name</p>
                  <p className="text-lg font-medium text-gray-900">
                    {user?.last_name}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Email</p>
                  <p className="text-lg font-medium text-gray-900">
                    {user?.email}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Member Since</p>
                  <p className="text-lg font-medium text-gray-900">
                    {user?.created_at
                      ? new Date(user.created_at).toLocaleDateString()
                      : 'N/A'}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsEditing(true)}
                className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                Edit Profile
              </button>
            </>
          )}
        </div>

        {/* Account Actions */}
        <div className="bg-white rounded-lg shadow p-8 mt-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Account Actions
          </h3>
          <div className="space-y-3">
            <button className="w-full text-left px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50">
              🔐 Change Password
            </button>
            <button className="w-full text-left px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50">
              🔔 Notification Preferences
            </button>
            <button className="w-full text-left px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50">
              🗑️ Delete Account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
