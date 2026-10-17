"use client";

import { useEffect, useState, useMemo, useCallback, useRef, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useUnsavedChanges, useNavigationGuard } from "@/hooks/use-unsaved-changes";
import {
  Plus, Search, Pencil, ArrowLeft, ArrowRight, Save, Users as UsersIcon, Upload,
  FileText, Download, Trash2, Eye, X, Lock, Mail, Phone, MapPin, Calendar,
  IdCard, Briefcase, Award, Image as ImageIcon, AlertTriangle, Building2, Settings,
  Hash, User, DollarSign, Shield, Fingerprint,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { downloadFile } from "@/lib/download";
import { canFillFpas } from "@/lib/fpas";
import { ProfilePrintDocument } from "@/components/profiling/profile-print";
import { useAuthStore } from "@/store/auth-store";
import { usePermissions } from "@/hooks/use-permissions";
import {
  useServerPagination,
  PaginationControls,
} from "@/components/shared/table-pagination-v2";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { BiometricsCard } from "@/components/biometric/BiometricsCard";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface ConfirmDialogState {
  open: boolean;
  title: string;
  message: string;
  variant: "danger" | "warning";
  onConfirm: () => void;
}

interface GroupBrief { id: string; name: string; code: string; }
interface ContractTypeBrief { id: string; name: string; code: string; }
interface RoleBrief { id: string; name: string; }

interface Employee {
  id: string;
  employeeId: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  email: string;
  phone: string | null;
  address: string | null;
  birthday: string | null;
  gender: string | null;
  contractType: string;
  contractTypeId: string | null;
  contractTypeName: string | null;
  employmentType: string;
  hireDate: string | null;
  salary: number | null;
  active: boolean;
  groupId: string | null;
  groupName: string | null;
  groupCode: string | null;
  group?: GroupBrief | null;
  roleId: string | null;
  roleName: string | null;
  mustChangePwd?: boolean;
  lastLoginAt?: string | null;
  photo?: string | null;
  placeOfBirth?: string | null;
  rank?: string | null;
  civilStatus?: string | null;
  citizenship?: string | null;
  religion?: string | null;
  height?: string | null;
  weight?: string | null;
  bloodType?: string | null;
  profileData?: string | null;
  certificateCount?: number;
  createdAt?: string;
  updatedAt?: string;
  certificates?: Certificate[];
  files?: EmployeeFile[];
  counts?: Record<string, number>;
}

interface Certificate {
  id: string;
  title: string;
  issuer: string | null;
  certificateNo: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  createdAt: string;
}

interface EmployeeFile {
  id: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  description: string | null;
  uploadedBy: string | null;
  createdAt: string;
  uploadedAt: string;
}

const EMPLOYMENT_TYPES = ["Teaching", "Non-Teaching"];
const GENDER_OPTIONS = ["Male", "Female"];

const inputClass =
  "w-full px-3 py-2 bg-rcc-bg border border-rcc-border rounded-md text-sm text-rcc-text-primary focus:outline-none focus:ring-2 focus:ring-rcc-accent/40";

// ═══════════════════════════════════════════════════════════════
// EmployeeListPage
// ═══════════════════════════════════════════════════════════════

export function EmployeeListPage() {
  const { setCurrentPage } = useAuthStore();
  const { has, hasAny } = usePermissions();
  const { user } = useAuth();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeTotal, setEmployeeTotal] = useState(0);
  const [groups, setGroups] = useState<GroupBrief[]>([]);
  const [roles, setRoles] = useState<RoleBrief[]>([]);
  const [contractTypes, setContractTypes] = useState<ContractTypeBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [groupId, setGroupId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [contractType, setContractType] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [fpasFilter, setFpasFilter] = useState("");

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Load groups, roles & contract types once for filters
  useEffect(() => {
    (async () => {
      try {
        const [g, r, ct] = await Promise.all([
          apiFetch<{ groups: GroupBrief[] }>("/api/groups"),
          apiFetch<{ roles: RoleBrief[] }>("/api/roles/active"),
          apiFetch<{ contractTypes: ContractTypeBrief[] }>("/api/contract-types"),
        ]);
        setGroups(g.groups ?? []);
        setRoles(r.roles ?? []);
        setContractTypes(ct.contractTypes ?? []);
      } catch {
        // non-fatal
      }
    })();
  }, []);

  // Server-driven paging: the list endpoint returns one page + total.
  const filterKey = [debouncedSearch, groupId, roleId, contractType, employmentType, activeFilter, fpasFilter].join("|");
  const serverPager = useServerPagination(employeeTotal, { defaultPageSize: 15, resetKey: filterKey });

  const loadEmployees = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (groupId) params.set("groupId", groupId);
      if (roleId) params.set("roleId", roleId);
      if (contractType) params.set("contractType", contractType);
      if (employmentType) params.set("employmentType", employmentType);
      if (activeFilter) params.set("active", activeFilter);
      if (fpasFilter) params.set("fpasStatus", fpasFilter);
      params.set("page", String(serverPager.page));
      params.set("pageSize", String(serverPager.pageSize));
      const qs = params.toString();
      const data = await apiFetch<{ employees: Employee[]; total?: number }>(
        `/api/employees${qs ? `?${qs}` : ""}`,
        { signal }
      );
      setEmployees(data.employees ?? []);
      setEmployeeTotal(typeof data.total === "number" ? data.total : (data.employees ?? []).length);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load employees.");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, groupId, roleId, contractType, activeFilter, fpasFilter, serverPager.page, serverPager.pageSize]);

  useEffect(() => {
    const controller = new AbortController();
    loadEmployees(controller.signal);
    return () => controller.abort();
  }, [loadEmployees]);

  const { currentData, controls } = { currentData: employees, controls: serverPager.controls };

  const canViewInactive = has("profiling.view_inactive");

  // FPAS submission status for the FPAS column (EMP-code → status).
  // Shown to fill/manage holders; hidden if the fetch fails. Rows are
  // pre-scoped server-side: managers see everyone, everyone else only
  // self — an absent entry renders as "—".
  const canViewFpas = hasAny(["fpas.fill", "fpas.manage"]);
  const [fpasMap, setFpasMap] = useState<Map<string, { hasSubmission: boolean; submissionId: string | null }> | null>(null);
  useEffect(() => {
    if (!canViewFpas) return;
    const controller = new AbortController();
    (async () => {
      try {
        const data = await apiFetch<{ employees: { employeeId: string; hasSubmission: boolean; submission: { id: string } | null }[] }>(
          "/api/fpas/status",
          { signal: controller.signal }
        );
        const map = new Map<string, { hasSubmission: boolean; submissionId: string | null }>();
        for (const e of data.employees ?? []) {
          map.set(e.employeeId, { hasSubmission: e.hasSubmission, submissionId: e.submission?.id ?? null });
        }
        if (!controller.signal.aborted) setFpasMap(map);
      } catch {
        // non-fatal — column stays hidden
      }
    })();
    return () => controller.abort();
  }, [canViewFpas]);
  const showFpasCol = fpasMap !== null;
  // Enabled-group ids for the Fill badge gate. Null while loading/failed —
  // treated as allowed (the form lock + submit API enforce regardless).
  // An empty list means all groups are enabled.
  const [fpasEnabledIds, setFpasEnabledIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!canViewFpas) return;
    (async () => {
      try {
        const data = await apiFetch<{ enabledGroupIds: string[] }>("/api/fpas/settings");
        setFpasEnabledIds(new Set(data.enabledGroupIds ?? []));
      } catch {
        // non-fatal — fall back to offering Fill (form + API enforce)
      }
    })();
  }, [canViewFpas]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-rcc-text-primary">Employee Records</h1>
          <p className="text-sm text-rcc-text-muted mt-0.5">
            Click a row to view the full employee profile.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {has("profiling.edit") && (
            <button
              onClick={() => setCurrentPage("profiling", "contract-types")}
              className="inline-flex items-center gap-2 bg-rcc-surface border border-rcc-border text-rcc-text-secondary px-4 py-2 rounded-md text-sm font-semibold hover:bg-rcc-bg transition-colors"
            >
              Contract Types
            </button>
          )}
          {has("fpas.export") && !has("fpas.manage") && (
            <button
              onClick={() => setCurrentPage("fpas", "export")}
              className="inline-flex items-center gap-2 bg-rcc-surface border border-rcc-border text-rcc-text-secondary px-4 py-2 rounded-md text-sm font-semibold hover:bg-rcc-bg transition-colors"
            >
              FPAS Export
            </button>
          )}
          {has("fpas.manage") && (
            <button
              onClick={() => setCurrentPage("fpas", "settings")}
              className="inline-flex items-center gap-2 bg-rcc-surface border border-rcc-border text-rcc-text-secondary px-4 py-2 rounded-md text-sm font-semibold hover:bg-rcc-bg transition-colors"
            >
              FPAS Configuration
            </button>
          )}
          {has("profiling.create") && (
            <button
              onClick={() => setCurrentPage("profiling", "create")}
              className="inline-flex items-center gap-2 bg-rcc-primary text-rcc-primary-foreground px-4 py-2 rounded-md text-sm font-semibold hover:bg-rcc-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              New Employee
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-rcc-surface rounded-lg border border-rcc-border p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
          <div className="lg:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-rcc-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or employee ID..."
              className={`${inputClass} pl-10`}
            />
          </div>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={inputClass}>
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className={inputClass}>
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <select value={contractType} onChange={(e) => setContractType(e.target.value)} className={inputClass}>
            <option value="">All contracts</option>
            {contractTypes.map((c) => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
          <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} className={inputClass}>
            <option value="">All types</option>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {canViewFpas && (
            <select value={fpasFilter} onChange={(e) => setFpasFilter(e.target.value)} className={inputClass} aria-label="FPAS submission status filter">
              <option value="">All FPAS</option>
              <option value="submitted">FPAS Submitted</option>
              <option value="empty">FPAS Not Started</option>
            </select>
          )}
        </div>
        {canViewInactive && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-rcc-text-muted">Status:</span>
            {["", "true", "false"].map((v) => (
              <button
                key={v}
                onClick={() => setActiveFilter(v)}
                className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                  activeFilter === v
                    ? "bg-rcc-primary text-rcc-primary-foreground border-rcc-primary"
                    : "border-rcc-border text-rcc-text-secondary hover:bg-rcc-bg"
                }`}
              >
                {v === "" ? "All" : v === "true" ? "Active" : "Inactive"}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-rcc-error">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-rcc-surface rounded-lg border border-rcc-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-rcc-bg/50 border-b border-rcc-border">
              <tr>
                <th className="text-left text-xs font-semibold text-rcc-text-muted uppercase tracking-wide px-4 py-3">Employee</th>
                <th className="text-left text-xs font-semibold text-rcc-text-muted uppercase tracking-wide px-4 py-3">ID</th>
                <th className="text-left text-xs font-semibold text-rcc-text-muted uppercase tracking-wide px-4 py-3">Group</th>
                <th className="text-left text-xs font-semibold text-rcc-text-muted uppercase tracking-wide px-4 py-3">Role</th>
                <th className="text-left text-xs font-semibold text-rcc-text-muted uppercase tracking-wide px-4 py-3">Contract</th>
                <th className="text-left text-xs font-semibold text-rcc-text-muted uppercase tracking-wide px-4 py-3">Type</th>
                <th className="text-left text-xs font-semibold text-rcc-text-muted uppercase tracking-wide px-4 py-3">Status</th>
                {showFpasCol && (
                  <th className="text-left text-xs font-semibold text-rcc-text-muted uppercase tracking-wide px-4 py-3">FPAS</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-rcc-border">
              {loading ? (
                <tr>
                  <td colSpan={showFpasCol ? 8 : 7} className="px-4 py-10 text-center text-rcc-text-muted">
                    Loading employees...
                  </td>
                </tr>
              ) : currentData.length === 0 ? (
                <tr>
                  <td colSpan={showFpasCol ? 8 : 7} className="px-4 py-10 text-center text-rcc-text-muted">
                    No employees found. Adjust filters or create a new record.
                  </td>
                </tr>
              ) : (
                currentData.map((emp) => {
                  const fpasEntry = fpasMap?.get(emp.employeeId);
                  const fpasSubmitted = !!fpasEntry?.hasSubmission && !!fpasEntry?.submissionId;
                  // Nobody files for anyone else: fill form only for the
                  // viewer's own row when they hold Fill.
                  // Fill badge only for the viewer's own row when they hold
                  // Fill gate (rule: @/lib/fpas canFillFpas — unknown/empty
                  // enabled list = allowed; managers bypass). Otherwise the
                  // form-level lock + submit API explain and enforce.
                  const mayFillRow = user?.id === emp.id && has("fpas.fill") && canFillFpas({
                    groupId: emp.groupId,
                    enabledGroupIds: fpasEnabledIds ? [...fpasEnabledIds] : null,
                    bypass: has("fpas.manage"),
                  });
                  const fpasBadge = fpasSubmitted ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-green-50 text-green-700 border border-green-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> SUBMITTED
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rcc-bg text-rcc-text-muted border border-rcc-border">
                      <span className="w-1.5 h-1.5 rounded-full bg-rcc-text-muted" /> NOT STARTED
                    </span>
                  );
                  // View target when a submission exists (presence in the
                  // pre-scoped map already authorizes viewing it); otherwise
                  // the fill form, but only for the owner's own row when
                  // they hold Fill. Nobody files for anyone else.
                  const fpasTarget = fpasSubmitted
                    ? `view:${fpasEntry!.submissionId}`
                    : (user?.id === emp.id && has("fpas.fill"))
                      ? `emp:${emp.id}`
                      : null;
                  const fpasTitle = fpasSubmitted ? "View FPAS submission" : "Fill FPAS form";
                  return (
                  <tr
                    key={emp.id}
                    onClick={() => setCurrentPage("profiling", `view:${emp.id}`)}
                    className="cursor-pointer hover:bg-rcc-bg/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-rcc-primary/10 text-rcc-primary flex items-center justify-center shrink-0 text-xs font-bold">
                          {(emp.firstName.charAt(0) + emp.lastName.charAt(0)).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-rcc-text-primary truncate">
                            {emp.firstName} {emp.lastName}
                          </p>
                          <p className="text-xs text-rcc-text-muted truncate">{emp.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-rcc-text-secondary font-mono text-xs">
                      {emp.employeeId}
                    </td>
                    <td className="px-4 py-3 text-rcc-text-secondary">
                      {emp.groupName ?? <span className="text-rcc-text-muted">-</span>}
                    </td>
                    <td className="px-4 py-3 text-rcc-text-secondary">
                      {emp.roleName ?? <span className="text-rcc-text-muted">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-rcc-accent/10 text-rcc-accent border border-rcc-accent/20">
                        {emp.contractType}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${
                        emp.employmentType === "Teaching"
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : "bg-purple-50 text-purple-700 border-purple-200"
                      }`}>
                        {emp.employmentType}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {emp.active ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-rcc-error">
                          <span className="w-1.5 h-1.5 rounded-full bg-rcc-error" /> Inactive
                        </span>
                      )}
                    </td>
                    {showFpasCol && (
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        {!fpasEntry ? (
                          <span className="text-rcc-text-muted">—</span>
                        ) : fpasTarget ? (
                          <button
                            onClick={() => setCurrentPage("fpas", fpasTarget)}
                            className="cursor-pointer hover:opacity-80 transition-opacity"
                            title={fpasTitle}
                          >
                            {fpasBadge}
                          </button>
                        ) : (
                          fpasBadge
                        )}
                      </td>
                    )}
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls {...controls} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// EmployeeFormPage
// ═══════════════════════════════════════════════════════════════

export function EmployeeFormPage({ mode, employeeId }: { mode: "create" | "edit"; employeeId?: string }) {
  const { setCurrentPage } = useAuthStore();

  const [groups, setGroups] = useState<GroupBrief[]>([]);
  const [roles, setRoles] = useState<RoleBrief[]>([]);
  const [contractTypes, setContractTypes] = useState<ContractTypeBrief[]>([]);
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [employeeIdField, setEmployeeIdField] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [birthday, setBirthday] = useState("");
  const [gender, setGender] = useState("");
  const [groupId, setGroupId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [contractTypeId, setContractTypeId] = useState("");
  const [employmentType, setEmploymentType] = useState("Teaching");
  const [hireDate, setHireDate] = useState("");
  const [salary, setSalary] = useState("");
  const [active, setActive] = useState(true);

  // Login credentials (create-only)
  const [password, setPassword] = useState("");
  const [mustChangePwd, setMustChangePwd] = useState(true);

  // Dirty detection
  const snapshotRef = useRef<Record<string, string | boolean>>({});
  const isDirty = useMemo(() => {
    const current: Record<string, string | boolean> = {
      employeeIdField, firstName, middleName, lastName, email, phone, address,
      birthday, gender, groupId, roleId, contractTypeId, employmentType, hireDate, salary, active,
    };
    return JSON.stringify(current) !== JSON.stringify(snapshotRef.current);
  }, [employeeIdField, firstName, middleName, lastName, email, phone, address, birthday, gender, groupId, roleId, contractTypeId, employmentType, hireDate, salary, active]);
  useUnsavedChanges(isDirty);
  const { requestNavigation, navDialogProps } = useNavigationGuard(isDirty);

  useEffect(() => {
    (async () => {
      try {
        const [g, r, ct] = await Promise.all([
          apiFetch<{ groups: GroupBrief[] }>("/api/groups"),
          apiFetch<{ roles: RoleBrief[] }>("/api/roles/active"),
          apiFetch<{ contractTypes: ContractTypeBrief[] }>("/api/contract-types"),
        ]);
        setGroups(g.groups ?? []);
        setRoles(r.roles ?? []);
        setContractTypes(ct.contractTypes ?? []);
      } catch {
        // non-fatal
      }
    })();
  }, []);

  useEffect(() => {
    if (mode !== "edit" || !employeeId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await apiFetch<{ employee: Employee }>(`/api/employees/${employeeId}`);
        if (cancelled) return;
        const e = data.employee;
        setEmployeeIdField(e.employeeId);
        setFirstName(e.firstName);
        setMiddleName(e.middleName ?? "");
        setLastName(e.lastName);
        setEmail(e.email);
        setPhone(e.phone ?? "");
        setAddress(e.address ?? "");
        setBirthday(e.birthday ? e.birthday.slice(0, 10) : "");
        setGender(e.gender ?? "");
        setGroupId(e.groupId ?? "");
        setRoleId(e.roleId ?? "");
        setContractTypeId(e.contractTypeId ?? "");
        setEmploymentType(e.employmentType ?? "Teaching");
        setHireDate(e.hireDate ? e.hireDate.slice(0, 10) : "");
        setSalary(e.salary != null ? String(e.salary) : "");
        setActive(e.active);
        snapshotRef.current = {
          employeeIdField: e.employeeId, firstName: e.firstName, middleName: e.middleName ?? "",
          lastName: e.lastName, email: e.email, phone: e.phone ?? "", address: e.address ?? "",
          birthday: e.birthday ? e.birthday.slice(0, 10) : "", gender: e.gender ?? "",
          groupId: e.groupId ?? "", roleId: e.roleId ?? "",
          contractTypeId: e.contractTypeId ?? "",
          employmentType: e.employmentType ?? "Teaching",
          hireDate: e.hireDate ? e.hireDate.slice(0, 10) : "",
          salary: e.salary != null ? String(e.salary) : "", active: e.active,
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load employee.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, employeeId]);

  const handleSave = async () => {
    setError(null);
    if (!employeeIdField.trim()) return setError("Employee ID is required.");
    if (!firstName.trim()) return setError("First name is required.");
    if (!lastName.trim()) return setError("Last name is required.");
    if (!email.trim()) return setError("Email is required.");
    if (mode === "create" && (!password || password.length < 8)) {
      return setError("Password must be at least 8 characters.");
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        employeeId: employeeIdField.trim(),
        firstName: firstName.trim(),
        middleName: middleName.trim() || null,
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        address: address.trim() || null,
        birthday: birthday || null,
        gender: gender || null,
        groupId: groupId || null,
        roleId: roleId || null,
        contractTypeId: contractTypeId || null,
        employmentType,
        hireDate: hireDate || null,
        salary: salary ? parseFloat(salary) : 0,
        active,
      };
      if (mode === "create") {
        payload.password = password;
        payload.mustChangePwd = mustChangePwd;
        await apiFetch("/api/employees", { method: "POST", body: JSON.stringify(payload) });
      } else if (employeeId) {
        // password is optional on edit
        if (password) payload.password = password;
        await apiFetch(`/api/employees/${employeeId}`, { method: "PATCH", body: JSON.stringify(payload) });
      }
      setCurrentPage("profiling");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-rcc-primary border-t-transparent" />
        <span className="ml-2 text-sm text-rcc-text-muted">Loading...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {navDialogProps && <ConfirmDialog {...navDialogProps} />}
      <div className="flex items-center gap-3">
        <button
          onClick={() => requestNavigation(() => setCurrentPage("profiling"))}
          className="inline-flex items-center gap-1 text-sm text-rcc-text-secondary hover:text-rcc-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to employees
        </button>
      </div>
      <div>
        <h1 className="text-xl font-bold text-rcc-text-primary">
          {mode === "create" ? "Create Employee" : `Edit: ${firstName} ${lastName}`}
        </h1>
        <p className="text-sm text-rcc-text-muted mt-0.5">
          Fill in all required fields. Login credentials are set on create; password is optional on edit.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-rcc-error">
          {error}
        </div>
      )}

      <section className="bg-rcc-surface rounded-lg border border-rcc-border p-6 space-y-4">
        <h2 className="text-sm font-semibold text-rcc-text-primary uppercase tracking-wide">
          Personal Information
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="Employee ID" required>
            <input type="text" value={employeeIdField} onChange={(e) => setEmployeeIdField(e.target.value)} placeholder="EMP-0001" className={`${inputClass} font-mono`} />
          </Field>
          <Field label="First Name" required>
            <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Middle Name">
            <input type="text" value={middleName} onChange={(e) => setMiddleName(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Last Name" required>
            <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Email" required>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Phone">
            <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Birthday">
            <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Gender">
            <select value={gender} onChange={(e) => setGender(e.target.value)} className={inputClass}>
              <option value="">-</option>
              {GENDER_OPTIONS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </Field>
          <Field label="Address" hint="Full home address.">
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
          </Field>
        </div>
      </section>

      <section className="bg-rcc-surface rounded-lg border border-rcc-border p-6 space-y-4">
        <h2 className="text-sm font-semibold text-rcc-text-primary uppercase tracking-wide">
          Work Assignment
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="Group">
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={inputClass}>
              <option value="">Unassigned</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name} ({g.code})</option>
              ))}
            </select>
          </Field>
          <Field label="Role">
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className={inputClass}>
              <option value="">Unassigned</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Contract Type">
            <select value={contractTypeId} onChange={(e) => setContractTypeId(e.target.value)} className={inputClass}>
              <option value="">Unassigned</option>
              {contractTypes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Employment Type">
            <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} className={inputClass}>
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Hire Date">
            <input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Monthly Salary" hint="₱ PHP">
            <input type="number" value={salary} onChange={(e) => setSalary(e.target.value)} min="0" step="0.01" className={inputClass} />
          </Field>
        </div>
      </section>

      {mode === "create" && (
        <section className="bg-rcc-surface rounded-lg border border-rcc-border p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-rcc-text-secondary" />
            <h2 className="text-sm font-semibold text-rcc-text-primary uppercase tracking-wide">
              Login Credentials
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Password" required hint="Minimum 8 characters.">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={inputClass}
                autoComplete="new-password"
              />
            </Field>
            <label
              className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                mustChangePwd ? "border-rcc-accent/40 bg-rcc-accent/5" : "border-rcc-border hover:bg-rcc-bg/40"
              }`}
            >
              <input type="checkbox" checked={mustChangePwd} onChange={(e) => setMustChangePwd(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-rcc-border text-rcc-accent focus:ring-rcc-accent/40" />
              <div>
                <p className="text-sm font-semibold text-rcc-text-primary">Must Change Password on First Login</p>
                <p className="text-xs text-rcc-text-muted mt-0.5">Force the user to choose a new password.</p>
              </div>
            </label>
          </div>
        </section>
      )}

      {mode === "edit" && (
        <section className="bg-rcc-surface rounded-lg border border-rcc-border p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-rcc-text-secondary" />
            <h2 className="text-sm font-semibold text-rcc-text-primary uppercase tracking-wide">
              Reset Password (Optional)
            </h2>
          </div>
          <Field label="New Password" hint="Leave blank to keep the current password. Min 8 chars.">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={inputClass}
              autoComplete="new-password"
            />
          </Field>
        </section>
      )}

      <section className="bg-rcc-surface rounded-lg border border-rcc-border p-6 space-y-4">
        <label
          className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
            active ? "border-rcc-accent/40 bg-rcc-accent/5" : "border-rcc-border hover:bg-rcc-bg/40"
          }`}
        >
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-rcc-border text-rcc-accent focus:ring-rcc-accent/40" />
          <div>
            <p className="text-sm font-semibold text-rcc-text-primary">Active Employee</p>
            <p className="text-xs text-rcc-text-muted mt-0.5">Inactive employees cannot sign in.</p>
          </div>
        </label>
      </section>

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={() => requestNavigation(() => setCurrentPage("profiling"))}
          disabled={saving}
          className="px-4 py-2 rounded-md text-sm font-medium border border-rcc-border text-rcc-text-secondary hover:bg-rcc-bg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold bg-rcc-primary text-rcc-primary-foreground hover:bg-rcc-primary/90 transition-colors disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : mode === "create" ? "Create Employee" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SectionCard — collapsible LinkedIn-style card wrapper
// ═══════════════════════════════════════════════════════════════

function SectionCard({ title, icon: Icon, canEdit, editing, onEdit, onCancel, onSave, saving, editError, noPadding, children }: {
  title: string;
  icon: any;
  canEdit?: boolean;
  editing?: boolean;
  onEdit?: () => void;
  onCancel?: () => void;
  onSave?: () => void;
  saving?: boolean;
  editError?: string | null;
  noPadding?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-rcc-surface rounded-lg border border-rcc-border overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5">
        <h2 className="text-sm font-semibold text-rcc-text-primary uppercase tracking-wide flex items-center gap-2">
          <Icon className="h-4 w-4 text-rcc-primary" /> {title}
        </h2>
        {canEdit && !editing && onEdit && (
          <button onClick={onEdit} className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border border-rcc-border text-rcc-text-secondary hover:bg-rcc-bg transition-colors">
            <Pencil className="h-3 w-3" /> Edit
          </button>
        )}
        {editing && (
          <div className="flex items-center gap-2">
            <button onClick={onCancel} className="px-2.5 py-1 rounded text-xs font-medium border border-rcc-border text-rcc-text-secondary hover:bg-rcc-bg transition-colors">Cancel</button>
            <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-rcc-primary text-rcc-primary-foreground hover:bg-rcc-primary/90 transition-colors disabled:opacity-50">
              <Save className="h-3 w-3" /> {saving ? "Saving..." : "Save"}
            </button>
          </div>
        )}
      </div>
      {editError && <div className="mx-5 mt-3 bg-red-50 border border-red-200 rounded-md p-2 text-xs text-rcc-error">{editError}</div>}
      <div className={noPadding ? "" : "p-5"}>{children}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ProfileSection — editable repeatable-row section
// ═══════════════════════════════════════════════════════════════

function ProfileSection({ sectionKey, label, rows, fields, editing, canEdit, onEdit, onCancel, onSave, saving, onAdd, onRemove, onUpdate }: {
  sectionKey: string;
  label: string;
  rows: any[];
  fields: Record<string, string>;
  editing: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  onUpdate: (idx: number, field: string, value: string) => void;
}) {
  const fieldLabels: Record<string, string> = {
    degree: "Degree", dateEarned: "Date Earned", school: "School",
    position: "Position", year: "Year", organization: "Organization",
    exam: "Examination", place: "Place", date: "Date", rating: "Rating",
    award: "Award", institution: "Granting Institution",
    title: "Title", publication: "Publication", issue: "Issue",
    scope: "Scope", nature: "Nature of Participation",
    function: "Function", beneficiaries: "Beneficiaries",
  };
  return (
    <SectionCard title={label} icon={Briefcase} canEdit={canEdit} editing={editing} onEdit={onEdit} onCancel={onCancel} onSave={onSave} saving={saving} noPadding>
      <div className="px-5 pb-4">
        {editing ? (
          <div className="space-y-3">
            {rows.map((row, idx) => (
              <div key={idx} className="flex items-start gap-2 p-3 border border-rcc-border rounded-md bg-rcc-bg/30">
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {Object.keys(fields).map((f) => (
                    <input key={f} type="text" placeholder={fieldLabels[f] || f} value={row[f] || ""} onChange={(e) => onUpdate(idx, f, e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded border border-rcc-border text-sm bg-rcc-surface text-rcc-text-primary placeholder:text-rcc-text-muted focus:outline-none focus:ring-1 focus:ring-rcc-primary" />
                  ))}
                </div>
                <button onClick={() => onRemove(idx)} className="mt-1 p-1 rounded text-rcc-text-muted hover:text-rcc-error hover:bg-red-50 transition-colors" title="Remove row">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button onClick={onAdd} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border border-dashed border-rcc-border text-rcc-text-secondary hover:bg-rcc-bg transition-colors">
              <Plus className="h-3 w-3" /> Add Row
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-rcc-text-muted text-center py-4">No data yet. Click Edit to add entries.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rcc-border">
                  {Object.keys(fields).map((f) => (
                    <th key={f} className="px-3 py-2 text-left text-xs font-semibold text-rcc-text-secondary uppercase tracking-wide">{fieldLabels[f] || f}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={idx} className="border-b border-rcc-border/50 last:border-0 hover:bg-rcc-bg/30 transition-colors">
                    {Object.keys(fields).map((f) => (
                      <td key={f} className="px-3 py-2 text-rcc-text-primary">{row[f] || <span className="text-rcc-text-muted">-</span>}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ═══════════════════════════════════════════════════════════════
// EmployeeProfilePage
// ═══════════════════════════════════════════════════════════════

export function EmployeeProfilePage({ employeeId }: { employeeId: string }) {
  const { setCurrentPage } = useAuthStore();
  const { has, hasAny, canChangePassword, canManageBiometrics } = usePermissions();
  const { user } = useAuth();

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // File viewer modal
  const [viewing, setViewing] = useState<{ url: string; mime: string; name: string } | null>(null);

  // Certificate add modal
  const [certOpen, setCertOpen] = useState(false);
  const [certForm, setCertForm] = useState({ title: "", issuer: "", certificateNo: "", issueDate: "", expiryDate: "" });

  // File upload state
  const [uploading, setUploading] = useState(false);
  const [fileDesc, setFileDesc] = useState("");

  const [confirmState, setConfirmState] = useState<ConfirmDialogState | null>(null);

  // FPAS enabled state for THIS profile's group.
  //   true  = group is on the enabled list (or the list is empty = all)
  //   false = group is switched off
  //   null  = not resolved yet (still loading, request failed, or the
  //           employee has no group) — treated as allowed, mirroring the
  //           Records list. The form lock and submit API stay the enforcers.
  const [fpasEnabled, setFpasEnabled] = useState<boolean | null>(null);
  // This profile's submission id (current school year) for the View button.
  // The status endpoint pre-scopes rows server-side, so presence here means
  // the viewer is authorized to see it.
  const [profileFpasSubId, setProfileFpasSubId] = useState<string | null>(null);

  // Inline edit mode — unified for all fields
  const canSelfEdit = employeeId === user?.id && has("profile.selfEdit");
  const canManageFiles = has("profiling.edit") || has("profile.editAll") || canSelfEdit;
  const isAdmin = has("profiling.edit") || has("profile.editAll");
  const canEditIdentity = isAdmin || has("profiling.editIdentity");
  const canEditEmployment = isAdmin || has("profiling.editEmployment");
  const canEditSalary = isAdmin || has("profiling.editSalary");
  const canEditStatus = isAdmin || has("profiling.editStatus");
  const [editing, setEditing] = useState(false);
  const [editFormData, setEditFormData] = useState({
    employeeId: "", firstName: "", middleName: "", lastName: "", email: "",
    phone: "", address: "", birthday: "", gender: "",
    placeOfBirth: "", rank: "", civilStatus: "", citizenship: "",
    religion: "", height: "", weight: "", bloodType: "",
    contractTypeId: "", employmentType: "Teaching", hireDate: "", salary: "",
    groupId: "", roleId: "", active: true,
  });
  const editSnapshotRef = useRef<string>("");
  const isInlineDirty = useMemo(() => {
    if (!editing) return false;
    return JSON.stringify(editFormData) !== editSnapshotRef.current;
  }, [editing, editFormData]);
  const { requestNavigation: requestInlineNav, navDialogProps: inlineNavDialog } =
    useNavigationGuard(isInlineDirty);
  const [editFormGroups, setEditFormGroups] = useState<GroupBrief[]>([]);
  const [editFormRoles, setEditFormRoles] = useState<RoleBrief[]>([]);
  const [editFormContractTypes, setEditFormContractTypes] = useState<ContractTypeBrief[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // Password change (profile page)
  const [newPassword, setNewPassword] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);
  const [pwdError, setPwdError] = useState<string | null>(null);

  // Profile data (LinkedIn-style)
  const canFillProfile = employeeId === user?.id && user?.canEditProfile;
  const [profileData, setProfileData] = useState<Record<string, any[]>>({});
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [sectionForm, setSectionForm] = useState<any[]>([]);
  const sectionSnapshotRef = useRef<string>("[]");
  const isSectionDirty = useMemo(() => {
    if (editingSection === null) return false;
    return JSON.stringify(sectionForm) !== sectionSnapshotRef.current;
  }, [editingSection, sectionForm]);
  const { requestNavigation: requestSectionNav, navDialogProps: sectionNavDialog } =
    useNavigationGuard(isSectionDirty);
  const [sectionSaving, setSectionSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  // Bumped after every upload/delete so the mutable /photo URL is never
  // served stale from the browser cache (session-35).
  const [photoVersion, setPhotoVersion] = useState(0);

  // Parse profileData JSON
  useEffect(() => {
    if (employee?.profileData) {
      try { setProfileData(JSON.parse(employee.profileData)); } catch { setProfileData({}); }
    }
  }, [employee?.profileData]);

  const loadEmployee = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ employee: Employee }>(`/api/employees/${employeeId}`);
      setEmployee(data.employee);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load employee.");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    loadEmployee();
  }, [loadEmployee]);

  // Check FPAS enabled for employee's group (rule: @/lib/fpas
  // canFillFpas — unknown/empty list = allowed).
  useEffect(() => {
    if (!employee?.groupId) return;
    (async () => {
      try {
        const data = await apiFetch<{ enabledGroupIds: string[] }>("/api/fpas/settings");
        setFpasEnabled(canFillFpas({
          groupId: employee.groupId,
          enabledGroupIds: data.enabledGroupIds ?? [],
        }));
      } catch {
        // non-fatal
      }
    })();
  }, [employee?.groupId]);

  // This profile's current-year submission (for the View FPAS button).
  // Only fetched when the viewer may see FPAS at all; the endpoint
  // pre-scopes rows, so a hit means authorized.
  useEffect(() => {
    setProfileFpasSubId(null);
    if (!employee?.employeeId) return;
    if (!hasAny(["fpas.fill", "fpas.manage"])) return;
    const code = employee.employeeId;
    (async () => {
      try {
        const data = await apiFetch<{ employees: { employeeId: string; submission: { id: string } | null }[] }>(
          "/api/fpas/status"
        );
        const row = (data.employees ?? []).find((e) => e.employeeId === code);
        setProfileFpasSubId(row?.submission?.id ?? null);
      } catch {
        // non-fatal — View button stays hidden
      }
    })();
  }, [employee?.employeeId, hasAny]);

  // Revoke blob URLs when viewer closes
  useEffect(() => {
    if (!viewing) return;
    const url = viewing.url;
    return () => {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    };
  }, [viewing]);

  const fetchFileBlob = async (fileId: string): Promise<{ blob: Blob; mime: string }> => {
    const token = localStorage.getItem("hiros_token");
    const res = await fetch(`/api/employees/${employeeId}/files/${fileId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Failed to fetch file (${res.status})`);
    const blob = await res.blob();
    const mime = res.headers.get("content-type") || "application/octet-stream";
    return { blob, mime };
  };

  const handleViewFile = async (file: EmployeeFile) => {
    try {
      const { blob, mime } = await fetchFileBlob(file.id);
      const url = URL.createObjectURL(blob);
      setViewing({ url, mime, name: file.originalName });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load file.");
    }
  };

  const handleDownloadFile = async (file: EmployeeFile) => {
    try {
      const { blob } = await fetchFileBlob(file.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.originalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    }
  };

  const handleDeleteFile = (file: EmployeeFile) => {
    setConfirmState({
      open: true,
      title: `Delete "${file.originalName}"?`,
      message: "This file will be permanently removed. This action cannot be undone.",
      variant: "danger",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await apiFetch(`/api/employees/${employeeId}/files/${file.id}`, { method: "DELETE" });
          loadEmployee();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Delete failed.");
        }
      },
    });
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") { setError("Only PDF files are allowed."); return; }
    if (file.size > 10 * 1024 * 1024) { setError("File exceeds 10MB limit."); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (fileDesc.trim()) fd.append("description", fileDesc.trim());
      await apiFetch(`/api/employees/${employeeId}/files`, {
        method: "POST",
        body: fd,
        skipJsonHeader: true,
      });
      setFileDesc("");
      (e.target as HTMLInputElement).value = "";
      loadEmployee();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const handleAddCert = async () => {
    if (!certForm.title.trim()) return;
    try {
      await apiFetch(`/api/employees/${employeeId}/certificates`, {
        method: "POST",
        body: JSON.stringify({
          title: certForm.title.trim(),
          issuer: certForm.issuer.trim() || null,
          certificateNo: certForm.certificateNo.trim() || null,
          issueDate: certForm.issueDate || null,
          expiryDate: certForm.expiryDate || null,
        }),
      });
      setCertForm({ title: "", issuer: "", certificateNo: "", issueDate: "", expiryDate: "" });
      setCertOpen(false);
      loadEmployee();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add certificate.");
    }
  };

  const handleDeleteCert = (certId: string, title: string) => {
    setConfirmState({
      open: true,
      title: `Delete certificate "${title}"?`,
      message: "This certificate will be permanently removed. This action cannot be undone.",
      variant: "danger",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await apiFetch(`/api/employees/${employeeId}/certificates/${certId}`, { method: "DELETE" });
          loadEmployee();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Delete failed.");
        }
      },
    });
  };

  // ── Inline edit ──────────────────────────────────────────────
  // ── Unified inline edit (replaces old 3-mode edit) ────────────
  const startEditing = async () => {
    if (!employee) return;
    setEditError(null);
    setEditFormData({
      employeeId: employee.employeeId,
      firstName: employee.firstName,
      middleName: employee.middleName ?? "",
      lastName: employee.lastName,
      email: employee.email,
      phone: employee.phone ?? "",
      address: employee.address ?? "",
      birthday: employee.birthday ? employee.birthday.slice(0, 10) : "",
      gender: employee.gender ?? "",
      placeOfBirth: employee.placeOfBirth ?? "",
      rank: employee.rank ?? "",
      civilStatus: employee.civilStatus ?? "",
      citizenship: employee.citizenship ?? "",
      religion: employee.religion ?? "",
      height: employee.height ?? "",
      weight: employee.weight ?? "",
      bloodType: employee.bloodType ?? "",
      contractTypeId: employee.contractTypeId ?? "",
      employmentType: employee.employmentType ?? "Teaching",
      hireDate: employee.hireDate ? employee.hireDate.slice(0, 10) : "",
      salary: employee.salary != null ? String(employee.salary) : "",
      groupId: employee.groupId ?? "",
      roleId: employee.roleId ?? "",
      active: employee.active,
    });
    try {
      const [groupsData, rolesData, ctData] = await Promise.all([
        apiFetch<{ groups: GroupBrief[] }>("/api/groups"),
        apiFetch<{ roles: RoleBrief[] }>("/api/roles/active"),
        apiFetch<{ contractTypes: ContractTypeBrief[] }>("/api/contract-types"),
      ]);
      setEditFormGroups(groupsData.groups ?? []);
      setEditFormRoles(rolesData.roles ?? []);
      setEditFormContractTypes(ctData.contractTypes ?? []);
    } catch { /* non-fatal — dropdowns will be empty */ }
    setEditing(true);
    // Set dirty snapshot after populating form
    setTimeout(() => {
      editSnapshotRef.current = JSON.stringify({
        employeeId: employee.employeeId, firstName: employee.firstName, middleName: employee.middleName ?? "",
        lastName: employee.lastName, email: employee.email, phone: employee.phone ?? "", address: employee.address ?? "",
        birthday: employee.birthday ? employee.birthday.slice(0, 10) : "", gender: employee.gender ?? "",
        placeOfBirth: employee.placeOfBirth ?? "", rank: employee.rank ?? "",
        civilStatus: employee.civilStatus ?? "", citizenship: employee.citizenship ?? "",
        religion: employee.religion ?? "", height: employee.height ?? "",
        weight: employee.weight ?? "", bloodType: employee.bloodType ?? "",
        contractTypeId: employee.contractTypeId ?? "",
        employmentType: employee.employmentType ?? "Teaching",
        hireDate: employee.hireDate ? employee.hireDate.slice(0, 10) : "",
        salary: employee.salary != null ? String(employee.salary) : "",
        groupId: employee.groupId ?? "", roleId: employee.roleId ?? "", active: employee.active,
      });
    }, 0);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditError(null);
  };

  const saveEditing = async () => {
    setEditError(null);
    if (!editFormData.employeeId.trim()) return setEditError("Employee ID is required.");
    if (!editFormData.firstName.trim()) return setEditError("First name is required.");
    if (!editFormData.lastName.trim()) return setEditError("Last name is required.");
    if (!editFormData.email.trim()) return setEditError("Email is required.");
    setEditSaving(true);
    try {
      const body: Record<string, unknown> = {};
      // Identity fields
      if (canEditIdentity) {
        body.employeeId = editFormData.employeeId.trim();
        body.firstName = editFormData.firstName.trim();
        body.middleName = editFormData.middleName.trim() || null;
        body.lastName = editFormData.lastName.trim();
        body.email = editFormData.email.trim();
      }
      // Employment fields
      if (canEditEmployment) {
        body.groupId = editFormData.groupId || null;
        body.roleId = editFormData.roleId || null;
        body.contractTypeId = editFormData.contractTypeId || null;
        body.employmentType = editFormData.employmentType;
      }
      // Salary
      if (canEditSalary) {
        body.salary = editFormData.salary ? parseFloat(editFormData.salary) : 0;
      }
      // Status
      if (canEditStatus) {
        body.active = editFormData.active;
      }
      // Self-edit fallback
      if (!canEditIdentity && !canEditEmployment && !canEditSalary && !canEditStatus) {
        body.middleName = editFormData.middleName.trim() || null;
      }
      // Shared fields (always sent)
      body.phone = editFormData.phone.trim() || null;
      body.address = editFormData.address.trim() || null;
      body.birthday = editFormData.birthday || null;
      body.gender = editFormData.gender || null;
      body.placeOfBirth = editFormData.placeOfBirth.trim() || null;
      body.rank = editFormData.rank.trim() || null;
      body.civilStatus = editFormData.civilStatus || null;
      body.citizenship = editFormData.citizenship.trim() || null;
      body.religion = editFormData.religion.trim() || null;
      body.height = editFormData.height.trim() || null;
      body.weight = editFormData.weight.trim() || null;
      body.bloodType = editFormData.bloodType.trim() || null;
      body.hireDate = editFormData.hireDate || null;
      await apiFetch(`/api/employees/${employeeId}`, { method: "PATCH", body: JSON.stringify(body) });
      setEditing(false);
      loadEmployee();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setEditSaving(false);
    }
  };

  // ── Password change (profile page) ────────────────────────────
  const handlePasswordChange = async () => {
    if (!newPassword || newPassword.length < 8) {
      setPwdError("Password must be at least 8 characters.");
      return;
    }
    setPwdSaving(true);
    setPwdError(null);
    setPwdMsg(null);
    try {
      await apiFetch(`/api/employees/${employeeId}`, {
        method: "PATCH",
        body: JSON.stringify({ password: newPassword }),
      });
      setNewPassword("");
      setPwdMsg("Password updated successfully.");
      setTimeout(() => setPwdMsg(null), 3000);
    } catch (err) {
      setPwdError(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setPwdSaving(false);
    }
  };

  // ── Reupload file ────────────────────────────────────────────
  const [reuploading, setReuploading] = useState<string | null>(null);

  const handleReupload = async (fileId: string, oldName: string) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.type !== "application/pdf") { setError("Only PDF files are allowed."); return; }
      if (f.size > 10 * 1024 * 1024) { setError("File exceeds 10MB limit."); return; }
      setReuploading(fileId);
      try {
        const fd = new FormData();
        fd.append("file", f);
        await apiFetch(`/api/employees/${employeeId}/files/${fileId}`, { method: "PUT", body: fd, skipJsonHeader: true });
        loadEmployee();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Reupload failed.");
      } finally {
        setReuploading(null);
      }
    };
    input.click();
  };

  // ── Photo upload ──────────────────────────────────────────────
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Only JPG, PNG, or WebP images are allowed.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Photo exceeds 5MB limit.");
      return;
    }
    setPhotoUploading(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      await apiFetch(`/api/employees/${employeeId}/photo`, { method: "POST", body: fd, skipJsonHeader: true });
      setPhotoVersion((v) => v + 1);
      loadEmployee();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo upload failed.");
    } finally {
      setPhotoUploading(false);
      e.target.value = "";
    }
  };

  const handlePhotoDelete = async () => {
    try {
      await apiFetch(`/api/employees/${employeeId}/photo`, { method: "DELETE" });
      setPhotoVersion((v) => v + 1);
      loadEmployee();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove photo.");
    }
  };

  // ── Profile section editing ────────────────────────────────────
  const SECTION_LABELS: Record<string, string> = {
    education: "Educational Background",
    experience: "Professional Experience",
    eligibility: "Eligibility",
    awards: "Achievements & Awards",
    publications: "Publications & Research",
    affiliations: "Organizational Affiliations",
    seminars: "Seminars & Conferences",
    accomplishments: "Other Accomplishments",
    community: "Community Involvement",
  };
  const SECTION_EMPTY: Record<string, Record<string, string>> = {
    education: { degree: "", dateEarned: "", school: "" },
    experience: { position: "", year: "", organization: "" },
    eligibility: { exam: "", place: "", date: "", rating: "" },
    awards: { award: "", year: "", institution: "" },
    publications: { title: "", publication: "", issue: "" },
    affiliations: { organization: "", position: "", date: "" },
    seminars: { title: "", scope: "", date: "", nature: "" },
    accomplishments: { function: "", nature: "" },
    community: { title: "", beneficiaries: "", date: "", nature: "" },
  };

  const startEditSection = (key: string) => {
    setEditingSection(key);
    const rows = [...(profileData[key] || [])];
    setSectionForm(rows);
    sectionSnapshotRef.current = JSON.stringify(rows);
  };

  const addSectionRow = (key: string) => {
    setSectionForm(prev => [...prev, { ...SECTION_EMPTY[key] }]);
  };

  const updateSectionRow = (idx: number, field: string, value: string) => {
    setSectionForm(prev => prev.map((row, i) => i === idx ? { ...row, [field]: value } : row));
  };

  const removeSectionRow = (idx: number) => {
    setSectionForm(prev => prev.filter((_, i) => i !== idx));
  };

  const saveSection = async (key: string) => {
    setSectionSaving(true);
    try {
      const updated = { ...profileData, [key]: sectionForm.filter(row =>
        Object.values(row).some(v => v && String(v).trim())
      ) };
      await apiFetch(`/api/employees/${employeeId}`, {
        method: "PATCH",
        body: JSON.stringify({ profileData: JSON.stringify(updated) }),
      });
      setProfileData(updated);
      setEditingSection(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save section.");
    } finally {
      setSectionSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-rcc-primary border-t-transparent" />
        <span className="ml-2 text-sm text-rcc-text-muted">Loading...</span>
      </div>
    );
  }

  if (error && !employee) {
    return (
      <div className="space-y-4">
      {employeeId !== user?.id && (
        <button
          onClick={() => setCurrentPage("profiling")}
          className="inline-flex items-center gap-1 text-sm text-rcc-text-secondary hover:text-rcc-primary transition-colors mb-3"
        >
          <ArrowLeft className="h-4 w-4" /> Back to employees
        </button>
      )}
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-rcc-error">{error}</div>
      </div>
    );
  }

  if (!employee) return null;

  const canEditProfile = canFillProfile || has("profiling.edit") || has("profile.editAll");
  const initials = (employee.firstName.charAt(0) + employee.lastName.charAt(0)).toUpperCase();
  const fullName = `${employee.firstName} ${employee.middleName ? employee.middleName + " " : ""}${employee.lastName}`;
  const photoUrl = employee.photo ? `/api/employees/${employeeId}/photo?v=${photoVersion}` : null;

  return (
    <>
    {/* Interactive profile — screen only; paper version is the
        print-only ProfilePrintDocument at the end of this return. */}
    <div className="space-y-5 max-w-5xl mx-auto no-print">

      {employeeId !== user?.id && (
        <div className="no-print flex items-center gap-3">
          <button onClick={() => setCurrentPage("profiling")} className="inline-flex items-center gap-1 text-sm text-rcc-text-secondary hover:text-rcc-primary transition-colors">
            <ArrowLeft className="h-4 w-4" /> Back to employees
          </button>
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-rcc-error flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Header Card */}
      <div className="bg-rcc-surface rounded-lg border border-rcc-border overflow-hidden">
        <div className="h-28 bg-gradient-to-r from-rcc-primary/20 via-rcc-primary/10 to-rcc-accent/10" />
        <div className="px-6 pb-5 -mt-8 relative">
          <div className="flex items-end gap-4">
            <div className="relative group">
              <div className="w-24 h-24 rounded-full border-4 border-rcc-surface bg-rcc-surface text-rcc-primary flex items-center justify-center text-2xl font-bold overflow-hidden shadow-md">
                {photoUrl ? <img src={photoUrl} alt={fullName} className="w-full h-full object-cover" /> : initials}
              </div>
              {canEditProfile && (
                <label className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity">
                  <ImageIcon className="h-5 w-5 text-white" />
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoUpload} disabled={photoUploading} />
                </label>
              )}
            </div>
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-rcc-text-primary">{fullName}</h1>
                {employee.active ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-green-50 text-green-700 border border-green-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> ACTIVE
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-rcc-error border border-red-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-rcc-error" /> INACTIVE
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-3 flex-wrap text-sm text-rcc-text-secondary">
                <span className="inline-flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" /> {employee.roleName ?? "Unassigned"}</span>
                {employee.group && <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {employee.group.name}</span>}
                <span className="inline-flex items-center gap-1"><IdCard className="h-3.5 w-3.5" /> <span className="font-mono">{employee.employeeId}</span></span>
              </div>
            </div>
            <div className="no-print flex items-center gap-2 pb-1">
              <button
                onClick={async () => {
                  setDownloadingPdf(true);
                  try {
                    await downloadFile(
                      `/api/employees/${employeeId}/pdf`,
                      `PROFILE-${employee.employeeId}-${employee.firstName}-${employee.lastName}.pdf`
                    );
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "PDF download failed.");
                  } finally {
                    setDownloadingPdf(false);
                  }
                }}
                disabled={downloadingPdf}
                title="Download this profile as a PDF file"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium border border-rcc-border text-rcc-text-secondary hover:bg-rcc-bg transition-colors disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" /> {downloadingPdf ? "Saving…" : "Download PDF"}
              </button>
              {/* Fill is offered only on the viewer's own profile. The group
                  gate matches the Records list: unknown (loading / fetch
                  failed / no group) is treated as allowed, and managers
                  bypass for their own fills. The form lock and submit API
                  remain the enforcers. */}
              {employeeId === user?.id &&
                has("fpas.fill") &&
                (fpasEnabled !== false || has("fpas.manage")) && (
                <button onClick={() => setCurrentPage("fpas", `emp:${employee.id}`)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium border border-rcc-accent/30 text-rcc-accent hover:bg-rcc-accent/5 transition-colors">
                  <FileText className="h-3.5 w-3.5" /> Fill FPAS
                </button>
              )}
              {profileFpasSubId && ((employeeId === user?.id) || has("fpas.manage")) && (
                <button onClick={() => setCurrentPage("fpas", `view:${profileFpasSubId}`)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium border border-rcc-border text-rcc-text-secondary hover:bg-rcc-bg transition-colors">
                  <Eye className="h-3.5 w-3.5" /> View FPAS
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Personal Information */}
      <SectionCard
        title="Personal Information"
        icon={UsersIcon}
        canEdit={canEditProfile}
        editing={editing}
        onEdit={startEditing}
        onCancel={() => requestInlineNav(() => cancelEditing())}
        onSave={saveEditing}
        saving={editSaving}
        editError={editError}
      >
        {editing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
            <EditField icon={Hash} label="Employee ID" type="text" value={editFormData.employeeId} onChange={(v) => setEditFormData(f => ({ ...f, employeeId: v }))} disabled={!canEditIdentity} className="font-mono" />
            <EditField icon={User} label="First Name" type="text" value={editFormData.firstName} onChange={(v) => setEditFormData(f => ({ ...f, firstName: v }))} disabled={!canEditIdentity} />
            <EditField icon={User} label="Middle Name" type="text" value={editFormData.middleName} onChange={(v) => setEditFormData(f => ({ ...f, middleName: v }))} />
            <EditField icon={User} label="Last Name" type="text" value={editFormData.lastName} onChange={(v) => setEditFormData(f => ({ ...f, lastName: v }))} disabled={!canEditIdentity} />
            <EditField icon={Mail} label="Email" type="email" value={editFormData.email} onChange={(v) => setEditFormData(f => ({ ...f, email: v }))} disabled={!canEditIdentity} />
            <EditField icon={Phone} label="Phone" type="text" value={editFormData.phone} onChange={(v) => setEditFormData(f => ({ ...f, phone: v }))} />
            <EditField icon={Calendar} label="Birthday" type="date" value={editFormData.birthday} onChange={(v) => setEditFormData(f => ({ ...f, birthday: v }))} />
            <SelectField icon={UsersIcon} label="Gender" value={editFormData.gender} options={["", "Male", "Female"]} onChange={(v) => setEditFormData(f => ({ ...f, gender: v }))} />
            <EditField icon={MapPin} label="Address" type="text" value={editFormData.address} onChange={(v) => setEditFormData(f => ({ ...f, address: v }))} />
            <EditField icon={MapPin} label="Place of Birth" type="text" value={editFormData.placeOfBirth} onChange={(v) => setEditFormData(f => ({ ...f, placeOfBirth: v }))} />
            <EditField icon={Briefcase} label="Rank" type="text" value={editFormData.rank} onChange={(v) => setEditFormData(f => ({ ...f, rank: v }))} />
            <SelectField icon={UsersIcon} label="Civil Status" value={editFormData.civilStatus} options={["", "Single", "Married", "Widowed", "Separated"]} onChange={(v) => setEditFormData(f => ({ ...f, civilStatus: v }))} />
            <EditField icon={IdCard} label="Citizenship" type="text" value={editFormData.citizenship} onChange={(v) => setEditFormData(f => ({ ...f, citizenship: v }))} />
            <EditField icon={Building2} label="Religion" type="text" value={editFormData.religion} onChange={(v) => setEditFormData(f => ({ ...f, religion: v }))} />
            <EditField icon={UsersIcon} label="Height" type="text" value={editFormData.height} onChange={(v) => setEditFormData(f => ({ ...f, height: v }))} />
            <EditField icon={UsersIcon} label="Weight" type="text" value={editFormData.weight} onChange={(v) => setEditFormData(f => ({ ...f, weight: v }))} />
            <EditField icon={Award} label="Blood Type" type="text" value={editFormData.bloodType} onChange={(v) => setEditFormData(f => ({ ...f, bloodType: v }))} />
            <SelectField icon={Briefcase} label="Contract Type" value={editFormData.contractTypeId} options={["", ...editFormContractTypes.map(c => c.id)]} optionLabels={["None", ...editFormContractTypes.map(c => c.name)]} onChange={(v) => setEditFormData(f => ({ ...f, contractTypeId: v }))} disabled={!canEditEmployment} />
            <SelectField icon={Briefcase} label="Employment Type" value={editFormData.employmentType} options={EMPLOYMENT_TYPES} onChange={(v) => setEditFormData(f => ({ ...f, employmentType: v }))} disabled={!canEditEmployment} />
            <EditField icon={Calendar} label="Hire Date" type="date" value={editFormData.hireDate} onChange={(v) => setEditFormData(f => ({ ...f, hireDate: v }))} disabled={!canEditEmployment} />
            {canEditSalary && (
              <EditField icon={DollarSign} label="Monthly Salary" type="number" value={editFormData.salary} onChange={(v) => setEditFormData(f => ({ ...f, salary: v }))} />
            )}
            {canEditEmployment && (
              <SelectField icon={Building2} label="Department" value={editFormData.groupId} options={["", ...editFormGroups.map(g => g.id)]} optionLabels={["Unassigned", ...editFormGroups.map(g => `${g.name} (${g.code})`)]} onChange={(v) => setEditFormData(f => ({ ...f, groupId: v }))} />
            )}
            {canEditEmployment && (
              <SelectField icon={Shield} label="Role" value={editFormData.roleId} options={["", ...editFormRoles.map(r => r.id)]} optionLabels={["Unassigned", ...editFormRoles.map(r => r.name)]} onChange={(v) => setEditFormData(f => ({ ...f, roleId: v }))} />
            )}
            {canEditStatus && (
              <label className="col-span-full sm:col-span-2 lg:col-span-3 flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors mt-1" style={{ borderColor: editFormData.active ? "var(--rcc-accent)" : "var(--rcc-border)", backgroundColor: editFormData.active ? "color-mix(in srgb, var(--rcc-accent) 5%, transparent)" : undefined }}>
                <input type="checkbox" checked={editFormData.active} onChange={(e) => setEditFormData(f => ({ ...f, active: e.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-rcc-border text-rcc-accent focus:ring-rcc-accent/40" />
                <div>
                  <p className="text-sm font-semibold text-rcc-text-primary">Active Employee</p>
                  <p className="text-xs text-rcc-text-muted mt-0.5">Inactive employees cannot sign in.</p>
                </div>
              </label>
            )}
          </div>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
            <InfoItem icon={Hash} label="Employee ID" value={employee.employeeId} className="font-mono" />
            <InfoItem icon={User} label="Full Name" value={fullName} />
            <InfoItem icon={Mail} label="Email" value={employee.email} />
            <InfoItem icon={Phone} label="Phone" value={employee.phone} />
            <InfoItem icon={MapPin} label="Address" value={employee.address} />
            <InfoItem icon={Calendar} label="Birthday" value={employee.birthday ? new Date(employee.birthday).toLocaleDateString() : null} />
            <InfoItem icon={UsersIcon} label="Gender" value={employee.gender} />
            <InfoItem icon={MapPin} label="Place of Birth" value={employee.placeOfBirth} />
            <InfoItem icon={Briefcase} label="Rank" value={employee.rank} />
            <InfoItem icon={UsersIcon} label="Civil Status" value={employee.civilStatus} />
            <InfoItem icon={IdCard} label="Citizenship" value={employee.citizenship} />
            <InfoItem icon={Building2} label="Religion" value={employee.religion} />
            <InfoItem icon={UsersIcon} label="Height" value={employee.height} />
            <InfoItem icon={UsersIcon} label="Weight" value={employee.weight} />
            <InfoItem icon={Award} label="Blood Type" value={employee.bloodType} />
            <InfoItem icon={Briefcase} label="Contract" value={employee.contractType} />
            <InfoItem icon={Briefcase} label="Employment Type" value={employee.employmentType} />
            <InfoItem icon={Calendar} label="Hire Date" value={employee.hireDate ? new Date(employee.hireDate).toLocaleDateString() : null} />
            <InfoItem icon={Building2} label="Department" value={employee.group?.name} />
            <InfoItem icon={Shield} label="Role" value={employee.roleName} />
            <InfoItem icon={DollarSign} label="Salary" value={employee.salary != null && employee.salary > 0 ? `₱${employee.salary.toLocaleString()}` : "Not set"} />
          </dl>
        )}
      </SectionCard>

      {/* Change Password (visible only to roles with canChangePassword) */}
      {canChangePassword && (
        <SectionCard title="Change Password" icon={Lock}>
          <div className="space-y-3">
            <p className="text-xs text-rcc-text-muted">Set a new password for this employee. Leave blank to keep the current password.</p>
            {pwdError && (
              <div className="bg-red-50 border border-red-200 rounded-md p-2 text-xs text-rcc-error flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {pwdError}
              </div>
            )}
            {pwdMsg && (
              <div className="bg-green-50 border border-green-200 rounded-md p-2 text-xs text-green-700">{pwdMsg}</div>
            )}
            <div className="flex items-end gap-3">
              <div className="flex-1 max-w-sm">
                <label className="text-xs font-semibold text-rcc-text-muted uppercase tracking-wide mb-1 block">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="w-full px-3 py-2 bg-rcc-bg border border-rcc-border rounded-md text-sm text-rcc-text-primary focus:outline-none focus:ring-2 focus:ring-rcc-accent/40"
                  autoComplete="new-password"
                />
              </div>
              <button
                onClick={handlePasswordChange}
                disabled={pwdSaving || !newPassword}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold bg-rcc-primary text-rcc-primary-foreground hover:bg-rcc-primary/90 transition-colors disabled:opacity-50"
              >
                <Save className="h-4 w-4" /> {pwdSaving ? "Saving..." : "Update Password"}
              </button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Profile Sections (repeatable rows) */}
      {(Object.keys(SECTION_LABELS) as string[]).filter(key => key !== "awards").map((key) => (
        <ProfileSection
          key={key}
          sectionKey={key}
          label={SECTION_LABELS[key]}
          rows={editingSection === key ? sectionForm : (profileData[key] || [])}
          fields={SECTION_EMPTY[key]}
          editing={editingSection === key}
          canEdit={canEditProfile}
          onEdit={() => startEditSection(key)}
          onCancel={() => requestSectionNav(() => setEditingSection(null))}
          onSave={() => saveSection(key)}
          saving={sectionSaving}
          onAdd={() => addSectionRow(key)}
          onRemove={removeSectionRow}
          onUpdate={updateSectionRow}
        />
      ))}

      {/* Achievements & Awards + Certificates combined */}
      <SectionCard
        title="Achievements & Awards"
        icon={Award}
        canEdit={canEditProfile}
        editing={editingSection === "awards"}
        onEdit={() => startEditSection("awards")}
        onCancel={() => requestSectionNav(() => setEditingSection(null))}
        onSave={() => saveSection("awards")}
        saving={sectionSaving}
        noPadding
      >
        <div className="px-5 pb-4">
          {editingSection === "awards" ? (
            <div className="space-y-3">
              {sectionForm.map((row, idx) => (
                <div key={idx} className="flex items-start gap-2 p-3 border border-rcc-border rounded-md bg-rcc-bg/30">
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {Object.keys(SECTION_EMPTY.awards).map((f) => (
                      <input key={f} type="text" placeholder={f === "award" ? "Award" : f === "year" ? "Year" : "Granting Institution"} value={row[f] || ""} onChange={(e) => updateSectionRow(idx, f, e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded border border-rcc-border text-sm bg-rcc-surface text-rcc-text-primary placeholder:text-rcc-text-muted focus:outline-none focus:ring-1 focus:ring-rcc-primary" />
                    ))}
                  </div>
                  <button onClick={() => removeSectionRow(idx)} className="mt-1 p-1 rounded text-rcc-text-muted hover:text-rcc-error hover:bg-red-50 transition-colors" title="Remove row">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button onClick={() => addSectionRow("awards")} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border border-dashed border-rcc-border text-rcc-text-secondary hover:bg-rcc-bg transition-colors">
                <Plus className="h-3 w-3" /> Add Row
              </button>
            </div>
          ) : (profileData.awards || []).length === 0 ? (
            <p className="text-xs text-rcc-text-muted text-center py-4">No awards yet. Click Edit to add entries.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-rcc-border">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-rcc-text-secondary uppercase tracking-wide">Award</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-rcc-text-secondary uppercase tracking-wide">Year</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-rcc-text-secondary uppercase tracking-wide">Granting Institution</th>
                  </tr>
                </thead>
                <tbody>
                  {(profileData.awards || []).map((row, idx) => (
                    <tr key={idx} className="border-b border-rcc-border last:border-0 hover:bg-rcc-bg/30 transition-colors">
                      <td className="px-3 py-2 text-sm text-rcc-text-primary">{row.award || "-"}</td>
                      <td className="px-3 py-2 text-sm text-rcc-text-secondary">{row.year || "-"}</td>
                      <td className="px-3 py-2 text-sm text-rcc-text-secondary">{row.institution || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-t border-rcc-border mt-4 pt-4">
            <h3 className="text-xs font-semibold text-rcc-text-secondary uppercase tracking-wide mb-2">Certificates</h3>
            {(has("profiling.edit") || canSelfEdit) && (
              <button onClick={() => setCertOpen(true)} className="mb-3 inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium border border-rcc-border text-rcc-text-secondary hover:bg-rcc-bg transition-colors">
                <Plus className="h-3 w-3" /> Add Certificate
              </button>
            )}
            {(!employee.certificates || employee.certificates.length === 0) ? (
              <p className="text-xs text-rcc-text-muted text-center py-4">No certificates yet.</p>
            ) : (
              <ul className="space-y-2">
                {employee.certificates.map((c) => (
                  <li key={c.id} className="border border-rcc-border rounded-md p-3 hover:bg-rcc-bg/30 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-rcc-text-primary flex items-center gap-1">
                          <Award className="h-3.5 w-3.5 text-rcc-accent shrink-0" /> {c.title}
                        </p>
                        {c.issuer && <p className="text-xs text-rcc-text-muted mt-0.5">{c.issuer}</p>}
                        <div className="text-xs text-rcc-text-muted mt-1 space-y-0.5">
                          {c.certificateNo && <p>No: <span className="font-mono">{c.certificateNo}</span></p>}
                          {c.issueDate && <p>Issued: {new Date(c.issueDate).toLocaleDateString()}</p>}
                          {c.expiryDate && <p>Expires: {new Date(c.expiryDate).toLocaleDateString()}</p>}
                        </div>
                      </div>
                      {(has("profiling.edit") || canSelfEdit) && (
                        <button onClick={() => handleDeleteCert(c.id, c.title)} className="p-1.5 rounded-md text-rcc-text-muted hover:text-rcc-error hover:bg-red-50 transition-colors" title="Delete certificate">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Files & Documents */}
      <SectionCard title="Files & Documents" icon={FileText} canEdit={canManageFiles} noPadding>
        <div className="px-5 pb-4">
          {canManageFiles && (
            <div className="mb-4 border border-dashed border-rcc-border rounded-md p-4 bg-rcc-bg/30">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <label className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border border-rcc-border text-rcc-text-secondary hover:bg-rcc-bg transition-colors cursor-pointer">
                  <Upload className="h-4 w-4" /> {uploading ? "Uploading..." : "Upload PDF"}
                  <input type="file" className="hidden" onChange={handleUploadFile} disabled={uploading} accept=".pdf" />
                </label>
                <input type="text" value={fileDesc} onChange={(e) => setFileDesc(e.target.value)} placeholder="Optional description..." className={inputClass} />
              </div>
              <p className="text-xs text-rcc-text-muted mt-2">Max 10MB. PDF only.</p>
            </div>
          )}
          {(!employee.files || employee.files.length === 0) ? (
            <p className="text-xs text-rcc-text-muted text-center py-4">No files uploaded yet.</p>
          ) : (
            <div className="space-y-2">
              {employee.files.map((f) => (
                <div key={f.id} className="flex items-center gap-3 p-3 border border-rcc-border rounded-md hover:bg-rcc-bg/30 transition-colors">
                  <div className="w-9 h-9 rounded-md bg-rcc-primary/10 text-rcc-primary flex items-center justify-center shrink-0">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-rcc-text-primary truncate">{f.originalName}</p>
                    <p className="text-xs text-rcc-text-muted">{(f.fileSize / 1024).toFixed(0)} KB {f.uploadedBy ? `· ${f.uploadedBy}` : ""} · {new Date(f.uploadedAt).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })}</p>
                    {f.description && <p className="text-xs text-rcc-text-secondary mt-1 line-clamp-1">{f.description}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleViewFile(f)} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-rcc-text-secondary hover:bg-rcc-bg hover:text-rcc-primary transition-colors" title="View"><Eye className="h-3 w-3" /> View</button>
                    <button onClick={() => handleDownloadFile(f)} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-rcc-text-secondary hover:bg-rcc-bg hover:text-rcc-primary transition-colors" title="Download"><Download className="h-3 w-3" /> DL</button>
                    {canManageFiles && (
                      <>
                        <button onClick={() => handleReupload(f.id, f.originalName)} disabled={reuploading === f.id} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-rcc-text-secondary hover:bg-rcc-bg hover:text-rcc-primary transition-colors disabled:opacity-50" title="Reupload"><Upload className="h-3 w-3" /> {reuploading === f.id ? "..." : "Re"}</button>
                        <button onClick={() => handleDeleteFile(f)} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-rcc-text-secondary hover:bg-red-50 hover:text-rcc-error transition-colors" title="Delete"><Trash2 className="h-3 w-3" /></button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SectionCard>

      {/* Fingerprint Biometrics */}
      {canManageBiometrics && (
        <BiometricsCard employeeId={employeeId} />
      )}

      {/* File Viewer Modal */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-rcc-surface rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-rcc-border">
              <p className="text-sm font-semibold text-rcc-text-primary truncate">{viewing.name}</p>
              <button
                onClick={() => setViewing(null)}
                className="p-1.5 rounded-md text-rcc-text-muted hover:bg-rcc-bg hover:text-rcc-text-primary transition-colors"
                aria-label="Close viewer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-rcc-bg/30">
              {viewing.mime.startsWith("image/") ? (
                <div className="flex items-center justify-center p-4">
                  {/* blob URL — no Next/Image optimization needed */}
                  <img src={viewing.url} alt={viewing.name} className="max-w-full max-h-[80vh] object-contain" />
                </div>
              ) : viewing.mime === "application/pdf" ? (
                <iframe src={viewing.url} title={viewing.name} className="w-full h-[80vh] border-0" />
              ) : (
                <div className="p-8 text-center">
                  <FileText className="h-12 w-12 text-rcc-text-muted mx-auto mb-3" />
                  <p className="text-sm text-rcc-text-secondary mb-3">
                    Preview not available for this file type.
                  </p>
                  <a
                    href={viewing.url}
                    download={viewing.name}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold bg-rcc-primary text-rcc-primary-foreground hover:bg-rcc-primary/90 transition-colors"
                  >
                    <Download className="h-4 w-4" /> Download
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Certificate Modal */}
      {certOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-rcc-surface rounded-lg shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-rcc-text-primary">Add Certificate</h3>
              <button
                onClick={() => setCertOpen(false)}
                className="p-1.5 rounded-md text-rcc-text-muted hover:bg-rcc-bg hover:text-rcc-text-primary transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <Field label="Title" required>
                <input type="text" value={certForm.title} onChange={(e) => setCertForm({ ...certForm, title: e.target.value })} className={inputClass} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Issuer">
                  <input type="text" value={certForm.issuer} onChange={(e) => setCertForm({ ...certForm, issuer: e.target.value })} className={inputClass} />
                </Field>
                <Field label="Certificate No.">
                  <input type="text" value={certForm.certificateNo} onChange={(e) => setCertForm({ ...certForm, certificateNo: e.target.value })} className={inputClass} />
                </Field>
                <Field label="Issue Date">
                  <input type="date" value={certForm.issueDate} onChange={(e) => setCertForm({ ...certForm, issueDate: e.target.value })} className={inputClass} />
                </Field>
                <Field label="Expiry Date">
                  <input type="date" value={certForm.expiryDate} onChange={(e) => setCertForm({ ...certForm, expiryDate: e.target.value })} className={inputClass} />
                </Field>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setCertOpen(false)}
                className="px-4 py-2 rounded-md text-sm font-medium border border-rcc-border text-rcc-text-secondary hover:bg-rcc-bg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCert}
                className="px-4 py-2 rounded-md text-sm font-semibold bg-rcc-primary text-rcc-primary-foreground hover:bg-rcc-primary/90 transition-colors"
              >
                Add Certificate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmState && (
        <ConfirmDialog
          open={confirmState.open}
          title={confirmState.title}
          message={confirmState.message}
          variant={confirmState.variant}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
      {inlineNavDialog && <ConfirmDialog {...inlineNavDialog} />}
      {sectionNavDialog && <ConfirmDialog {...sectionNavDialog} />}
    </div>
    {/* Template-faithful print document (screen-hidden, paper-only) */}
    <div className="print-only">
      <ProfilePrintDocument
        employee={{
          employeeId: employee.employeeId,
          firstName: employee.firstName,
          middleName: employee.middleName,
          lastName: employee.lastName,
          email: employee.email,
          phone: employee.phone,
          address: employee.address,
          birthday: employee.birthday,
          gender: employee.gender,
          employmentType: employee.employmentType,
          contractType: employee.contractTypeName ?? employee.contractType,
          hireDate: employee.hireDate,
          active: employee.active,
          groupName: employee.groupName ?? employee.group?.name ?? null,
          roleName: employee.roleName,
          placeOfBirth: employee.placeOfBirth,
          rank: employee.rank,
          civilStatus: employee.civilStatus,
          citizenship: employee.citizenship,
          religion: employee.religion,
          photo: employee.photo,
        }}
        profileData={profileData}
        photoUrl={photoUrl}
        schoolYear={`${new Date().getFullYear()}-${new Date().getFullYear() + 1}`}
      />
    </div>
    </>
  );
}

function InfoItem({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: typeof Mail;
  label: string;
  value: string | null | undefined;
  className?: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="h-4 w-4 text-rcc-text-muted mt-0.5 shrink-0" />
      <div className="min-w-0">
        <dt className="text-xs font-semibold text-rcc-text-muted uppercase tracking-wide">{label}</dt>
        <dd className={`text-sm text-rcc-text-primary mt-0.5 break-words ${className || ""}`}>{value || <span className="text-rcc-text-muted">-</span>}</dd>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-rcc-text-secondary mb-1.5">
        {label}
        {required && <span className="text-rcc-error ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-rcc-text-muted mt-1">{hint}</p>}
    </div>
  );
}

function EditField({
  icon: Icon,
  label,
  type,
  value,
  onChange,
  disabled,
  className,
}: {
  icon: typeof Mail;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="h-4 w-4 text-rcc-text-muted mt-2 shrink-0" />
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-semibold text-rcc-text-muted uppercase tracking-wide mb-1">{label}</dt>
        {type === "select" ? (
          <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="w-full px-3 py-2 bg-rcc-bg border border-rcc-border rounded-md text-sm text-rcc-text-primary focus:outline-none focus:ring-2 focus:ring-rcc-accent/40 disabled:opacity-50 disabled:cursor-not-allowed">
            {["", "Male", "Female"].map((o) => (
              <option key={o} value={o}>{o || "-"}</option>
            ))}
          </select>
        ) : (
          <input
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className={`w-full px-3 py-2 bg-rcc-bg border border-rcc-border rounded-md text-sm text-rcc-text-primary focus:outline-none focus:ring-2 focus:ring-rcc-accent/40 disabled:opacity-50 disabled:cursor-not-allowed ${className || ""}`}
          />
        )}
        {disabled && (
          <p className="text-[10px] text-rcc-text-muted mt-1">Only administrators can change this field.</p>
        )}
      </div>
    </div>
  );
}

function SelectField({
  icon: Icon,
  label,
  value,
  options,
  optionLabels,
  onChange,
  disabled,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
  options: string[];
  optionLabels?: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="h-4 w-4 text-rcc-text-muted mt-2 shrink-0" />
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-semibold text-rcc-text-muted uppercase tracking-wide mb-1">{label}</dt>
        <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
          className={`w-full px-3 py-2 bg-rcc-bg border border-rcc-border rounded-md text-sm text-rcc-text-primary focus:outline-none focus:ring-2 focus:ring-rcc-accent/40 ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}>
          {options.map((o, i) => (
            <option key={o} value={o}>{optionLabels?.[i] || o || "-"}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
