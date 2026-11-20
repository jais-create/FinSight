import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  X,
  Send,
  Paperclip,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowRight,
  Trash2,
  RotateCcw,
  UserPlus,
  FileCheck2,
  CalendarClock,
  ClipboardCheck,
  BellRing,
  Check,
  Ban,
  Zap,
} from 'lucide-react';
import {
  computeMissingDocsForClient,
  formatINR,
  usePractice,
} from '../../context/PracticeContext';
import {
  ClientType,
  ComplianceType,
  CopilotActionType,
  CopilotProposedAction,
  DocumentCategory,
  DocumentRecord,
  ExtractedDocumentPayload,
  NavSection,
  PriorityLevel,
  ScheduledReminder,
} from '../../types';

interface ActionExecutionState {
  status: 'pending' | 'executing' | 'executed' | 'dismissed' | 'error';
  resultLabel?: string;
  targetSection?: NavSection;
  errorMessage?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  attachmentName?: string;
  attachmentMime?: string;
  attachmentPreviewUrl?: string;
  extracted?: ExtractedDocumentPayload;
  proposedActions?: CopilotProposedAction[];
  actionStates?: Record<string, ActionExecutionState>;
  error?: boolean;
  retryPrompt?: string;
  retryAttachment?: PendingAttachment | null;
  timestamp: string;
}

interface PendingAttachment {
  name: string;
  mimeType: string;
  sizeLabel: string;
  base64Data?: string;
  textContent?: string;
  previewUrl?: string;
}

const SUGGESTED_PROMPTS = [
  "Which clients haven't submitted bank statements?",
  'Show all overdue GST-related tasks.',
  'Which employee has the most pending work?',
  'Draft a follow-up reminder for clients with missing documents.',
];

const VALID_CLIENT_TYPES: ClientType[] = [
  'Individual',
  'Private Limited',
  'Partnership',
  'LLP',
  'Proprietorship',
];

const VALID_DOCUMENT_CATEGORIES: DocumentCategory[] = [
  'PAN Card',
  'Aadhaar',
  'GST Registration Certificate',
  'Sales Invoices',
  'Purchase Invoices',
  'Bank Statements',
  'Income Tax Returns',
  'TDS Certificates',
  'Form 16',
  'Balance Sheets',
  'Profit & Loss Statements',
  'Audit Reports',
  'Other Financial Documents',
];

const VALID_COMPLIANCE_TYPES: ComplianceType[] = [
  'GST Returns',
  'GSTR-1',
  'GSTR-3B',
  'Income Tax Returns',
  'Advance Tax',
  'TDS Returns',
  'TDS Payments',
  'Tax Audit',
  'ROC Compliance',
  'Custom Compliance',
];

const VALID_PRIORITIES: PriorityLevel[] = ['Low', 'Medium', 'High', 'Urgent'];

const VALID_REMINDER_TYPES: ScheduledReminder['reminderType'][] = [
  'Document Follow-up',
  'Compliance Deadline',
  'Client Check-in',
];

const VALID_REMINDER_CHANNELS: ScheduledReminder['channel'][] = [
  'Email (Simulated)',
  'WhatsApp (Simulated)',
  'Portal Alert',
];

function resolveClientMimeType(file: File): string {
  const normalizedType = file.type?.toLowerCase().trim();
  if (normalizedType === 'image/jpg' || normalizedType === 'image/pjpeg') return 'image/jpeg';
  if (normalizedType === 'image/x-png') return 'image/png';
  if (normalizedType && normalizedType !== 'application/octet-stream') return normalizedType;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'txt' || ext === 'json' || ext === 'tsv' || ext === 'md' || ext === 'xml') {
    return 'text/plain';
  }
  return 'application/pdf';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(chunks.join(''));
}

function safeStr(val: unknown, maxLen: number): string {
  return String(val ?? '').trim().slice(0, maxLen);
}

const PLACEHOLDER_TEXT = new Set([
  'not found in document',
  'not found',
  'n/a',
  'na',
  'none',
  'unknown',
  'null',
  'undefined',
  '—',
  '-',
]);

function cleanExtractedField(val: unknown, maxLen: number): string {
  const s = safeStr(val, maxLen);
  if (!s || PLACEHOLDER_TEXT.has(s.toLowerCase())) return '';
  return s;
}

function normalizeDateYYYYMMDD(val: unknown, daysOffset = 0): string {
  const raw = String(val ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return new Date(Date.now() + daysOffset * 86400000).toISOString().slice(0, 10);
}

function normalizeClientType(val: unknown): ClientType {
  const raw = String(val ?? '').trim();
  const exact = VALID_CLIENT_TYPES.find((t) => t.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const lower = raw.toLowerCase();
  if (lower.includes('pvt') || lower.includes('private') || lower.includes('limited') && !lower.includes('llp')) {
    return 'Private Limited';
  }
  if (lower.includes('llp')) return 'LLP';
  if (lower.includes('partner')) return 'Partnership';
  if (lower.includes('prop')) return 'Proprietorship';
  if (lower.includes('indiv')) return 'Individual';
  return 'Private Limited';
}

function normalizeDocCategory(val: unknown): DocumentCategory {
  const raw = String(val ?? '').trim();
  const exact = VALID_DOCUMENT_CATEGORIES.find((c) => c.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const lower = raw.toLowerCase();
  if (lower.includes('sale')) return 'Sales Invoices';
  if (lower.includes('purch') || lower.includes('invoice') || lower.includes('bill')) return 'Purchase Invoices';
  if (lower.includes('bank') || lower.includes('statement')) return 'Bank Statements';
  if (lower.includes('gst')) return 'GST Registration Certificate';
  if (lower.includes('pan')) return 'PAN Card';
  if (lower.includes('aadhaar')) return 'Aadhaar';
  if (lower.includes('tds')) return 'TDS Certificates';
  if (lower.includes('itr') || lower.includes('income tax')) return 'Income Tax Returns';
  if (lower.includes('form 16')) return 'Form 16';
  if (lower.includes('balance')) return 'Balance Sheets';
  if (lower.includes('profit') || lower.includes('p&l')) return 'Profit & Loss Statements';
  if (lower.includes('audit')) return 'Audit Reports';
  return 'Other Financial Documents';
}

function normalizeDocFileType(val: unknown, fallbackMime?: string, fallbackName?: string): DocumentRecord['fileType'] {
  const raw = `${String(val ?? '')} ${fallbackMime ?? ''} ${fallbackName ?? ''}`.toUpperCase();
  if (raw.includes('CSV')) return 'CSV';
  if (raw.includes('XLS')) return 'XLSX';
  if (raw.includes('JPG') || raw.includes('JPEG')) return 'JPG';
  if (raw.includes('PNG') || raw.includes('WEBP') || raw.includes('GIF') || raw.includes('HEIC')) return 'PNG';
  return 'PDF';
}

function normalizeComplianceType(val: unknown): ComplianceType {
  const raw = String(val ?? '').trim();
  const exact = VALID_COMPLIANCE_TYPES.find((c) => c.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const lower = raw.toLowerCase();
  if (lower.includes('3b')) return 'GSTR-3B';
  if (lower.includes('gstr-1') || lower.includes('gstr1')) return 'GSTR-1';
  if (lower.includes('gst')) return 'GST Returns';
  if (lower.includes('advance')) return 'Advance Tax';
  if (lower.includes('itr') || lower.includes('income tax')) return 'Income Tax Returns';
  if (lower.includes('tds') && lower.includes('pay')) return 'TDS Payments';
  if (lower.includes('tds')) return 'TDS Returns';
  if (lower.includes('audit')) return 'Tax Audit';
  if (lower.includes('roc') || lower.includes('aoc') || lower.includes('mgt')) return 'ROC Compliance';
  return 'Custom Compliance';
}

function normalizePriority(val: unknown): PriorityLevel {
  const raw = String(val ?? '').trim().toLowerCase();
  const matched = VALID_PRIORITIES.find((p) => p.toLowerCase() === raw);
  return matched || 'Medium';
}

const ACTION_META: Record<
  CopilotActionType,
  { label: string; icon: React.ComponentType<{ className?: string }>; section: NavSection; sectionLabel: string }
> = {
  create_client: {
    label: 'Create Client & Onboarding',
    icon: UserPlus,
    section: 'clients',
    sectionLabel: 'View Clients',
  },
  log_document: {
    label: 'Log Document to Vault',
    icon: FileCheck2,
    section: 'documents',
    sectionLabel: 'Open Vault',
  },
  create_compliance_task: {
    label: 'Create Compliance Task',
    icon: CalendarClock,
    section: 'compliance',
    sectionLabel: 'Open Calendar',
  },
  create_staff_task: {
    label: 'Assign Staff Workflow Task',
    icon: ClipboardCheck,
    section: 'tasks',
    sectionLabel: 'View Tasks',
  },
  draft_reminder: {
    label: 'Schedule Client Reminder',
    icon: BellRing,
    section: 'reminders',
    sectionLabel: 'View Reminders',
  },
};

export const FinSightCopilotDrawer: React.FC = () => {
  const {
    copilotOpen,
    firebaseUser,
    openClientProfile,
    setCopilotOpen,
    queuedCopilotPrompt,
    clearQueuedCopilotPrompt,
    clients,
    documents,
    complianceTasks,
    staffTasks,
    validationIssues,
    anomalies,
    employees,
    currentUser,
    selectedFY,
    computeClientRiskScore,
    addClientAsync,
    addDocument,
    addComplianceTask,
    addStaffTask,
    addReminder,
    runDocumentToActionPipeline,
    setActiveSection,
    addToast,
  } = usePractice();

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text:
        'FinSight AI Agent ready for A Y & COMPANY. Attach invoices, PDFs, images, or CSV statements for verbatim extraction — or instruct me directly to onboard a client from an invoice, log documents, schedule GST/TDS compliance tasks, assign staff tasks, or draft follow-up reminders.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [extractClientId, setExtractClientId] = useState(clients[0]?.id || '');
  const [actionClientOverrides, setActionClientOverrides] = useState<Record<string, string>>({});
  const [createdClientIdsByName, setCreatedClientIdsByName] = useState<Record<string, string>>({});
  const [directClientTargetByMsg, setDirectClientTargetByMsg] = useState<Record<string, 'party' | 'counterparty'>>({});
  const [directClientTypeByMsg, setDirectClientTypeByMsg] = useState<Record<string, ClientType>>({});
  const [directAddingMsgId, setDirectAddingMsgId] = useState<string | null>(null);
  const [directAddedClientByMsg, setDirectAddedClientByMsg] = useState<Record<string, { id: string; name: string; code: string }>>({});
  const [loading, setLoading] = useState(false);
  const [extractingStructured, setExtractingStructured] = useState(false);

  useEffect(() => {
    if (!extractClientId || !clients.some((c) => c.id === extractClientId)) {
      setExtractClientId(clients[0]?.id || '');
    }
  }, [clients, extractClientId]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const practiceContext = useMemo(() => {
    return {
      firm: 'A Y & COMPANY – Chartered Accountants, Jaipur',
      activeFinancialYear: selectedFY,
      clients: clients.map((c) => {
        const missingChecklist = computeMissingDocsForClient(c, documents, selectedFY);
        const risk = computeClientRiskScore(c.id);
        return {
          id: c.id,
          code: c.clientCode,
          name: c.name,
          type: c.type,
          status: c.status,
          assignedEmployee: employees.find((e) => e.id === c.assignedEmployeeId)?.name || 'Unassigned',
          riskScore: risk.score,
          riskLevel: risk.level,
          missingDocuments: missingChecklist.filter((m) => m.state === 'Missing').map((m) => m.category),
          pendingReviewDocuments: missingChecklist.filter((m) => m.state === 'Pending').map((m) => m.category),
        };
      }),
      documents: documents.map((d) => ({
        name: d.name,
        client: clients.find((c) => c.id === d.clientId)?.name || d.clientId,
        category: d.category,
        fy: d.financialYear,
        status: d.status,
        uploadDate: d.uploadDate,
        metrics: d.extractedMetrics,
      })),
      complianceTasks: complianceTasks.map((t) => ({
        title: t.title,
        client: clients.find((c) => c.id === t.clientId)?.name || t.clientId,
        type: t.type,
        dueDate: t.dueDate,
        status: t.status,
        priority: t.priority,
        assignee: employees.find((e) => e.id === t.assignedEmployeeId)?.name || t.assignedEmployeeId,
      })),
      staffWorkload: employees.map((e) => {
        const openStaff = staffTasks.filter((t) => t.assignedEmployeeId === e.id && t.status !== 'Completed');
        const openCmp = complianceTasks.filter((c) => c.assignedEmployeeId === e.id && c.status !== 'Completed');
        return {
          name: e.name,
          role: e.role,
          openStaffTasks: openStaff.length,
          openComplianceTasks: openCmp.length,
          totalPendingWork: openStaff.length + openCmp.length,
          taskTitles: openStaff.map((t) => `${t.title} [${t.status}]`),
        };
      }),
      openAnomalies: anomalies
        .filter((a) => a.status !== 'Resolved' && a.status !== 'Dismissed')
        .map((a) => ({
          title: a.title,
          client: clients.find((c) => c.id === a.clientId)?.name || a.clientId,
          severity: a.severity,
          sourceA: `${a.sourceARef}: ${a.sourceAValue}`,
          sourceB: `${a.sourceBRef}: ${a.sourceBValue}`,
          status: a.status,
        })),
      openValidationIssues: validationIssues
        .filter((v) => v.status !== 'Approved')
        .map((v) => ({
          title: v.title,
          client: clients.find((c) => c.id === v.clientId)?.name || v.clientId,
          severity: v.severity,
          detectedValue: v.detectedValue,
          status: v.status,
        })),
    };
  }, [clients, documents, complianceTasks, staffTasks, validationIssues, anomalies, employees, selectedFY, computeClientRiskScore]);

  const processAttachedFile = async (file: File) => {
    if (file.size === 0) {
      addToast('Empty File', `"${file.name}" is empty (0 bytes) and cannot be attached.`, 'error');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      addToast('File Too Large', `"${file.name}" exceeds the 15 MB inline analysis limit.`, 'error');
      return;
    }

    const sizeLabel =
      file.size >= 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
        : `${Math.max(1, Math.round(file.size / 1024))} KB`;

    const resolvedMime = resolveClientMimeType(file);
    const isTextLike =
      resolvedMime.startsWith('text/') ||
      /\.(csv|txt|json|tsv|md|xml)$/i.test(file.name);

    setReadingFile(true);
    try {
      if (isTextLike) {
        const textContent = await file.text();
        if (!textContent.trim()) {
          throw new Error(`"${file.name}" contains no readable text.`);
        }
        setAttachment({
          name: file.name,
          mimeType: resolvedMime,
          sizeLabel,
          textContent,
        });
      } else {
        let dataUrl = '';
        let base64 = '';
        try {
          const encoded = await new Promise<{ dataUrl: string; base64: string }>(
            (resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrlStr = typeof reader.result === 'string' ? reader.result : '';
                const base64Str = dataUrlStr.includes(',')
                  ? dataUrlStr.split(',')[1].trim()
                  : dataUrlStr.trim();
                if (!base64Str) {
                  reject(new Error('FileReader produced empty base64 payload.'));
                  return;
                }
                resolve({ dataUrl: dataUrlStr, base64: base64Str });
              };
              reader.onerror = () => reject(new Error('FileReader failed to read attached file.'));
              reader.readAsDataURL(file);
            }
          );
          dataUrl = encoded.dataUrl;
          base64 = encoded.base64;
        } catch {
          // Binary ArrayBuffer fallback if FileReader failed on browser blob
          const buf = await file.arrayBuffer();
          base64 = arrayBufferToBase64(buf);
          if (!base64) {
            throw new Error(`Could not encode "${file.name}" into base64.`);
          }
          dataUrl = `data:${resolvedMime};base64,${base64}`;
        }

        setAttachment({
          name: file.name,
          mimeType: resolvedMime,
          sizeLabel,
          base64Data: base64,
          previewUrl: resolvedMime.startsWith('image/') ? dataUrl : undefined,
        });
      }
    } catch (err) {
      addToast(
        'File Read Error',
        err instanceof Error ? err.message : 'Could not read the selected file.',
        'error'
      );
    } finally {
      setReadingFile(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await processAttachedFile(file);
  };

  const resolveClientIdForAction = (
    action: CopilotProposedAction,
    extraClientMap?: Record<string, string>
  ): string | undefined => {
    const manualOverride = actionClientOverrides[action.id];
    if (manualOverride && clients.some((c) => c.id === manualOverride)) {
      return manualOverride;
    }

    const argId = safeStr(action.args.clientId, 128);
    if (argId && clients.some((c) => c.id === argId)) {
      return argId;
    }

    const argName = safeStr(action.args.clientName, 160).toLowerCase();
    if (argName) {
      if (extraClientMap && extraClientMap[argName]) {
        return extraClientMap[argName];
      }
      if (createdClientIdsByName[argName]) {
        return createdClientIdsByName[argName];
      }
      const exactClient = clients.find((c) => c.name.toLowerCase() === argName);
      if (exactClient) return exactClient.id;
      const fuzzyClient = clients.find(
        (c) => c.name.toLowerCase().includes(argName) || argName.includes(c.name.toLowerCase())
      );
      if (fuzzyClient) return fuzzyClient.id;
    }

    return undefined;
  };

  const resolveEmployeeId = (nameVal: unknown, fallbackClientId?: string): string => {
    const raw = safeStr(nameVal, 120).toLowerCase();
    if (raw) {
      const emp = employees.find(
        (e) => e.name.toLowerCase() === raw || e.name.toLowerCase().includes(raw) || raw.includes(e.name.toLowerCase())
      );
      if (emp) return emp.id;
    }
    const client = fallbackClientId ? clients.find((c) => c.id === fallbackClientId) : undefined;
    return client?.assignedEmployeeId || currentUser.id;
  };

  const setMessageActionState = (
    messageId: string,
    actionId: string,
    nextState: ActionExecutionState
  ) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? {
              ...m,
              actionStates: {
                ...(m.actionStates || {}),
                [actionId]: nextState,
              },
            }
          : m
      )
    );
  };

  const executeSingleAction = async (
    message: ChatMessage,
    action: CopilotProposedAction,
    sessionClientMap?: Record<string, string>
  ): Promise<{ createdClient?: { name: string; id: string } }> => {
    setMessageActionState(message.id, action.id, { status: 'executing' });

    try {
      const meta = ACTION_META[action.name];

      if (action.name === 'create_client') {
        if (!firebaseUser) {
          throw new Error('Please sign in with Google to save clients directly to Firestore.');
        }

        const clientName = cleanExtractedField(action.args.name, 160);
        if (!clientName) {
          throw new Error('Client name is required to onboard a client.');
        }

        const panClean = cleanExtractedField(action.args.pan, 20).toUpperCase();
        const gstinClean = cleanExtractedField(action.args.gstin, 30).toUpperCase();

        const existing = clients.find(
          (c) =>
            c.name.toLowerCase() === clientName.toLowerCase() ||
            (panClean && c.pan && c.pan.toUpperCase() === panClean) ||
            (gstinClean && c.gstin && c.gstin.toUpperCase() === gstinClean)
        );
        if (existing) {
          setCreatedClientIdsByName((prev) => ({
            ...prev,
            [clientName.toLowerCase()]: existing.id,
          }));
          setExtractClientId(existing.id);
          setMessageActionState(message.id, action.id, {
            status: 'executed',
            resultLabel: `Linked existing client ${existing.name} (${existing.clientCode})`,
            targetSection: 'clients',
          });
          return { createdClient: { name: existing.name.toLowerCase(), id: existing.id } };
        }

        const created = await addClientAsync({
          name: clientName,
          type: normalizeClientType(cleanExtractedField(action.args.type, 40) || clientName),
          dobOrIncDate: '',
          email: cleanExtractedField(action.args.email, 200),
          phone: cleanExtractedField(action.args.phone, 40),
          address: cleanExtractedField(action.args.address, 300),
          city: cleanExtractedField(action.args.city, 80),
          state: cleanExtractedField(action.args.state, 80),
          pinCode: cleanExtractedField(action.args.pinCode, 20),
          pan: panClean,
          ...(gstinClean ? { gstin: gstinClean } : {}),
          financialYear: selectedFY,
          services: [],
          assignedEmployeeId: currentUser.id,
          onboardingDate: new Date().toISOString().slice(0, 10),
          notes:
            cleanExtractedField(action.args.notes, 2000) ||
            'Created directly via FinSight AI Copilot.',
          status: 'Active',
          requiredCategories: [],
        });

        setCreatedClientIdsByName((prev) => ({
          ...prev,
          [created.name.toLowerCase()]: created.id,
        }));
        setExtractClientId(created.id);

        setMessageActionState(message.id, action.id, {
          status: 'executed',
          resultLabel: `Added ${created.name} (${created.clientCode}) directly to Clients`,
          targetSection: 'clients',
        });
        return { createdClient: { name: created.name.toLowerCase(), id: created.id } };
      }

      const resolvedClientId = resolveClientIdForAction(action, sessionClientMap);
      if (!resolvedClientId) {
        const targetLabel = safeStr(action.args.clientName, 160) || 'this action';
        throw new Error(
          `Could not match "${targetLabel}" to an existing client yet. Select a client in the dropdown above or execute "Create Client" first.`
        );
      }

      if (action.name === 'log_document') {
        const docName =
          safeStr(action.args.name, 240) ||
          message.attachmentName ||
          'Extracted_Financial_Document.pdf';
        const category = normalizeDocCategory(action.args.category);
        const fileType = normalizeDocFileType(
          action.args.fileType,
          message.attachmentMime,
          docName
        );
        const summary =
          safeStr(action.args.previewSummary, 3000) ||
          'Logged via FinSight AI Copilot.';

        const toNum = (v: unknown): number | undefined => {
          const n = typeof v === 'number' ? v : Number(v);
          return Number.isFinite(n) && v !== null && v !== '' ? n : undefined;
        };

        const issues = Array.isArray(action.args.detectedIssues)
          ? action.args.detectedIssues.map((x) => safeStr(x, 500)).filter(Boolean)
          : [];

        const metrics = {
          ...(toNum(action.args.taxableValue) !== undefined
            ? { taxableValue: toNum(action.args.taxableValue) }
            : {}),
          ...(toNum(action.args.gstAmount) !== undefined
            ? { gstAmount: toNum(action.args.gstAmount) }
            : {}),
          ...(toNum(action.args.totalAmount) !== undefined
            ? { totalAmount: toNum(action.args.totalAmount) }
            : {}),
          ...(safeStr(action.args.period, 40)
            ? { period: safeStr(action.args.period, 40) }
            : {}),
          ...(safeStr(action.args.referenceNo, 120)
            ? { referenceNo: safeStr(action.args.referenceNo, 120) }
            : {}),
        };

        if (Boolean(action.args.createReviewTask) || issues.length > 0) {
          runDocumentToActionPipeline({
            clientId: resolvedClientId,
            name: docName,
            fileType,
            fileSize: 'Copilot Extracted',
            category,
            previewSummary: summary,
            extractedMetrics: Object.keys(metrics).length > 0 ? metrics : undefined,
            detectedIssues: issues,
          });
        } else {
          addDocument({
            name: docName,
            fileType,
            fileSize: 'Copilot Logged',
            clientId: resolvedClientId,
            category,
            financialYear: selectedFY,
            uploadedBy: currentUser.name,
            uploadedByRole: 'Staff',
            status: 'Pending Review',
            previewSummary: summary,
            extractedMetrics: Object.keys(metrics).length > 0 ? metrics : undefined,
          });
        }

        setMessageActionState(message.id, action.id, {
          status: 'executed',
          resultLabel: `${docName} logged (${category})`,
          targetSection: meta.section,
        });
        return {};
      }

      if (action.name === 'create_compliance_task') {
        const title = safeStr(action.args.title, 200) || 'Compliance Filing';
        const reqDocs = Array.isArray(action.args.requiredDocuments)
          ? action.args.requiredDocuments.map((d) => normalizeDocCategory(d))
          : [];

        addComplianceTask({
          title,
          clientId: resolvedClientId,
          type: normalizeComplianceType(action.args.type),
          financialYear: selectedFY,
          dueDate: normalizeDateYYYYMMDD(action.args.dueDate, 7),
          assignedEmployeeId: resolveEmployeeId(action.args.assignedEmployeeName, resolvedClientId),
          status: 'Not Started',
          priority: normalizePriority(action.args.priority),
          description:
            safeStr(action.args.description, 2000) ||
            'Scheduled by FinSight AI Copilot agent.',
          requiredDocuments: Array.from(new Set(reqDocs)).slice(0, 15),
          reminderDaysBefore: 3,
          internalNotes: 'Created via FinSight AI Copilot.',
        });

        setMessageActionState(message.id, action.id, {
          status: 'executed',
          resultLabel: `Compliance task "${title}" scheduled`,
          targetSection: meta.section,
        });
        return {};
      }

      if (action.name === 'create_staff_task') {
        const title = safeStr(action.args.title, 200) || 'CA Review Task';
        addStaffTask({
          title,
          description:
            safeStr(action.args.description, 3000) ||
            'Workflow task created via FinSight AI Copilot.',
          clientId: resolvedClientId,
          assignedEmployeeId: resolveEmployeeId(action.args.assignedEmployeeName, resolvedClientId),
          createdBy: `${currentUser.name} (via Copilot)`,
          priority: normalizePriority(action.args.priority),
          startDate: new Date().toISOString().slice(0, 10),
          dueDate: normalizeDateYYYYMMDD(action.args.dueDate, 3),
          status: 'Not Started',
          attachments: message.attachmentName ? [message.attachmentName] : [],
        });

        setMessageActionState(message.id, action.id, {
          status: 'executed',
          resultLabel: `Staff task "${title}" assigned`,
          targetSection: meta.section,
        });
        return {};
      }

      if (action.name === 'draft_reminder') {
        const title = safeStr(action.args.title, 200) || 'Document Follow-up Reminder';
        const rType =
          VALID_REMINDER_TYPES.find(
            (t) => t.toLowerCase() === String(action.args.reminderType ?? '').toLowerCase()
          ) || 'Document Follow-up';
        const ch =
          VALID_REMINDER_CHANNELS.find(
            (c) => c.toLowerCase() === String(action.args.channel ?? '').toLowerCase()
          ) || 'Email (Simulated)';

        addReminder({
          title,
          clientId: resolvedClientId,
          reminderType: rType,
          channel: ch,
          scheduledFor: normalizeDateYYYYMMDD(action.args.scheduledFor, 1),
          status: 'Scheduled',
          message:
            safeStr(action.args.message, 2000) ||
            'Gentle reminder to upload your pending financial/compliance documents to the FinSight Client Portal.',
          createdBy: currentUser.name,
        });

        setMessageActionState(message.id, action.id, {
          status: 'executed',
          resultLabel: `Reminder "${title}" saved (${ch})`,
          targetSection: meta.section,
        });
        return {};
      }

      return {};
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Action failed to save to Firestore.';
      setMessageActionState(message.id, action.id, {
        status: 'error',
        errorMessage: errorMsg,
      });
      addToast('Copilot Action Error', errorMsg, 'error');
      return {};
    }
  };

  const executeAllPendingActions = async (message: ChatMessage) => {
    const actions = message.proposedActions || [];
    if (actions.length === 0) return;

    // Ensure create_client executes before dependent actions (log_document / tasks / reminders)
    const ordered = [
      ...actions.filter((a) => a.name === 'create_client'),
      ...actions.filter((a) => a.name !== 'create_client'),
    ];

    const sessionClientMap: Record<string, string> = { ...createdClientIdsByName };

    for (const action of ordered) {
      const currentState = message.actionStates?.[action.id]?.status || 'pending';
      if (currentState === 'executed' || currentState === 'dismissed') continue;
      const res = await executeSingleAction(message, action, sessionClientMap);
      if (res.createdClient) {
        sessionClientMap[res.createdClient.name] = res.createdClient.id;
      }
    }
  };

  const sendMessage = async (
    promptOverride?: string,
    attachmentOverride?: PendingAttachment | null
  ) => {
    if (loading || readingFile) return;
    const activeAttachment =
      attachmentOverride !== undefined ? attachmentOverride : attachment;
    const queryText = (promptOverride ?? input).trim();
    if (!queryText && !activeAttachment) return;

    const userMsgText =
      queryText ||
      `Extract and brief all data verbatim from attached document "${activeAttachment?.name}".`;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      text: userMsgText,
      attachmentName: activeAttachment?.name,
      attachmentMime: activeAttachment?.mimeType,
      attachmentPreviewUrl: activeAttachment?.previewUrl,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const validPriorHistory = messages.filter(
      (m) => !m.error && m.id !== 'welcome' && m.id !== 'reset'
    );
    const nextHistoryForApi = [...validPriorHistory, userMessage];

    setMessages((prev) => [...prev, userMessage]);
    if (!promptOverride) setInput('');
    if (attachmentOverride === undefined) setAttachment(null);
    setLoading(true);
    setExtractingStructured(Boolean(activeAttachment));

    try {
      const attachmentPayload = activeAttachment
        ? {
            name: activeAttachment.name,
            mimeType: activeAttachment.mimeType,
            ...(activeAttachment.base64Data ? { base64Data: activeAttachment.base64Data } : {}),
            ...(activeAttachment.textContent ? { textContent: activeAttachment.textContent } : {}),
          }
        : undefined;

      const chatPromise = fetch('/api/copilot/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextHistoryForApi.map((m) => ({
            role: m.role,
            text: m.text,
            ...(m.attachmentName ? { attachmentName: m.attachmentName } : {}),
            ...(m.extracted ? { extractedContext: m.extracted } : {}),
          })),
          practiceContext,
          ...(attachmentPayload ? { attachment: attachmentPayload } : {}),
        }),
      });

      const extractPromise = attachmentPayload
        ? fetch('/api/copilot/extract-document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(attachmentPayload),
          })
        : null;

      const [chatResult, extractResult] = await Promise.allSettled([
        chatPromise,
        extractPromise ?? Promise.resolve(null),
      ]);

      if (chatResult.status === 'rejected') {
        throw chatResult.reason;
      }

      const chatRes = chatResult.value;
      const rawChatText = await chatRes.text();
      let chatJson: {
        reply?: string;
        proposedActions?: CopilotProposedAction[];
        error?: string;
      } = {};
      try {
        chatJson = JSON.parse(rawChatText);
      } catch {
        throw new Error(rawChatText || `HTTP ${chatRes.status} from FinSight Copilot backend.`);
      }

      if (!chatRes.ok || !chatJson.reply) {
        throw new Error(chatJson?.error || `HTTP ${chatRes.status} from FinSight Copilot backend.`);
      }

      let extracted: ExtractedDocumentPayload | undefined;
      if (extractResult.status === 'fulfilled' && extractResult.value) {
        try {
          if (extractResult.value.ok) {
            const extData = await extractResult.value.json();
            extracted = extData.extracted;
          }
        } catch {
          // structured extraction is optional alongside main reply
        }
      }

      const proposedActions = Array.isArray(chatJson.proposedActions)
        ? chatJson.proposedActions
        : [];
      const initialActionStates: Record<string, ActionExecutionState> = {};
      proposedActions.forEach((act) => {
        initialActionStates[act.id] = { status: 'pending' };
      });

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        text: chatJson.reply!,
        attachmentName: activeAttachment?.name,
        attachmentMime: activeAttachment?.mimeType,
        extracted,
        proposedActions: proposedActions.length > 0 ? proposedActions : undefined,
        actionStates: proposedActions.length > 0 ? initialActionStates : undefined,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // Auto-execute direct client onboarding (and any paired log_document) when user explicitly instructs Copilot to add/create a client
      const directClientIntent =
        /\b(add|create|onboard|register|save)\b.*\b(client|party|vendor|company)\b|\badd\b.*\bto\s+clients?\b/i.test(
          userMsgText
        );
      if (
        firebaseUser &&
        directClientIntent &&
        proposedActions.some((a) => a.name === 'create_client')
      ) {
        const orderedDirect = [
          ...proposedActions.filter((a) => a.name === 'create_client'),
          ...proposedActions.filter((a) => a.name === 'log_document'),
        ];
        const sessionMap: Record<string, string> = { ...createdClientIdsByName };
        for (const act of orderedDirect) {
          const res = await executeSingleAction(assistantMsg, act, sessionMap);
          if (res.createdClient) {
            sessionMap[res.createdClient.name] = res.createdClient.id;
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reach FinSight AI Copilot server.';
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now() + 1}`,
          role: 'assistant',
          text: msg,
          error: true,
          retryPrompt: userMsgText,
          retryAttachment: activeAttachment ?? null,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setExtractingStructured(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (copilotOpen && queuedCopilotPrompt) {
      const p = queuedCopilotPrompt;
      clearQueuedCopilotPrompt();
      void sendMessage(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copilotOpen, queuedCopilotPrompt]);

  if (!copilotOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#020611]/75 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) setCopilotOpen(false);
      }}
    >
      <aside
        className="w-full max-w-2xl h-full bg-[#081020] border-l border-[#1E2E4E] flex flex-col shadow-2xl text-slate-100"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) void processAttachedFile(dropped);
        }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1A2945] bg-[#060C18] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-lg bg-teal-600/20 border border-teal-500/40 text-teal-300 flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold font-display text-slate-100 truncate">
                  FinSight AI Copilot
                </h2>
                <span className="text-[11px] font-mono text-teal-400">Agent + Live Context</span>
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                {clients.length} clients · {complianceTasks.filter((c) => c.status === 'Overdue').length} overdue · {anomalies.filter((a) => a.status === 'Flagged for CA Review').length} anomalies indexed
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setMessages([
                  {
                    id: 'reset',
                    role: 'assistant',
                    text: 'Conversation cleared. Ask a question about A Y & COMPANY records, attach a real document, or command me to create clients, tasks, or reminders.',
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  },
                ])
              }
              title="Clear conversation"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-[#13223D]"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setCopilotOpen(false)}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-[#13223D]"
              aria-label="Close Copilot"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Quick Grounded Queries */}
        <div className="px-5 py-2.5 border-b border-[#16233B] bg-[#0A1326] flex items-center gap-2 overflow-x-auto shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-teal-400 shrink-0" />
          {SUGGESTED_PROMPTS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={loading}
              onClick={() => void sendMessage(q)}
              className="px-2.5 py-1 text-[11px] font-medium text-slate-300 bg-[#101D36] hover:bg-[#162849] hover:text-white border border-[#223559] rounded-md whitespace-nowrap transition-colors"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.map((m) => {
            const proposed = m.proposedActions || [];
            const pendingActionCount = proposed.filter(
              (a) => (m.actionStates?.[a.id]?.status || 'pending') === 'pending'
            ).length;
            const hasCreateClientInMsg = proposed.some((a) => a.name === 'create_client');

            return (
              <div
                key={m.id}
                className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[92%] rounded-xl px-4 py-3 text-xs leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-[#173361] border border-[#284E8C] text-slate-100'
                      : m.error
                      ? 'bg-rose-950/50 border border-rose-500/40 text-rose-200'
                      : 'bg-[#0D182E] border border-[#1E2E4E] text-slate-200'
                  }`}
                >
                  {m.attachmentName && m.role === 'user' && (
                    <div className="mb-2 space-y-1.5">
                      {m.attachmentPreviewUrl && (
                        <img
                          src={m.attachmentPreviewUrl}
                          alt={m.attachmentName}
                          className="max-h-40 max-w-full rounded-lg border border-[#243B63] object-contain bg-[#050A14]"
                        />
                      )}
                      <div className="px-2.5 py-1.5 rounded-md bg-[#0B1426] border border-[#243B63] inline-flex items-center gap-2 text-[11px] font-mono text-teal-300">
                        <FileText className="w-3.5 h-3.5 shrink-0" />
                        <span>{m.attachmentName}</span>
                      </div>
                    </div>
                  )}

                  {m.error && (
                    <div className="flex items-center justify-between gap-3 font-semibold text-rose-300 mb-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>Copilot Request Failed</span>
                      </span>
                      {m.retryPrompt && (
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => void sendMessage(m.retryPrompt, m.retryAttachment)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-rose-100"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Retry
                        </button>
                      )}
                    </div>
                  )}

                  <div className="whitespace-pre-wrap break-words">{m.text}</div>

                  {/* Interactive Agent Action Cards */}
                  {proposed.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[#1E2E4E] space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-teal-400">
                          <Zap className="w-3.5 h-3.5" />
                          <span>Copilot Workspace Actions ({proposed.length})</span>
                        </span>
                        {pendingActionCount > 1 && (
                          <button
                            type="button"
                            onClick={() => void executeAllPendingActions(m)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-[11px] font-semibold transition-colors"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Execute All ({pendingActionCount})
                          </button>
                        )}
                      </div>

                      <div className="space-y-2">
                        {proposed.map((act) => {
                          const meta = ACTION_META[act.name];
                          const Icon = meta.icon;
                          const st = m.actionStates?.[act.id] || { status: 'pending' };
                          const matchedClientId = resolveClientIdForAction(act);
                          const argClientName = safeStr(act.args.clientName, 160);
                          const linkedToPendingCreate =
                            !matchedClientId &&
                            hasCreateClientInMsg &&
                            act.name !== 'create_client';

                          return (
                            <div
                              key={act.id}
                              className={`p-3 rounded-lg border text-[11px] space-y-2 ${
                                st.status === 'executed'
                                  ? 'bg-emerald-950/25 border-emerald-500/40'
                                  : st.status === 'dismissed'
                                  ? 'bg-[#081020]/50 border-[#1A2945] opacity-60'
                                  : st.status === 'error'
                                  ? 'bg-rose-950/30 border-rose-500/40'
                                  : 'bg-[#081020] border-[#223559]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 font-semibold text-slate-100">
                                  <span className="w-6 h-6 rounded-md bg-teal-500/15 border border-teal-500/30 text-teal-300 flex items-center justify-center shrink-0">
                                    <Icon className="w-3.5 h-3.5" />
                                  </span>
                                  <span>{meta.label}</span>
                                </div>
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                                    st.status === 'executed'
                                      ? 'bg-emerald-500/20 text-emerald-300'
                                      : st.status === 'dismissed'
                                      ? 'bg-slate-700/40 text-slate-400'
                                      : st.status === 'error'
                                      ? 'bg-rose-500/20 text-rose-300'
                                      : 'bg-amber-500/15 text-amber-300'
                                  }`}
                                >
                                  {st.status === 'executed'
                                    ? 'Saved to Firestore'
                                    : st.status === 'executing'
                                    ? 'Saving...'
                                    : st.status === 'dismissed'
                                    ? 'Dismissed'
                                    : st.status === 'error'
                                    ? 'Action Needed'
                                    : 'Pending Confirmation'}
                                </span>
                              </div>

                              {/* Concise Payload Summary */}
                              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] bg-[#060C18] p-2.5 rounded border border-[#192845]">
                                {act.name === 'create_client' && (
                                  <>
                                    <div>
                                      <span className="text-slate-500">Client Name: </span>
                                      <span className="font-semibold text-slate-100">{safeStr(act.args.name, 160) || '—'}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">Entity Type: </span>
                                      <span className="text-teal-300">{normalizeClientType(act.args.type)}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">PAN: </span>
                                      <span className="font-mono text-slate-200">{safeStr(act.args.pan, 20) || '—'}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">GSTIN: </span>
                                      <span className="font-mono text-slate-200">{safeStr(act.args.gstin, 30) || '—'}</span>
                                    </div>
                                  </>
                                )}

                                {act.name === 'log_document' && (
                                  <>
                                    <div>
                                      <span className="text-slate-500">Document: </span>
                                      <span className="font-semibold text-slate-100">{safeStr(act.args.name, 160) || '—'}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">Category: </span>
                                      <span className="text-teal-300">{normalizeDocCategory(act.args.category)}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">Total Amount: </span>
                                      <span className="font-mono text-slate-100">
                                        {typeof act.args.totalAmount === 'number'
                                          ? formatINR(act.args.totalAmount)
                                          : '—'}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">Ref No: </span>
                                      <span className="font-mono text-slate-200">{safeStr(act.args.referenceNo, 80) || '—'}</span>
                                    </div>
                                  </>
                                )}

                                {act.name === 'create_compliance_task' && (
                                  <>
                                    <div>
                                      <span className="text-slate-500">Title: </span>
                                      <span className="font-semibold text-slate-100">{safeStr(act.args.title, 160) || '—'}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">Type / Priority: </span>
                                      <span className="text-teal-300">
                                        {normalizeComplianceType(act.args.type)} · {normalizePriority(act.args.priority)}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">Due Date: </span>
                                      <span className="font-mono text-slate-100">{normalizeDateYYYYMMDD(act.args.dueDate, 7)}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">Target Client: </span>
                                      <span className="text-slate-200">{argClientName || '—'}</span>
                                    </div>
                                  </>
                                )}

                                {act.name === 'create_staff_task' && (
                                  <>
                                    <div>
                                      <span className="text-slate-500">Task: </span>
                                      <span className="font-semibold text-slate-100">{safeStr(act.args.title, 160) || '—'}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">Due / Priority: </span>
                                      <span className="font-mono text-teal-300">
                                        {normalizeDateYYYYMMDD(act.args.dueDate, 3)} · {normalizePriority(act.args.priority)}
                                      </span>
                                    </div>
                                    <div className="col-span-2 text-slate-300 truncate">
                                      {safeStr(act.args.description, 200)}
                                    </div>
                                  </>
                                )}

                                {act.name === 'draft_reminder' && (
                                  <>
                                    <div>
                                      <span className="text-slate-500">Subject: </span>
                                      <span className="font-semibold text-slate-100">{safeStr(act.args.title, 160) || '—'}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">Channel / Date: </span>
                                      <span className="font-mono text-teal-300">
                                        {safeStr(act.args.channel, 40) || 'Email'} · {normalizeDateYYYYMMDD(act.args.scheduledFor, 1)}
                                      </span>
                                    </div>
                                    <div className="col-span-2 text-slate-300">
                                      {safeStr(act.args.message, 280)}
                                    </div>
                                  </>
                                )}
                              </div>

                              {/* Client binding dropdown for existing-client actions when pending/error */}
                              {act.name !== 'create_client' &&
                                (st.status === 'pending' || st.status === 'error') && (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[10px] text-slate-400">Target Client:</span>
                                    {linkedToPendingCreate ? (
                                      <span className="text-[10px] font-mono text-teal-300">
                                        Will link to newly created &ldquo;{argClientName}&rdquo; (run Execute All or Create Client first)
                                      </span>
                                    ) : (
                                      <select
                                        value={matchedClientId || ''}
                                        onChange={(e) =>
                                          setActionClientOverrides((prev) => ({
                                            ...prev,
                                            [act.id]: e.target.value,
                                          }))
                                        }
                                        className="px-2 py-1 text-[11px] bg-[#0B1426] border border-[#243B63] rounded text-slate-200"
                                      >
                                        <option value="">
                                          {clients.length === 0
                                            ? 'No clients in workspace yet'
                                            : `Select client (suggested: ${argClientName || 'Choose'})`}
                                        </option>
                                        {clients.map((c) => (
                                          <option key={c.id} value={c.id}>
                                            {c.name} ({c.clientCode})
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                  </div>
                                )}

                              {st.status === 'error' && st.errorMessage && (
                                <div className="text-[11px] text-rose-300 flex items-start gap-1.5">
                                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                  <span>{st.errorMessage}</span>
                                </div>
                              )}

                              {st.status === 'executed' ? (
                                <div className="flex items-center justify-between gap-2 pt-0.5">
                                  <span className="text-emerald-300 font-medium inline-flex items-center gap-1.5">
                                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                    <span>{st.resultLabel}</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCopilotOpen(false);
                                      setActiveSection(st.targetSection || meta.section);
                                    }}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#101C33] hover:bg-[#172848] border border-[#243B63] text-[10px] text-slate-200"
                                  >
                                    <span>{meta.sectionLabel}</span>
                                    <ArrowRight className="w-3 h-3" />
                                  </button>
                                </div>
                              ) : st.status !== 'dismissed' ? (
                                <div className="flex items-center gap-2 pt-0.5">
                                  <button
                                    type="button"
                                    disabled={st.status === 'executing'}
                                    onClick={() => void executeSingleAction(m, act)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white font-semibold transition-colors"
                                  >
                                    {st.status === 'executing' ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Check className="w-3 h-3" />
                                    )}
                                    <span>Confirm &amp; Save to Firestore</span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={st.status === 'executing'}
                                    onClick={() =>
                                      setMessageActionState(m.id, act.id, { status: 'dismissed' })
                                    }
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#101C33] hover:bg-[#172848] border border-[#243B63] text-slate-400 hover:text-slate-200"
                                  >
                                    <Ban className="w-3 h-3" />
                                    <span>Dismiss</span>
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Structured Verbatim Extraction Card + Direct Client Onboarding + Document-to-Action */}
                  {m.extracted && (() => {
                    const ext = m.extracted!;
                    const primaryName = cleanExtractedField(ext.partyName, 160);
                    const counterName = cleanExtractedField(ext.counterpartyName, 160);
                    const hasCounterOption = Boolean(
                      counterName && counterName.toLowerCase() !== primaryName.toLowerCase()
                    );
                    const targetChoice =
                      directClientTargetByMsg[m.id] === 'counterparty' && hasCounterOption
                        ? 'counterparty'
                        : 'party';
                    const chosenClientName =
                      targetChoice === 'counterparty' ? counterName : primaryName;
                    const chosenEntityType =
                      directClientTypeByMsg[m.id] ||
                      ext.inferredEntityType ||
                      normalizeClientType(chosenClientName);
                    const addedRecord = directAddedClientByMsg[m.id];

                    const handleDirectAddClient = async (alsoLogDocument: boolean) => {
                      if (!firebaseUser) {
                        addToast('Sign in required', 'Sign in with Google first to save clients to Firestore.', 'warning');
                        return;
                      }
                      if (!chosenClientName) {
                        addToast('Name unavailable', 'Could not find a valid party name in this document.', 'warning');
                        return;
                      }
                      setDirectAddingMsgId(m.id);
                      try {
                        const panClean = cleanExtractedField(ext.pan, 20).toUpperCase();
                        const gstinClean = cleanExtractedField(ext.gstin, 30).toUpperCase();
                        const existing = clients.find(
                          (c) =>
                            c.name.toLowerCase() === chosenClientName.toLowerCase() ||
                            (panClean && c.pan && c.pan.toUpperCase() === panClean) ||
                            (gstinClean && c.gstin && c.gstin.toUpperCase() === gstinClean)
                        );
                        const savedClient =
                          existing ||
                          (await addClientAsync({
                            name: chosenClientName,
                            type: chosenEntityType,
                            dobOrIncDate: '',
                            email: cleanExtractedField(ext.email, 200),
                            phone: cleanExtractedField(ext.phone, 40),
                            address: cleanExtractedField(ext.address, 300),
                            city: cleanExtractedField(ext.city, 80),
                            state: cleanExtractedField(ext.state, 80),
                            pinCode: cleanExtractedField(ext.pinCode, 20),
                            pan: panClean,
                            ...(gstinClean ? { gstin: gstinClean } : {}),
                            financialYear: selectedFY,
                            services: [],
                            assignedEmployeeId: currentUser.id,
                            onboardingDate: new Date().toISOString().slice(0, 10),
                            notes: `Added directly from uploaded document "${m.attachmentName || ext.documentTitle}" (Ref: ${cleanExtractedField(ext.invoiceOrRefNo, 80) || '—'}).`,
                            status: 'Active',
                            requiredCategories: [],
                          }));

                        setDirectAddedClientByMsg((prev) => ({
                          ...prev,
                          [m.id]: {
                            id: savedClient.id,
                            name: savedClient.name,
                            code: savedClient.clientCode,
                          },
                        }));
                        setCreatedClientIdsByName((prev) => ({
                          ...prev,
                          [savedClient.name.toLowerCase()]: savedClient.id,
                        }));
                        setExtractClientId(savedClient.id);

                        if (alsoLogDocument) {
                          runDocumentToActionPipeline({
                            clientId: savedClient.id,
                            name: ext.documentTitle || m.attachmentName || 'Extracted_Document.pdf',
                            fileType: normalizeDocFileType('', m.attachmentMime, m.attachmentName),
                            fileSize: 'Extracted',
                            category: ext.detectedCategory,
                            previewSummary: ext.executiveBriefing,
                            extractedMetrics: {
                              taxableValue: ext.taxableValue ?? undefined,
                              gstAmount: ext.gstAmount ?? undefined,
                              totalAmount: ext.totalAmount ?? undefined,
                              period: ext.period,
                              referenceNo: ext.invoiceOrRefNo,
                            },
                            detectedIssues: ext.anomaliesDetected,
                          });
                        }
                      } finally {
                        setDirectAddingMsgId(null);
                      }
                    };

                    return (
                      <div className="mt-3 pt-3 border-t border-[#1E2E4E] space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-teal-400">
                            Verbatim Extracted Fields
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">
                            {ext.detectedCategory}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 bg-[#081020] p-3 rounded-lg border border-[#192845] text-[11px]">
                          <div>
                            <span className="text-slate-500">Party</span>
                            <div className="font-medium text-slate-100">{ext.partyName}</div>
                          </div>
                          <div>
                            <span className="text-slate-500">Ref / Invoice No.</span>
                            <div className="font-mono text-slate-100">{ext.invoiceOrRefNo}</div>
                          </div>
                          <div>
                            <span className="text-slate-500">Date / Period</span>
                            <div className="font-mono text-slate-200">
                              {ext.documentDate} {ext.period ? `(${ext.period})` : ''}
                            </div>
                          </div>
                          <div>
                            <span className="text-slate-500">GSTIN / PAN</span>
                            <div className="font-mono text-slate-200">
                              {ext.gstin || ext.pan || 'Not found in document'}
                            </div>
                          </div>
                          <div>
                            <span className="text-slate-500">Taxable Value</span>
                            <div className="font-mono tabular-nums text-slate-100">
                              {ext.taxableValue !== null ? formatINR(ext.taxableValue) : '—'}
                            </div>
                          </div>
                          <div>
                            <span className="text-slate-500">Total Amount</span>
                            <div className="font-mono tabular-nums font-semibold text-teal-300">
                              {ext.totalAmount !== null ? formatINR(ext.totalAmount) : '—'}
                            </div>
                          </div>
                        </div>

                        {ext.anomaliesDetected.length > 0 && (
                          <div className="bg-amber-950/30 border border-amber-500/30 rounded-lg p-2.5 text-[11px] text-amber-200 space-y-1">
                            <div className="font-semibold text-amber-300">
                              Discrepancies / Checks Flagged ({ext.anomaliesDetected.length})
                            </div>
                            {ext.anomaliesDetected.map((a, idx) => (
                              <div key={idx}>• {a}</div>
                            ))}
                          </div>
                        )}

                        {/* 1-Click Direct Client Onboarding from Extracted Document */}
                        {chosenClientName && (
                          <div className="bg-[#081020] border border-teal-500/30 rounded-lg p-2.5 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-semibold text-teal-300 inline-flex items-center gap-1.5">
                                <UserPlus className="w-3.5 h-3.5" />
                                <span>Add Directly as Client</span>
                              </span>
                              {hasCounterOption && !addedRecord && (
                                <select
                                  value={targetChoice}
                                  onChange={(e) =>
                                    setDirectClientTargetByMsg((prev) => ({
                                      ...prev,
                                      [m.id]: e.target.value as 'party' | 'counterparty',
                                    }))
                                  }
                                  className="px-2 py-0.5 text-[10px] bg-[#0B1426] border border-[#243B63] rounded text-slate-200"
                                >
                                  <option value="party">Issuer: {primaryName}</option>
                                  <option value="counterparty">Recipient: {counterName}</option>
                                </select>
                              )}
                            </div>

                            {addedRecord ? (
                              <div className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="text-emerald-300 font-medium inline-flex items-center gap-1.5">
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  <span>
                                    Added <strong>{addedRecord.name}</strong> ({addedRecord.code}) to Clients
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCopilotOpen(false);
                                    openClientProfile(addedRecord.id);
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#101C33] hover:bg-[#172848] border border-[#243B63] text-[10px] text-slate-200 shrink-0"
                                >
                                  <span>Open Client Profile</span>
                                  <ArrowRight className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[11px] font-medium text-slate-100 truncate max-w-[180px]">
                                  {chosenClientName}
                                </span>
                                <select
                                  value={chosenEntityType}
                                  onChange={(e) =>
                                    setDirectClientTypeByMsg((prev) => ({
                                      ...prev,
                                      [m.id]: e.target.value as ClientType,
                                    }))
                                  }
                                  className="px-2 py-1 text-[10px] bg-[#0B1426] border border-[#243B63] rounded text-slate-200"
                                >
                                  {VALID_CLIENT_TYPES.map((t) => (
                                    <option key={t} value={t}>
                                      {t}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  disabled={directAddingMsgId === m.id}
                                  onClick={() => void handleDirectAddClient(false)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#14274A] hover:bg-[#1C3666] border border-[#2D5299] text-[11px] font-semibold text-teal-200 disabled:opacity-50"
                                >
                                  {directAddingMsgId === m.id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <UserPlus className="w-3 h-3" />
                                  )}
                                  <span>Add to Clients</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={directAddingMsgId === m.id}
                                  onClick={() => void handleDirectAddClient(true)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-teal-600 hover:bg-teal-500 text-[11px] font-semibold text-white disabled:opacity-50"
                                >
                                  <Zap className="w-3 h-3" />
                                  <span>Add Client &amp; Log Doc</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <select
                            value={extractClientId}
                            onChange={(e) => setExtractClientId(e.target.value)}
                            className="px-2.5 py-1.5 text-[11px] bg-[#0B1426] border border-[#243B63] rounded-md text-slate-200"
                          >
                            {clients.length === 0 ? (
                              <option value="">No clients yet</option>
                            ) : (
                              clients.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))
                            )}
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              if (!extractClientId) {
                                addToast(
                                  'Client required',
                                  'Click "Add Client & Log Doc" above or onboard a client first.',
                                  'warning'
                                );
                                return;
                              }
                              runDocumentToActionPipeline({
                                clientId: extractClientId,
                                name: ext.documentTitle || m.attachmentName || 'Extracted_Document.pdf',
                                fileType: normalizeDocFileType('', m.attachmentMime, m.attachmentName),
                                fileSize: 'Extracted',
                                category: ext.detectedCategory,
                                previewSummary: ext.executiveBriefing,
                                extractedMetrics: {
                                  taxableValue: ext.taxableValue ?? undefined,
                                  gstAmount: ext.gstAmount ?? undefined,
                                  totalAmount: ext.totalAmount ?? undefined,
                                  period: ext.period,
                                  referenceNo: ext.invoiceOrRefNo,
                                },
                                detectedIssues: ext.anomaliesDetected,
                              });
                              addToast('Pipeline completed', 'Document saved & CA review task queued.');
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-[11px] font-semibold transition-colors"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Run Document-to-Action Workflow
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCopilotOpen(false);
                              setActiveSection('tasks');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#101C33] hover:bg-[#172848] border border-[#243B63] text-[11px] text-slate-300"
                          >
                            <span>View Tasks</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <span className="text-[10px] font-mono text-slate-500 mt-1 px-1">
                  {m.role === 'user' ? 'You' : 'FinSight Copilot'} · {m.timestamp}
                </span>
              </div>
            );
          })}

          {loading && (
            <div className="flex items-center gap-2 text-xs text-teal-300 bg-[#0D182E] border border-[#1E2E4E] rounded-xl px-4 py-3 w-fit">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                {extractingStructured
                  ? 'Reading attached file, extracting verbatim fields & checking agent actions...'
                  : 'Analyzing practice records & preparing response...'}
              </span>
            </div>
          )}
          <div ref={scrollEndRef} />
        </div>

        {/* Composer */}
        <div className="p-4 border-t border-[#1A2945] bg-[#060C18] space-y-2.5 shrink-0">
          {readingFile && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0D182E] border border-[#223559] text-xs text-teal-300">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>Encoding attached file...</span>
            </div>
          )}

          {attachment && !readingFile && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#0D182E] border border-teal-500/40 text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                {attachment.previewUrl ? (
                  <img
                    src={attachment.previewUrl}
                    alt={attachment.name}
                    className="w-9 h-9 rounded object-cover border border-[#243B63] shrink-0 bg-[#050A14]"
                  />
                ) : (
                  <FileText className="w-4 h-4 text-teal-400 shrink-0" />
                )}
                <span className="truncate font-medium text-slate-100">{attachment.name}</span>
                <span className="text-[11px] font-mono text-slate-400 shrink-0">
                  {attachment.sizeLabel}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="text-slate-400 hover:text-rose-400 text-[11px] shrink-0"
              >
                Remove
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.csv,.txt,.json,.tsv,.xml"
              className="hidden"
              onChange={(e) => void handleFileChange(e)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Upload real PDF, image, CSV, or text statement for verbatim extraction"
              className="p-2.5 rounded-lg bg-[#0F1B33] hover:bg-[#172849] border border-[#223559] text-slate-300 hover:text-teal-300 transition-colors shrink-0"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                const items = Array.from(e.clipboardData?.items || []);
                const imageItem = items.find((item) => item.kind === 'file');
                const file = imageItem?.getAsFile();
                if (file) {
                  e.preventDefault();
                  void processAttachedFile(file);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="Ask questions, attach/drop/paste a file, or command: 'Create a client from this invoice & log it'..."
              className="flex-1 px-3 py-2 text-xs bg-[#0B1426] border border-[#223559] rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-teal-500 resize-none"
            />

            <button
              type="button"
              disabled={loading || readingFile || (!input.trim() && !attachment)}
              onClick={() => void sendMessage()}
              className="p-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white transition-colors shrink-0"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[10px] text-slate-500">
            Supports PDF, PNG/JPG/WEBP/HEIC scans, CSV &amp; TXT · Extracts verbatim fields &amp; stages Firestore agent actions for CA confirmation.
          </p>
        </div>
      </aside>
    </div>
  );
};
