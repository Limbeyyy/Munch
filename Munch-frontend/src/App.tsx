import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './store/authStore';
import { apiClient } from './services/api';
import { LoginPage } from './pages/LoginPage';
import { PricingPage } from './pages/PricingPage';
import { OrganizerPage } from './pages/OrganizerPage';
import { AttendeePage } from './pages/AttendeePage';
import { HomeRedirect } from './pages/HomeRedirect';
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

/**
 * A page that needs somebody signed in.
 *
 * The guard waits for the stored session to be read before judging it.
 * Acting on `isAuthenticated` while it still only means "not asked yet" is
 * what sent people to the login page for the crime of refreshing.
 */
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading, ready } = useAuthStore();

  if (!ready || isLoading) {
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

/**
 * The organizer panel, kept to the people who actually host.
 *
 * Being invited to a programme now puts it in your lists, so the panel has
 * to ask the server what standing you hold rather than infer it from what
 * you can see.
 */
const HostRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [allowed, setAllowed] = React.useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getMyRoles()
      .then((roles) => { if (!cancelled) setAllowed(roles.is_host); })
      .catch(() => { if (!cancelled) setAllowed(false); });
    return () => { cancelled = true; };
  }, []);

  if (allowed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }
  return allowed ? <>{children}</> : <Navigate to="/" replace />;
};

function App() {
  const { getCurrentUser } = useAuthStore();

  // Once, on startup. Restoring the session is not something to retry on
  // every render, and the store settles `ready` whichever way it goes.
  useEffect(() => {
    getCurrentUser();
  }, [getCurrentUser]);

  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/pricing" element={<PricingPage />} />

          {/* Guests: no account, no dashboard */}
          <Route path="/guest/waiting" element={<GuestWaitingPage />} />
          <Route path="/guest/meeting" element={<GuestMeetingPage />} />
          <Route
            path="/organizer"
            element={
              <ProtectedRoute>
                <HostRoute>
                  <OrganizerPage />
                </HostRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <AttendeePage />
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
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <HomeRedirect />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" />
    </>
  );
}

export default App;
