import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import type { ServerEvent } from '@shared/types';
import { Footer, ScanIndicator, Toasts } from './components/Chrome';
import { DetailModalHost } from './components/DetailModal';
import { Nav } from './components/Nav';
import { PreviewHost } from './components/PreviewPopup';
import { Browse } from './pages/Browse';
import { Latest, MyList, Search } from './pages/Collections';
import { Login } from './pages/Login';
import { ManageProfiles, ProfileGate } from './pages/Profiles';
import { Settings } from './pages/Settings';
import { WatchRoute } from './pages/Watch';
import { Welcome } from './pages/Welcome';
import { useApp } from './store/app';

/** Keeps the UI live while scans run: titles appear as they are discovered. */
function ServerEvents() {
  const setScan = useApp((s) => s.setScan);
  const profileId = useApp((s) => s.profileId);
  useEffect(() => {
    const source = new EventSource('/api/events');
    let wasRunning = false;
    source.onmessage = (msg) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(msg.data) as ServerEvent;
      } catch {
        return;
      }
      const app = useApp.getState();
      if (event.type === 'scan') {
        setScan(event.progress);
        if (wasRunning && !event.progress.running) void app.loadSystem();
        wasRunning = event.progress.running;
      } else if (event.type === 'library') {
        if (app.profileId) void app.refreshProfileData();
      } else if (event.type === 'libraries') {
        void app.loadLibraries();
      }
    };
    return () => source.close();
  }, [setScan, profileId]);
  return null;
}

function RequireProfile({ children }: { children: ReactNode }) {
  const profileId = useApp((s) => s.profileId);
  const onboarded = useApp((s) => s.system?.onboarded ?? true);
  const libraries = useApp((s) => s.libraries);
  const location = useLocation();
  if (!onboarded && libraries.length === 0) return <Navigate to="/welcome" replace />;
  if (!profileId) return <Navigate to="/profiles" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

function BrowseLayout() {
  return (
    <>
      <Nav />
      <Outlet />
      <Footer />
      <DetailModalHost />
      <PreviewHost />
      <ScanIndicator />
    </>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export function App() {
  const ready = useApp((s) => s.ready);
  const auth = useApp((s) => s.auth);
  const init = useApp((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  if (!ready) {
    return (
      <div className="page-loading">
        <div className="spinner" />
      </div>
    );
  }
  if (auth.required && !auth.authenticated) {
    return (
      <>
        <Login />
        <Toasts />
      </>
    );
  }

  return (
    <BrowserRouter>
      <ServerEvents />
      <ScrollToTop />
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/profiles" element={<ProfileGate />} />
        <Route path="/profiles/manage" element={<ManageProfiles />} />
        <Route
          path="/watch/:fileId"
          element={
            <RequireProfile>
              <WatchRoute />
            </RequireProfile>
          }
        />
        <Route
          path="/settings/*"
          element={
            <RequireProfile>
              <Settings />
            </RequireProfile>
          }
        />
        <Route
          element={
            <RequireProfile>
              <BrowseLayout />
            </RequireProfile>
          }
        >
          <Route path="/browse" element={<Browse filter="all" />} />
          <Route path="/tv" element={<Browse filter="show" />} />
          <Route path="/movies" element={<Browse filter="movie" />} />
          <Route path="/latest" element={<Latest />} />
          <Route path="/my-list" element={<MyList />} />
          <Route path="/search" element={<Search />} />
        </Route>
        <Route path="*" element={<Navigate to="/browse" replace />} />
      </Routes>
      <Toasts />
    </BrowserRouter>
  );
}
