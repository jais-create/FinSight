import React, { useEffect, useState } from 'react';
import { PracticeProvider, usePractice } from './context/PracticeContext';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { QuickAddModal } from './components/layout/QuickAddModal';
import { CommandPalette } from './components/layout/CommandPalette';
import { FinSightCopilotDrawer } from './components/copilot/FinSightCopilotDrawer';
import { ToastContainer } from './components/ui/ToastContainer';
import { Modal } from './components/ui/Modal';

import { ErrorBoundary } from './components/ui/ErrorBoundary';

import { DashboardPage } from './pages/DashboardPage';
import { IntelligencePage } from './pages/IntelligencePage';
import { ClientsPage } from './pages/ClientsPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { AiScannerPage } from './pages/AiScannerPage';
import { ValidationPage } from './pages/ValidationPage';
import { CompliancePage } from './pages/CompliancePage';
import { FinancialOverviewPage } from './pages/FinancialOverviewPage';
import { RemindersPage } from './pages/RemindersPage';
import { TasksPage } from './pages/TasksPage';
import { ClientPortalPage } from './pages/ClientPortalPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { HelpSupportPage } from './pages/HelpSupportPage';

const AppShell: React.FC = () => {
  const {
    activeSection,
    setActiveSection,
    currentUser,
    authReady,
    firebaseUser,
    authError,
    firestoreReady,
    signInWithGoogle,
    signOutUser,
    settings,
  } = usePractice();

  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  if (!authReady || (firebaseUser && !firestoreReady)) {
    return (
      <div className="min-h-screen bg-[#050A14] flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-[#0B1426] border border-[#1E2E4E] rounded-xl p-6 space-y-4 shadow-2xl text-center">
          <span className="w-10 h-10 mx-auto rounded-lg bg-teal-600 text-white font-display font-bold flex items-center justify-center">
            FS
          </span>
          <div className="space-y-1">
            <h1 className="text-base font-bold text-slate-100 font-display">FinSight</h1>
            <p className="text-xs text-slate-400">
              {!authReady
                ? 'Checking authentication session...'
                : 'Connecting to Cloud Firestore workspace...'}
            </p>
          </div>
          <div className="w-6 h-6 mx-auto border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
    return (
      <div className="min-h-screen bg-[#050A14] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#0B1426] border border-[#1E2E4E] rounded-xl p-6 space-y-5 shadow-2xl">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-teal-600 text-white font-display font-bold flex items-center justify-center">
              FS
            </span>
            <div>
              <h1 className="text-lg font-bold text-slate-100 font-display">FinSight</h1>
              <p className="text-xs text-slate-400">
                {settings.firmName} · {settings.city}, {settings.state}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold text-slate-100 font-display">
              Sign in to Practice Workspace
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Sign in with your Google account to access your firm&apos;s Cloud Firestore compliance records, clients, documents, and AI workflows.
            </p>
          </div>

          {authError && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              {authError}
            </div>
          )}

          <button
            type="button"
            disabled={signingIn}
            onClick={async () => {
              setSigningIn(true);
              try {
                await signInWithGoogle();
              } finally {
                setSigningIn(false);
              }
            }}
            className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-500 disabled:opacity-60 rounded-lg flex items-center justify-center gap-2.5 transition-colors shadow-lg shadow-teal-950/40"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81z"
              />
            </svg>
            <span>{signingIn ? 'Signing in...' : 'Continue with Google'}</span>
          </button>

          <p className="text-[11px] text-slate-500 text-center">
            Secured by Firebase Authentication &amp; Cloud Firestore Rules
          </p>
        </div>
      </div>
    );
  }

  const renderPage = () => {
    switch (activeSection) {
      case 'dashboard':
        return <DashboardPage />;
      case 'intelligence':
        return <IntelligencePage />;
      case 'clients':
        return <ClientsPage />;
      case 'documents':
        return <DocumentsPage />;
      case 'scanner':
        return <AiScannerPage />;
      case 'validation':
        return <ValidationPage />;
      case 'compliance':
        return <CompliancePage />;
      case 'financial':
        return <FinancialOverviewPage />;
      case 'reminders':
        return <RemindersPage />;
      case 'tasks':
        return <TasksPage />;
      case 'portal':
        return <ClientPortalPage />;
      case 'reports':
        return <ReportsPage />;
      case 'settings':
        return <SettingsPage />;
      case 'help':
        return <HelpSupportPage />;
    }
  };

  return (
    <div className="min-h-screen flex bg-[#050A14] text-slate-100">
      <Sidebar onOpenProfileModal={() => setProfileModalOpen(true)} />

      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          onOpenProfileModal={() => setProfileModalOpen(true)}
          onOpenCommandPalette={() => setCommandOpen(true)}
        />

        <main className="flex-1 p-4 sm:p-6 max-w-[1600px] w-full mx-auto">
          {renderPage()}
        </main>
      </div>

      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
      <FinSightCopilotDrawer />
      <QuickAddModal />
      <ToastContainer />

      <Modal
        open={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        title={currentUser.name}
        subtitle={`${currentUser.role} · ${currentUser.department}`}
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4 text-xs">
          <dl className="grid grid-cols-2 gap-3 bg-[#081020] p-4 rounded-xl border border-[#1E2E4E]">
            <div>
              <dt className="text-slate-400">Firm</dt>
              <dd className="font-semibold text-slate-100 mt-0.5">{settings.firmName}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Location</dt>
              <dd className="font-medium text-slate-100 mt-0.5">
                {settings.city}, {settings.state}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Email</dt>
              <dd className="font-medium text-slate-100 mt-0.5 break-all">{currentUser.email}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Phone</dt>
              <dd className="font-mono text-slate-100 mt-0.5">{currentUser.phone || 'Not set'}</dd>
            </div>
          </dl>

          <div className="flex justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                setProfileModalOpen(false);
                void signOutUser();
              }}
              className="px-4 py-2 text-xs font-medium text-rose-300 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 rounded-lg"
            >
              Sign Out
            </button>
            <button
              type="button"
              onClick={() => {
                setProfileModalOpen(false);
                setActiveSection('settings');
              }}
              className="px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-500 rounded-lg"
            >
              Edit in Settings
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <PracticeProvider>
        <AppShell />
      </PracticeProvider>
    </ErrorBoundary>
  );
}
