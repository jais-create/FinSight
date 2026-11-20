import {
  ClientType,
  DocumentCategory,
  FirmSettings,
  RolePermission,
} from '../types';

export const DEFAULT_PERMISSIONS: RolePermission[] = [
  {
    role: 'Partner',
    canManageClients: true,
    canVerifyDocuments: true,
    canApproveCompliance: true,
    canViewFinancials: true,
    canManageTeam: true,
    canExportReports: true,
  },
  {
    role: 'Senior CA',
    canManageClients: true,
    canVerifyDocuments: true,
    canApproveCompliance: true,
    canViewFinancials: true,
    canManageTeam: false,
    canExportReports: true,
  },
  {
    role: 'Audit Executive',
    canManageClients: true,
    canVerifyDocuments: true,
    canApproveCompliance: false,
    canViewFinancials: true,
    canManageTeam: false,
    canExportReports: true,
  },
  {
    role: 'Tax Associate',
    canManageClients: false,
    canVerifyDocuments: true,
    canApproveCompliance: false,
    canViewFinancials: false,
    canManageTeam: false,
    canExportReports: false,
  },
];

export const DEFAULT_FIRM_SETTINGS: FirmSettings = {
  firmName: 'A Y & COMPANY',
  tagline: 'Simplifying CA Practice Management',
  address: '304, Corporate Square, Tonk Road',
  city: 'Jaipur',
  state: 'Rajasthan',
  pinCode: '302015',
  icaiRegNo: '',
  gstin: '',
  email: 'office@aycompany.in',
  phone: '+91 141 274 8800',
  defaultFinancialYear: 'FY 2026-27',
  availableFinancialYears: ['FY 2026-27', 'FY 2025-26', 'FY 2024-25'],
  enabledComplianceCategories: [
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
  ],
  enabledDocumentCategories: [
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
  ],
  notifications: {
    emailReminders: true,
    portalAlerts: true,
    overdueDigest: true,
    reminderLeadDays: 3,
  },
  preferences: {
    compactTables: false,
    maskSensitiveIds: true,
    autoSaveDrafts: true,
  },
};

export const SMART_ONBOARDING_CHECKLISTS: Record<
  ClientType,
  { requiredCategories: DocumentCategory[]; defaultServices: string[]; onboardingSteps: string[] }
> = {
  'Private Limited': {
    requiredCategories: [
      'PAN Card',
      'GST Registration Certificate',
      'Bank Statements',
      'Sales Invoices',
      'Purchase Invoices',
      'TDS Certificates',
      'Balance Sheets',
      'Audit Reports',
    ],
    defaultServices: ['GST Filing', 'Statutory Audit', 'ROC Filing', 'Income Tax Return', 'TDS Compliance'],
    onboardingSteps: [
      'Collect COI, MOA/AOA, PAN & GST REG-06',
      'Verify Director DIN & DSC validity for MCA ROC filings',
      'Configure monthly GSTR-1 / GSTR-3B & 26Q TDS calendar',
    ],
  },
  LLP: {
    requiredCategories: [
      'PAN Card',
      'GST Registration Certificate',
      'Bank Statements',
      'Sales Invoices',
      'TDS Certificates',
      'Balance Sheets',
    ],
    defaultServices: ['GST Filing', 'ROC Compliance', 'Income Tax Return', 'TDS Compliance'],
    onboardingSteps: [
      'Collect LLP Agreement, PAN & Designated Partner KYC',
      'Schedule Form 11 & Form 8 ROC compliance deadlines',
      'Set up monthly bank & sales register reconciliation',
    ],
  },
  Partnership: {
    requiredCategories: [
      'PAN Card',
      'GST Registration Certificate',
      'Bank Statements',
      'Sales Invoices',
      'Purchase Invoices',
    ],
    defaultServices: ['GST Filing', 'Income Tax Return', 'TDS Compliance'],
    onboardingSteps: [
      'Collect registered Partnership Deed & Firm PAN',
      'Verify partner capital & remuneration clauses',
      'Enable monthly GSTR-2B ITC matching alerts',
    ],
  },
  Proprietorship: {
    requiredCategories: [
      'PAN Card',
      'GST Registration Certificate',
      'Bank Statements',
      'Sales Invoices',
      'Purchase Invoices',
    ],
    defaultServices: ['GST Filing', 'Income Tax Return', 'Tax Audit'],
    onboardingSteps: [
      'Collect Proprietor PAN, Aadhaar & GST Certificate',
      'Confirm turnover threshold for QRMP vs Monthly GST',
      'Set up monthly bank & purchase invoice portal requests',
    ],
  },
  Individual: {
    requiredCategories: ['PAN Card', 'Aadhaar', 'Form 16', 'Bank Statements', 'Income Tax Returns'],
    defaultServices: ['Income Tax Return', 'Advance Tax'],
    onboardingSteps: [
      'Collect PAN, Masked Aadhaar & prior FY ITR-V',
      'Fetch Form 16, AIS/TIS & capital gains brokerage sheets',
      'Configure quarterly Advance Tax reminders',
    ],
  },
};
