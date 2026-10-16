import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { onDesktop } from './services/device';
import { useAuthStore } from './store/authStore';
import { apiClient } from './services/api';
import { LoginPage } from './pages/LoginPage';
import { PricingPage } from './pages/PricingPage';
import { OrganizerPage } from './pages/OrganizerPage';
import { AttendeePage } from './pages/AttendeePage';
import { HomeRedirect } from './pages/HomeRedirect';
import { GuestMobileOnlyPage } from './pages/GuestMobileOnlyPage';
import { GuestWaitingPage } from './pages/GuestWaitingPage';
import { GuestEventPage } from './pages/GuestEventPage';
import { EventRoomPage } from './pages/EventRoomPage';
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

/**
 * A route that belongs to one kind of device.
 *
 * The home redirect already chose a portal from the device, but it only
 * ran on "/" - so typing /app on a laptop, or /organizer on a phone,
 * walked straight past it into a screen drawn for the other thing. The
 * decision belongs on the routes, where every way in passes through it.
 *
 * `replace`, so the back button does not bounce between the two.
 */
export const DeviceRoute: React.FC<{
  want: 'desktop' | 'mobile';
  children: React.ReactNode;
}> = ({ want, children }) => {
  const desktop = onDesktop();
  if (want === 'desktop' && !desktop) return <Navigate to="/app" replace />;
  if (want === 'mobile' && desktop) return <Navigate to="/organizer" replace />;
  return <>{children}</>;
};

/**
 * Guest entry, which is for a phone and nothing else.
 *
 * A guest has no account to sign into and no dashboard to be sent to,
 * so there is nowhere to bounce them: they are told why instead, and
 * offered the sign-in that does work on a laptop.
 */
export const GuestRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (onDesktop()) return <Navigate to="/guest/mobile-only" replace />;
  return <>{children}</>;
};

const EventLinkRedirect: React.FC = () => {
  const { eventCode = '' } = useParams<{ eventCode: string }>();
  return <Navigate to={`/login?join=${encodeURIComponent(eventCode)}`} replace />;
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
          <Route path="/events/:eventCode" element={<EventLinkRedirect />} />
          <Route path="/guest/mobile-only" element={<GuestMobileOnlyPage />} />
          <Route
            path="/guest/waiting"
            element={<GuestRoute><GuestWaitingPage /></GuestRoute>}
          />
          <Route
            path="/guest/event"
            element={<GuestRoute><GuestEventPage /></GuestRoute>}
          />
          <Route
            path="/organizer"
            element={
              <DeviceRoute want="desktop">
                <ProtectedRoute>
                  <HostRoute>
                    <OrganizerPage />
                  </HostRoute>
                </ProtectedRoute>
              </DeviceRoute>
            }
          />
          <Route
            path="/app"
            element={
              <DeviceRoute want="mobile">
                <ProtectedRoute>
                  <AttendeePage />
                </ProtectedRoute>
              </DeviceRoute>
            }
          />
          <Route
            path="/event/:eventCode"
            element={
              <ProtectedRoute>
                <EventRoomPage />
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
            path="/artifacts/:eventId"
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
            path="/transcript/:eventId"
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

          {/* Anything else at all.

              Without this a path the router does not know renders
              nothing: the server answers a navigation with index.html
              whatever the path, so the app loads, matches no route and
              draws a white screen with no error anywhere. That is what
              an installed PWA did for as long as its start_url was a
              path this table never had.

              "/" rather than a not-found page, because every such path
              here is a stale link, a typo or an old install, and what
              all three want is the way in. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" />
    </>
  );
}

export default App;
