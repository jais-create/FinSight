import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { FunctionDeclaration, GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
}

function inferMimeType(name: string, provided?: string): string {
  const normalizedProvided = provided?.toLowerCase().trim();
  if (normalizedProvided === 'image/jpg' || normalizedProvided === 'image/pjpeg') return 'image/jpeg';
  if (normalizedProvided === 'image/x-png') return 'image/png';
  if (normalizedProvided && normalizedProvided !== 'application/octet-stream') {
    return normalizedProvided;
  }
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'txt' || ext === 'md' || ext === 'log' || ext === 'tsv' || ext === 'json' || ext === 'xml') {
    return 'text/plain';
  }
  return normalizedProvided || 'application/pdf';
}

function extractReadableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Unexpected server error contacting Gemini API.');
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error?.message) {
      return String(parsed.error.message);
    }
  } catch {
    // not JSON
  }
  return raw;
}

function isRetryableError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('resource_exhausted') ||
    msg.includes('overloaded') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('aborted') ||
    msg.includes('econnreset') ||
    msg.includes('fetch failed')
  );
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ProposedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

async function generateWithFallback(
  ai: GoogleGenAI,
  params: {
    contents: Parameters<GoogleGenAI['models']['generateContent']>[0]['contents'];
    systemInstruction: string;
    thinkingLevel: ThinkingLevel;
    responseMimeType?: string;
    responseSchema?: unknown;
    tools?: Array<{ functionDeclarations: FunctionDeclaration[] }>;
  }
): Promise<{ text: string; functionCalls: ProposedToolCall[]; modelUsed: string }> {
  const attempts: Array<{
    model: string;
    thinkingLevel: ThinkingLevel;
    waitBeforeMs: number;
    timeoutMs: number;
  }> = [
    { model: 'gemini-4-hydrogen', thinkingLevel: params.thinkingLevel, waitBeforeMs: 0, timeoutMs: 8500 },
    { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.LOW, waitBeforeMs: 150, timeoutMs: 20000 },
    { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL, waitBeforeMs: 400, timeoutMs: 20000 },
  ];

  let lastErr: unknown;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    if (attempt.waitBeforeMs > 0) {
      await delay(attempt.waitBeforeMs);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attempt.timeoutMs);

    try {
      const config: Record<string, unknown> = {
        systemInstruction: params.systemInstruction,
        thinkingConfig: { thinkingLevel: attempt.thinkingLevel },
        abortSignal: controller.signal,
      };
      if (params.responseMimeType) {
        config.responseMimeType = params.responseMimeType;
      }
      if (params.responseSchema) {
        config.responseSchema = params.responseSchema;
      }
      if (params.tools && params.tools.length > 0) {
        config.tools = params.tools;
      }

      const response = await Promise.race([
        ai.models.generateContent({
          model: attempt.model,
          contents: params.contents,
          config,
        }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => reject(new Error(`Gemini (${attempt.model}) request timed out after ${attempt.timeoutMs}ms.`)),
            { once: true }
          );
        }),
      ]);

      const text = typeof response.text === 'string' ? response.text : '';
      const rawCalls = Array.isArray(response.functionCalls) ? response.functionCalls : [];
      const functionCalls: ProposedToolCall[] = rawCalls
        .filter((fc) => fc && typeof fc.name === 'string' && fc.name.trim().length > 0)
        .map((fc, idx) => ({
          id: fc.id || `act-${Date.now()}-${idx}`,
          name: fc.name!,
          args: (fc.args && typeof fc.args === 'object' ? fc.args : {}) as Record<string, unknown>,
        }));

      if (text.trim() || functionCalls.length > 0) {
        return { text, functionCalls, modelUsed: attempt.model };
      }

      const finishReason = response.candidates?.[0]?.finishReason;
      throw new Error(
        `Gemini (${attempt.model}) returned an empty response${finishReason ? ` (finishReason: ${finishReason})` : ''}.`
      );
    } catch (err) {
      lastErr = err;
      const retryable = isRetryableError(err) || (err instanceof Error && err.message.includes('empty response'));
      console.warn(
        `[Gemini attempt ${i + 1}/${attempts.length} via ${attempt.model}] Failed: ${extractReadableError(err)}`
      );
      if (!retryable && i >= 1) {
        const msg = extractReadableError(err).toLowerCase();
        if (!msg.includes('not found') && !msg.includes('unsupported')) {
          throw err;
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr;
}

const COPILOT_ACTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'create_client',
    description:
      'Stage creation of a new client in the FinSight CA Firestore workspace (also auto-generates Smart Onboarding checklist & workflow task). Use when the user asks to onboard/create a client manually or from an attached invoice/KYC document.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Full legal or trade name of the client.' },
        type: {
          type: Type.STRING,
          enum: ['Individual', 'Private Limited', 'Partnership', 'LLP', 'Proprietorship'],
          description: 'Legal entity constitution inferred from the name (e.g. Pvt Ltd -> Private Limited, LLP -> LLP) or user request.',
        },
        pan: { type: Type.STRING, description: '10-character PAN if explicitly present in source; otherwise empty string.' },
        gstin: { type: Type.STRING, description: '15-character GSTIN if explicitly present in source; otherwise empty string.' },
        email: { type: Type.STRING, description: 'Client email if present; otherwise empty string.' },
        phone: { type: Type.STRING, description: 'Client phone number if present; otherwise empty string.' },
        address: { type: Type.STRING, description: 'Street/building address if present; otherwise empty string.' },
        city: { type: Type.STRING, description: 'City if present; otherwise empty string.' },
        state: { type: Type.STRING, description: 'State if present; otherwise empty string.' },
        pinCode: { type: Type.STRING, description: 'PIN code if present; otherwise empty string.' },
        notes: { type: Type.STRING, description: 'Concise onboarding notes summarizing origin (e.g. invoice number / source doc).' },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'log_document',
    description:
      'Log and store an analyzed/extracted financial or tax document into the client Document Vault in Firestore (optionally running Document-to-Action review & anomaly creation).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        clientId: { type: Type.STRING, description: 'Existing client ID from LIVE_PRACTICE_CONTEXT if known.' },
        clientName: { type: Type.STRING, description: 'Exact client name (matching an existing client or a newly created client in the same request).' },
        name: { type: Type.STRING, description: 'Descriptive filename or document title.' },
        category: {
          type: Type.STRING,
          enum: [
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
          description: 'FinSight document category.',
        },
        fileType: {
          type: Type.STRING,
          enum: ['PDF', 'XLSX', 'JPG', 'PNG', 'CSV'],
          description: 'Document file format.',
        },
        previewSummary: { type: Type.STRING, description: 'Verbatim key summary and line-item highlights of the document.' },
        taxableValue: { type: Type.NUMBER, description: 'Taxable base amount in INR if present.' },
        gstAmount: { type: Type.NUMBER, description: 'Total GST amount in INR if present.' },
        totalAmount: { type: Type.NUMBER, description: 'Grand total invoice/statement amount in INR if present.' },
        period: { type: Type.STRING, description: 'Document billing/return period (e.g. Oct 2026) if present.' },
        referenceNo: { type: Type.STRING, description: 'Invoice number or reference ID verbatim.' },
        createReviewTask: {
          type: Type.BOOLEAN,
          description: 'Set true to also auto-create a CA Review workflow task and log anomalies via Document-to-Action.',
        },
        detectedIssues: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'List of real mathematical/tax discrepancies found, or empty array if clean.',
        },
      },
      required: ['clientName', 'name', 'category', 'previewSummary'],
    },
  },
  {
    name: 'create_compliance_task',
    description:
      'Create a statutory compliance calendar deadline (GSTR-1, GSTR-3B, Income Tax, TDS, Tax Audit, ROC) for a client in Firestore.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        clientId: { type: Type.STRING, description: 'Existing client ID from LIVE_PRACTICE_CONTEXT if known.' },
        clientName: { type: Type.STRING, description: 'Target client name.' },
        title: { type: Type.STRING, description: 'Clear compliance filing title (e.g., GSTR-3B Filing — Nov 2026).' },
        type: {
          type: Type.STRING,
          enum: [
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
        },
        dueDate: { type: Type.STRING, description: 'Due date formatted strictly as YYYY-MM-DD.' },
        priority: {
          type: Type.STRING,
          enum: ['Low', 'Medium', 'High', 'Urgent'],
        },
        description: { type: Type.STRING, description: 'Filing instructions and checklist details.' },
        requiredDocuments: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'List of required document categories (e.g. Sales Invoices, Purchase Invoices).',
        },
        assignedEmployeeName: { type: Type.STRING, description: 'Optional staff member name from LIVE_PRACTICE_CONTEXT.' },
      },
      required: ['clientName', 'title', 'type', 'dueDate', 'priority'],
    },
  },
  {
    name: 'create_staff_task',
    description:
      'Assign an internal CA staff workflow task in the Tasks & Workflow board in Firestore.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        clientId: { type: Type.STRING, description: 'Existing client ID if applicable.' },
        clientName: { type: Type.STRING, description: 'Client name associated with this task.' },
        title: { type: Type.STRING, description: 'Actionable task title for CA staff.' },
        description: { type: Type.STRING, description: 'Detailed verification or follow-up steps.' },
        dueDate: { type: Type.STRING, description: 'Target due date formatted strictly as YYYY-MM-DD.' },
        priority: {
          type: Type.STRING,
          enum: ['Low', 'Medium', 'High', 'Urgent'],
        },
        assignedEmployeeName: { type: Type.STRING, description: 'Staff member name from LIVE_PRACTICE_CONTEXT.' },
      },
      required: ['clientName', 'title', 'description', 'dueDate', 'priority'],
    },
  },
  {
    name: 'draft_reminder',
    description:
      'Draft and schedule a client follow-up reminder (for missing documents, compliance deadlines, or check-ins) in Firestore.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        clientId: { type: Type.STRING, description: 'Existing client ID if known.' },
        clientName: { type: Type.STRING, description: 'Target client name.' },
        title: { type: Type.STRING, description: 'Short reminder subject line.' },
        reminderType: {
          type: Type.STRING,
          enum: ['Document Follow-up', 'Compliance Deadline', 'Client Check-in'],
        },
        channel: {
          type: Type.STRING,
          enum: ['Email (Simulated)', 'WhatsApp (Simulated)', 'Portal Alert'],
        },
        scheduledFor: { type: Type.STRING, description: 'Scheduled date formatted strictly as YYYY-MM-DD.' },
        message: { type: Type.STRING, description: 'Polite, professional client-facing reminder text specifying exact pending docs/deadlines.' },
      },
      required: ['clientName', 'title', 'reminderType', 'channel', 'scheduledFor', 'message'],
    },
  },
];

function summarizeProposedActions(calls: ProposedToolCall[]): string {
  const labels: Record<string, string> = {
    create_client: 'Create New Client & Smart Onboarding Workflow',
    log_document: 'Log Extracted Document to Client Vault',
    create_compliance_task: 'Schedule Statutory Compliance Deadline',
    create_staff_task: 'Assign CA Staff Workflow Task',
    draft_reminder: 'Schedule Client Follow-Up Reminder',
  };

  const lines = calls.map((c, idx) => {
    const label = labels[c.name] || c.name;
    const subject =
      String(c.args.name || c.args.title || c.args.clientName || '').trim() || 'Workspace Record';
    return `${idx + 1}. **${label}** — ${subject}`;
  });

  return `I've prepared the following action(s) in FinSight based on your request. Review the details below and click **Confirm & Save** to commit them to Firestore:\n\n${lines.join('\n')}`;
}

interface ChatMessageInput {
  role: 'user' | 'assistant';
  text: string;
  attachmentName?: string;
  extractedContext?: unknown;
}

interface AttachmentInput {
  name: string;
  mimeType: string;
  base64Data?: string;
  textContent?: string;
}

const COPILOT_SYSTEM_INSTRUCTION = `You are FinSight AI Copilot, an enterprise Chartered Accountancy AI agent built for A Y & COMPANY – Chartered Accountants (Jaipur, Rajasthan, India).

Follow these strict operating rules:
1. GROUNDED PRACTICE INTELLIGENCE:
   When asked about clients, missing documents, overdue GST/ROC/TDS/ITR tasks, employee workload, compliance risk scores, or financial anomalies, answer strictly and accurately using ONLY the live LIVE_PRACTICE_CONTEXT JSON supplied in the request.
   - Cite exact client names, client codes (e.g., AYC-101), employee names, dates, INR amounts, and document filenames from LIVE_PRACTICE_CONTEXT.
   - Never invent clients, filings, or numbers that do not appear in LIVE_PRACTICE_CONTEXT.
   - If the requested item does not exist in LIVE_PRACTICE_CONTEXT, state that clearly.

2. VERBATIM DOCUMENT EXTRACTION & BRIEFING:
   When the user attaches/uploads a document (image, PDF, CSV, or text statement), its raw content is supplied directly inside the user turn (as binary inlineData or VERBATIM_FILE_CONTENT).
   - NEVER claim that an attached file is missing or cannot be accessed when inlineData or VERBATIM_FILE_CONTENT is present.
   - Extract and brief the document contents EXACTLY as written in the source document.
   - Preserve every invoice number, date, GSTIN, PAN, HSN/SAC code, party name, line item description, quantity, rate, taxable value, CGST/SGST/IGST, cess, bank balance, and total amount VERBATIM without rounding, altering, guessing, or omitting values.
   - Do NOT synthesize or extrapolate missing values. If a field is illegible or absent from the document, explicitly write "Not found in document".
   - Highlight any arithmetic discrepancies (e.g., taxable + tax != total, GST rate mismatches, duplicate lines) clearly under an "Anomalies / Observations for CA Review" heading, while keeping raw extracted numbers untouched.

3. AGENTIC WORKSPACE ACTIONS (FUNCTION CALLING):
   You have workspace tools: create_client, log_document, create_compliance_task, create_staff_task, and draft_reminder.
   - ONLY call action tools when the user asks you to create, add, onboard, log, save, schedule, assign, or draft a record (either from an uploaded/previously extracted document or from LIVE_PRACTICE_CONTEXT).
   - When the user asks to add or create a client according to an uploaded or previously extracted document, ALWAYS call create_client immediately with the extracted legal/party name, inferred entity type (Private Limited / LLP / Partnership / Proprietorship / Individual), PAN, GSTIN, email, phone, address, city, state, and pinCode.
   - NEVER put placeholder phrases like "Not found in document" or "N/A" inside tool arguments—pass empty string "" if an optional field is absent from the source document.
   - For pure informational questions or plain document reading/extraction requests ("Extract this invoice", "Which clients haven't submitted bank statements?"), respond with clear structured text and DO NOT call mutation tools unless requested.
   - If the user asks to perform multiple actions (e.g. "create a client from this invoice and log the document"), invoke BOTH tools together using the exact same clientName so they link cleanly.
   - Populate tool arguments strictly from verified document fields or LIVE_PRACTICE_CONTEXT. Use YYYY-MM-DD for dueDate / scheduledFor relative to CURRENT_DATE supplied in context.
   - Always accompany tool calls with a concise natural explanation of what was extracted and what actions were prepared.

4. COMMUNICATION STYLE:
   - Be concise, structured, and audit-ready. Use clean headings and bullet points.
   - Clearly distinguish automated observations from formal Chartered Accountant sign-off or professional financial advice.`;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
    });
  });

  app.post('/api/copilot/chat', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY in the Settings > Secrets panel to run live FinSight AI Copilot queries and document extraction.',
      });
    }

    try {
      const {
        messages,
        practiceContext,
        attachment,
      }: {
        messages?: ChatMessageInput[];
        practiceContext?: unknown;
        attachment?: AttachmentInput;
      } = req.body || {};

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'At least one chat message is required.' });
      }

      // Ensure Gemini contents always start with a 'user' turn
      const trimmed = messages.slice(-12).filter((m) => m && typeof m.text === 'string' && m.text.trim());
      const firstUserIdx = trimmed.findIndex((m) => m.role === 'user');
      const normalizedMessages = firstUserIdx >= 0 ? trimmed.slice(firstUserIdx) : trimmed;

      if (normalizedMessages.length === 0) {
        return res.status(400).json({ error: 'At least one user message is required.' });
      }

      if (attachment) {
        const hasText = typeof attachment.textContent === 'string' && attachment.textContent.trim().length > 0;
        const cleanBase64 = typeof attachment.base64Data === 'string'
          ? attachment.base64Data.replace(/^data:[^;]+;base64,/i, '').trim()
          : '';
        if (!hasText && !cleanBase64) {
          return res.status(400).json({
            error: `Attachment "${attachment.name || 'file'}" had an empty payload and could not be sent to Gemini. Please re-attach the file and try again.`,
          });
        }
      }

      const todayStr = new Date().toISOString().slice(0, 10);

      const historyParts = normalizedMessages.map((m, idx) => {
        const isLast = idx === normalizedMessages.length - 1;
        const parts: Array<
          | { text: string }
          | { inlineData: { mimeType: string; data: string } }
        > = [];

        if (isLast && m.role === 'user') {
          if (practiceContext) {
            parts.push({
              text: `CURRENT_DATE: ${todayStr}\nLIVE_PRACTICE_CONTEXT (JSON):\n${JSON.stringify(practiceContext)}`,
            });
          } else {
            parts.push({ text: `CURRENT_DATE: ${todayStr}` });
          }

          if (attachment) {
            const resolvedMime = inferMimeType(attachment.name, attachment.mimeType);
            const cleanBase64 = typeof attachment.base64Data === 'string'
              ? attachment.base64Data.replace(/^data:[^;]+;base64,/i, '').trim()
              : '';
            if (attachment.textContent && attachment.textContent.trim()) {
              parts.push({
                text: `ATTACHED_FILE_VERIFIED: "${attachment.name}" (${resolvedMime}) is attached below.\nVERBATIM_FILE_CONTENT:\n${attachment.textContent}`,
              });
            } else if (cleanBase64) {
              parts.push({
                text: `ATTACHED_FILE_VERIFIED: "${attachment.name}" (${resolvedMime}) IS SUCCESSFULLY ATTACHED right below as binary inlineData. Read and inspect every line, figure, GSTIN, PAN, and party detail directly from it.`,
              });
              parts.push({
                inlineData: {
                  mimeType: resolvedMime,
                  data: cleanBase64,
                },
              });
            }
          }
        }

        const msgTextParts: string[] = [m.text];
        if (m.extractedContext) {
          msgTextParts.push(
            `\n[PREVIOUSLY_EXTRACTED_DOCUMENT_DATA${m.attachmentName ? ` (${m.attachmentName})` : ''}]:\n${JSON.stringify(m.extractedContext)}`
          );
        }
        parts.push({ text: msgTextParts.join('') });

        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts,
        };
      });

      const result = await generateWithFallback(ai, {
        contents: historyParts,
        systemInstruction: COPILOT_SYSTEM_INSTRUCTION,
        thinkingLevel: attachment ? ThinkingLevel.MEDIUM : ThinkingLevel.LOW,
        tools: [{ functionDeclarations: COPILOT_ACTION_DECLARATIONS }],
      });

      const replyText =
        result.text.trim() ||
        (result.functionCalls.length > 0
          ? summarizeProposedActions(result.functionCalls)
          : '');

      return res.json({
        reply: replyText,
        proposedActions: result.functionCalls,
        modelUsed: result.modelUsed,
      });
    } catch (err) {
      const message = extractReadableError(err);
      console.error('[/api/copilot/chat] Error:', message);
      return res.status(502).json({ error: message });
    }
  });

  app.post('/api/copilot/extract-document', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets to extract uploaded documents with Gemini.',
      });
    }

    try {
      const { name, mimeType, base64Data, textContent }: AttachmentInput = req.body || {};
      const cleanBase64 = typeof base64Data === 'string'
        ? base64Data.replace(/^data:[^;]+;base64,/i, '').trim()
        : '';
      const hasText = typeof textContent === 'string' && textContent.trim().length > 0;
      if (!name || (!cleanBase64 && !hasText)) {
        return res.status(400).json({ error: 'Document filename and non-empty file payload are required.' });
      }

      const resolvedMime = inferMimeType(name, mimeType);
      const parts: Array<
        | { text: string }
        | { inlineData: { mimeType: string; data: string } }
      > = [
        {
          text: `Perform a STRICT VERBATIM extraction of the attached financial/compliance document "${name}".
Copy every identifier, party name, date, line item, and currency figure verbatim without modifying, rounding, or guessing.
If a numeric field is not present, return null. If a text field is absent, return "Not found in document".
Verify GST/tax arithmetic: ONLY add entries to anomaliesDetected if there is an actual mathematical mismatch, duplicate entry, or missing mandatory tax ID; leave anomaliesDetected as [] if all extracted figures reconcile cleanly.`,
        },
      ];

      if (hasText) {
        parts.push({ text: `VERBATIM_TEXT_CONTENT:\n${textContent}` });
      } else if (cleanBase64) {
        parts.push({
          inlineData: {
            mimeType: resolvedMime,
            data: cleanBase64,
          },
        });
      }

      const result = await generateWithFallback(ai, {
        contents: [{ role: 'user', parts }],
        systemInstruction: COPILOT_SYSTEM_INSTRUCTION,
        thinkingLevel: ThinkingLevel.MEDIUM,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            documentTitle: { type: Type.STRING },
            detectedCategory: {
              type: Type.STRING,
              enum: [
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
            },
            partyName: { type: Type.STRING },
            counterpartyName: { type: Type.STRING },
            inferredEntityType: {
              type: Type.STRING,
              enum: ['Individual', 'Private Limited', 'Partnership', 'LLP', 'Proprietorship'],
            },
            pan: { type: Type.STRING },
            gstin: { type: Type.STRING },
            email: { type: Type.STRING },
            phone: { type: Type.STRING },
            address: { type: Type.STRING },
            city: { type: Type.STRING },
            state: { type: Type.STRING },
            pinCode: { type: Type.STRING },
            invoiceOrRefNo: { type: Type.STRING },
            documentDate: { type: Type.STRING },
            period: { type: Type.STRING },
            taxableValue: { type: Type.NUMBER, nullable: true },
            cgst: { type: Type.NUMBER, nullable: true },
            sgst: { type: Type.NUMBER, nullable: true },
            igst: { type: Type.NUMBER, nullable: true },
            gstAmount: { type: Type.NUMBER, nullable: true },
            totalAmount: { type: Type.NUMBER, nullable: true },
            verbatimLineItems: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            anomaliesDetected: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            executiveBriefing: { type: Type.STRING },
          },
          required: [
            'documentTitle',
            'detectedCategory',
            'partyName',
            'invoiceOrRefNo',
            'documentDate',
            'verbatimLineItems',
            'anomaliesDetected',
            'executiveBriefing',
          ],
        },
      });

      const cleanedJson = result.text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const extracted = JSON.parse(cleanedJson);
      return res.json({ extracted, modelUsed: result.modelUsed });
    } catch (err) {
      const message = extractReadableError(err);
      console.error('[/api/copilot/extract-document] Error:', message);
      return res.status(502).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FinSight server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
