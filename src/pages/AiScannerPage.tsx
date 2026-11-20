import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScanLine,
  UploadCloud,
  AlertTriangle,
  CheckCircle2,
  Save,
  Info,
  Loader2,
  ShieldAlert,
  ZoomIn,
  ZoomOut,
  Calculator,
  Zap,
  Bot,
  Camera,
  RefreshCw,
  X,
  UserPlus,
} from 'lucide-react';
import { formatINR, usePractice } from '../context/PracticeContext';
import { ClientType, DocumentCategory, ExtractedDocumentPayload, FinancialYear } from '../types';

type ScannerDocType = 'Tax Invoice' | 'Bank Statement' | 'PAN / GST Certificate';

interface ExtractionField {
  key: string;
  label: string;
  value: string;
  confidence?: number;
  missingWarning?: string;
}

const SAMPLE_TEMPLATES: Record<
  ScannerDocType,
  { fileName: string; fields: ExtractionField[]; warnings: string[] }
> = {
  'Tax Invoice': {
    fileName: 'Sample_B2B_Tax_Invoice_Jaipur_Steel.pdf',
    warnings: [
      'Supplier State Code matches Rajasthan (08); confirm IGST is ₹0 for intra-state supply.',
      'AI-extracted values are provisional and require CA review before GST return posting.',
    ],
    fields: [
      { key: 'supplierName', label: 'Supplier Name', value: 'Jaipur Precision Steels Pvt Ltd (Demo)', confidence: 98 },
      { key: 'supplierGstin', label: 'Supplier GSTIN', value: '08AAECJ0041M1Z2', confidence: 96 },
      { key: 'customerName', label: 'Customer Name', value: 'ABC Private Limited', confidence: 99 },
      { key: 'customerGstin', label: 'Customer GSTIN', value: '08AABCA0001D1Z5', confidence: 97 },
      { key: 'invoiceNumber', label: 'Invoice Number', value: 'JPS/26-27/0842', confidence: 95 },
      { key: 'invoiceDate', label: 'Invoice Date', value: '2026-11-12', confidence: 94 },
      { key: 'taxableValue', label: 'Taxable Value (INR)', value: '185000', confidence: 98 },
      { key: 'cgst', label: 'CGST (9%)', value: '16650', confidence: 97 },
      { key: 'sgst', label: 'SGST (9%)', value: '16650', confidence: 97 },
      { key: 'igst', label: 'IGST', value: '0', confidence: 99 },
      { key: 'totalAmount', label: 'Total Invoice Amount (INR)', value: '218300', confidence: 98 },
    ],
  },
  'Bank Statement': {
    fileName: 'Sample_HDFC_Current_Account_Oct2026.pdf',
    warnings: [
      'Account number automatically masked for confidentiality.',
      '2 narration lines flagged for manual ledger classification.',
    ],
    fields: [
      { key: 'accountHolder', label: 'Account Holder', value: 'ABC Private Limited', confidence: 99 },
      { key: 'bankName', label: 'Bank Name', value: 'HDFC Bank Ltd — Sitapura Branch', confidence: 98 },
      { key: 'accountNumber', label: 'Account Number (Masked)', value: 'XXXX-XXXX-4918', confidence: 99 },
      { key: 'statementPeriod', label: 'Statement Period', value: '01 Oct 2026 – 31 Oct 2026', confidence: 97 },
      { key: 'openingBalance', label: 'Opening Balance (INR)', value: '1245600', confidence: 95 },
      { key: 'closingBalance', label: 'Closing Balance (INR)', value: '1682450', confidence: 95 },
      { key: 'transactionCount', label: 'Transaction Count', value: '118', confidence: 92 },
    ],
  },
  'PAN / GST Certificate': {
    fileName: 'Sample_GST_REG06_Certificate.pdf',
    warnings: [
      'Sensitive tax identifiers masked in preview; confirm full ID against MCA/GST portal.',
    ],
    fields: [
      { key: 'legalName', label: 'Legal Name of Business', value: 'Greenfield Industries Pvt Ltd', confidence: 99 },
      { key: 'tradeName', label: 'Trade Name', value: 'Greenfield Packaging', confidence: 96 },
      { key: 'panMasked', label: 'PAN (Masked)', value: 'AAB••••06M', confidence: 98 },
      { key: 'gstinMasked', label: 'GSTIN (Masked)', value: '08AAB••••06M1Z7', confidence: 97 },
      { key: 'constitution', label: 'Constitution of Business', value: 'Private Limited Company', confidence: 99 },
      { key: 'regDate', label: 'Date of Registration', value: '2017-07-01', confidence: 94 },
      { key: 'jurisdiction', label: 'State / Jurisdiction', value: 'Rajasthan — Jaipur Ward 4', confidence: 91 },
    ],
  },
};

function resolveScannerMimeType(file: File): string {
  const normalizedType = file.type?.toLowerCase().trim();
  if (normalizedType === 'image/jpg' || normalizedType === 'image/pjpeg') return 'image/jpeg';
  if (normalizedType === 'image/x-png') return 'image/png';
  if (normalizedType && normalizedType !== 'application/octet-stream') return normalizedType;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'txt' || ext === 'json') return 'text/plain';
  return 'application/pdf';
}

function readFileAsDataUrl(file: File): Promise<{ dataUrl: string; base64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1].trim() : dataUrl.trim();
      if (!base64) {
        reject(new Error('Selected file could not be encoded (empty payload).'));
        return;
      }
      resolve({ dataUrl, base64 });
    };
    reader.onerror = () => reject(new Error('Failed to read local file.'));
    reader.readAsDataURL(file);
  });
}

export const AiScannerPage: React.FC = () => {
  const {
    firebaseUser,
    clients,
    selectedFY,
    settings,
    currentUser,
    addClientAsync,
    addDocument,
    addFinancialRecord,
    runDocumentToActionPipeline,
    openCopilotWithPrompt,
    addToast,
  } = usePractice();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraCaptureInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [docType, setDocType] = useState<ScannerDocType>('Tax Invoice');
  const [clientId, setClientId] = useState(clients[0]?.id || '');
  const [fy, setFy] = useState<FinancialYear>(selectedFY);

  useEffect(() => {
    if (!clientId || !clients.some((c) => c.id === clientId)) {
      setClientId(clients[0]?.id || '');
    }
  }, [clients, clientId]);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadedFileSize, setUploadedFileSize] = useState<string>('640 KB');
  const [lastUploadedFile, setLastUploadedFile] = useState<File | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [creatingClientFromScan, setCreatingClientFromScan] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(100);
  const blobUrlRef = useRef<string | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    return () => {
      stopCameraStream();
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, []);

  const startCamera = async (mode: 'environment' | 'user') => {
    stopCameraStream();
    setCameraError(null);
    setCameraLoading(true);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraLoading(false);
      setCameraError(
        'Live camera preview is not supported in this browser context. Use "Take Picture via Device Camera" below to snap and scan a photo.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Camera permission denied or no camera device detected.';
      setCameraError(
        `${msg} You can still use "Take Picture via Device Camera" below to capture and scan an image.`
      );
    } finally {
      setCameraLoading(false);
    }
  };

  useEffect(() => {
    if (cameraOpen) {
      void startCamera(facingMode);
    } else {
      stopCameraStream();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen, facingMode]);

  const captureAndScanPhoto = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      addToast('Camera Not Ready', 'Wait for the camera feed to initialize before capturing.', 'warning');
      return;
    }

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      addToast('Capture Error', 'Could not initialize image canvas.', 'error');
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          addToast('Capture Error', 'Failed to capture image frame from camera.', 'error');
          return;
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const capturedFile = new File([blob], `Camera_Scan_${stamp}.jpg`, {
          type: 'image/jpeg',
        });
        stopCameraStream();
        setCameraOpen(false);
        void handleUserFileSelected(capturedFile);
      },
      'image/jpeg',
      0.92
    );
  };

  const [scanResult, setScanResult] = useState<{
    mode: 'sample' | 'gemini-live' | 'manual';
    docType: ScannerDocType;
    fileName: string;
    previewUrl?: string;
    previewMimeType?: string;
    previewText?: string;
    fields: ExtractionField[];
    warnings: string[];
    caApproved: boolean;
    livePayload?: ExtractedDocumentPayload;
  } | null>(null);

  const runSampleScan = (typeOverride?: ScannerDocType) => {
    const activeType = typeOverride ?? docType;
    setApiError(null);
    setUploadedFileName(null);
    setLastUploadedFile(null);
    setIsScanning(true);
    setScanResult(null);

    setTimeout(() => {
      const tpl = SAMPLE_TEMPLATES[activeType];
      setScanResult({
        mode: 'sample',
        docType: activeType,
        fileName: tpl.fileName,
        fields: tpl.fields.map((f) => ({ ...f })),
        warnings: tpl.warnings,
        caApproved: false,
      });
      setIsScanning(false);
    }, 450);
  };

  const handleUserFileSelected = async (file: File | null) => {
    if (!file) return;
    setLastUploadedFile(file);
    setUploadedFileName(file.name);
    const sizeKB = Math.max(12, Math.round(file.size / 1024));
    setUploadedFileSize(sizeKB >= 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`);
    setApiError(null);
    setIsScanning(true);
    setScanResult(null);

    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    let previewUrl: string | undefined;
    let previewText: string | undefined;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const resolvedMime = resolveScannerMimeType(file);
    const isText = ext === 'csv' || ext === 'txt' || ext === 'json' || resolvedMime.startsWith('text/');
    const isImage = resolvedMime.startsWith('image/');
    const isSupportedBinary = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'image/heic',
      'image/heif',
    ].includes(resolvedMime);

    try {
      if (!isText && !isSupportedBinary) {
        throw new Error(
          `Unsupported file format (.${ext || 'unknown'}). Please upload PDF, PNG, JPG, WEBP, CSV, or TXT.`
        );
      }

      const payload: {
        name: string;
        mimeType: string;
        base64Data?: string;
        textContent?: string;
      } = {
        name: file.name,
        mimeType: resolvedMime,
      };

      if (isText) {
        const txt = await file.text();
        if (!txt.trim()) {
          throw new Error('The uploaded text/CSV file is empty.');
        }
        previewText = txt;
        payload.textContent = txt;
      } else {
        const { dataUrl, base64 } = await readFileAsDataUrl(file);
        payload.base64Data = base64;
        if (isImage) {
          previewUrl = dataUrl;
        } else if (resolvedMime === 'application/pdf') {
          const objUrl = URL.createObjectURL(file);
          blobUrlRef.current = objUrl;
          previewUrl = objUrl;
        }
      }

      const res = await fetch('/api/copilot/extract-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const rawText = await res.text();
      let data: { extracted?: ExtractedDocumentPayload; error?: string; modelUsed?: string } = {};
      if (rawText) {
        try {
          data = JSON.parse(rawText);
        } catch {
          throw new Error(`Unexpected response (HTTP ${res.status}): ${rawText.slice(0, 180)}`);
        }
      }

      if (!res.ok || !data.extracted) {
        throw new Error(data.error || `Extraction failed (HTTP ${res.status}).`);
      }

      const extData: ExtractedDocumentPayload = data.extracted;
      const inferredType: ScannerDocType =
        extData.detectedCategory === 'Bank Statements'
          ? 'Bank Statement'
          : extData.detectedCategory === 'PAN Card' ||
            extData.detectedCategory === 'GST Registration Certificate'
          ? 'PAN / GST Certificate'
          : 'Tax Invoice';

      setDocType(inferredType);

      const liveFields: ExtractionField[] = [
        { key: 'partyName', label: 'Primary Party / Issuer', value: extData.partyName || '' },
        {
          key: 'counterpartyName',
          label: 'Counterparty / Recipient',
          value: extData.counterpartyName || '',
        },
        { key: 'gstin', label: 'GSTIN (Verbatim)', value: extData.gstin || '' },
        { key: 'pan', label: 'PAN (Verbatim)', value: extData.pan || '' },
        {
          key: 'invoiceOrRefNo',
          label: 'Invoice / Reference No.',
          value: extData.invoiceOrRefNo || '',
        },
        { key: 'documentDate', label: 'Document Date', value: extData.documentDate || '' },
        { key: 'period', label: 'Period', value: extData.period || '' },
        {
          key: 'taxableValue',
          label: 'Taxable Value (INR)',
          value: extData.taxableValue !== null && extData.taxableValue !== undefined ? String(extData.taxableValue) : '',
        },
        {
          key: 'cgst',
          label: 'CGST (INR)',
          value: extData.cgst !== null && extData.cgst !== undefined ? String(extData.cgst) : '0',
        },
        {
          key: 'sgst',
          label: 'SGST (INR)',
          value: extData.sgst !== null && extData.sgst !== undefined ? String(extData.sgst) : '0',
        },
        {
          key: 'igst',
          label: 'IGST (INR)',
          value: extData.igst !== null && extData.igst !== undefined ? String(extData.igst) : '0',
        },
        {
          key: 'totalAmount',
          label: 'Total Amount (INR)',
          value: extData.totalAmount !== null && extData.totalAmount !== undefined ? String(extData.totalAmount) : '',
        },
      ];

      setScanResult({
        mode: 'gemini-live',
        docType: inferredType,
        fileName: file.name,
        previewUrl,
        previewMimeType: resolvedMime,
        previewText,
        fields: liveFields,
        warnings:
          extData.anomaliesDetected.length > 0
            ? extData.anomaliesDetected
            : ['Verbatim Gemini extraction completed. Verify fields before CA approval.'],
        caApproved: false,
        livePayload: extData,
      });
      addToast('Verbatim Extraction Complete', `${file.name} parsed without altering figures.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to extract document.';
      setApiError(msg);

      const blankFields = SAMPLE_TEMPLATES[docType].fields.map((f) => ({
        ...f,
        value: '',
        confidence: undefined,
        missingWarning: 'Manual entry required (live AI extraction unavailable)',
      }));

      setScanResult({
        mode: 'manual',
        docType,
        fileName: file.name,
        previewUrl,
        previewMimeType: resolvedMime,
        previewText,
        fields: blankFields,
        warnings: [
          msg,
          'No OCR values were fabricated. Enter fields manually on the right or re-run AI extraction.',
        ],
        caApproved: false,
      });
    } finally {
      setIsScanning(false);
    }
  };

  const updateFieldValue = (key: string, value: string) => {
    if (!scanResult) return;
    setScanResult({
      ...scanResult,
      fields: scanResult.fields.map((f) =>
        f.key === key
          ? { ...f, value, missingWarning: value.trim() ? undefined : 'Field empty' }
          : f
      ),
    });
  };

  // Live GST Arithmetic Validator for Tax Invoice
  const gstCheck = useMemo(() => {
    if (!scanResult || scanResult.docType !== 'Tax Invoice') return null;
    const num = (k: string) => {
      const raw = scanResult.fields.find((f) => f.key === k)?.value || '0';
      const parsed = Number(raw.replace(/[^0-9.-]/g, ''));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const taxable = num('taxableValue');
    const cgst = num('cgst');
    const sgst = num('sgst');
    const igst = num('igst');
    const total = num('totalAmount');
    if (taxable === 0 && total === 0 && cgst === 0 && sgst === 0 && igst === 0) {
      return null;
    }
    const computedTotal = taxable + cgst + sgst + igst;
    const diff = Math.abs(total - computedTotal);
    const cgstSgstEqual = cgst === sgst;

    return {
      taxable,
      taxTotal: cgst + sgst + igst,
      computedTotal,
      total,
      diff,
      cgstSgstEqual,
      isBalanced: diff <= 1 && cgstSgstEqual && taxable > 0,
    };
  }, [scanResult]);

  const getNum = (k: string) => {
    if (!scanResult) return 0;
    const raw = scanResult.fields.find((f) => f.key === k)?.value || '0';
    const n = Number(raw.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  const resolveMappedCategory = (): DocumentCategory => {
    if (scanResult?.livePayload?.detectedCategory) {
      return scanResult.livePayload.detectedCategory;
    }
    if (scanResult?.docType === 'Tax Invoice') return 'Purchase Invoices';
    if (scanResult?.docType === 'Bank Statement') return 'Bank Statements';
    return 'GST Registration Certificate';
  };

  const handleSaveToClient = () => {
    if (!scanResult) return;
    if (!clientId || !clients.some((c) => c.id === clientId)) {
      addToast('Client required', 'Please onboard a client first before saving scanned records.', 'warning');
      return;
    }

    const mappedCategory = resolveMappedCategory();
    const taxable = getNum('taxableValue');
    const cgst = getNum('cgst');
    const sgst = getNum('sgst');
    const igst = getNum('igst');
    const total = getNum('totalAmount') || getNum('closingBalance');

    addDocument({
      name: scanResult.fileName,
      fileType: scanResult.fileName.toLowerCase().endsWith('.csv')
        ? 'CSV'
        : scanResult.fileName.toLowerCase().endsWith('.png')
        ? 'PNG'
        : scanResult.fileName.toLowerCase().endsWith('.jpg') ||
          scanResult.fileName.toLowerCase().endsWith('.jpeg')
        ? 'JPG'
        : 'PDF',
      fileSize: uploadedFileSize,
      clientId,
      category: mappedCategory,
      financialYear: fy,
      uploadedBy: currentUser.name,
      uploadedByRole: 'Staff',
      status: scanResult.caApproved ? 'Verified' : 'Pending Review',
      previewSummary:
        scanResult.livePayload?.executiveBriefing ||
        `${
          scanResult.caApproved ? 'CA-Approved' : 'AI-Extracted (Provisional)'
        } entry from Scanner workbench.`,
      extractedMetrics: {
        taxableValue: taxable || undefined,
        gstAmount: cgst + sgst + igst || undefined,
        totalAmount: total || undefined,
        period: scanResult.livePayload?.period || 'Nov 2026',
      },
    });

    if (scanResult.docType === 'Tax Invoice' && taxable > 0) {
      addFinancialRecord({
        clientId,
        financialYear: fy,
        month: 'Nov 2026',
        sourceType: scanResult.caApproved
          ? 'Finalized Accounting Record'
          : 'Document-Extracted (Provisional)',
        revenue: 0,
        expenses: taxable,
        taxableValue: taxable,
        cgst,
        sgst,
        igst,
        invoiceCount: 1,
      });
    }

    addToast(
      'Saved to Client Records',
      scanResult.caApproved
        ? 'Marked CA-Approved and stored in Documents.'
        : 'Saved as Provisional AI-Extracted data pending final CA verification.'
    );
  };

  const handleRunDocumentToAction = () => {
    if (!scanResult) return;
    if (!clientId || !clients.some((c) => c.id === clientId)) {
      addToast('Client required', 'Please onboard a client first before running Document-to-Action.', 'warning');
      return;
    }
    const mappedCategory = resolveMappedCategory();
    const taxable = getNum('taxableValue');
    const cgst = getNum('cgst');
    const sgst = getNum('sgst');
    const igst = getNum('igst');
    const total = getNum('totalAmount') || getNum('closingBalance');

    const detectedIssues = [
      ...(gstCheck && !gstCheck.isBalanced
        ? [
            `GST arithmetic variance detected: Computed ${formatINR(
              gstCheck.computedTotal
            )} vs Total ${formatINR(gstCheck.total)}`,
          ]
        : []),
      ...scanResult.warnings.filter(
        (w) =>
          !w.toLowerCase().includes('provisional') &&
          !w.toLowerCase().includes('verbatim gemini extraction completed')
      ),
    ];

    runDocumentToActionPipeline({
      clientId,
      name: scanResult.fileName,
      fileType: scanResult.fileName.toLowerCase().endsWith('.csv') ? 'CSV' : 'PDF',
      fileSize: uploadedFileSize,
      category: mappedCategory,
      previewSummary:
        scanResult.livePayload?.executiveBriefing ||
        `Extracted via AI Scanner & routed through Document-to-Action Automation.`,
      extractedMetrics: {
        taxableValue: taxable || undefined,
        gstAmount: cgst + sgst + igst || undefined,
        totalAmount: total || undefined,
        period: scanResult.livePayload?.period || 'Nov 2026',
      },
      detectedIssues,
    });
  };

  const highlightRing = (key: string) =>
    focusedField === key
      ? 'bg-teal-500/20 ring-2 ring-teal-400 text-teal-100 rounded px-1 -mx-1 transition-all'
      : 'transition-all';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 font-display">
            AI Document Scanner &amp; Verification Workbench
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Live verbatim Gemini extraction or synthetic template verification with GST arithmetic check &amp; CA sign-off
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            disabled={isScanning}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-500 rounded-lg whitespace-nowrap disabled:opacity-60 transition-colors"
          >
            <Camera className="w-4 h-4" />
            Scan with Camera
          </button>
          <button
            type="button"
            onClick={() =>
              openCopilotWithPrompt(
                'Guide me on what documents I can upload for verbatim extraction and GST verification.'
              )
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-teal-200 bg-[#0E2240] hover:bg-[#14305A] border border-teal-500/40 rounded-lg whitespace-nowrap transition-colors"
          >
            <Bot className="w-4 h-4 text-teal-400" />
            Extract in Copilot
          </button>
          <button
            type="button"
            onClick={() => runSampleScan()}
            disabled={isScanning}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-200 bg-[#101C33] hover:bg-[#172848] border border-[#243B63] rounded-lg whitespace-nowrap disabled:opacity-60 transition-colors"
          >
            <ScanLine className="w-4 h-4 text-teal-400" />
            Run Sample Demo
          </button>
        </div>
      </div>

      {/* Live Camera Capture Modal */}
      {cameraOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#020611]/85 backdrop-blur-xs p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCameraOpen(false);
          }}
        >
          <div className="w-full max-w-2xl bg-[#081020] border border-[#1E2E4E] rounded-2xl overflow-hidden shadow-2xl">
            <div className="px-5 py-3.5 border-b border-[#1A2945] bg-[#060C18] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-teal-600/20 border border-teal-500/40 text-teal-300 flex items-center justify-center">
                  <Camera className="w-4 h-4" />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-slate-100 font-display">
                    Camera Document Scanner
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Point your camera at a Tax Invoice, Bank Statement, PAN, or GST Certificate to read &amp; extract its data
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCameraOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-[#13223D]"
                aria-label="Close Camera"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <input
                ref={cameraCaptureInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const snapped = e.target.files?.[0] || null;
                  e.target.value = '';
                  if (snapped) {
                    setCameraOpen(false);
                    void handleUserFileSelected(snapped);
                  }
                }}
              />

              {cameraError ? (
                <div className="p-6 rounded-xl bg-[#050A14] border border-amber-500/40 text-center space-y-3">
                  <AlertTriangle className="w-7 h-7 text-amber-400 mx-auto" />
                  <p className="text-xs text-amber-200 max-w-md mx-auto leading-relaxed">
                    {cameraError}
                  </p>
                  <button
                    type="button"
                    onClick={() => cameraCaptureInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold transition-colors"
                  >
                    <Camera className="w-4 h-4" />
                    Take Picture via Device Camera
                  </button>
                </div>
              ) : (
                <div className="relative bg-[#050A14] border border-[#1E2E4E] rounded-xl overflow-hidden aspect-video flex items-center justify-center">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  {cameraLoading && (
                    <div className="absolute inset-0 bg-[#050A14]/80 flex flex-col items-center justify-center gap-2 text-xs text-teal-300">
                      <Loader2 className="w-6 h-6 animate-spin" />
                      <span>Starting camera feed...</span>
                    </div>
                  )}
                  {/* Alignment guide overlay */}
                  <div className="pointer-events-none absolute inset-6 border border-dashed border-teal-400/50 rounded-lg" />
                  <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-md bg-[#050A14]/75 border border-[#1E2E4E] text-[11px] text-slate-300 whitespace-nowrap">
                    Keep document flat &amp; well-lit for sharp GSTIN / amount reading
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#101C33] hover:bg-[#172848] border border-[#243B63] text-xs text-slate-200"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-teal-400" />
                    Switch Camera
                  </button>
                  <button
                    type="button"
                    onClick={() => cameraCaptureInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#101C33] hover:bg-[#172848] border border-[#243B63] text-xs text-slate-300"
                  >
                    <UploadCloud className="w-3.5 h-3.5 text-teal-400" />
                    Device Camera / Photo
                  </button>
                </div>

                {!cameraError && (
                  <button
                    type="button"
                    disabled={cameraLoading}
                    onClick={captureAndScanPhoto}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                  >
                    <ScanLine className="w-4 h-4" />
                    Capture &amp; Extract Data
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Setup Card */}
      <section className="bg-[#0B1426] border border-[#1E2E4E] rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Supported Document Type
            </label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value as ScannerDocType)}
              className="w-full px-3 py-2 text-xs border border-[#223559] rounded-lg bg-[#081020] text-slate-100 focus:outline-none focus:border-teal-500"
            >
              <option>Tax Invoice</option>
              <option>Bank Statement</option>
              <option>PAN / GST Certificate</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Select Client</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-[#223559] rounded-lg bg-[#081020] text-slate-100 focus:outline-none focus:border-teal-500"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.clientCode})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Select Financial Year
            </label>
            <select
              value={fy}
              onChange={(e) => setFy(e.target.value as FinancialYear)}
              className="w-full px-3 py-2 text-xs border border-[#223559] rounded-lg bg-[#081020] text-slate-100 focus:outline-none focus:border-teal-500"
            >
              {settings.availableFinancialYears.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleUserFileSelected(e.dataTransfer.files?.[0] || null);
          }}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-[#223559] hover:border-teal-500 rounded-xl p-6 text-center cursor-pointer bg-[#081020] transition-colors"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.csv,.txt"
            className="hidden"
            onChange={(e) => {
              handleUserFileSelected(e.target.files?.[0] || null);
              e.target.value = '';
            }}
          />
          <UploadCloud className="w-7 h-7 text-teal-400 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-100">
            {uploadedFileName
              ? `Selected: ${uploadedFileName} (${uploadedFileSize})`
              : 'Upload a real Tax Invoice, Bank Statement, or Tax Certificate (.pdf, .png, .jpg, .webp, .csv, .txt)'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Uploading a file immediately extracts all data verbatim via Gemini AI and displays your file below.
          </p>
        </div>

        {apiError && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            <span>{apiError}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Info className="w-4 h-4 text-teal-400 shrink-0" />
            <span>
              Extracted figures are never rounded or altered automatically. All entries require CA verification before filing.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              disabled={isScanning}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-teal-200 bg-[#0E2240] hover:bg-[#14305A] border border-teal-500/40 rounded-lg disabled:opacity-60 transition-colors"
            >
              <Camera className="w-3.5 h-3.5 text-teal-400" />
              Scan with Camera
            </button>
            {lastUploadedFile ? (
              <button
                type="button"
                onClick={() => void handleUserFileSelected(lastUploadedFile)}
                disabled={isScanning}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-500 rounded-lg disabled:opacity-60 transition-colors"
              >
                {isScanning ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Extracting File...
                  </>
                ) : (
                  <>
                    <ScanLine className="w-3.5 h-3.5" />
                    Re-run AI Extraction
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isScanning}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-500 rounded-lg disabled:opacity-60 transition-colors"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                Upload Document to Extract
              </button>
            )}
          </div>
        </div>
      </section>

      {isScanning && (
        <div className="bg-[#0B1426] border border-[#1E2E4E] rounded-xl p-10 text-center space-y-2">
          <Loader2 className="w-7 h-7 text-teal-400 animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-100">
            Analyzing {uploadedFileName || docType} layout &amp; tax totals verbatim...
          </p>
          <p className="text-xs text-slate-400">
            Cross-checking GSTIN format, invoice numbering, and arithmetic consistency.
          </p>
        </div>
      )}

      {/* Split-Screen Verification Workbench */}
      {!isScanning && scanResult && (
        <section className="bg-[#0B1426] border border-[#1E2E4E] rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#1E2E4E] flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-[#081020]">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-semibold text-slate-100 font-display">
                  Split Verification — {scanResult.fileName}
                </h2>
                <span
                  className={`text-xs font-medium ${
                    scanResult.caApproved ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {scanResult.caApproved
                    ? '· CA-Approved Data'
                    : scanResult.mode === 'gemini-live'
                    ? '· Verbatim Gemini Extraction (Provisional)'
                    : '· AI-Extracted (Provisional)'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Hover or focus any field on the right to inspect or trace its value
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {scanResult.livePayload?.partyName &&
                !/^(not found|n\/a|none|unknown|-|—)$/i.test(scanResult.livePayload.partyName.trim()) && (
                  <button
                    type="button"
                    disabled={creatingClientFromScan}
                    onClick={async () => {
                      if (!firebaseUser) {
                        addToast('Sign in required', 'Sign in with Google to save clients to Firestore.', 'warning');
                        return;
                      }
                      const lp = scanResult.livePayload!;
                      const cleanField = (v?: string) => {
                        const s = (v || '').trim();
                        return !s || /^(not found in document|not found|n\/a|na|none|unknown|null|undefined|-|—)$/i.test(s)
                          ? ''
                          : s;
                      };
                      const party = cleanField(lp.partyName).slice(0, 160);
                      const panClean = cleanField(lp.pan).slice(0, 20).toUpperCase();
                      const gstinClean = cleanField(lp.gstin).slice(0, 30).toUpperCase();
                      if (!party) return;

                      setCreatingClientFromScan(true);
                      try {
                        const existing = clients.find(
                          (c) =>
                            c.name.toLowerCase() === party.toLowerCase() ||
                            (panClean && c.pan && c.pan.toUpperCase() === panClean) ||
                            (gstinClean && c.gstin && c.gstin.toUpperCase() === gstinClean)
                        );
                        if (existing) {
                          setClientId(existing.id);
                          addToast('Existing Client Linked', `Selected ${existing.name} (${existing.clientCode}).`);
                          return;
                        }
                        const inferredType: ClientType =
                          lp.inferredEntityType ||
                          (party.toLowerCase().includes('llp')
                            ? 'LLP'
                            : party.toLowerCase().includes('partner')
                            ? 'Partnership'
                            : party.toLowerCase().includes('pvt') || party.toLowerCase().includes('private')
                            ? 'Private Limited'
                            : 'Private Limited');
                        const created = await addClientAsync({
                          name: party,
                          type: inferredType,
                          dobOrIncDate: '',
                          email: cleanField(lp.email).slice(0, 200),
                          phone: cleanField(lp.phone).slice(0, 40),
                          address: cleanField(lp.address).slice(0, 300),
                          city: cleanField(lp.city).slice(0, 80),
                          state: cleanField(lp.state).slice(0, 80),
                          pinCode: cleanField(lp.pinCode).slice(0, 20),
                          pan: panClean,
                          ...(gstinClean ? { gstin: gstinClean } : {}),
                          financialYear: fy,
                          services: [],
                          assignedEmployeeId: currentUser.id,
                          onboardingDate: new Date().toISOString().slice(0, 10),
                          notes: `Created directly from AI Scanner (${scanResult.fileName}).`,
                          status: 'Active',
                          requiredCategories: [],
                        });
                        setClientId(created.id);
                      } finally {
                        setCreatingClientFromScan(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-200 bg-[#0E2240] hover:bg-[#14305A] border border-teal-500/40 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {creatingClientFromScan ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <UserPlus className="w-3.5 h-3.5 text-teal-400" />
                    )}
                    Add Client from Scan
                  </button>
                )}
              <button
                type="button"
                onClick={() =>
                  setScanResult({ ...scanResult, caApproved: !scanResult.caApproved })
                }
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  scanResult.caApproved
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : 'bg-[#0B1426] border-[#223559] text-slate-300 hover:bg-[#101C33]'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {scanResult.caApproved ? 'CA Approved' : 'Mark CA-Approved'}
              </button>
              <button
                type="button"
                onClick={handleSaveToClient}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-100 bg-[#14274A] hover:bg-[#1B3360] border border-[#274680] rounded-lg transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                Save to Records
              </button>
              <button
                type="button"
                onClick={handleRunDocumentToAction}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-500 rounded-lg transition-colors"
              >
                <Zap className="w-3.5 h-3.5" />
                Run Document-to-Action
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#1E2E4E]">
            {/* Left Pane: Interactive Document Facsimile Viewer */}
            <div className="lg:col-span-5 bg-[#070E1C] p-4 flex flex-col">
              <div className="flex items-center justify-between mb-3 text-xs text-slate-400">
                <span className="font-medium text-slate-300">Document Source Preview</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(85, z - 15))}
                    className="p-1 rounded bg-[#0B1426] border border-[#223559] hover:bg-[#101C33] text-slate-300"
                    aria-label="Zoom out"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono text-[11px] w-10 text-center text-slate-300">
                    {zoom}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(115, z + 15))}
                    className="p-1 rounded bg-[#0B1426] border border-[#223559] hover:bg-[#101C33] text-slate-300"
                    aria-label="Zoom in"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-auto flex justify-center">
                <div
                  className="bg-[#0B1426] border border-[#1E2E4E] rounded-lg p-5 w-full text-[11px] text-slate-300 space-y-4 origin-top transition-transform"
                  style={{ transform: `scale(${zoom / 100})` }}
                >
                  {scanResult.mode !== 'sample' ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-[#1E2E4E] pb-2">
                        <div>
                          <div className="text-[10px] font-mono uppercase tracking-wider text-teal-400">
                            {scanResult.livePayload
                              ? `Uploaded Document · ${scanResult.livePayload.detectedCategory}`
                              : 'Uploaded Document Preview'}
                          </div>
                          <div className="font-bold text-xs text-slate-100 mt-0.5 truncate max-w-[260px]">
                            {scanResult.fileName}
                          </div>
                        </div>
                        {scanResult.previewUrl && (
                          <a
                            href={scanResult.previewUrl}
                            download={scanResult.fileName}
                            className="text-[11px] text-teal-400 hover:underline shrink-0"
                          >
                            Download Copy
                          </a>
                        )}
                      </div>

                      {scanResult.previewMimeType?.startsWith('image/') && scanResult.previewUrl ? (
                        <div className="bg-[#050A14] border border-[#192845] rounded-lg p-2 flex items-center justify-center overflow-auto max-h-[540px]">
                          <img
                            src={scanResult.previewUrl}
                            alt={scanResult.fileName}
                            className="max-w-full h-auto max-h-[510px] object-contain rounded"
                          />
                        </div>
                      ) : scanResult.previewMimeType === 'application/pdf' && scanResult.previewUrl ? (
                        <div className="bg-[#050A14] border border-[#192845] rounded-lg overflow-hidden">
                          <iframe
                            src={scanResult.previewUrl}
                            title={scanResult.fileName}
                            className="w-full h-[520px] bg-white"
                          />
                        </div>
                      ) : scanResult.previewText ? (
                        <pre className="text-[11px] font-mono text-slate-200 bg-[#050A14] border border-[#192845] rounded-lg p-3 max-h-[480px] overflow-auto whitespace-pre-wrap">
                          {scanResult.previewText}
                        </pre>
                      ) : (
                        <div className="py-10 text-center space-y-2 text-slate-400">
                          <p className="font-semibold text-slate-100">{scanResult.fileName}</p>
                          <p>Preview unavailable for this file format.</p>
                        </div>
                      )}

                      {scanResult.mode === 'manual' && (
                        <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200">
                          Live AI extraction did not complete. Your uploaded file is displayed above; enter fields manually on the right or click Re-run AI Extraction.
                        </div>
                      )}

                      {scanResult.livePayload?.executiveBriefing && (
                        <div className="pt-2 border-t border-[#192845] space-y-1">
                          <div className="text-[10px] font-mono uppercase text-slate-400">
                            AI Verbatim Briefing
                          </div>
                          <p className="text-slate-300 leading-relaxed">
                            {scanResult.livePayload.executiveBriefing}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : scanResult.docType === 'Tax Invoice' ? (
                    <>
                      <div className="flex justify-between border-b border-[#1E2E4E] pb-3">
                        <div>
                          <div className={`font-bold text-xs text-slate-100 ${highlightRing('supplierName')}`}>
                            Jaipur Precision Steels Pvt Ltd (Demo)
                          </div>
                          <div className="text-slate-400">Sitapura Industrial Area, Jaipur · Rajasthan (08)</div>
                          <div className={`font-mono mt-0.5 text-slate-300 ${highlightRing('supplierGstin')}`}>
                            GSTIN: 08AAECJ0041M1Z2
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-teal-400 text-xs">TAX INVOICE</div>
                          <div className={`font-mono mt-1 ${highlightRing('invoiceNumber')}`}>
                            No: JPS/26-27/0842
                          </div>
                          <div className={`font-mono ${highlightRing('invoiceDate')}`}>
                            Date: 2026-11-12
                          </div>
                        </div>
                      </div>

                      <div className="border-b border-[#1E2E4E] pb-2.5">
                        <div className="text-slate-500">Billed To:</div>
                        <div className={`font-semibold text-slate-100 ${highlightRing('customerName')}`}>
                          ABC Private Limited
                        </div>
                        <div className={`font-mono text-slate-300 ${highlightRing('customerGstin')}`}>
                          GSTIN: 08AABCA0001D1Z5
                        </div>
                      </div>

                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-[#1E2E4E] text-slate-400">
                            <th className="py-1">Item / HSN 7208</th>
                            <th className="py-1 text-right">Amount (₹)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#15223C] font-mono">
                          <tr>
                            <td className="py-1.5 font-sans">Cold Rolled Steel Sheets (Batch B-12)</td>
                            <td className={`py-1.5 text-right ${highlightRing('taxableValue')}`}>
                              1,85,000.00
                            </td>
                          </tr>
                          <tr>
                            <td className="py-1.5 font-sans">CGST @ 9%</td>
                            <td className={`py-1.5 text-right ${highlightRing('cgst')}`}>
                              16,650.00
                            </td>
                          </tr>
                          <tr>
                            <td className="py-1.5 font-sans">SGST @ 9%</td>
                            <td className={`py-1.5 text-right ${highlightRing('sgst')}`}>
                              16,650.00
                            </td>
                          </tr>
                          <tr>
                            <td className="py-1.5 font-sans">IGST @ 0%</td>
                            <td className={`py-1.5 text-right ${highlightRing('igst')}`}>0.00</td>
                          </tr>
                          <tr className="font-bold text-slate-100 border-t border-[#263C66]">
                            <td className="py-2 font-sans">Grand Total</td>
                            <td className={`py-2 text-right text-teal-400 ${highlightRing('totalAmount')}`}>
                              2,18,300.00
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </>
                  ) : scanResult.docType === 'Bank Statement' ? (
                    <>
                      <div className="flex justify-between border-b border-[#1E2E4E] pb-3">
                        <div>
                          <div className={`font-bold text-xs text-sky-400 ${highlightRing('bankName')}`}>
                            HDFC Bank Ltd — Sitapura Branch
                          </div>
                          <div className={`font-semibold mt-0.5 text-slate-100 ${highlightRing('accountHolder')}`}>
                            ABC Private Limited
                          </div>
                        </div>
                        <div className="text-right font-mono">
                          <div className={highlightRing('accountNumber')}>A/C: XXXX-XXXX-4918</div>
                          <div className={highlightRing('statementPeriod')}>
                            01 Oct 2026 – 31 Oct 2026
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 bg-[#081020] border border-[#192845] p-2.5 rounded font-mono">
                        <div>
                          <div className="text-slate-400 font-sans">Opening Bal</div>
                          <div className={`font-semibold text-slate-100 ${highlightRing('openingBalance')}`}>
                            ₹12,45,600
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-400 font-sans">Transactions</div>
                          <div className={`font-semibold text-slate-100 ${highlightRing('transactionCount')}`}>
                            118 entries
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-400 font-sans">Closing Bal</div>
                          <div className={`font-semibold text-teal-400 ${highlightRing('closingBalance')}`}>
                            ₹16,82,450
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1.5 font-mono text-[10px] text-slate-400 border-t border-[#192845] pt-2">
                        <div className="flex justify-between">
                          <span>04 Oct · NEFT INWARD RAJASTHAN INFRA</span>
                          <span className="text-emerald-400">+₹4,20,000</span>
                        </div>
                        <div className="flex justify-between">
                          <span>11 Oct · RTGS SUPPLIER SETTLEMENT</span>
                          <span className="text-rose-400">-₹1,85,400</span>
                        </div>
                        <div className="flex justify-between">
                          <span>20 Oct · GST PMT-06 CHALLAN DEBIT</span>
                          <span className="text-rose-400">-₹1,12,800</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="border-b border-[#1E2E4E] pb-3 text-center">
                        <div className="font-bold text-xs text-sky-400">
                          FORM GST REG-06 · REGISTRATION CERTIFICATE (DEMO)
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className={highlightRing('legalName')}>
                          <span className="text-slate-400">Legal Name:</span>{' '}
                          <strong className="text-slate-100">Greenfield Industries Pvt Ltd</strong>
                        </div>
                        <div className={highlightRing('tradeName')}>
                          <span className="text-slate-400">Trade Name:</span> Greenfield Packaging
                        </div>
                        <div className={`font-mono ${highlightRing('gstinMasked')}`}>
                          <span className="text-slate-400 font-sans">GSTIN:</span> 08AAB••••06M1Z7
                        </div>
                        <div className={`font-mono ${highlightRing('panMasked')}`}>
                          <span className="text-slate-400 font-sans">PAN:</span> AAB••••06M
                        </div>
                        <div className={highlightRing('constitution')}>
                          <span className="text-slate-400">Constitution:</span> Private Limited Company
                        </div>
                        <div className={highlightRing('regDate')}>
                          <span className="text-slate-400">Effective Date:</span> 2017-07-01
                        </div>
                        <div className={highlightRing('jurisdiction')}>
                          <span className="text-slate-400">Jurisdiction:</span> Rajasthan — Jaipur Ward 4
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Right Pane: Editable Fields + GST Arithmetic Validator */}
            <div className="lg:col-span-7 p-5 space-y-4">
              {gstCheck && (
                <div
                  className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-3 ${
                    gstCheck.isBalanced
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Calculator className="w-4 h-4 shrink-0" />
                    <span>
                      {gstCheck.isBalanced
                        ? `GST Arithmetic Reconciled: Taxable ${formatINR(
                            gstCheck.taxable
                          )} + Tax ${formatINR(gstCheck.taxTotal)} = ${formatINR(
                            gstCheck.total
                          )}`
                        : `Arithmetic Variance Detected: Taxable + Tax = ${formatINR(
                            gstCheck.computedTotal
                          )} vs Total ${formatINR(gstCheck.total)} (Diff: ${formatINR(
                            gstCheck.diff
                          )})`}
                    </span>
                  </div>
                </div>
              )}

              {scanResult.warnings.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                    <ShieldAlert className="w-4 h-4 text-amber-400" />
                    Review Warnings &amp; Statutory Notice
                  </div>
                  <ul className="list-disc pl-5 text-xs text-amber-200/90 space-y-0.5">
                    {scanResult.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {scanResult.fields.map((field) => {
                  const isMissing = !field.value.trim();
                  return (
                    <div key={field.key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <label className="font-medium text-slate-300">{field.label}</label>
                        {field.confidence !== undefined && (
                          <span className="font-mono text-[11px] text-teal-400">
                            {field.confidence}%
                          </span>
                        )}
                      </div>
                      <input
                        value={field.value}
                        onFocus={() => setFocusedField(field.key)}
                        onMouseEnter={() => setFocusedField(field.key)}
                        onBlur={() => setFocusedField(null)}
                        onChange={(e) => updateFieldValue(field.key, e.target.value)}
                        placeholder="Enter verified value..."
                        className={`w-full px-3 py-2 text-xs font-mono border rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none ${
                          isMissing
                            ? 'border-amber-500/50 bg-amber-500/10 focus:border-amber-400'
                            : 'border-[#223559] bg-[#081020] focus:border-teal-500'
                        }`}
                      />
                      {(isMissing || field.missingWarning) && (
                        <div className="flex items-center gap-1 text-[11px] text-amber-400">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>{field.missingWarning || 'Missing mandatory value'}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {scanResult.livePayload && scanResult.livePayload.verbatimLineItems.length > 0 && (
                <div className="pt-3 border-t border-[#1E2E4E] space-y-2">
                  <div className="text-xs font-semibold text-slate-200">
                    Verbatim Extracted Line Items ({scanResult.livePayload.verbatimLineItems.length})
                  </div>
                  <ul className="space-y-1.5 font-mono text-[11px] text-slate-200 max-h-48 overflow-y-auto">
                    {scanResult.livePayload.verbatimLineItems.map((line, i) => (
                      <li
                        key={i}
                        className="bg-[#081020] border border-[#192845] rounded px-3 py-1.5"
                      >
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
