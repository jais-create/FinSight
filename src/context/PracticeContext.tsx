import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  DEFAULT_FIRM_SETTINGS,
  DEFAULT_PERMISSIONS,
  SMART_ONBOARDING_CHECKLISTS,
} from '../data/practiceDefaults';
import {
  OperationType,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  stripUndefined,
} from '../lib/firebase';
import {
  ActivityLog,
  AppNotification,
  Client,
  ClientRiskFactor,
  ClientRiskScoreResult,
  ClientStatus,
  CommunicationLog,
  ComplianceStatus,
  ComplianceTask,
  CrossDocumentComparison,
  DocumentCategory,
  DocumentRecord,
  DocumentRequest,
  DocumentStatus,
  Employee,
  FinancialAnomaly,
  FinancialSummaryRecord,
  FinancialYear,
  FirmSettings,
  NavSection,
  RolePermission,
  ScheduledReminder,
  StaffTask,
  StaffTaskStatus,
  ToastMessage,
  ValidationIssue,
} from '../types';

interface PracticeContextValue {
  // Auth & Workspace status
  authReady: boolean;
  firebaseUser: User | null;
  authError: string | null;
  firestoreReady: boolean;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;

  // Persisted Firestore Collections
  clients: Client[];
  documents: DocumentRecord[];
  complianceTasks: ComplianceTask[];
  staffTasks: StaffTask[];
  docRequests: DocumentRequest[];
  notifications: AppNotification[];
  reminders: ScheduledReminder[];
  communications: CommunicationLog[];
  validationIssues: ValidationIssue[];
  crossComparisons: CrossDocumentComparison[];
  financialRecords: FinancialSummaryRecord[];
  anomalies: FinancialAnomaly[];
  activities: ActivityLog[];
  employees: Employee[];
  permissions: RolePermission[];
  settings: FirmSettings;
  selectedFY: FinancialYear;
  currentEmployeeId: string;
  previewClientId: string;

  // Navigation & UI state
  activeSection: NavSection;
  setActiveSection: (section: NavSection) => void;
  selectedClientId: string | null;
  setSelectedClientId: (id: string | null) => void;
  openClientProfile: (clientId: string) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (v: boolean) => void;
  toasts: ToastMessage[];
  addToast: (title: string, description?: string, variant?: ToastMessage['variant']) => void;
  dismissToast: (id: string) => void;
  currentUser: Employee;
  setCurrentEmployeeId: (id: string) => void;
  setSelectedFY: (fy: FinancialYear) => void;
  setPreviewClientId: (clientId: string) => void;
  isDemoClientMode: boolean;
  setIsDemoClientMode: (v: boolean) => void;
  globalSearchQuery: string;
  setGlobalSearchQuery: (q: string) => void;
  quickAddOpen: boolean;
  setQuickAddOpen: (v: boolean) => void;
  quickAddInitialType: 'client' | 'document' | 'compliance' | 'task' | 'reminder' | null;
  openQuickAdd: (type?: 'client' | 'document' | 'compliance' | 'task' | 'reminder') => void;

  // FinSight AI Copilot
  copilotOpen: boolean;
  setCopilotOpen: (v: boolean) => void;
  queuedCopilotPrompt: string | null;
  openCopilotWithPrompt: (prompt?: string) => void;
  clearQueuedCopilotPrompt: () => void;

  // Risk & Intelligence Engine
  computeClientRiskScore: (clientId: string) => ClientRiskScoreResult;
  updateAnomalyStatus: (
    id: string,
    status: FinancialAnomaly['status'],
    caNote?: string
  ) => void;
  escalateAnomalyToTask: (id: string) => void;
  addAnomaly: (anomaly: Omit<FinancialAnomaly, 'id' | 'detectedAt'>) => void;
  addCrossComparison: (comp: Omit<CrossDocumentComparison, 'id'>) => void;
  runDocumentToActionPipeline: (params: {
    clientId: string;
    name: string;
    fileType: DocumentRecord['fileType'];
    fileSize: string;
    category: DocumentCategory;
    previewSummary: string;
    extractedMetrics?: DocumentRecord['extractedMetrics'];
    detectedIssues?: string[];
  }) => { doc: DocumentRecord; createdTaskId?: string };

  // Client mutations
  addClient: (client: Omit<Client, 'id' | 'clientCode'>) => Client;
  addClientAsync: (client: Omit<Client, 'id' | 'clientCode'>) => Promise<Client>;
  updateClient: (id: string, patch: Partial<Client>) => void;
  setClientStatus: (id: string, status: ClientStatus) => void;

  // Document mutations
  addDocument: (
    doc: Omit<DocumentRecord, 'id' | 'comments' | 'history' | 'uploadDate'>,
    customDate?: string
  ) => DocumentRecord;
  updateDocumentStatus: (docId: string, status: DocumentStatus, note?: string) => void;
  addDocumentComment: (docId: string, text: string) => void;

  // Document Request mutations
  createDocumentRequest: (req: Omit<DocumentRequest, 'id' | 'requestedDate' | 'status'>) => void;
  fulfillDocumentRequest: (requestId: string, docId: string) => void;

  // Compliance mutations
  addComplianceTask: (task: Omit<ComplianceTask, 'id' | 'progressHistory'>) => void;
  updateComplianceTask: (id: string, patch: Partial<ComplianceTask>) => void;
  updateComplianceStatus: (id: string, status: ComplianceStatus, note?: string) => void;

  // Staff task mutations
  addStaffTask: (task: Omit<StaffTask, 'id' | 'comments' | 'timeline'>) => void;
  updateStaffTask: (id: string, patch: Partial<StaffTask>) => void;
  updateStaffTaskStatus: (id: string, status: StaffTaskStatus) => void;
  addStaffTaskComment: (id: string, text: string) => void;

  // Validation mutations
  updateValidationIssue: (
    id: string,
    status: ValidationIssue['status'],
    comment?: string
  ) => void;
  updateCrossComparison: (
    id: string,
    varianceStatus: CrossDocumentComparison['varianceStatus'],
    notes?: string
  ) => void;

  // Notifications & reminders
  markNotificationRead: (id: string, read?: boolean) => void;
  markAllNotificationsRead: () => void;
  addReminder: (rem: Omit<ScheduledReminder, 'id'>) => void;
  triggerSimulatedReminder: (id: string) => void;
  addCommunication: (log: Omit<CommunicationLog, 'id' | 'timestamp'>) => void;

  // Financial record additions (e.g. from AI Scanner)
  addFinancialRecord: (rec: Omit<FinancialSummaryRecord, 'id'>) => void;

  // Settings & Employees
  updateSettings: (patch: Partial<FirmSettings>) => void;
  addEmployee: (emp: Omit<Employee, 'id' | 'avatarInitials'>) => void;
  updateEmployee: (id: string, patch: Partial<Employee>) => void;
  updatePermission: (
    role: RolePermission['role'],
    field: keyof Omit<RolePermission, 'role'>,
    val: boolean
  ) => void;
  resetDemoData: () => void;
  logoutDemoSession: () => void;
  demoLocked: boolean;
  unlockDemoSession: () => void;
}

const PracticeContext = createContext<PracticeContextValue | null>(null);

const nowTimestamp = () => {
  const d = new Date();
  return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`;
};

const todayDate = () => new Date().toISOString().slice(0, 10);

const makeId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function computeInitials(name: string): string {
  const cleaned = name.replace(/^CA\s+/i, '').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'CA';
  return parts
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export const PracticeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [firestoreReady, setFirestoreReady] = useState(false);

  const [clients, setClients] = useState<Client[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [complianceTasks, setComplianceTasks] = useState<ComplianceTask[]>([]);
  const [staffTasks, setStaffTasks] = useState<StaffTask[]>([]);
  const [docRequests, setDocRequests] = useState<DocumentRequest[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [reminders, setReminders] = useState<ScheduledReminder[]>([]);
  const [communications, setCommunications] = useState<CommunicationLog[]>([]);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [crossComparisons, setCrossComparisons] = useState<CrossDocumentComparison[]>([]);
  const [financialRecords, setFinancialRecords] = useState<FinancialSummaryRecord[]>([]);
  const [anomalies, setAnomalies] = useState<FinancialAnomaly[]>([]);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [permissions, setPermissions] = useState<RolePermission[]>(DEFAULT_PERMISSIONS);
  const [settings, setSettings] = useState<FirmSettings>(DEFAULT_FIRM_SETTINGS);

  const [selectedFY, setSelectedFY] = useState<FinancialYear>('FY 2026-27');
  const [currentEmployeeId, setCurrentEmployeeId] = useState<string>('');
  const [previewClientId, setPreviewClientId] = useState<string>('');

  const [activeSection, setActiveSectionState] = useState<NavSection>('dashboard');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isDemoClientMode, setIsDemoClientMode] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddInitialType, setQuickAddInitialType] = useState<
    'client' | 'document' | 'compliance' | 'task' | 'reminder' | null
  >(null);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [queuedCopilotPrompt, setQueuedCopilotPrompt] = useState<string | null>(null);

  const addToast = (
    title: string,
    description?: string,
    variant: ToastMessage['variant'] = 'success'
  ) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, title, description, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const openCopilotWithPrompt = (prompt?: string) => {
    if (prompt) setQueuedCopilotPrompt(prompt);
    setCopilotOpen(true);
  };
  const clearQueuedCopilotPrompt = () => setQueuedCopilotPrompt(null);

  // Firebase Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        setFirestoreReady(false);
        setClients([]);
        setDocuments([]);
        setComplianceTasks([]);
        setStaffTasks([]);
        setDocRequests([]);
        setNotifications([]);
        setReminders([]);
        setCommunications([]);
        setValidationIssues([]);
        setCrossComparisons([]);
        setFinancialRecords([]);
        setAnomalies([]);
        setActivities([]);
        setEmployees([]);
        setPermissions(DEFAULT_PERMISSIONS);
        setSettings(DEFAULT_FIRM_SETTINGS);
        setCurrentEmployeeId('');
        setPreviewClientId('');
      }
    });
    return () => unsub();
  }, []);

  // Bootstrap user + firm document & attach Firestore real-time listeners once authenticated
  useEffect(() => {
    if (!authReady || !firebaseUser) return;

    const uid = firebaseUser.uid;
    let cancelled = false;
    const unsubs: Array<() => void> = [];

    const initAndSubscribe = async () => {
      try {
        const displayName = (
          firebaseUser.displayName ||
          firebaseUser.email?.split('@')[0] ||
          'CA Partner'
        ).slice(0, 120);
        const initials = computeInitials(displayName);
        const email = (firebaseUser.email || '').slice(0, 200);

        // 1. User public & private PII split docs
        const userPubRef = doc(db, 'users', uid);
        const userPubSnap = await getDoc(userPubRef).catch((err) =>
          handleFirestoreError(err, OperationType.GET, `users/${uid}`)
        );
        if (!userPubSnap.exists()) {
          await setDoc(
            userPubRef,
            stripUndefined({
              uid,
              displayName,
              role: 'Partner',
              department: 'Practice Management',
              avatarInitials: initials,
              active: true,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            })
          ).catch((err) => handleFirestoreError(err, OperationType.CREATE, `users/${uid}`));
        }

        const userPrivRef = doc(db, 'users', uid, 'private', 'info');
        const userPrivSnap = await getDoc(userPrivRef).catch((err) =>
          handleFirestoreError(err, OperationType.GET, `users/${uid}/private/info`)
        );
        if (!userPrivSnap.exists()) {
          await setDoc(
            userPrivRef,
            stripUndefined({
              uid,
              email,
              phone: '',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            })
          ).catch((err) =>
            handleFirestoreError(err, OperationType.CREATE, `users/${uid}/private/info`)
          );
        }

        // 2. Firm workspace root doc
        const firmRef = doc(db, 'firms', uid);
        const firmSnap = await getDoc(firmRef).catch((err) =>
          handleFirestoreError(err, OperationType.GET, `firms/${uid}`)
        );
        if (!firmSnap.exists()) {
          await setDoc(
            firmRef,
            stripUndefined({
              ownerUid: uid,
              ...DEFAULT_FIRM_SETTINGS,
              email: email || DEFAULT_FIRM_SETTINGS.email,
              permissions: DEFAULT_PERMISSIONS,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            })
          ).catch((err) => handleFirestoreError(err, OperationType.CREATE, `firms/${uid}`));
        }

        // 3. Default Employee profile for the signed-in user
        const empRef = doc(db, 'firms', uid, 'employees', uid);
        const empSnap = await getDoc(empRef).catch((err) =>
          handleFirestoreError(err, OperationType.GET, `firms/${uid}/employees/${uid}`)
        );
        if (!empSnap.exists()) {
          await setDoc(
            empRef,
            stripUndefined({
              id: uid,
              ownerUid: uid,
              name: displayName,
              role: 'Partner',
              email,
              phone: '',
              department: 'Practice Management',
              active: true,
              avatarInitials: initials,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            })
          ).catch((err) =>
            handleFirestoreError(err, OperationType.CREATE, `firms/${uid}/employees/${uid}`)
          );
        }

        if (cancelled) return;
        setCurrentEmployeeId((prev) => prev || uid);

        // Subscribe to Firm doc
        unsubs.push(
          onSnapshot(
            firmRef,
            (snap) => {
              if (!snap.exists()) return;
              const data = snap.data();
              setSettings({
                firmName: data.firmName || DEFAULT_FIRM_SETTINGS.firmName,
                tagline: data.tagline ?? DEFAULT_FIRM_SETTINGS.tagline,
                address: data.address ?? DEFAULT_FIRM_SETTINGS.address,
                city: data.city ?? DEFAULT_FIRM_SETTINGS.city,
                state: data.state ?? DEFAULT_FIRM_SETTINGS.state,
                pinCode: data.pinCode ?? DEFAULT_FIRM_SETTINGS.pinCode,
                icaiRegNo: data.icaiRegNo ?? '',
                gstin: data.gstin ?? '',
                email: data.email ?? '',
                phone: data.phone ?? '',
                defaultFinancialYear:
                  data.defaultFinancialYear || DEFAULT_FIRM_SETTINGS.defaultFinancialYear,
                availableFinancialYears:
                  data.availableFinancialYears || DEFAULT_FIRM_SETTINGS.availableFinancialYears,
                enabledComplianceCategories:
                  data.enabledComplianceCategories ||
                  DEFAULT_FIRM_SETTINGS.enabledComplianceCategories,
                enabledDocumentCategories:
                  data.enabledDocumentCategories ||
                  DEFAULT_FIRM_SETTINGS.enabledDocumentCategories,
                notifications: data.notifications || DEFAULT_FIRM_SETTINGS.notifications,
                preferences: data.preferences || DEFAULT_FIRM_SETTINGS.preferences,
              });
              if (Array.isArray(data.permissions)) {
                setPermissions(data.permissions as RolePermission[]);
              }
            },
            (err) => handleFirestoreError(err, OperationType.GET, `firms/${uid}`)
          )
        );

        const subCol = <T,>(
          colName: string,
          setter: React.Dispatch<React.SetStateAction<T[]>>,
          sortByField?: keyof T
        ) => {
          const path = `firms/${uid}/${colName}`;
          const q = query(collection(db, 'firms', uid, colName), where('ownerUid', '==', uid));
          unsubs.push(
            onSnapshot(
              q,
              (snap) => {
                const rows = snap.docs.map((d) => d.data() as T);
                if (sortByField) {
                  rows.sort((a, b) =>
                    String(b[sortByField] ?? '').localeCompare(String(a[sortByField] ?? ''))
                  );
                }
                setter(rows);
              },
              (err) => handleFirestoreError(err, OperationType.LIST, path)
            )
          );
        };

        subCol<Employee>('employees', setEmployees);
        subCol<Client>('clients', setClients, 'onboardingDate');
        subCol<DocumentRecord>('documents', setDocuments, 'uploadDate');
        subCol<ComplianceTask>('complianceTasks', setComplianceTasks);
        subCol<StaffTask>('staffTasks', setStaffTasks, 'startDate');
        subCol<DocumentRequest>('docRequests', setDocRequests, 'requestedDate');
        subCol<AppNotification>('notifications', setNotifications, 'timestamp');
        subCol<ScheduledReminder>('reminders', setReminders, 'scheduledFor');
        subCol<CommunicationLog>('communications', setCommunications, 'timestamp');
        subCol<ValidationIssue>('validationIssues', setValidationIssues);
        subCol<CrossDocumentComparison>('crossComparisons', setCrossComparisons);
        subCol<FinancialSummaryRecord>('financialRecords', setFinancialRecords);
        subCol<FinancialAnomaly>('anomalies', setAnomalies, 'detectedAt');
        subCol<ActivityLog>('activities', setActivities, 'timestamp');

        setFirestoreReady(true);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to initialize Firestore workspace.';
          setAuthError(msg);
        }
      }
    };

    void initAndSubscribe();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [authReady, firebaseUser]);

  // Keep previewClientId pointing at a valid client whenever clients change
  useEffect(() => {
    if (clients.length > 0 && !clients.some((c) => c.id === previewClientId)) {
      setPreviewClientId(clients[0].id);
    } else if (clients.length === 0 && previewClientId) {
      setPreviewClientId('');
    }
  }, [clients, previewClientId]);

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In failed.';
      setAuthError(msg);
      addToast('Sign-In Failed', msg, 'error');
    }
  };

  const signOutUser = async () => {
    try {
      await signOut(auth);
      addToast('Signed out', 'Your FinSight Firebase session has ended.', 'info');
    } catch (err) {
      addToast(
        'Sign-out Error',
        err instanceof Error ? err.message : 'Could not sign out cleanly.',
        'error'
      );
    }
  };

  const currentUser: Employee = useMemo(() => {
    const found = employees.find((e) => e.id === currentEmployeeId) || employees[0];
    if (found) return found;
    const fallbackName =
      firebaseUser?.displayName || firebaseUser?.email?.split('@')[0] || 'CA Partner';
    return {
      id: firebaseUser?.uid || 'emp-pending',
      name: fallbackName,
      role: 'Partner',
      email: firebaseUser?.email || '',
      phone: '',
      department: 'Practice Management',
      active: true,
      avatarInitials: computeInitials(fallbackName),
    };
  }, [employees, currentEmployeeId, firebaseUser]);

  const firmUid = firebaseUser?.uid || '';

  const logActivity = async (
    action: string,
    target: string,
    section: NavSection,
    clientId?: string,
    actorOverride?: string
  ) => {
    if (!firmUid) return;
    const id = makeId('act');
    const path = `firms/${firmUid}/activities/${id}`;
    try {
      await setDoc(
        doc(db, 'firms', firmUid, 'activities', id),
        stripUndefined({
          id,
          ownerUid: firmUid,
          clientId,
          actor: (actorOverride || currentUser.name).slice(0, 160),
          action: action.slice(0, 240),
          target: target.slice(0, 240),
          timestamp: nowTimestamp(),
          section,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  };

  const pushNotification = async (
    title: string,
    message: string,
    type: AppNotification['type'],
    linkSection?: NavSection,
    clientId?: string
  ) => {
    if (!firmUid) return;
    const id = makeId('ntf');
    const path = `firms/${firmUid}/notifications/${id}`;
    try {
      await setDoc(
        doc(db, 'firms', firmUid, 'notifications', id),
        stripUndefined({
          id,
          ownerUid: firmUid,
          title: title.slice(0, 200),
          message: message.slice(0, 1000),
          type,
          read: false,
          timestamp: nowTimestamp(),
          linkSection,
          clientId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  };

  const setActiveSection = (section: NavSection) => {
    setActiveSectionState(section);
    if (section === 'portal') {
      setIsDemoClientMode(true);
    } else {
      setIsDemoClientMode(false);
    }
    if (section !== 'clients') {
      setSelectedClientId(null);
    }
    setMobileMenuOpen(false);
  };

  const openClientProfile = (clientId: string) => {
    setSelectedClientId(clientId);
    setActiveSectionState('clients');
    setIsDemoClientMode(false);
    setMobileMenuOpen(false);
  };

  const openQuickAdd = (type?: 'client' | 'document' | 'compliance' | 'task' | 'reminder') => {
    setQuickAddInitialType(type ?? null);
    setQuickAddOpen(true);
  };

  const createClientWithCommit = (
    clientInput: Omit<Client, 'id' | 'clientCode'>
  ): { client: Client; commitPromise: Promise<void> } => {
    const nextNum = 101 + clients.length;
    const template = SMART_ONBOARDING_CHECKLISTS[clientInput.type];
    const resolvedRequired =
      clientInput.requiredCategories.length > 0
        ? clientInput.requiredCategories
        : template.requiredCategories;
    const resolvedServices =
      clientInput.services.length > 0 ? clientInput.services : template.defaultServices;

    const newClient: Client = {
      ...clientInput,
      requiredCategories: resolvedRequired,
      services: resolvedServices,
      id: makeId('cli'),
      clientCode: `AYC-${nextNum}`,
    };

    let commitPromise: Promise<void> = Promise.resolve();

    if (firmUid) {
      const onboardingTaskId = makeId('tsk-onb');
      const actId = makeId('act');
      const ntfId = makeId('ntf');
      const batch = writeBatch(db);

      batch.set(
        doc(db, 'firms', firmUid, 'clients', newClient.id),
        stripUndefined({
          ...newClient,
          ownerUid: firmUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      batch.set(
        doc(db, 'firms', firmUid, 'staffTasks', onboardingTaskId),
        stripUndefined({
          id: onboardingTaskId,
          ownerUid: firmUid,
          title: `Smart Onboarding Pack — ${newClient.name}`.slice(0, 200),
          description: `Execute ${newClient.type} onboarding checklist:\n• ${template.onboardingSteps.join('\n• ')}`,
          clientId: newClient.id,
          assignedEmployeeId: newClient.assignedEmployeeId || currentUser.id,
          createdBy: currentUser.name,
          priority: 'High',
          startDate: todayDate(),
          dueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
          status: 'Not Started',
          attachments: [],
          comments: [],
          timeline: [
            {
              id: makeId('tl-onb'),
              event: `Auto-generated Smart Onboarding workflow (${resolvedRequired.length} required doc categories)`,
              actor: 'FinSight Onboarding Engine',
              timestamp: nowTimestamp(),
            },
          ],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      batch.set(
        doc(db, 'firms', firmUid, 'activities', actId),
        stripUndefined({
          id: actId,
          ownerUid: firmUid,
          clientId: newClient.id,
          actor: currentUser.name,
          action: `onboarded new ${newClient.type} client (${resolvedRequired.length} doc checklist)`,
          target: newClient.name,
          timestamp: nowTimestamp(),
          section: 'clients',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      batch.set(
        doc(db, 'firms', firmUid, 'notifications', ntfId),
        stripUndefined({
          id: ntfId,
          ownerUid: firmUid,
          title: `New Client Onboarded — ${newClient.name}`.slice(0, 200),
          message: `Client ${newClient.clientCode} assigned to ${
            employees.find((e) => e.id === newClient.assignedEmployeeId)?.name || 'CA Staff'
          } with Smart Onboarding task.`,
          type: 'system',
          read: false,
          timestamp: nowTimestamp(),
          linkSection: 'clients',
          clientId: newClient.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      commitPromise = batch.commit().catch((err) => {
        handleFirestoreError(err, OperationType.WRITE, `firms/${firmUid}/clients/${newClient.id}`);
        throw err;
      });
    }

    addToast(
      'Client onboarded',
      `${newClient.name} (${newClient.clientCode}) saved to Firestore with ${resolvedRequired.length}-item checklist.`
    );
    return { client: newClient, commitPromise };
  };

  const addClient = (clientInput: Omit<Client, 'id' | 'clientCode'>): Client => {
    const { client, commitPromise } = createClientWithCommit(clientInput);
    void commitPromise.catch(() => undefined);
    return client;
  };

  const addClientAsync = async (clientInput: Omit<Client, 'id' | 'clientCode'>): Promise<Client> => {
    const { client, commitPromise } = createClientWithCommit(clientInput);
    await commitPromise;
    return client;
  };

  const updateClient = (id: string, patch: Partial<Client>) => {
    if (!firmUid) return;
    const target = clients.find((c) => c.id === id);
    const path = `firms/${firmUid}/clients/${id}`;
    updateDoc(
      doc(db, 'firms', firmUid, 'clients', id),
      stripUndefined({ ...patch, updatedAt: serverTimestamp() })
    )
      .then(() => {
        if (target) {
          void logActivity('updated client profile', target.name, 'clients', id);
        }
        addToast('Client updated', 'Changes saved to Firestore.');
      })
      .catch((err) => handleFirestoreError(err, OperationType.UPDATE, path));
  };

  const setClientStatus = (id: string, status: ClientStatus) => {
    if (!firmUid) return;
    const target = clients.find((c) => c.id === id);
    const path = `firms/${firmUid}/clients/${id}`;
    updateDoc(doc(db, 'firms', firmUid, 'clients', id), {
      status,
      updatedAt: serverTimestamp(),
    })
      .then(() => {
        if (target) {
          void logActivity(`changed client status to ${status}`, target.name, 'clients', id);
        }
        addToast(`Client marked ${status}`);
      })
      .catch((err) => handleFirestoreError(err, OperationType.UPDATE, path));
  };

  const addDocument = (
    docInput: Omit<DocumentRecord, 'id' | 'comments' | 'history' | 'uploadDate'>,
    customDate?: string
  ): DocumentRecord => {
    const newDoc: DocumentRecord = {
      ...docInput,
      id: makeId('doc'),
      uploadDate: customDate || todayDate(),
      comments: [],
      history: [
        {
          id: makeId('h'),
          action: `Uploaded by ${docInput.uploadedByRole}`,
          actor: docInput.uploadedBy,
          timestamp: nowTimestamp(),
        },
      ],
    };

    if (firmUid) {
      const client = clients.find((c) => c.id === newDoc.clientId);
      const batch = writeBatch(db);
      batch.set(
        doc(db, 'firms', firmUid, 'documents', newDoc.id),
        stripUndefined({
          ...newDoc,
          ownerUid: firmUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      if (newDoc.linkedRequestId) {
        batch.update(doc(db, 'firms', firmUid, 'docRequests', newDoc.linkedRequestId), {
          status: 'Under CA Review',
          linkedDocumentId: newDoc.id,
          updatedAt: serverTimestamp(),
        });
      }

      const actId = makeId('act');
      batch.set(
        doc(db, 'firms', firmUid, 'activities', actId),
        stripUndefined({
          id: actId,
          ownerUid: firmUid,
          clientId: newDoc.clientId,
          actor: newDoc.uploadedBy,
          action: `uploaded ${newDoc.category}`,
          target: newDoc.name,
          timestamp: nowTimestamp(),
          section: 'documents',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      const ntfId = makeId('ntf');
      batch.set(
        doc(db, 'firms', firmUid, 'notifications', ntfId),
        stripUndefined({
          id: ntfId,
          ownerUid: firmUid,
          title: `New Document Uploaded — ${client?.name || 'Client'}`.slice(0, 200),
          message: `${newDoc.name} (${newDoc.category}) is ready for CA review.`,
          type: 'document',
          read: false,
          timestamp: nowTimestamp(),
          linkSection: 'documents',
          clientId: newDoc.clientId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      batch
        .commit()
        .catch((err) =>
          handleFirestoreError(err, OperationType.WRITE, `firms/${firmUid}/documents/${newDoc.id}`)
        );
    }

    addToast('Document recorded', `${newDoc.name} saved to Firestore.`);
    return newDoc;
  };

  const updateDocumentStatus = (docId: string, status: DocumentStatus, note?: string) => {
    if (!firmUid) return;
    const targetDoc = documents.find((d) => d.id === docId);
    if (!targetDoc) return;
    const client = clients.find((c) => c.id === targetDoc.clientId);

    const nextHistory = [
      ...targetDoc.history,
      {
        id: makeId('h'),
        action: `Marked ${status}`,
        actor: currentUser.name,
        timestamp: nowTimestamp(),
        ...(note ? { notes: note } : {}),
      },
    ].slice(-50);

    const nextComments = note
      ? [
          ...targetDoc.comments,
          {
            id: makeId('c'),
            author: currentUser.name,
            role: currentUser.role,
            text: note,
            timestamp: nowTimestamp(),
          },
        ].slice(-50)
      : targetDoc.comments;

    const batch = writeBatch(db);
    batch.update(doc(db, 'firms', firmUid, 'documents', docId), {
      status,
      history: stripUndefined(nextHistory),
      comments: stripUndefined(nextComments),
      updatedAt: serverTimestamp(),
    });

    docRequests
      .filter((r) => r.linkedDocumentId === docId || r.id === targetDoc.linkedRequestId)
      .forEach((r) => {
        const nextReqStatus =
          status === 'Verified'
            ? 'Verified'
            : status === 'Rejected' || status === 'Replacement Required'
            ? 'Correction Requested'
            : 'Under CA Review';
        batch.update(doc(db, 'firms', firmUid, 'docRequests', r.id), {
          status: nextReqStatus,
          updatedAt: serverTimestamp(),
        });
      });

    batch
      .commit()
      .then(() => {
        void logActivity(
          `marked document ${status}`,
          `${targetDoc.name} (${client?.name || ''})`,
          'documents',
          targetDoc.clientId
        );
        void pushNotification(
          status === 'Verified'
            ? `Document Verified — ${client?.name || 'Client'}`
            : `Document ${status} — ${client?.name || 'Client'}`,
          `${targetDoc.name} was marked ${status} by ${currentUser.name}.`,
          'document',
          'documents',
          targetDoc.clientId
        );
        addToast(`Document ${status}`, note || 'Status synchronized across client profile & reports.');
      })
      .catch((err) =>
        handleFirestoreError(err, OperationType.UPDATE, `firms/${firmUid}/documents/${docId}`)
      );
  };

  const addDocumentComment = (docId: string, text: string) => {
    if (!firmUid) return;
    const targetDoc = documents.find((d) => d.id === docId);
    if (!targetDoc) return;
    const nextComments = [
      ...targetDoc.comments,
      {
        id: makeId('c'),
        author: currentUser.name,
        role: currentUser.role,
        text,
        timestamp: nowTimestamp(),
      },
    ].slice(-50);

    updateDoc(doc(db, 'firms', firmUid, 'documents', docId), {
      comments: stripUndefined(nextComments),
      updatedAt: serverTimestamp(),
    })
      .then(() => addToast('Comment added'))
      .catch((err) =>
        handleFirestoreError(err, OperationType.UPDATE, `firms/${firmUid}/documents/${docId}`)
      );
  };

  const createDocumentRequest = (
    req: Omit<DocumentRequest, 'id' | 'requestedDate' | 'status'>
  ) => {
    if (!firmUid) return;
    const client = clients.find((c) => c.id === req.clientId);
    const reqId = makeId('req');
    const comId = makeId('com');
    const actId = makeId('act');
    const ntfId = makeId('ntf');

    const batch = writeBatch(db);
    batch.set(
      doc(db, 'firms', firmUid, 'docRequests', reqId),
      stripUndefined({
        ...req,
        id: reqId,
        ownerUid: firmUid,
        requestedDate: todayDate(),
        status: 'Sent to Client',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    batch.set(
      doc(db, 'firms', firmUid, 'communications', comId),
      stripUndefined({
        id: comId,
        ownerUid: firmUid,
        clientId: req.clientId,
        direction: 'Outbound (CA -> Client)',
        channel: 'Client Portal',
        subject: `Document Request: ${req.title}`.slice(0, 200),
        message: req.message,
        sender: req.requestedBy,
        timestamp: nowTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    batch.set(
      doc(db, 'firms', firmUid, 'activities', actId),
      stripUndefined({
        id: actId,
        ownerUid: firmUid,
        clientId: req.clientId,
        actor: currentUser.name,
        action: 'sent document request',
        target: `${req.title} (${client?.name || ''})`,
        timestamp: nowTimestamp(),
        section: 'reminders',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    batch.set(
      doc(db, 'firms', firmUid, 'notifications', ntfId),
      stripUndefined({
        id: ntfId,
        ownerUid: firmUid,
        title: `Document Request Sent — ${client?.name || ''}`.slice(0, 200),
        message: `Requested ${req.category}: ${req.title}`,
        type: 'document',
        read: false,
        timestamp: nowTimestamp(),
        linkSection: 'portal',
        clientId: req.clientId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    batch
      .commit()
      .then(() => addToast('Document request sent', 'Saved and visible in Client Portal & Reminders.'))
      .catch((err) =>
        handleFirestoreError(err, OperationType.WRITE, `firms/${firmUid}/docRequests/${reqId}`)
      );
  };

  const fulfillDocumentRequest = (requestId: string, docId: string) => {
    if (!firmUid) return;
    updateDoc(doc(db, 'firms', firmUid, 'docRequests', requestId), {
      status: 'Under CA Review',
      linkedDocumentId: docId,
      updatedAt: serverTimestamp(),
    }).catch((err) =>
      handleFirestoreError(err, OperationType.UPDATE, `firms/${firmUid}/docRequests/${requestId}`)
    );
  };

  const addComplianceTask = (task: Omit<ComplianceTask, 'id' | 'progressHistory'>) => {
    if (!firmUid) return;
    const id = makeId('cmp');
    const client = clients.find((c) => c.id === task.clientId);
    setDoc(
      doc(db, 'firms', firmUid, 'complianceTasks', id),
      stripUndefined({
        ...task,
        id,
        ownerUid: firmUid,
        progressHistory: [
          {
            id: makeId('ph'),
            note: 'Compliance task created.',
            actor: currentUser.name,
            date: todayDate(),
          },
        ],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    )
      .then(() => {
        void logActivity(
          'created compliance task',
          `${task.title} (${client?.name || ''})`,
          'compliance',
          task.clientId
        );
        addToast('Compliance task created', task.title);
      })
      .catch((err) =>
        handleFirestoreError(err, OperationType.CREATE, `firms/${firmUid}/complianceTasks/${id}`)
      );
  };

  const updateComplianceTask = (id: string, patch: Partial<ComplianceTask>) => {
    if (!firmUid) return;
    updateDoc(
      doc(db, 'firms', firmUid, 'complianceTasks', id),
      stripUndefined({ ...patch, updatedAt: serverTimestamp() })
    )
      .then(() => addToast('Compliance details updated'))
      .catch((err) =>
        handleFirestoreError(err, OperationType.UPDATE, `firms/${firmUid}/complianceTasks/${id}`)
      );
  };

  const updateComplianceStatus = (id: string, status: ComplianceStatus, note?: string) => {
    if (!firmUid) return;
    const target = complianceTasks.find((t) => t.id === id);
    if (!target) return;

    const nextHistory = [
      ...target.progressHistory,
      {
        id: makeId('ph'),
        note: note || `Status updated to ${status}`,
        actor: currentUser.name,
        date: todayDate(),
      },
    ].slice(-50);

    updateDoc(
      doc(db, 'firms', firmUid, 'complianceTasks', id),
      stripUndefined({
        status,
        completionDate: status === 'Completed' ? todayDate() : target.completionDate,
        progressHistory: nextHistory,
        updatedAt: serverTimestamp(),
      })
    )
      .then(() => {
        void logActivity(`marked compliance ${status}`, target.title, 'compliance', target.clientId);
        addToast(`Compliance marked ${status}`);
      })
      .catch((err) =>
        handleFirestoreError(err, OperationType.UPDATE, `firms/${firmUid}/complianceTasks/${id}`)
      );
  };

  const addStaffTask = (task: Omit<StaffTask, 'id' | 'comments' | 'timeline'>) => {
    if (!firmUid) return;
    const id = makeId('tsk');
    const batch = writeBatch(db);
    batch.set(
      doc(db, 'firms', firmUid, 'staffTasks', id),
      stripUndefined({
        ...task,
        id,
        ownerUid: firmUid,
        comments: [],
        timeline: [
          {
            id: makeId('tl'),
            event: 'Task created',
            actor: currentUser.name,
            timestamp: nowTimestamp(),
          },
        ],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    const actId = makeId('act');
    batch.set(
      doc(db, 'firms', firmUid, 'activities', actId),
      stripUndefined({
        id: actId,
        ownerUid: firmUid,
        clientId: task.clientId,
        actor: currentUser.name,
        action: 'created staff task',
        target: task.title,
        timestamp: nowTimestamp(),
        section: 'tasks',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    const ntfId = makeId('ntf');
    batch.set(
      doc(db, 'firms', firmUid, 'notifications', ntfId),
      stripUndefined({
        id: ntfId,
        ownerUid: firmUid,
        title: 'New Staff Task Assigned',
        message: `${task.title} assigned to ${
          employees.find((e) => e.id === task.assignedEmployeeId)?.name || 'Staff'
        }.`,
        type: 'task',
        read: false,
        timestamp: nowTimestamp(),
        linkSection: 'tasks',
        clientId: task.clientId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    batch
      .commit()
      .then(() => addToast('Task created', task.title))
      .catch((err) =>
        handleFirestoreError(err, OperationType.WRITE, `firms/${firmUid}/staffTasks/${id}`)
      );
  };

  const updateStaffTask = (id: string, patch: Partial<StaffTask>) => {
    if (!firmUid) return;
    updateDoc(
      doc(db, 'firms', firmUid, 'staffTasks', id),
      stripUndefined({ ...patch, updatedAt: serverTimestamp() })
    )
      .then(() => addToast('Task updated'))
      .catch((err) =>
        handleFirestoreError(err, OperationType.UPDATE, `firms/${firmUid}/staffTasks/${id}`)
      );
  };

  const updateStaffTaskStatus = (id: string, status: StaffTaskStatus) => {
    if (!firmUid) return;
    const target = staffTasks.find((t) => t.id === id);
    if (!target) return;
    const nextTimeline = [
      ...target.timeline,
      {
        id: makeId('tl'),
        event: `Status changed to ${status}`,
        actor: currentUser.name,
        timestamp: nowTimestamp(),
      },
    ].slice(-50);

    updateDoc(doc(db, 'firms', firmUid, 'staffTasks', id), {
      status,
      timeline: stripUndefined(nextTimeline),
      updatedAt: serverTimestamp(),
    })
      .then(() => {
        void logActivity(`moved task to ${status}`, target.title, 'tasks', target.clientId);
        addToast(`Task moved to ${status}`);
      })
      .catch((err) =>
        handleFirestoreError(err, OperationType.UPDATE, `firms/${firmUid}/staffTasks/${id}`)
      );
  };

  const addStaffTaskComment = (id: string, text: string) => {
    if (!firmUid) return;
    const target = staffTasks.find((t) => t.id === id);
    if (!target) return;
    const nextComments = [
      ...target.comments,
      { id: makeId('tc'), author: currentUser.name, text, timestamp: nowTimestamp() },
    ].slice(-50);

    updateDoc(doc(db, 'firms', firmUid, 'staffTasks', id), {
      comments: stripUndefined(nextComments),
      updatedAt: serverTimestamp(),
    })
      .then(() => addToast('Task comment added'))
      .catch((err) =>
        handleFirestoreError(err, OperationType.UPDATE, `firms/${firmUid}/staffTasks/${id}`)
      );
  };

  const updateValidationIssue = (
    id: string,
    status: ValidationIssue['status'],
    comment?: string
  ) => {
    if (!firmUid) return;
    const target = validationIssues.find((v) => v.id === id);
    if (!target) return;
    const nextComments = comment
      ? [
          ...target.internalComments,
          {
            id: makeId('vc'),
            author: currentUser.name,
            text: comment,
            timestamp: nowTimestamp(),
          },
        ].slice(-50)
      : target.internalComments;

    updateDoc(doc(db, 'firms', firmUid, 'validationIssues', id), {
      status,
      internalComments: stripUndefined(nextComments),
      updatedAt: serverTimestamp(),
    })
      .then(() => {
        void logActivity(
          `updated validation finding (${status})`,
          target.title,
          'validation',
          target.clientId
        );
        addToast(`Validation issue marked ${status}`);
      })
      .catch((err) =>
        handleFirestoreError(
          err,
          OperationType.UPDATE,
          `firms/${firmUid}/validationIssues/${id}`
        )
      );
  };

  const updateCrossComparison = (
    id: string,
    varianceStatus: CrossDocumentComparison['varianceStatus'],
    notes?: string
  ) => {
    if (!firmUid) return;
    const target = crossComparisons.find((c) => c.id === id);
    updateDoc(doc(db, 'firms', firmUid, 'crossComparisons', id), {
      varianceStatus,
      notes: notes ?? target?.notes ?? '',
      updatedAt: serverTimestamp(),
    })
      .then(() => addToast('Cross-document review updated'))
      .catch((err) =>
        handleFirestoreError(
          err,
          OperationType.UPDATE,
          `firms/${firmUid}/crossComparisons/${id}`
        )
      );
  };

  const markNotificationRead = (id: string, read = true) => {
    if (!firmUid) return;
    updateDoc(doc(db, 'firms', firmUid, 'notifications', id), {
      read,
      updatedAt: serverTimestamp(),
    }).catch((err) =>
      handleFirestoreError(err, OperationType.UPDATE, `firms/${firmUid}/notifications/${id}`)
    );
  };

  const markAllNotificationsRead = () => {
    if (!firmUid) return;
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    unread.forEach((n) => {
      batch.update(doc(db, 'firms', firmUid, 'notifications', n.id), {
        read: true,
        updatedAt: serverTimestamp(),
      });
    });
    batch
      .commit()
      .then(() => addToast('All notifications marked read'))
      .catch((err) =>
        handleFirestoreError(err, OperationType.UPDATE, `firms/${firmUid}/notifications`)
      );
  };

  const addReminder = (rem: Omit<ScheduledReminder, 'id'>) => {
    if (!firmUid) return;
    const id = makeId('rem');
    setDoc(
      doc(db, 'firms', firmUid, 'reminders', id),
      stripUndefined({
        ...rem,
        id,
        ownerUid: firmUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    )
      .then(() => {
        void logActivity('scheduled reminder', rem.title, 'reminders', rem.clientId);
        addToast(
          'Reminder scheduled',
          'Saved to Firestore. (External Email/WhatsApp dispatch requires messaging provider setup.)'
        );
      })
      .catch((err) =>
        handleFirestoreError(err, OperationType.CREATE, `firms/${firmUid}/reminders/${id}`)
      );
  };

  const triggerSimulatedReminder = (id: string) => {
    if (!firmUid) return;
    const rem = reminders.find((r) => r.id === id);
    if (!rem) return;
    const comId = makeId('com');
    const batch = writeBatch(db);
    batch.update(doc(db, 'firms', firmUid, 'reminders', id), {
      status: 'Sent (Simulated)',
      updatedAt: serverTimestamp(),
    });
    batch.set(
      doc(db, 'firms', firmUid, 'communications', comId),
      stripUndefined({
        id: comId,
        ownerUid: firmUid,
        clientId: rem.clientId,
        direction: 'Outbound (CA -> Client)',
        channel: rem.channel === 'Portal Alert' ? 'Client Portal' : 'Email (Simulated)',
        subject: rem.title,
        message: rem.message,
        sender: currentUser.name,
        timestamp: nowTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    batch
      .commit()
      .then(() => addToast('Simulated reminder logged', 'Recorded in Firestore communication history.'))
      .catch((err) =>
        handleFirestoreError(err, OperationType.UPDATE, `firms/${firmUid}/reminders/${id}`)
      );
  };

  const addCommunication = (log: Omit<CommunicationLog, 'id' | 'timestamp'>) => {
    if (!firmUid) return;
    const id = makeId('com');
    setDoc(
      doc(db, 'firms', firmUid, 'communications', id),
      stripUndefined({
        ...log,
        id,
        ownerUid: firmUid,
        timestamp: nowTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    )
      .then(() => addToast('Message recorded'))
      .catch((err) =>
        handleFirestoreError(err, OperationType.CREATE, `firms/${firmUid}/communications/${id}`)
      );
  };

  const addFinancialRecord = (rec: Omit<FinancialSummaryRecord, 'id'>) => {
    if (!firmUid) return;
    const id = makeId('fin');
    setDoc(
      doc(db, 'firms', firmUid, 'financialRecords', id),
      stripUndefined({
        ...rec,
        id,
        ownerUid: firmUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    )
      .then(() => {
        void logActivity(
          'saved extracted financial entry',
          `${rec.month} (${rec.sourceType})`,
          'financial',
          rec.clientId
        );
        addToast(
          'Saved to client records',
          'Provisional extracted record saved to Firestore Financial Overview.'
        );
      })
      .catch((err) =>
        handleFirestoreError(err, OperationType.CREATE, `firms/${firmUid}/financialRecords/${id}`)
      );
  };

  const updateSettings = (patch: Partial<FirmSettings>) => {
    if (!firmUid) return;
    updateDoc(
      doc(db, 'firms', firmUid),
      stripUndefined({ ...patch, updatedAt: serverTimestamp() })
    )
      .then(() => addToast('Settings saved', 'Firm settings persisted to Firestore.'))
      .catch((err) => handleFirestoreError(err, OperationType.UPDATE, `firms/${firmUid}`));
  };

  const addEmployee = (emp: Omit<Employee, 'id' | 'avatarInitials'>) => {
    if (!firmUid) return;
    const id = makeId('emp');
    const initials = computeInitials(emp.name);
    setDoc(
      doc(db, 'firms', firmUid, 'employees', id),
      stripUndefined({
        ...emp,
        id,
        ownerUid: firmUid,
        avatarInitials: initials,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    )
      .then(() => addToast('Team member added', emp.name))
      .catch((err) =>
        handleFirestoreError(err, OperationType.CREATE, `firms/${firmUid}/employees/${id}`)
      );
  };

  const updateEmployee = (id: string, patch: Partial<Employee>) => {
    if (!firmUid) return;
    updateDoc(
      doc(db, 'firms', firmUid, 'employees', id),
      stripUndefined({ ...patch, updatedAt: serverTimestamp() })
    )
      .then(() => addToast('Employee record updated'))
      .catch((err) =>
        handleFirestoreError(err, OperationType.UPDATE, `firms/${firmUid}/employees/${id}`)
      );
  };

  const updatePermission = (
    role: RolePermission['role'],
    field: keyof Omit<RolePermission, 'role'>,
    val: boolean
  ) => {
    if (!firmUid) return;
    const nextPermissions = permissions.map((p) => (p.role === role ? { ...p, [field]: val } : p));
    updateDoc(doc(db, 'firms', firmUid), {
      permissions: nextPermissions,
      updatedAt: serverTimestamp(),
    })
      .then(() => addToast('Permissions updated', `${role} access matrix saved to Firestore.`))
      .catch((err) => handleFirestoreError(err, OperationType.UPDATE, `firms/${firmUid}`));
  };

  const computeClientRiskScore = (clientId: string): ClientRiskScoreResult => {
    const client = clients.find((c) => c.id === clientId);
    if (!client) {
      return { score: 0, level: 'Low Risk', factors: [] };
    }
    return calculateClientRiskScore(
      client,
      documents,
      complianceTasks,
      validationIssues,
      anomalies,
      selectedFY
    );
  };

  const updateAnomalyStatus = (
    id: string,
    status: FinancialAnomaly['status'],
    caNote?: string
  ) => {
    if (!firmUid) return;
    const target = anomalies.find((a) => a.id === id);
    if (!target) return;
    updateDoc(
      doc(db, 'firms', firmUid, 'anomalies', id),
      stripUndefined({
        status,
        caNote: caNote ?? target.caNote,
        updatedAt: serverTimestamp(),
      })
    )
      .then(() => {
        void logActivity(`marked anomaly ${status}`, target.title, 'intelligence', target.clientId);
        addToast(`Anomaly marked ${status}`);
      })
      .catch((err) =>
        handleFirestoreError(err, OperationType.UPDATE, `firms/${firmUid}/anomalies/${id}`)
      );
  };

  const escalateAnomalyToTask = (id: string) => {
    if (!firmUid) return;
    const anomaly = anomalies.find((a) => a.id === id);
    if (!anomaly) return;
    const client = clients.find((c) => c.id === anomaly.clientId);
    const taskId = makeId('tsk-anom');
    const actId = makeId('act');

    const batch = writeBatch(db);
    batch.set(
      doc(db, 'firms', firmUid, 'staffTasks', taskId),
      stripUndefined({
        id: taskId,
        ownerUid: firmUid,
        title: `CA Anomaly Review: ${anomaly.title}`.slice(0, 200),
        description: `${anomaly.description}\nSource A: ${anomaly.sourceARef} (${anomaly.sourceAValue})\nSource B: ${anomaly.sourceBRef} (${anomaly.sourceBValue})`,
        clientId: anomaly.clientId,
        assignedEmployeeId: client?.assignedEmployeeId || currentUser.id,
        createdBy: currentUser.name,
        priority: anomaly.severity === 'Critical' ? 'Urgent' : 'High',
        startDate: todayDate(),
        dueDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
        status: 'Not Started',
        attachments: anomaly.sourceARef ? [anomaly.sourceARef] : [],
        comments: [],
        timeline: [
          {
            id: makeId('tl'),
            event: 'Auto-created from AI Financial Anomaly Detector',
            actor: currentUser.name,
            timestamp: nowTimestamp(),
          },
        ],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    batch.update(doc(db, 'firms', firmUid, 'anomalies', id), {
      status: 'Task Created',
      linkedTaskId: taskId,
      updatedAt: serverTimestamp(),
    });

    batch.set(
      doc(db, 'firms', firmUid, 'activities', actId),
      stripUndefined({
        id: actId,
        ownerUid: firmUid,
        clientId: anomaly.clientId,
        actor: currentUser.name,
        action: 'escalated anomaly to CA review task',
        target: anomaly.title,
        timestamp: nowTimestamp(),
        section: 'tasks',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    batch
      .commit()
      .then(() =>
        addToast('CA Review Task Created', 'Anomaly linked to Tasks & Workflow board in Firestore.')
      )
      .catch((err) =>
        handleFirestoreError(err, OperationType.WRITE, `firms/${firmUid}/anomalies/${id}`)
      );
  };

  const addAnomaly = (anomaly: Omit<FinancialAnomaly, 'id' | 'detectedAt'>) => {
    if (!firmUid) return;
    const id = makeId('anom');
    setDoc(
      doc(db, 'firms', firmUid, 'anomalies', id),
      stripUndefined({
        ...anomaly,
        id,
        ownerUid: firmUid,
        detectedAt: nowTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    )
      .then(() =>
        logActivity('flagged financial anomaly', anomaly.title, 'intelligence', anomaly.clientId)
      )
      .catch((err) =>
        handleFirestoreError(err, OperationType.CREATE, `firms/${firmUid}/anomalies/${id}`)
      );
  };

  const addCrossComparison = (comp: Omit<CrossDocumentComparison, 'id'>) => {
    if (!firmUid) return;
    const id = makeId('cc');
    setDoc(
      doc(db, 'firms', firmUid, 'crossComparisons', id),
      stripUndefined({
        ...comp,
        id,
        ownerUid: firmUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    )
      .then(() => {
        void logActivity(
          'added cross-document reconciliation',
          comp.metric,
          'intelligence',
          comp.clientId
        );
        addToast('Reconciliation entry recorded', comp.metric);
      })
      .catch((err) =>
        handleFirestoreError(
          err,
          OperationType.CREATE,
          `firms/${firmUid}/crossComparisons/${id}`
        )
      );
  };

  const runDocumentToActionPipeline: PracticeContextValue['runDocumentToActionPipeline'] = (
    params
  ) => {
    const docId = makeId('doc');
    const taskId = makeId('tsk-pipe');
    const hasIssues = Boolean(params.detectedIssues && params.detectedIssues.length > 0);
    const client = clients.find((c) => c.id === params.clientId);

    const newDoc: DocumentRecord = {
      id: docId,
      name: params.name,
      fileType: params.fileType,
      fileSize: params.fileSize,
      clientId: params.clientId,
      category: params.category,
      financialYear: selectedFY,
      uploadedBy: currentUser.name,
      uploadedByRole: 'Staff',
      uploadDate: todayDate(),
      status: 'Pending Review',
      previewSummary: params.previewSummary,
      extractedMetrics: params.extractedMetrics,
      comments: [],
      history: [
        {
          id: makeId('h'),
          action: 'Uploaded & extracted via Document-to-Action Automation',
          actor: currentUser.name,
          timestamp: nowTimestamp(),
        },
      ],
    };

    if (firmUid) {
      const batch = writeBatch(db);
      batch.set(
        doc(db, 'firms', firmUid, 'documents', docId),
        stripUndefined({
          ...newDoc,
          ownerUid: firmUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      batch.set(
        doc(db, 'firms', firmUid, 'staffTasks', taskId),
        stripUndefined({
          id: taskId,
          ownerUid: firmUid,
          title: `CA Review: ${params.name} (${client?.name || 'Client'})`.slice(0, 200),
          description: hasIssues
            ? `Document-to-Action pipeline detected items requiring CA sign-off:\n• ${params.detectedIssues!.join('\n• ')}`
            : `Extracted ${params.category} ready for CA verification and final sign-off.`,
          clientId: params.clientId,
          assignedEmployeeId: client?.assignedEmployeeId || currentUser.id,
          createdBy: 'Document-to-Action Automation',
          priority: hasIssues ? 'High' : 'Medium',
          startDate: todayDate(),
          dueDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
          status: 'Under Review',
          attachments: [params.name],
          comments: [],
          timeline: [
            {
              id: makeId('tl'),
              event: `Pipeline step: Upload → Extract → Validate (${params.detectedIssues?.length || 0} flags) → CA Review Task`,
              actor: currentUser.name,
              timestamp: nowTimestamp(),
            },
          ],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      (params.detectedIssues || []).forEach((issue, idx) => {
        const anomId = makeId(`anom-pipe-${idx}`);
        batch.set(
          doc(db, 'firms', firmUid, 'anomalies', anomId),
          stripUndefined({
            id: anomId,
            ownerUid: firmUid,
            clientId: params.clientId,
            documentId: docId,
            type: 'Tax Calculation Variance',
            severity: 'Warning',
            title: `Extracted Check Flag — ${params.name}`.slice(0, 200),
            description: issue,
            sourceARef: params.name,
            sourceAValue:
              params.extractedMetrics?.totalAmount !== undefined
                ? formatINR(params.extractedMetrics.totalAmount)
                : 'Extracted',
            sourceBRef: 'FinSight Automated Rule Check',
            sourceBValue: 'CA Verification Required',
            detectedAt: nowTimestamp(),
            status: 'Task Created',
            linkedTaskId: taskId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      });

      const actId = makeId('act');
      batch.set(
        doc(db, 'firms', firmUid, 'activities', actId),
        stripUndefined({
          id: actId,
          ownerUid: firmUid,
          clientId: params.clientId,
          actor: currentUser.name,
          action: 'ran Document-to-Action automation',
          target: `${params.name} → Task & ${params.detectedIssues?.length || 0} check(s)`,
          timestamp: nowTimestamp(),
          section: 'documents',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      const ntfId = makeId('ntf');
      batch.set(
        doc(db, 'firms', firmUid, 'notifications', ntfId),
        stripUndefined({
          id: ntfId,
          ownerUid: firmUid,
          title: `Document-to-Action Ready — ${client?.name || 'Client'}`.slice(0, 200),
          message: `${params.name} extracted, validated, and queued for CA Review.`,
          type: 'document',
          read: false,
          timestamp: nowTimestamp(),
          linkSection: 'tasks',
          clientId: params.clientId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      batch
        .commit()
        .catch((err) =>
          handleFirestoreError(err, OperationType.WRITE, `firms/${firmUid}/documents/${docId}`)
        );
    }

    addToast(
      'Document-to-Action Executed',
      `Saved ${params.name}, logged ${params.detectedIssues?.length || 0} flag(s), and created CA review task.`
    );
    return { doc: newDoc, createdTaskId: taskId };
  };

  const resetDemoData = () => {
    if (!firmUid) return;
    const subCollections = [
      'clients',
      'documents',
      'complianceTasks',
      'staffTasks',
      'docRequests',
      'notifications',
      'reminders',
      'communications',
      'validationIssues',
      'crossComparisons',
      'financialRecords',
      'anomalies',
      'activities',
    ];

    void (async () => {
      try {
        const batch = writeBatch(db);
        for (const colName of subCollections) {
          const snap = await getDocs(
            query(collection(db, 'firms', firmUid, colName), where('ownerUid', '==', firmUid))
          );
          snap.docs.forEach((d) => batch.delete(d.ref));
        }
        await batch.commit();
        addToast(
          'Workspace cleared',
          'All practice collections cleared from Firestore. Firm settings and staff profile preserved.',
          'info'
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `firms/${firmUid}`);
      }
    })();
  };

  const logoutDemoSession = () => {
    void signOutUser();
  };

  const unlockDemoSession = () => {
    void signInWithGoogle();
  };

  return (
    <PracticeContext.Provider
      value={{
        authReady,
        firebaseUser,
        authError,
        firestoreReady,
        signInWithGoogle,
        signOutUser,
        clients,
        documents,
        complianceTasks,
        staffTasks,
        docRequests,
        notifications,
        reminders,
        communications,
        validationIssues,
        crossComparisons,
        financialRecords,
        anomalies,
        activities,
        employees,
        permissions,
        settings,
        selectedFY,
        currentEmployeeId,
        previewClientId,
        activeSection,
        setActiveSection,
        selectedClientId,
        setSelectedClientId,
        openClientProfile,
        sidebarCollapsed,
        setSidebarCollapsed,
        mobileMenuOpen,
        setMobileMenuOpen,
        toasts,
        addToast,
        dismissToast,
        currentUser,
        setCurrentEmployeeId,
        setSelectedFY,
        setPreviewClientId,
        isDemoClientMode,
        setIsDemoClientMode,
        globalSearchQuery,
        setGlobalSearchQuery,
        quickAddOpen,
        setQuickAddOpen,
        quickAddInitialType,
        openQuickAdd,
        copilotOpen,
        setCopilotOpen,
        queuedCopilotPrompt,
        openCopilotWithPrompt,
        clearQueuedCopilotPrompt,
        computeClientRiskScore,
        updateAnomalyStatus,
        escalateAnomalyToTask,
        addAnomaly,
        addCrossComparison,
        runDocumentToActionPipeline,
        addClient,
        addClientAsync,
        updateClient,
        setClientStatus,
        addDocument,
        updateDocumentStatus,
        addDocumentComment,
        createDocumentRequest,
        fulfillDocumentRequest,
        addComplianceTask,
        updateComplianceTask,
        updateComplianceStatus,
        addStaffTask,
        updateStaffTask,
        updateStaffTaskStatus,
        addStaffTaskComment,
        updateValidationIssue,
        updateCrossComparison,
        markNotificationRead,
        markAllNotificationsRead,
        addReminder,
        triggerSimulatedReminder,
        addCommunication,
        addFinancialRecord,
        updateSettings,
        addEmployee,
        updateEmployee,
        updatePermission,
        resetDemoData,
        logoutDemoSession,
        demoLocked: !firebaseUser,
        unlockDemoSession,
      }}
    >
      {children}
    </PracticeContext.Provider>
  );
};

export function usePractice() {
  const ctx = useContext(PracticeContext);
  if (!ctx) throw new Error('usePractice must be used within PracticeProvider');
  return ctx;
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function maskIdentifier(val?: string, mask = true): string {
  if (!val) return '—';
  if (!mask || val.length < 6) return val;
  return `${val.slice(0, 3)}••••${val.slice(-3)}`;
}

export function computeMissingDocsForClient(
  client: Client,
  documents: DocumentRecord[],
  fy: FinancialYear
): { category: DocumentCategory; state: 'Received' | 'Pending' | 'Missing' }[] {
  const clientDocs = documents.filter((d) => d.clientId === client.id && d.financialYear === fy);
  return client.requiredCategories.map((cat) => {
    const matched = clientDocs.filter((d) => d.category === cat);
    if (matched.some((d) => d.status === 'Verified')) {
      return { category: cat, state: 'Received' };
    }
    if (matched.length > 0) {
      return { category: cat, state: 'Pending' };
    }
    return { category: cat, state: 'Missing' };
  });
}

export function calculateClientRiskScore(
  client: Client,
  documents: DocumentRecord[],
  complianceTasks: ComplianceTask[],
  validationIssues: ValidationIssue[],
  anomalies: FinancialAnomaly[],
  fy: FinancialYear
): ClientRiskScoreResult {
  const factors: ClientRiskFactor[] = [];

  const checklist = computeMissingDocsForClient(client, documents, fy);
  const missingCount = checklist.filter((c) => c.state === 'Missing').length;
  if (missingCount > 0) {
    const pts = Math.min(32, missingCount * 11);
    factors.push({
      label: 'Missing Mandatory Documents',
      points: pts,
      detail: `${missingCount} required category(s) not yet uploaded for ${fy}`,
    });
  }

  const clientCompliance = complianceTasks.filter((c) => c.clientId === client.id);
  const overdueCount = clientCompliance.filter((c) => c.status === 'Overdue').length;
  if (overdueCount > 0) {
    const pts = Math.min(30, overdueCount * 22);
    factors.push({
      label: 'Overdue Compliance Filings',
      points: pts,
      detail: `${overdueCount} statutory filing(s) past due date`,
    });
  }

  const awaitingOrUrgent = clientCompliance.filter(
    (c) =>
      c.status !== 'Completed' &&
      c.status !== 'Overdue' &&
      (c.status === 'Awaiting Documents' || c.priority === 'Urgent' || c.priority === 'High')
  ).length;
  if (awaitingOrUrgent > 0) {
    const pts = Math.min(20, awaitingOrUrgent * 10);
    factors.push({
      label: 'Approaching / Blocked Deadlines',
      points: pts,
      detail: `${awaitingOrUrgent} active high-urgency or doc-blocked filing(s)`,
    });
  }

  const rejectedDocs = documents.filter(
    (d) => d.clientId === client.id && (d.status === 'Rejected' || d.status === 'Replacement Required')
  ).length;
  if (rejectedDocs > 0) {
    const pts = Math.min(18, rejectedDocs * 10);
    factors.push({
      label: 'Rejected / Replacement Required Docs',
      points: pts,
      detail: `${rejectedDocs} document(s) require resubmission`,
    });
  }

  const openValIssues = validationIssues.filter(
    (v) =>
      v.clientId === client.id &&
      (v.status === 'Open' || v.status === 'Correction Requested' || v.status === 'Rejected')
  ).length;
  const openAnomalies = anomalies.filter(
    (a) => a.clientId === client.id && (a.status === 'Flagged for CA Review' || a.status === 'Task Created')
  ).length;
  const issueTotal = openValIssues + openAnomalies;
  if (issueTotal > 0) {
    const pts = Math.min(24, issueTotal * 8);
    factors.push({
      label: 'Unresolved Validation & Anomaly Flags',
      points: pts,
      detail: `${openValIssues} validation + ${openAnomalies} anomaly alert(s) awaiting CA resolution`,
    });
  }

  const pendingApprovals = documents.filter(
    (d) => d.clientId === client.id && (d.status === 'Pending Review' || d.status === 'Uploaded')
  ).length;
  if (pendingApprovals > 0) {
    const pts = Math.min(12, pendingApprovals * 6);
    factors.push({
      label: 'Pending CA Approvals',
      points: pts,
      detail: `${pendingApprovals} document(s) awaiting CA sign-off`,
    });
  }

  const score = Math.min(
    100,
    factors.reduce((sum, f) => sum + f.points, 0)
  );

  const level: ClientRiskScoreResult['level'] =
    score >= 70
      ? 'Critical Risk'
      : score >= 45
      ? 'High Risk'
      : score >= 20
      ? 'Moderate Risk'
      : 'Low Risk';

  return { score, level, factors };
}
