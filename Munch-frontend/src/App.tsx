import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './store/authStore';
import { LoginPage } from './pages/LoginPage';
import { GuestWaitingPage } from './pages/GuestWaitingPage';
import { GuestMeetingPage } from './pages/GuestMeetingPage';
import { DashboardPage } from './pages/DashboardPage';
import { MeetingRoomPage } from './pages/MeetingRoomPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { MembersPage } from './pages/MembersPage';
import { ArtifactsPage } from './pages/ArtifactsPage';
import { RecordingsPage } from './pages/RecordingsPage';
import { TranscriptEditorPage } from './pages/TranscriptEditorPage';
import { DriveIntegrationPage } from './pages/DriveIntegrationPage';
import { AnalyticsDashboardPage } from './pages/AnalyticsDashboardPage';
import { BillingPage } from './pages/BillingPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

function App() {
  const { getCurrentUser, isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated) {
      getCurrentUser();
    }
  }, [isAuthenticated, getCurrentUser]);

  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Guests: no account, no dashboard */}
          <Route path="/guest/waiting" element={<GuestWaitingPage />} />
          <Route path="/guest/meeting" element={<GuestMeetingPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/meeting/:meetingCode"
            element={
              <ProtectedRoute>
                <MeetingRoomPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/organizations"
            element={
              <ProtectedRoute>
                <OrganizationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/members"
            element={
              <ProtectedRoute>
                <MembersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/artifacts/:meetingId"
            element={
              <ProtectedRoute>
                <ArtifactsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/recordings"
            element={
              <ProtectedRoute>
                <RecordingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/transcript/:meetingId"
            element={
              <ProtectedRoute>
                <TranscriptEditorPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/drive"
            element={
              <ProtectedRoute>
                <DriveIntegrationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/analytics"
            element={
              <ProtectedRoute>
                <AnalyticsDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/billing"
            element={
              <ProtectedRoute>
                <BillingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" />
    </>
  );
}

export default App;
