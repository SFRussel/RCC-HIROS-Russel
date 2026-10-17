"use client";

import { useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import {
  ArrowLeft, Save, ChevronDown, ChevronRight, Plus, Trash2,
  CheckCircle2, Download,
} from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { downloadFile } from "@/lib/download";
import { canFillFpas } from "@/lib/fpas";
import { FpasPrintDocument } from "@/components/fpas/fpas-print";
import { FpasExportHub } from "@/components/fpas/fpas-export";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/store/auth-store";
import { useUnsavedChanges, useNavigationGuard } from "@/hooks/use-unsaved-changes";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PermissionDenied } from "@/components/shared/permission-denied";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface GroupBrief { id: string; name: string; code: string; }

export type { GroupBrief };

interface EmployeeBrief {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  groupId: string | null;
  groupName: string | null;
  groupCode: string | null;
  roleName: string | null;
  gender: string | null;
  hireDate: string | null;
}

interface FpasSubmissionRecord {
  id: string;
  employeeId: string;
  schoolYear: string;
  formData: string;
  totalPoints: number;
  createdAt: string;
  updatedAt: string;
  employee: {
    id: string;
    employeeId: string;
    firstName: string;
    lastName: string;
    middleName: string | null;
    group: { id: string; name: string; code: string } | null;
  };
}

export interface DynamicRow {
  id: string;
  [key: string]: string | number | boolean;
}

// Canonical model + scoring live in @/lib/fpas-form (shared with the
// print/PDF documents and server routes). Re-exported here so existing
// imports keep working.
export type { FpasFormData } from "@/lib/fpas-form";
import type { FpasFormData } from "@/lib/fpas-form";
import {
  blankFpasForm,
  calculateCriteria,
  calculateTotal,
} from "@/lib/fpas-form";
export { blankFpasForm, calculateCriteria, calculateTotal };

const DEFAULT_FORM_DATA: FpasFormData = blankFpasForm("");

const inputClass =
  "w-full px-3 py-2 bg-rcc-bg border border-rcc-border rounded-md text-sm text-rcc-text-primary focus:outline-none focus:ring-2 focus:ring-rcc-accent/40";

function makeRowId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ═══════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════

export function FpasPage({ employeeId, submissionId, showSettings: showSettingsProp }: { employeeId?: string; submissionId?: string; showSettings?: boolean }) {
  const { has } = usePermissions();
  const canManage = has("fpas.manage");
  const { setCurrentPage } = useAuthStore();

  const [showSettings, setShowSettings] = useState(showSettingsProp ?? false);

  // No list view: Employee Records (FPAS filter + status column) is the
  // hub. Bare `fpas` navigation redirects there.
  const showList = !showSettings && !employeeId && !submissionId;
  useEffect(() => {
    if (showList) setCurrentPage("profiling");
  }, [showList, setCurrentPage]);

  // If admin clicks settings, show settings page
  if (showSettings && canManage) {
    return <FpasSettingsPage onBack={() => setShowSettings(false)} />;
  }

  // If viewing a specific submission from the list
  if (submissionId) {
    return (
      <FpasSubmissionViewPage
        submissionId={submissionId}
        onBack={() => setCurrentPage("profiling")}
        onSettings={() => setShowSettings(true)}
        canManage={canManage}
      />
    );
  }

  // If we have an employeeId, show the form for that employee
  if (employeeId) {
    return (
      <FpasFormPage
        employeeId={employeeId}
        readOnly={false}
        onBack={() => setCurrentPage("profiling", `view:${employeeId}`)}
        onSettings={() => setShowSettings(true)}
        canManage={canManage}
      />
    );
  }

  // Default: no list view (removed) — redirect handled above.
  return null;
}

// ═══════════════════════════════════════════════════════════════
// FPAS Export Page — standalone bulk-download hub for fpas.export
// holders who do NOT manage FPAS (e.g. Deans). No configuration
// controls: the department is locked to the holder's own group,
// mirrored by a server-side scope pin in /api/fpas/export-pdf.
// ═══════════════════════════════════════════════════════════════

export function FpasExportPage() {
  const { has } = usePermissions();
  const { user } = useAuth();
  const setCurrentPage = useAuthStore((s) => s.setCurrentPage);

  const canManage = has("fpas.manage");
  const [groups, setGroups] = useState<GroupBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ groups: GroupBrief[] }>("/api/groups");
        setGroups(data.groups ?? []);
      } catch {
        setError("Failed to load departments.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const ownGroup =
    groups.find((g) => g.id === user?.groupId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-rcc-text-primary">FPAS Export</h1>
          <p className="text-sm text-rcc-text-muted mt-0.5">
            {canManage
              ? "Download submitted appraisal forms in bulk (any department)."
              : "Download the submitted appraisal forms of your department in bulk."}
          </p>
        </div>
        <button
          onClick={() => setCurrentPage("profiling")}
          className="inline-flex items-center gap-2 bg-rcc-surface border border-rcc-border text-rcc-text-secondary px-4 py-2 rounded-md text-sm font-semibold hover:bg-rcc-bg transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Employee Records
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-rcc-text-muted py-4 text-center">Loading departments…</p>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-md p-2.5 text-xs text-rcc-error">{error}</div>
      ) : canManage ? (
        <FpasExportHub groups={groups} />
      ) : ownGroup ? (
        <FpasExportHub groups={groups} lockedGroup={ownGroup} />
      ) : (
        <div className="bg-rcc-surface rounded-lg border border-rcc-border p-6 text-sm text-rcc-text-muted">
          You are not associated with a department, so there is nothing to export. Ask HR to set your department.
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FPAS Submission View Page (admin viewing a specific submission)
// ═══════════════════════════════════════════════════════════════

function FpasSubmissionViewPage({
  submissionId,
  onBack,
  onSettings,
  canManage,
}: {
  submissionId: string;
  onBack: () => void;
  onSettings?: () => void;
  canManage: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [submission, setSubmission] = useState<FpasSubmissionRecord | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    setAccessDenied(false);
    (async () => {
      try {
        const data = await apiFetch<{ submission: FpasSubmissionRecord }>(`/api/fpas/${submissionId}`);
        setSubmission(data.submission);
      } catch (err) {
        // 403 = outside the viewer's scope: explain instead of a bare 404.
        if (err instanceof ApiError && err.status === 403) setAccessDenied(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [submissionId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-rcc-primary border-t-transparent" />
        <span className="text-sm text-rcc-text-muted">Loading...</span>
      </div>
    );
  }

  if (!submission) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-rcc-text-secondary hover:text-rcc-primary transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        {accessDenied ? (
          <PermissionDenied message="You are not allowed to view this submission." />
        ) : (
          <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-rcc-error">Submission not found.</div>
        )}
      </div>
    );
  }

  return (
    <FpasFormPage
      employeeId={submission.employeeId}
      readOnly={true}
      onBack={onBack}
      onSettings={onSettings}
      canManage={canManage}
      submissionId={submissionId}
    />
  );
}

// ═══════════════════════════════════════════════════════════════
// FPAS Form Page
// ═══════════════════════════════════════════════════════════════

function FpasFormPage({
  employeeId,
  readOnly: readOnlyProp,
  onBack,
  onSettings,
  canManage,
  submissionId,
}: {
  employeeId: string;
  readOnly: boolean;
  onBack: () => void;
  onSettings?: () => void;
  canManage: boolean;
  submissionId?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [employee, setEmployee] = useState<EmployeeBrief | null>(null);
  // True when the target's group is switched off in FPAS Configuration
  // (managers bypass for their own fills). Starts false (optimistic —
  // the submit API remains the enforcer) to avoid a locked-form flash.
  const [groupBlocked, setGroupBlocked] = useState(false);
  // Effective editability: view mode, or a switched-off group.
  const readOnly = readOnlyProp || groupBlocked;
  const [formData, setFormData] = useState<FpasFormData>(DEFAULT_FORM_DATA);
  const [existingId, setExistingId] = useState<string | null>(submissionId ?? null);
  const [schoolYear, setSchoolYear] = useState(new Date().getFullYear() + "-" + (new Date().getFullYear() + 1));

  // Dirty detection. The snapshot is reactive state (not a ref) so the
  // memoized isDirty always recomputes after load/save — a mutated ref
  // would leave the flag stale-true and warn on every Back.
  const [snapshot, setSnapshot] = useState({ formData: JSON.stringify(DEFAULT_FORM_DATA), schoolYear: "" });
  const isDirty = useMemo(() => {
    return JSON.stringify(formData) !== snapshot.formData || schoolYear !== snapshot.schoolYear;
  }, [formData, schoolYear, snapshot]);
  useUnsavedChanges(isDirty && !readOnly);
  const { requestNavigation, navDialogProps } = useNavigationGuard(isDirty && !readOnly);

  // Load employee data
  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ employee: EmployeeBrief }>(`/api/employees/${employeeId}`);
        setEmployee(data.employee);
        // Pure updater — the snapshot is re-baselined by the effect below once
        // this commit lands. Calling setSnapshot in here would be a render-phase
        // side effect, and StrictMode double-invokes updaters in dev.
        setFormData((prev) => ({
          ...prev,
          header: {
            ...prev.header,
            name: `${data.employee.firstName} ${data.employee.middleName ? data.employee.middleName + " " : ""}${data.employee.lastName}`,
            department: data.employee.groupName ?? "",
          },
        }));
      } catch {
        setError("Failed to load employee data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [employeeId]);

  // Re-baseline the snapshot once the employee load has committed, so the
  // auto-filled header fields are not counted as unsaved edits. Reading the
  // committed formData here keeps the updater above pure, and snapshotting the
  // live schoolYear fixes a fresh form starting out "dirty" — the seed uses
  // schoolYear: "" while the state default is a "YYYY-YYYY" string.
  useEffect(() => {
    if (loading) return;
    setSnapshot({ formData: JSON.stringify(formData), schoolYear });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, employee]);

  // Group gate (rule: @/lib/fpas canFillFpas): a switched-off group
  // locks the form (Save hidden). Empty enabled list = all enabled;
  // managers bypass for their own fills.
  useEffect(() => {
    setGroupBlocked(false);
    if (canManage || !employee?.groupId) return;
    (async () => {
      try {
        const data = await apiFetch<{ enabledGroupIds: string[] }>("/api/fpas/settings");
        if (!canFillFpas({ groupId: employee.groupId, enabledGroupIds: data.enabledGroupIds ?? [] })) {
          setGroupBlocked(true);
        }
      } catch {
        // non-fatal — submit API remains the enforcer
      }
    })();
  }, [employee?.groupId, canManage]);

  // Load existing submission if submissionId provided
  useEffect(() => {
    if (!submissionId) return;
    (async () => {
      try {
        const data = await apiFetch<{ submission: FpasSubmissionRecord }>(`/api/fpas/${submissionId}`);
        const parsed = JSON.parse(data.submission.formData) as FpasFormData;
        setFormData(parsed);
        setSchoolYear(data.submission.schoolYear);
        setExistingId(data.submission.id);
        setSnapshot({ formData: JSON.stringify(parsed), schoolYear: data.submission.schoolYear });
      } catch {
        // non-fatal
      }
    })();
  }, [submissionId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    // Validation
    if (!formData.header.name.trim()) {
      setError("Name is required.");
      setSaving(false);
      return;
    }
    if (!schoolYear || !/^\d{4}-\d{4}$/.test(schoolYear)) {
      setError("School year is required (e.g., 2025-2026).");
      setSaving(false);
      return;
    }
    if (formData.criteria1.studentEvaluation === 0) {
      setError("Select a student evaluation rating.");
      setSaving(false);
      return;
    }
    if (formData.criteria1.classroomPerformance === 0) {
      setError("Select a classroom performance rating.");
      setSaving(false);
      return;
    }

    // Grand total check
    const total = calculateTotal(formData);
    if (total > 100) {
      setError("Total score exceeds maximum (100).");
      setSaving(false);
      return;
    }

    try {
      const payload = {
        employeeId,
        schoolYear,
        formData: JSON.stringify(formData),
        totalPoints: calculateTotal(formData),
      };

      if (existingId) {
        await apiFetch(`/api/fpas/${existingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        const result = await apiFetch<{ submission: { id: string } }>("/api/fpas", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setExistingId(result.submission.id);
      }
      setSuccess("FPAS form saved successfully.");
      setSnapshot({ formData: JSON.stringify(formData), schoolYear });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const updateHeader = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, header: { ...prev.header, [field]: value } }));
  };

  const updateCriteria1 = (field: string, value: number | boolean) => {
    setFormData((prev) => ({ ...prev, criteria1: { ...prev.criteria1, [field]: value } }));
  };

  const updateCriteria2 = (field: string, value: number) => {
    setFormData((prev) => ({ ...prev, criteria2: { ...prev.criteria2, [field]: value } }));
  };

  const updateCriteriaTable = (
    criteria: "criteria3" | "criteria4" | "criteria5" | "criteria6",
    table: string,
    rowId: string,
    field: string,
    value: string | number
  ) => {
    setFormData((prev) => ({
      ...prev,
      [criteria]: {
        ...prev[criteria],
        [table]: (prev[criteria] as Record<string, DynamicRow[]>)[table].map((row) =>
          row.id === rowId ? { ...row, [field]: value } : row
        ),
      },
    }));
  };

  const addRow = (criteria: "criteria3" | "criteria4" | "criteria5" | "criteria6", table: string) => {
    setFormData((prev) => ({
      ...prev,
      [criteria]: {
        ...prev[criteria],
        [table]: [...(prev[criteria] as Record<string, DynamicRow[]>)[table], { id: makeRowId(), title: "", nature: "", points: 0 }],
      },
    }));
  };

  const removeRow = (criteria: "criteria3" | "criteria4" | "criteria5" | "criteria6", table: string, rowId: string) => {
    setFormData((prev) => ({
      ...prev,
      [criteria]: {
        ...prev[criteria],
        [table]: (prev[criteria] as Record<string, DynamicRow[]>)[table].filter((r) => r.id !== rowId),
      },
    }));
  };

  const totalPoints = useMemo(() => calculateTotal(formData), [formData]);
  const criteriaTotals = useMemo(() => calculateCriteria(formData), [formData]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-rcc-primary border-t-transparent" />
        <span className="text-sm text-rcc-text-muted">Loading...</span>
      </div>
    );
  }

  return (
    <>
    {/* Interactive form — screen only; the paper version is the
        print-only FpasPrintDocument at the end of this return. */}
    <div className="space-y-4 no-print">
      {navDialogProps && <ConfirmDialog {...navDialogProps} />}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-rcc-error">{error}</div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-md p-3 text-sm text-green-700 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> {success}
        </div>
      )}
      {groupBlocked && !readOnlyProp && (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800">
          Your department ({employee?.groupName ?? formData.header.department ?? "Unassigned"}) is not
          enabled for FPAS. Switch it on in FPAS Configuration to fill this form.
        </div>
      )}

      {/* Header */}
      <div>
        <button onClick={() => requestNavigation(() => onBack())} className="no-print inline-flex items-center gap-1 text-sm text-rcc-text-secondary hover:text-rcc-primary transition-colors mb-3">
          <ArrowLeft className="h-4 w-4" /> Back to FPAS
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-rcc-text-primary">Faculty Performance Appraisal Form</h1>
            <p className="text-sm text-rcc-text-muted mt-0.5">
              {employee?.employeeId} - {formData.header.name || "Loading..."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-rcc-accent/10 text-rcc-accent text-sm font-semibold tabular-nums">
              {totalPoints.toFixed(1)} pts
            </span>
            <button
              onClick={async () => {
                if (!existingId) return;
                setDownloadingPdf(true);
                setError(null);
                try {
                  await downloadFile(
                    `/api/fpas/${existingId}/pdf`,
                    `FPAS-${employee?.employeeId ?? "form"}-${schoolYear}.pdf`
                  );
                } catch (err) {
                  setError(err instanceof Error ? err.message : "PDF download failed.");
                } finally {
                  setDownloadingPdf(false);
                }
              }}
              disabled={!existingId || downloadingPdf}
              title={existingId ? "Download this FPAS form as a PDF file" : "Save the form first, then download the PDF"}
              className="no-print inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold border border-rcc-border text-rcc-text-secondary hover:bg-rcc-bg transition-colors disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> {downloadingPdf ? "Saving…" : "Download PDF"}
            </button>
            {!readOnly && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="no-print inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold bg-rcc-primary text-rcc-primary-foreground hover:bg-rcc-primary/90 transition-colors disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Header Fields */}
      <div className="bg-rcc-surface rounded-lg border border-rcc-border p-6">
        <h2 className="text-sm font-semibold text-rcc-text-primary uppercase tracking-wide mb-4">Form Header</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="Name" required>
            <input value={formData.header.name} onChange={(e) => updateHeader("name", e.target.value)} className={inputClass} disabled={readOnly} />
          </Field>
          <Field label="Department">
            <input value={formData.header.department} onChange={(e) => updateHeader("department", e.target.value)} className={inputClass} disabled={readOnly} />
          </Field>
          <Field label="Date Entered RCC">
            <input value={formData.header.dateEnteredRcc} onChange={(e) => updateHeader("dateEnteredRcc", e.target.value)} className={inputClass} placeholder="e.g., June 2020" disabled={readOnly} />
          </Field>
          <Field label="Bachelor's Degree / Institution">
            <input value={formData.header.degreeInstitution} onChange={(e) => updateHeader("degreeInstitution", e.target.value)} className={inputClass} disabled={readOnly} />
          </Field>
          <Field label="School Year" required>
            <input value={schoolYear} onChange={(e) => setSchoolYear(e.target.value)} className={inputClass} placeholder="e.g., 2025-2026" disabled={readOnly} />
          </Field>
        </div>
      </div>

      {/* Official FPAS instructions */}
      <div className="bg-rcc-accent/5 border border-rcc-accent/20 rounded-lg p-4 text-sm text-rcc-text-secondary space-y-2">
        <p>
          <strong className="text-rcc-text-primary">Instruction:</strong> For Criteria I–II, kindly check
          only those items that are true to you. For Criteria III–VI, kindly fill out and refer to the
          FPAS scoring guide for the corresponding points.
        </p>
        <p className="italic">
          The Dean/Principal and the faculty shall sit down to discuss the points marked for each
          criterion and the final ratings.
        </p>
      </div>

      {/* Criteria I: Instruction */}
      <CriteriaSection title="I. Instruction" points={criteriaTotals.c1} maxPoints={25}>
        <RadioGroup
          label="Faculty Evaluation by Students"
          value={formData.criteria1.studentEvaluation}
          onChange={(v) => updateCriteria1("studentEvaluation", v)}
          options={[
            { value: 6, label: "5.00" },
            { value: 5, label: "4.50-4.995" },
            { value: 4, label: "3.50-4.494" },
            { value: 3, label: "2.50-3.493" },
            { value: 2, label: "1.50-2.492" },
            { value: 1, label: "Below 1.491" },
          ]}
          readOnly={readOnly}
        />
        <RadioGroup
          label="Classroom Performance Evaluation by Superior"
          value={formData.criteria1.classroomPerformance}
          onChange={(v) => updateCriteria1("classroomPerformance", v)}
          options={[
            { value: 6, label: "5.00" },
            { value: 5, label: "4.50-4.995" },
            { value: 4, label: "3.50-4.494" },
            { value: 3, label: "2.50-3.493" },
            { value: 2, label: "1.50-2.492" },
            { value: 1, label: "Below 1.491" },
          ]}
          readOnly={readOnly}
        />

        <h4 className="text-xs font-semibold text-rcc-text-secondary uppercase tracking-wide pt-3 pb-1">Performance on Student Assessment</h4>
        <RadioGroup
          label="Accomplishment and Submission of Grades"
          value={formData.criteria1.gradeSubmission}
          onChange={(v) => updateCriteria1("gradeSubmission", v)}
          options={[
            { value: 2, label: "Before the deadline" },
            { value: 1.5, label: "As per deadline" },
            { value: 0.5, label: "After deadline (w/in the week)" },
          ]}
          readOnly={readOnly}
        />
        <RadioGroup
          label="Accuracy on Grade Entry"
          value={formData.criteria1.gradeAccuracy}
          onChange={(v) => updateCriteria1("gradeAccuracy", v)}
          options={[
            { value: 1, label: "No corrections or alterations made" },
          ]}
          readOnly={readOnly}
        />
        <RadioGroup
          label="Submission of Class Records"
          value={formData.criteria1.classRecordSubmission}
          onChange={(v) => updateCriteria1("classRecordSubmission", v)}
          options={[
            { value: 1, label: "Before the deadline" },
            { value: 0.5, label: "As per deadline" },
            { value: 0.25, label: "After deadline (w/in the week)" },
          ]}
          readOnly={readOnly}
        />
        <RadioGroup
          label="Submission of Grading Sheets"
          value={formData.criteria1.gradingSheetSubmission}
          onChange={(v) => updateCriteria1("gradingSheetSubmission", v)}
          options={[
            { value: 1, label: "Before the deadline" },
            { value: 0.5, label: "As per deadline" },
            { value: 0.25, label: "After deadline (w/in the week)" },
          ]}
          readOnly={readOnly}
        />

        <h4 className="text-xs font-semibold text-rcc-text-secondary uppercase tracking-wide pt-3 pb-1">Course Syllabi</h4>
        <RadioGroup
          label="Accomplishment and Submission of Syllabi"
          value={formData.criteria1.syllabiSubmission}
          onChange={(v) => updateCriteria1("syllabiSubmission", v)}
          options={[
            { value: 2, label: "Before the deadline" },
            { value: 1, label: "As per deadline" },
            { value: 0.5, label: "After deadline (w/in the week)" },
          ]}
          readOnly={readOnly}
        />
        <CheckboxGroup
          label="Quality of Syllabi"
          items={[
            { key: "syllabiFormat", label: "Compliance w/ Format (0.5 pts)", checked: formData.criteria1.syllabiFormat },
            { key: "syllabiObjectives", label: "Complete Course Objectives/Content (1 pt)", checked: formData.criteria1.syllabiObjectives },
            { key: "syllabiReferences", label: "At least 5 references w/in the last 5 yrs (0.5 pts)", checked: formData.criteria1.syllabiReferences },
          ]}
          onChange={(key, val) => updateCriteria1(key, val)}
          readOnly={readOnly}
        />

        <h4 className="text-xs font-semibold text-rcc-text-secondary uppercase tracking-wide pt-3 pb-1">Test Papers</h4>
        <RadioGroup
          label="Accomplishment and Submission of Test Papers"
          value={formData.criteria1.testPaperSubmission}
          onChange={(v) => updateCriteria1("testPaperSubmission", v)}
          options={[
            { value: 1, label: "10 school days before the scheduled exam" },
            { value: 0.5, label: "7 school days before the scheduled exam" },
          ]}
          readOnly={readOnly}
        />
        <RadioGroup
          label="Quality of the Test Items"
          value={formData.criteria1.testItemQuality}
          onChange={(v) => updateCriteria1("testItemQuality", v)}
          options={[
            { value: 2, label: "Compliance with guidelines" },
            { value: 1, label: "With deviation" },
          ]}
          readOnly={readOnly}
        />
        <RadioGroup
          label="Administration of the Test"
          value={formData.criteria1.testAdministration}
          onChange={(v) => updateCriteria1("testAdministration", v)}
          options={[
            { value: 1, label: "As per schedule" },
          ]}
          readOnly={readOnly}
        />
      </CriteriaSection>

      {/* Criteria II: Faculty Attendance */}
      <CriteriaSection title="II. Faculty Attendance" points={criteriaTotals.c2} maxPoints={20}>
        <RadioGroup
          label="Record of Absences"
          value={formData.criteria2.absences}
          onChange={(v) => updateCriteria2("absences", v)}
          options={[
            { value: 6, label: "0 days" },
            { value: 5, label: "1-2 days" },
            { value: 4, label: "3-5 days" },
          ]}
          readOnly={readOnly}
        />
        <RadioGroup
          label="Record of Tardiness"
          value={formData.criteria2.tardiness}
          onChange={(v) => updateCriteria2("tardiness", v)}
          options={[
            { value: 5, label: "0 mins" },
            { value: 4, label: "1-60 mins" },
            { value: 3, label: "61-120 mins" },
          ]}
          readOnly={readOnly}
        />
        <RadioGroup
          label="Attendance in School/College Activities"
          value={formData.criteria2.schoolActivities}
          onChange={(v) => updateCriteria2("schoolActivities", v)}
          options={[
            { value: 3, label: "0 absences" },
            { value: 2, label: "1 absence" },
            { value: 1, label: "2 absences" },
          ]}
          readOnly={readOnly}
        />
        <RadioGroup
          label="Attendance in Faculty Meetings"
          value={formData.criteria2.facultyMeetings}
          onChange={(v) => updateCriteria2("facultyMeetings", v)}
          options={[
            { value: 3, label: "0 absences" },
            { value: 2, label: "1 absence" },
            { value: 1, label: "2 absences" },
          ]}
          readOnly={readOnly}
        />
        <RadioGroup
          label="Library Visitation / Utilization of Lib Resources"
          value={formData.criteria2.libraryVisits}
          onChange={(v) => updateCriteria2("libraryVisits", v)}
          options={[
            { value: 3, label: "37 visits and above" },
            { value: 2, label: "26-36 visits" },
            { value: 1, label: "18-25 visits" },
          ]}
          readOnly={readOnly}
        />
      </CriteriaSection>

      {/* Criteria III: Professional Growth */}
      <CriteriaSection title="III. Professional Growth" points={criteriaTotals.c3} maxPoints={20}>
        <DynamicTable
          title="Graduate Degree (max 9 pts)"
          rows={formData.criteria3.graduateDegree}
          columns={[
            { key: "title", label: "Title" },
            { key: "institution", label: "Name of Institution" },
            { key: "nature", label: "Date Graduated or Units Earned" },
            { key: "points", label: "Points", type: "number" },
          ]}
          onAdd={() => addRow("criteria3", "graduateDegree")}
          onRemove={(rowId) => removeRow("criteria3", "graduateDegree", rowId)}
          onUpdate={(rowId, field, val) => updateCriteriaTable("criteria3", "graduateDegree", rowId, field, val)}
          readOnly={readOnly}
        />
        <DynamicTable
          title="Participation in Faculty Development Activities (max 4 pts)"
          rows={formData.criteria3.facultyDevelopment}
          columns={[
            { key: "title", label: "Title" },
            { key: "nature", label: "Nature of Participation" },
            { key: "points", label: "Points", type: "number" },
          ]}
          onAdd={() => addRow("criteria3", "facultyDevelopment")}
          onRemove={(rowId) => removeRow("criteria3", "facultyDevelopment", rowId)}
          onUpdate={(rowId, field, val) => updateCriteriaTable("criteria3", "facultyDevelopment", rowId, field, val)}
          readOnly={readOnly}
        />
        <DynamicTable
          title="Attendance in Seminars, Symposia and Workshop (max 3 pts)"
          rows={formData.criteria3.seminars}
          columns={[
            { key: "title", label: "Title" },
            { key: "nature", label: "Nature of Participation" },
            { key: "points", label: "Points", type: "number" },
          ]}
          onAdd={() => addRow("criteria3", "seminars")}
          onRemove={(rowId) => removeRow("criteria3", "seminars", rowId)}
          onUpdate={(rowId, field, val) => updateCriteriaTable("criteria3", "seminars", rowId, field, val)}
          readOnly={readOnly}
        />
        <DynamicTable
          title="Special Studies / Training (max 3 pts)"
          rows={formData.criteria3.specialStudies}
          columns={[
            { key: "title", label: "Title" },
            { key: "nature", label: "Nature of Participation" },
            { key: "points", label: "Points", type: "number" },
          ]}
          onAdd={() => addRow("criteria3", "specialStudies")}
          onRemove={(rowId) => removeRow("criteria3", "specialStudies", rowId)}
          onUpdate={(rowId, field, val) => updateCriteriaTable("criteria3", "specialStudies", rowId, field, val)}
          readOnly={readOnly}
        />
        <DynamicTable
          title="Awards / Recognition (max 4 pts)"
          rows={formData.criteria3.awards}
          columns={[
            { key: "title", label: "Nature of Award" },
            { key: "institution", label: "Awarded by" },
            { key: "nature", label: "Date Awarded" },
            { key: "points", label: "Points", type: "number" },
          ]}
          onAdd={() => addRow("criteria3", "awards")}
          onRemove={(rowId) => removeRow("criteria3", "awards", rowId)}
          onUpdate={(rowId, field, val) => updateCriteriaTable("criteria3", "awards", rowId, field, val)}
          readOnly={readOnly}
        />
        <DynamicTable
          title="Membership in Professional Organizations (max 3 pts)"
          rows={formData.criteria3.professionalOrgs}
          columns={[
            { key: "title", label: "Name of Organization" },
            { key: "nature", label: "Position" },
            { key: "institution", label: "No. of Years" },
            { key: "points", label: "Points", type: "number" },
          ]}
          onAdd={() => addRow("criteria3", "professionalOrgs")}
          onRemove={(rowId) => removeRow("criteria3", "professionalOrgs", rowId)}
          onUpdate={(rowId, field, val) => updateCriteriaTable("criteria3", "professionalOrgs", rowId, field, val)}
          readOnly={readOnly}
        />
      </CriteriaSection>

      {/* Criteria IV: Researches & Publications */}
      <CriteriaSection title="IV. Researches and Publications" points={criteriaTotals.c4} maxPoints={16}>
        <DynamicTable
          title="Scientific Discoveries and Inventions (max 7 pts)"
          rows={formData.criteria4.discoveries}
          columns={[
            { key: "title", label: "Title" },
            { key: "nature", label: "Nature of Participation" },
            { key: "points", label: "Points", type: "number" },
          ]}
          onAdd={() => addRow("criteria4", "discoveries")}
          onRemove={(rowId) => removeRow("criteria4", "discoveries", rowId)}
          onUpdate={(rowId, field, val) => updateCriteriaTable("criteria4", "discoveries", rowId, field, val)}
          readOnly={readOnly}
        />
        <DynamicTable
          title="Books / Manuals / Instructional Materials / Modules Published"
          rows={formData.criteria4.publications}
          columns={[
            { key: "title", label: "Title" },
            { key: "nature", label: "Nature of Participation" },
            { key: "points", label: "Points", type: "number" },
          ]}
          onAdd={() => addRow("criteria4", "publications")}
          onRemove={(rowId) => removeRow("criteria4", "publications", rowId)}
          onUpdate={(rowId, field, val) => updateCriteriaTable("criteria4", "publications", rowId, field, val)}
          readOnly={readOnly}
        />
        <DynamicTable
          title="Research Studies Conducted and Presented (max 5 pts)"
          rows={formData.criteria4.researchStudies}
          columns={[
            { key: "title", label: "Title" },
            { key: "nature", label: "Nature of Participation" },
            { key: "points", label: "Points", type: "number" },
          ]}
          onAdd={() => addRow("criteria4", "researchStudies")}
          onRemove={(rowId) => removeRow("criteria4", "researchStudies", rowId)}
          onUpdate={(rowId, field, val) => updateCriteriaTable("criteria4", "researchStudies", rowId, field, val)}
          readOnly={readOnly}
        />
        <DynamicTable
          title="Research Articles Published (max 4 pts)"
          rows={formData.criteria4.researchArticles}
          columns={[
            { key: "title", label: "Title" },
            { key: "nature", label: "Nature of Participation" },
            { key: "points", label: "Points", type: "number" },
          ]}
          onAdd={() => addRow("criteria4", "researchArticles")}
          onRemove={(rowId) => removeRow("criteria4", "researchArticles", rowId)}
          onUpdate={(rowId, field, val) => updateCriteriaTable("criteria4", "researchArticles", rowId, field, val)}
          readOnly={readOnly}
        />
      </CriteriaSection>

      {/* Criteria V: School Functions / Extracurricular */}
      <CriteriaSection title="V. Involvement in School Functions / Student Extra-Curricular Activities" points={criteriaTotals.c5} maxPoints={9}>
        <DynamicTable
          title="Adviser of Student Organizations (max 3 pts)"
          rows={formData.criteria5.adviser}
          columns={[
            { key: "title", label: "Name of Organization" },
            { key: "nature", label: "Period" },
            { key: "points", label: "Points", type: "number" },
          ]}
          onAdd={() => addRow("criteria5", "adviser")}
          onRemove={(rowId) => removeRow("criteria5", "adviser", rowId)}
          onUpdate={(rowId, field, val) => updateCriteriaTable("criteria5", "adviser", rowId, field, val)}
          readOnly={readOnly}
        />
        <DynamicTable
          title="Official Coach of Student Competitions (max 3 pts)"
          rows={formData.criteria5.coach}
          columns={[
            { key: "title", label: "Title of the Competition" },
            { key: "nature", label: "Period" },
            { key: "points", label: "Points", type: "number" },
          ]}
          onAdd={() => addRow("criteria5", "coach")}
          onRemove={(rowId) => removeRow("criteria5", "coach", rowId)}
          onUpdate={(rowId, field, val) => updateCriteriaTable("criteria5", "coach", rowId, field, val)}
          readOnly={readOnly}
        />
        <DynamicTable
          title="Official School Functions / Working Committee (max 3 pts)"
          rows={formData.criteria5.officialFunctions}
          columns={[
            { key: "title", label: "Name of the School Functions" },
            { key: "nature", label: "Nature of Participation" },
            { key: "points", label: "Points", type: "number" },
          ]}
          onAdd={() => addRow("criteria5", "officialFunctions")}
          onRemove={(rowId) => removeRow("criteria5", "officialFunctions", rowId)}
          onUpdate={(rowId, field, val) => updateCriteriaTable("criteria5", "officialFunctions", rowId, field, val)}
          readOnly={readOnly}
        />
      </CriteriaSection>

      {/* Criteria VI: Community Involvement */}
      <CriteriaSection title="VI. Community Involvement" points={criteriaTotals.c6} maxPoints={10}>
        <DynamicTable
          title="Projects Initiated (max 4 pts)"
          rows={formData.criteria6.projectsInitiated}
          columns={[
            { key: "title", label: "Title" },
            { key: "nature", label: "Nature of Participation" },
            { key: "points", label: "Points", type: "number" },
          ]}
          onAdd={() => addRow("criteria6", "projectsInitiated")}
          onRemove={(rowId) => removeRow("criteria6", "projectsInitiated", rowId)}
          onUpdate={(rowId, field, val) => updateCriteriaTable("criteria6", "projectsInitiated", rowId, field, val)}
          readOnly={readOnly}
        />
        <DynamicTable
          title="Projects Participated (max 3 pts)"
          rows={formData.criteria6.projectsParticipated}
          columns={[
            { key: "title", label: "Title" },
            { key: "nature", label: "Nature of Participation" },
            { key: "points", label: "Points", type: "number" },
          ]}
          onAdd={() => addRow("criteria6", "projectsParticipated")}
          onRemove={(rowId) => removeRow("criteria6", "projectsParticipated", rowId)}
          onUpdate={(rowId, field, val) => updateCriteriaTable("criteria6", "projectsParticipated", rowId, field, val)}
          readOnly={readOnly}
        />
        <DynamicTable
          title="Membership in Socio-Civic & Religious Organizations (max 3 pts)"
          rows={formData.criteria6.memberships}
          columns={[
            { key: "title", label: "Name of Organization" },
            { key: "nature", label: "Position" },
            { key: "institution", label: "No. of Years" },
            { key: "points", label: "Points", type: "number" },
          ]}
          onAdd={() => addRow("criteria6", "memberships")}
          onRemove={(rowId) => removeRow("criteria6", "memberships", rowId)}
          onUpdate={(rowId, field, val) => updateCriteriaTable("criteria6", "memberships", rowId, field, val)}
          readOnly={readOnly}
        />
      </CriteriaSection>
    </div>
    {/* Template-faithful print document (screen-hidden, paper-only) */}
    <div className="print-only">
      <FpasPrintDocument formData={formData} schoolYear={schoolYear} />
    </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// FPAS Settings Page
// ═══════════════════════════════════════════════════════════════

function FpasSettingsPage({ onBack }: { onBack: () => void }) {
  const [groups, setGroups] = useState<GroupBrief[]>([]);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  // True while the export hub shows its print preview — the config
  // chrome above stays on screen but is hidden on paper.
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);

  // Dirty detection
  // The snapshot must be reactive state, not a ref: `isDirty` is memoized,
  // and mutating a ref does not invalidate the memo. Keeping the snapshot in
  // a ref made the flag stay stale-true after a successful save (the green
  // banner and "Unsaved changes" showed at the same time) until `enabledIds`
  // happened to change again.
  const [snapshot, setSnapshot] = useState<string>("[]");
  const isDirty = useMemo(() => {
    return JSON.stringify(Array.from(enabledIds).sort()) !== snapshot;
  }, [enabledIds, snapshot]);
  useUnsavedChanges(isDirty);
  const { requestNavigation, navDialogProps } = useNavigationGuard(isDirty);

  useEffect(() => {
    (async () => {
      try {
        const [groupsData, settingsData] = await Promise.all([
          apiFetch<{ groups: GroupBrief[] }>("/api/groups"),
          apiFetch<{ enabledGroupIds: string[] }>("/api/fpas/settings"),
        ]);
        setGroups(groupsData.groups ?? []);
        setEnabledIds(new Set(settingsData.enabledGroupIds ?? []));
        setSnapshot(JSON.stringify((settingsData.enabledGroupIds ?? []).sort()));
      } catch {
        setError("Failed to load settings.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleSelect = (groupId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const allSelected = groups.length > 0 && groups.every((g) => selectedIds.has(g.id));
  const someSelected = selectedIds.size > 0;
  const enabledCount = groups.filter((g) => enabledIds.has(g.id)).length;

  const selectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(groups.map((g) => g.id)));
    }
  };

  const enableSelected = () => {
    setSuccess(null);
    setEnabledIds((prev) => {
      const next = new Set(prev);
      for (const id of selectedIds) next.add(id);
      return next;
    });
    setSelectedIds(new Set());
  };

  const disableSelected = () => {
    setSuccess(null);
    setEnabledIds((prev) => {
      const next = new Set(prev);
      for (const id of selectedIds) next.delete(id);
      return next;
    });
    setSelectedIds(new Set());
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      // Snapshot from the server echo (server truth), never from the
      // click-time local copy — the two can differ if staging changed
      // mid-flight (now prevented by disabling the picker while saving).
      const result = await apiFetch<{ enabledGroupIds: string[] }>("/api/fpas/settings", {
        method: "PATCH",
        body: JSON.stringify({ enabledGroupIds: Array.from(enabledIds) }),
      });
      setSuccess("Settings saved successfully.");
      // Pin the screen and the snapshot to the server echo so the list on
      // screen, the banner, and the dirty check can never disagree.
      setEnabledIds(new Set(result.enabledGroupIds ?? []));
      setSnapshot(JSON.stringify([...(result.enabledGroupIds ?? [])].sort()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-rcc-primary border-t-transparent" />
        <span className="text-sm text-rcc-text-muted">Loading...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {navDialogProps && <ConfirmDialog {...navDialogProps} />}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-rcc-error">{error}</div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-md p-3 text-sm text-green-700 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> {success}
        </div>
      )}

      <div className={exportPreviewOpen ? "no-print" : ""}>
        <button onClick={() => requestNavigation(() => onBack())} className="inline-flex items-center gap-1 text-sm text-rcc-text-secondary hover:text-rcc-primary transition-colors mb-3">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div>
          <h1 className="text-xl font-bold text-rcc-text-primary">FPAS Configuration</h1>
          <p className="text-sm text-rcc-text-muted mt-0.5">Select groups, then enable or disable FPAS access for them.</p>
        </div>
      </div>

      <div className={`bg-rcc-surface rounded-lg border border-rcc-border ${exportPreviewOpen ? "no-print" : ""}`}>
        {/* Header with actions */}
        <div className="px-4 py-3 border-b border-rcc-border flex items-center justify-between gap-4">
          <span className="text-sm font-semibold text-rcc-text-primary">
            Department Access
            {someSelected && <span className="ml-2 text-xs text-rcc-text-muted">({selectedIds.size} selected)</span>}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={enableSelected}
              disabled={!someSelected || saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold border border-green-200 text-green-700 hover:bg-green-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Enable
            </button>
            <button
              onClick={disableSelected}
              disabled={!someSelected || saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Disable
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-semibold bg-rcc-primary text-rcc-primary-foreground hover:bg-rcc-primary/90 transition-colors disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save Changes"}
            </button>
            {isDirty && !saving && (
              <span className="text-xs font-medium text-amber-700">• Unsaved changes</span>
            )}
          </div>
        </div>
        {/* Department dropdown picker */}
        <div className="p-4">
          <div className="relative">
            <button
              type="button"
              onClick={() => setDropdownOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
              disabled={saving}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-rcc-bg border border-rcc-border rounded-md text-sm text-rcc-text-primary focus:outline-none focus:ring-2 focus:ring-rcc-accent/40 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span className={someSelected ? "" : "text-rcc-text-muted"}>
                {someSelected
                  ? `${selectedIds.size} of ${groups.length} departments selected`
                  : "Select departments…"}
              </span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-rcc-text-muted transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
            </button>
            {dropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
                <div role="listbox" className="absolute z-20 mt-1 w-full bg-rcc-surface border border-rcc-border rounded-md shadow-xl max-h-72 overflow-auto">
                  <label className="flex items-center gap-2 px-4 py-2.5 cursor-pointer border-b border-rcc-border hover:bg-rcc-bg/30 text-sm font-medium text-rcc-text-primary">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={selectAll}
                      disabled={saving}
                      className="h-4 w-4 rounded border-rcc-border text-rcc-accent focus:ring-rcc-accent/40 disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                    Select all
                  </label>
                  {groups.map((g) => (
                    <label
                      key={g.id}
                      className="flex items-center gap-4 px-4 py-2.5 cursor-pointer hover:bg-rcc-bg/30 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(g.id)}
                        onChange={() => toggleSelect(g.id)}
                        disabled={saving}
                        className="h-4 w-4 rounded border-rcc-border text-rcc-accent focus:ring-rcc-accent/40 disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-rcc-text-primary">{g.name}</p>
                        <p className="text-xs text-rcc-text-muted font-mono">{g.code}</p>
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${enabledIds.has(g.id) ? "bg-green-50 text-green-700 border border-green-200" : "bg-rcc-bg text-rcc-text-muted border border-rcc-border"}`}>
                        {enabledIds.has(g.id) ? "Enabled" : "Disabled"}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          <p className="mt-2 text-xs text-rcc-text-muted">
            {enabledCount} of {groups.length} departments can fill the Faculty Performance Appraisal form. Changes apply after Save Changes.
          </p>
        </div>
      </div>

      {/* Submission exports (print-to-PDF per member) */}
      <FpasExportHub groups={groups} onPreviewChange={setExportPreviewOpen} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Shared UI Components
// ═══════════════════════════════════════════════════════════════

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-rcc-text-secondary mb-1.5">
        {label} {required && <span className="text-rcc-error">*</span>}
      </label>
      {children}
    </div>
  );
}

function CriteriaSection({
  title,
  points,
  maxPoints,
  children,
}: {
  title: string;
  points: number;
  maxPoints: number;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="bg-rcc-surface rounded-lg border border-rcc-border overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 border-b border-rcc-border flex items-center justify-between hover:bg-rcc-bg/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4 text-rcc-text-muted" /> : <ChevronRight className="h-4 w-4 text-rcc-text-muted" />}
          <h2 className="text-sm font-semibold text-rcc-text-primary uppercase tracking-wide">{title}</h2>
        </div>
        <span className="text-xs font-semibold text-rcc-accent tabular-nums">{points} / {maxPoints} pts</span>
      </button>
      {expanded && <div className="p-4 space-y-4">{children}</div>}
    </div>
  );
}

function RadioGroup({
  label,
  value,
  onChange,
  options,
  readOnly,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  options: { value: number; label: string }[];
  readOnly: boolean;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-rcc-text-primary mb-2">{label}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {options.map((opt) => (
          <label
            key={opt.value}
            className={`flex flex-col items-center justify-center px-3 py-2.5 rounded-lg border-2 text-center cursor-pointer transition-all
              ${value === opt.value
                ? "border-rcc-accent bg-rcc-accent/8 shadow-sm"
                : "border-rcc-border hover:border-rcc-accent/30 hover:bg-rcc-bg/50"}
              ${readOnly ? "opacity-70 cursor-default" : ""}`}
          >
            <div className="flex items-center gap-1.5">
              <input
                type="radio"
                name={label}
                checked={value === opt.value}
                onChange={() => !readOnly && onChange(opt.value)}
                disabled={readOnly}
                className="h-4 w-4 text-rcc-accent focus:ring-rcc-accent/40"
              />
              <span className={`text-sm font-medium ${value === opt.value ? "text-rcc-accent" : "text-rcc-text-primary"}`}>
                {opt.label}
              </span>
            </div>
            <span className={`text-[11px] mt-1 font-semibold ${value === opt.value ? "text-rcc-accent/70" : "text-rcc-text-muted"}`}>
              {opt.value} {opt.value === 1 ? "pt" : "pts"}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function CheckboxGroup({
  label,
  items,
  onChange,
  readOnly,
}: {
  label: string;
  items: { key: string; label: string; checked: boolean }[];
  onChange: (key: string, val: boolean) => void;
  readOnly: boolean;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-rcc-text-primary mb-2">{label}</p>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <label
            key={item.key}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm cursor-pointer transition-colors
              ${item.checked ? "border-rcc-accent/40 bg-rcc-accent/5 text-rcc-accent" : "border-rcc-border text-rcc-text-secondary hover:bg-rcc-bg/40"}
              ${readOnly ? "opacity-70 cursor-default" : ""}`}
          >
            <input
              type="checkbox"
              checked={item.checked}
              onChange={(e) => !readOnly && onChange(item.key, e.target.checked)}
              disabled={readOnly}
              className="h-3.5 w-3.5 rounded border-rcc-border text-rcc-accent focus:ring-rcc-accent/40"
            />
            {item.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function DynamicTable({
  title,
  rows,
  columns,
  onAdd,
  onRemove,
  onUpdate,
  readOnly,
}: {
  title: string;
  rows: DynamicRow[];
  columns: { key: string; label: string; type?: "text" | "number" }[];
  onAdd: () => void;
  onRemove: (rowId: string) => void;
  onUpdate: (rowId: string, field: string, value: string | number) => void;
  readOnly: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-rcc-text-primary">{title}</p>
        {!readOnly && (
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold text-rcc-accent hover:bg-rcc-accent/10 transition-colors"
          >
            <Plus className="h-3 w-3" /> Add Row
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-rcc-text-muted italic py-2">No entries yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-rcc-bg/50 border-b border-rcc-border">
              <tr>
                {columns.map((col) => (
                  <th key={col.key} className="text-left text-xs font-semibold text-rcc-text-muted uppercase tracking-wide px-3 py-2">
                    {col.label}
                  </th>
                ))}
                {!readOnly && <th className="w-10"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-rcc-border">
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-1.5">
                      <input
                        type={col.type === "number" ? "number" : "text"}
                        value={String(row[col.key] ?? "")}
                        onChange={(e) => onUpdate(row.id, col.key, col.type === "number" ? parseFloat(e.target.value) || 0 : e.target.value)}
                        min={col.type === "number" ? "0" : undefined}
                        className="w-full px-2 py-1 bg-rcc-bg border border-rcc-border rounded-md text-sm text-rcc-text-primary focus:outline-none focus:ring-1 focus:ring-rcc-accent/40"
                        readOnly={readOnly}
                      />
                    </td>
                  ))}
                  {!readOnly && (
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => onRemove(row.id)}
                        className="p-1.5 rounded-md hover:bg-red-50 text-rcc-text-muted hover:text-rcc-error transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

