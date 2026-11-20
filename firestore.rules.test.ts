/**
 * Firestore Security Rules Specification Tests (Phase 0 TDD)
 * Evaluates the "Dirty Dozen" adversarial payloads against FinSight's security invariants.
 */

export interface AdversarialTestCase {
  id: string;
  name: string;
  operation: 'list' | 'get' | 'create' | 'update';
  path: string;
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: AdversarialTestCase[] = [
  {
    id: 'DD-01',
    name: 'Unauthenticated client list',
    operation: 'list',
    path: 'firms/uidA/clients',
    auth: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-02',
    name: 'Unverified admin email spoofing attempt',
    operation: 'create',
    path: 'firms/uidA/clients/c1',
    auth: { uid: 'uidSpoof', email: 'jaiswalarya17@gmail.com', email_verified: false },
    payload: { id: 'c1', ownerUid: 'uidA', name: 'Spoof Co' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-03',
    name: 'Cross-tenant ownership spoofing',
    operation: 'create',
    path: 'firms/uidA/clients/c1',
    auth: { uid: 'uidB', email: 'b@example.com', email_verified: true },
    payload: { id: 'c1', ownerUid: 'uidA', name: 'Injected Co' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-04',
    name: 'Ghost / shadow field injection',
    operation: 'create',
    path: 'firms/uidA/clients/c1',
    auth: { uid: 'uidA', email: 'a@example.com', email_verified: true },
    payload: { id: 'c1', ownerUid: 'uidA', name: 'Legit Co', isVerifiedAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-05',
    name: 'Document ID poisoning',
    operation: 'create',
    path: 'firms/uidA/clients/bad$id..junk',
    auth: { uid: 'uidA', email: 'a@example.com', email_verified: true },
    payload: { id: 'bad$id..junk', ownerUid: 'uidA', name: 'Poison' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-06',
    name: 'Oversized string DoS (>160 chars in client name)',
    operation: 'create',
    path: 'firms/uidA/clients/c1',
    auth: { uid: 'uidA', email: 'a@example.com', email_verified: true },
    payload: { id: 'c1', ownerUid: 'uidA', name: 'X'.repeat(300) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-07',
    name: 'Forged client-side createdAt timestamp',
    operation: 'create',
    path: 'firms/uidA/clients/c1',
    auth: { uid: 'uidA', email: 'a@example.com', email_verified: true },
    payload: { id: 'c1', ownerUid: 'uidA', name: 'Client', createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-08',
    name: 'Immutable ownerUid mutation on update',
    operation: 'update',
    path: 'firms/uidA/clients/c1',
    auth: { uid: 'uidA', email: 'a@example.com', email_verified: true },
    payload: { ownerUid: 'uidB' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-09',
    name: 'Cross-user private PII read',
    operation: 'get',
    path: 'users/uidA/private/info',
    auth: { uid: 'uidB', email: 'b@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-10',
    name: 'Self-assigned admin privilege escalation',
    operation: 'create',
    path: 'admins/uidB',
    auth: { uid: 'uidB', email: 'b@example.com', email_verified: true },
    payload: { role: 'admin' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-11',
    name: 'Terminal state downgrade by non-admin user',
    operation: 'update',
    path: 'firms/uidA/complianceTasks/t1',
    auth: { uid: 'uidA', email: 'staff@example.com', email_verified: true },
    payload: { status: 'In Progress' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-12',
    name: 'Blanket list query missing ownerUid filter',
    operation: 'list',
    path: 'firms/uidA/clients',
    auth: { uid: 'uidB', email: 'b@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
];
