import React, { useState } from 'react';

export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState({
    notifications_email: true,
    notifications_inapp: true,
    auto_transcription: true,
    auto_recording: false,
    dark_mode: false,
    language: 'en',
    timezone: 'UTC',
  });

  const handleToggle = (key: keyof typeof settings) => {
    setSettings((prev) => ({
      ...prev,
      [key]: typeof prev[key] === 'boolean' ? !prev[key] : prev[key],
    }));
  };

  const handleSave = async () => {
    // TODO: Call API to save settings
    console.log('Saving settings:', settings);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Settings</h1>

        {/* Notifications */}
        <div className="bg-white rounded-lg shadow p-8 mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">
            Notifications
          </h2>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="font-medium text-gray-900">Email Notifications</p>
                <p className="text-sm text-gray-600">
                  Receive email updates about your meetings
                </p>
              </div>
              <button
                onClick={() => handleToggle('notifications_email')}
                className={`relative inline-flex h-6 w-11 items-center rounded-full ${
                  settings.notifications_email
                    ? 'bg-blue-600'
                    : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    settings.notifications_email ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex justify-between items-center">
              <div>
                <p className="font-medium text-gray-900">In-App Notifications</p>
                <p className="text-sm text-gray-600">
                  Show notifications inside the app
                </p>
              </div>
              <button
                onClick={() => handleToggle('notifications_inapp')}
                className={`relative inline-flex h-6 w-11 items-center rounded-full ${
                  settings.notifications_inapp
                    ? 'bg-blue-600'
                    : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    settings.notifications_inapp ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Meeting Preferences */}
        <div className="bg-white rounded-lg shadow p-8 mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">
            Meeting Preferences
          </h2>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="font-medium text-gray-900">Auto Transcription</p>
                <p className="text-sm text-gray-600">
                  Automatically transcribe meetings
                </p>
              </div>
              <button
                onClick={() => handleToggle('auto_transcription')}
                className={`relative inline-flex h-6 w-11 items-center rounded-full ${
                  settings.auto_transcription
                    ? 'bg-blue-600'
                    : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    settings.auto_transcription ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex justify-between items-center">
              <div>
                <p className="font-medium text-gray-900">Auto Recording</p>
                <p className="text-sm text-gray-600">
                  Automatically record all meetings
                </p>
              </div>
              <button
                onClick={() => handleToggle('auto_recording')}
                className={`relative inline-flex h-6 w-11 items-center rounded-full ${
                  settings.auto_recording
                    ? 'bg-blue-600'
                    : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    settings.auto_recording ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* General */}
        <div className="bg-white rounded-lg shadow p-8 mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">General</h2>
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Language
              </label>
              <select
                value={settings.language}
                onChange={(e) =>
                  setSettings({ ...settings, language: e.target.value })
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Timezone
              </label>
              <select
                value={settings.timezone}
                onChange={(e) =>
                  setSettings({ ...settings, timezone: e.target.value })
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="UTC">UTC</option>
                <option value="EST">EST</option>
                <option value="CST">CST</option>
                <option value="MST">MST</option>
                <option value="PST">PST</option>
              </select>
            </div>

            <div className="flex justify-between items-center">
              <div>
                <p className="font-medium text-gray-900">Dark Mode</p>
                <p className="text-sm text-gray-600">
                  Use dark theme throughout the app
                </p>
              </div>
              <button
                onClick={() => handleToggle('dark_mode')}
                className={`relative inline-flex h-6 w-11 items-center rounded-full ${
                  settings.dark_mode ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    settings.dark_mode ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex gap-4">
          <button
            onClick={handleSave}
            className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium"
          >
            Save Settings
          </button>
          <button className="flex-1 border border-gray-300 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-50 font-medium">
            Reset to Defaults
          </button>
        </div>
      </div>
    </div>
  );
};
