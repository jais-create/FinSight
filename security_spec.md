# FinSight Firestore Security Specification (Phase 0)

## Data Invariants
1. **Strict Ownership & Workspace Isolation**: Every subcollection record under `/firms/{firmId}` MUST carry `ownerUid == firmId == request.auth.uid`, enforced against the parent `/firms/{firmId}` document via `get()` on `get`/`create`/`update`/`delete` and directly against `resource.data.ownerUid == request.auth.uid` on `list`.
2. **Email Verification Mandate**: All reads and writes to practice data require `request.auth != null && request.auth.token.email_verified == true`.
3. **Immutable Ownership & Creation Timestamps**: `ownerUid` and `createdAt` can never be modified after document creation; `createdAt == request.time` on create and `updatedAt == request.time` on every create/update.
4. **PII Isolation**: User email and phone are isolated in `/users/{userId}/private/info` and never stored on `/users/{userId}` public docs. Client/employee records under `/firms/{firmId}` are strictly restricted to the verified firm owner or verified bootstrapped admin.
5. **Bounded Arrays & Strict Key Allowlists**: Every document creation enforces `keys().hasAll(...) && keys().hasOnly(...)` and bounded list sizes (`<= 50`), preventing ghost fields or resource exhaustion.
6. **Terminal State Protection**: Completed compliance tasks, completed staff tasks, and resolved/dismissed anomalies prevent state downgrade once finalized unless executed by a verified admin (`jaiswalarya17@gmail.com` with `email_verified == true`).

## Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated List**: `list(/firms/uidA/clients)` with `request.auth == null`.
2. **Unverified Email Spoof**: `create(/firms/uidA/clients/c1)` where `request.auth.token.email == 'jaiswalarya17@gmail.com'` and `request.auth.token.email_verified == false`.
3. **Cross-Tenant Ownership Spoof**: `create(/firms/uidA/clients/c1)` by `uidB` setting `ownerUid: 'uidA'`.
4. **Ghost / Shadow Field Injection**: `create(/firms/uidA/clients/c1)` including an unexpected field `isVerifiedAdmin: true`.
5. **ID Poisoning**: `create(/firms/uidA/clients/bad$id..with/junk)` violating `^[a-zA-Z0-9_\\-]+$`.
6. **Oversized String DoS**: `create(/firms/uidA/clients/c1)` with `name` of 500 characters (`> 160`).
7. **Forged Client Timestamp**: `create(/firms/uidA/clients/c1)` with backdated `createdAt` (`createdAt != request.time`).
8. **Immutable Field Mutation**: `update(/firms/uidA/clients/c1)` attempting to change `ownerUid` or `createdAt`.
9. **PII Cross-User Read**: `get(/users/uidA/private/info)` requested by `uidB`.
10. **Self-Assigned Admin Privilege Escalation**: `create(/admins/uidB)` requested by non-admin `uidB`.
11. **Terminal State Re-opening by Non-Admin**: `update(/firms/uidA/complianceTasks/t1)` changing `status` from `'Completed'` back to `'In Progress'` by a non-admin user.
12. **Blanket List Without Owner Filter**: `list(/firms/uidA/clients)` without matching `resource.data.ownerUid == request.auth.uid`.
