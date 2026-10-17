"use client";

import { useEffect, useState, useMemo, useCallback, useRef, type ReactNode } from "react";
import {
  Plus, Search, Pencil, ArrowLeft, Save, ShieldCheck,
  Users as UsersIcon, Lock, Unlock, Globe, BadgeCheck,
  ToggleLeft, ToggleRight,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/store/auth-store";
import { usePermissions } from "@/hooks/use-permissions";
import { useUnsavedChanges, useNavigationGuard } from "@/hooks/use-unsaved-changes";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  usePagination,
  PaginationControls,
} from "@/components/shared/table-pagination-v2";
import { PERMISSIONS } from "@/lib/permissions";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface Role {
  id: string;
  name: string;
  description: string | null;
  scopeAllProfiling: boolean;
  scopeAllEvaluation: boolean;
  scopeAllLeave: boolean;
  scopeAllReports: boolean;
  scopeAllAttendance: boolean;
  scopeGroupAttendance: boolean;
  canSelfApproveLeave: boolean;
  canEditProfile: boolean;
  canChangePassword: boolean;
  canManageBiometrics: boolean;
  isSystem: boolean;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
  permissions: string[];
  allPermissions?: { identifier: string; granted: boolean }[];
  employeeCount?: number;
}

// ═══════════════════════════════════════════════════════════════
// PERMISSIONS_BY_MODULE — grouped matrix for the form
// ═══════════════════════════════════════════════════════════════

interface PermissionDef {
  id: string;
  label: string;
  description: string;
}

type ScopeKey =
  | "scopeAllProfiling"
  | "scopeAllEvaluation"
  | "scopeAllLeave"
  | "scopeAllReports"
  | "scopeAllAttendance"
  | "scopeGroupAttendance"
  | "canSelfApproveLeave"
  | "canEditProfile"
  | "canChangePassword"
  | "canManageBiometrics";

interface ScopeDef {
  key: ScopeKey;
  label: string;
  description: string;
}

interface PermissionModule {
  label: string;
  permissions: PermissionDef[];
  scopes?: ScopeDef[];
}

const PERMISSION_LABELS: Record<string, { label: string; description: string }> = {
  "dashboard.view": { label: "View Dashboard", description: "Access the main dashboard landing page." },

  "profiling.view": { label: "View Employees", description: "See employee records within scope." },
  "profiling.view_inactive": { label: "View Inactive", description: "See deactivated / soft-deleted employees." },
  "profiling.create": { label: "Create Employees", description: "Add new employee records." },
  "profiling.edit": { label: "Edit Employees (All)", description: "Full access to all employee fields. Grants all sub-permissions below." },
  "profiling.editIdentity": { label: "Edit Identity", description: "Edit name, email, employee ID, phone, address, birthday, gender." },
  "profiling.editEmployment": { label: "Edit Employment", description: "Edit contract type, employment type, hire date, department, and role assignment." },
  "profiling.editSalary": { label: "Edit Salary", description: "Edit employee monthly salary." },
  "profiling.editStatus": { label: "Edit Status", description: "Activate or deactivate employee accounts." },
  "profiling.delete": { label: "Deactivate Employees", description: "Soft-delete an employee record." },
  "profile.selfEdit": { label: "Edit Own Profile", description: "Edit own basic profile fields (email, phone, address, birthday, gender)." },
  "profile.editAll": { label: "Edit All Profiles", description: "Edit any employee's basic profile fields inline." },

  "attendance.view": { label: "View Attendance", description: "See attendance records within scope." },
  "attendance.clock_in": { label: "Clock In / Out", description: "Submit clock-in / clock-out events." },
  "attendance.edit": { label: "Edit Times", description: "Manually edit clock-in / clock-out times." },
  "attendance.edit_on_premise": { label: "Edit On-Premise Flag", description: "Override the on-premise geofence flag." },
  "attendance.view_all": { label: "View All Groups", description: "Bypass group scoping for attendance." },

  "evaluation.view": { label: "View Results (Own Group)", description: "See evaluation results in own group." },
  "evaluation.submit": { label: "Submit Evaluations", description: "Create and submit evaluation forms." },
  "evaluation.view_results": { label: "View Results (For Me)", description: "See evaluations written about self." },
  "evaluation.manage_forms": { label: "Manage Forms & Periods", description: "Create evaluation forms, periods, criteria." },
  "evaluation.reset": { label: "Reset Evaluations", description: "Reset evaluation submissions for a new period." },

  "leave.request": { label: "Request Leave", description: "Submit own leave requests." },
  "leave.approve_l1": { label: "Approve L1", description: "First-level approval of leave." },
  "leave.approve_l2": { label: "Approve L2", description: "Second-level (final) approval of leave." },
  "leave.view_all": { label: "View All Requests", description: "See all leave requests across the institution." },
  "leave.manage_types": { label: "Manage Leave Types", description: "Create / edit leave types." },

  "reports.view": { label: "View Reports", description: "Access the reports module." },
  "reports.export": { label: "Export Reports", description: "Download CSV / PDF report exports." },

  "roles.view": { label: "View Roles", description: "List and inspect role definitions." },
  "roles.create": { label: "Create Roles", description: "Define new roles." },
  "roles.edit": { label: "Edit Roles", description: "Modify role permissions and flags." },
  "roles.delete": { label: "Delete Roles", description: "Remove unused roles." },

  "groups.view": { label: "View Groups", description: "List groups / departments." },
  "groups.create": { label: "Create Groups", description: "Create new groups / departments." },
  "groups.edit": { label: "Edit Groups", description: "Edit group names, codes, and descriptions." },
  "groups.delete": { label: "Delete Groups", description: "Deactivate / remove groups." },

  "fpas.fill": { label: "Fill FPAS Form", description: "Fill out the Faculty Performance Appraisal form." },
  "fpas.export": { label: "Bulk Export FPAS Forms", description: "Download submitted FPAS forms in bulk (merged PDF or ZIP). Export-only holders are limited to their own department." },
  "fpas.manage": { label: "Manage FPAS", description: "Configure which departments can fill FPAS (group access settings)." },

  "biometric.enroll": { label: "Enroll Fingerprints", description: "Enroll and delete employee fingerprint templates." },
  "biometric.manage": { label: "View Biometric Status", description: "View any employee's biometric enrollment status." },
};

const PERMISSIONS_BY_MODULE: PermissionModule[] = [
  {
    label: "Dashboard",
    permissions: ["dashboard.view"],
  },
  {
    label: "Employee Profiling",
    permissions: ["profiling.view", "profiling.view_inactive", "profiling.create", "profiling.edit", "profiling.editIdentity", "profiling.editEmployment", "profiling.editSalary", "profiling.editStatus", "profiling.delete", "profile.selfEdit", "profile.editAll"],
    scopes: [
      { key: "scopeAllProfiling" as const, label: "All Profiling", description: "See employee records across all groups." },
      { key: "canEditProfile" as const, label: "Fill Profile Data", description: "Allow users to fill/edit their own profile sections (education, experience, etc.)." },
      { key: "canChangePassword" as const, label: "Change Password", description: "Allow users to change passwords for employees." },
      { key: "canManageBiometrics" as const, label: "Manage Fingerprints", description: "Allow users to enroll and manage employee fingerprint biometrics." },
    ],
  },
  {
    label: "Attendance",
    permissions: ["attendance.view", "attendance.clock_in", "attendance.edit", "attendance.edit_on_premise", "attendance.view_all"],
    scopes: [
      { key: "scopeAllAttendance" as const, label: "All Attendance", description: "View attendance records across all groups." },
      { key: "scopeGroupAttendance" as const, label: "Own Group Attendance", description: "View attendance records within own group only." },
    ],
  },
  {
    label: "Performance Evaluation",
    permissions: ["evaluation.view", "evaluation.submit", "evaluation.view_results", "evaluation.manage_forms", "evaluation.reset"],
    scopes: [
      { key: "scopeAllEvaluation" as const, label: "All Evaluation", description: "View and submit evaluations institution-wide." },
    ],
  },
  {
    label: "Leave Management",
    permissions: ["leave.request", "leave.approve_l1", "leave.approve_l2", "leave.view_all", "leave.manage_types"],
    scopes: [
      { key: "scopeAllLeave" as const, label: "All Leave", description: "Approve and view all leave requests." },
      { key: "canSelfApproveLeave" as const, label: "Can Self-Approve Leave", description: "Allow approving own leave requests." },
    ],
  },
  {
    label: "Reports",
    permissions: ["reports.view", "reports.export"],
    scopes: [
      { key: "scopeAllReports" as const, label: "All Reports", description: "Access reports across all groups." },
    ],
  },
  {
    label: "Roles & Permissions",
    permissions: ["roles.view", "roles.create", "roles.edit", "roles.delete"],
  },
  {
    label: "Groups",
    permissions: ["groups.view", "groups.create", "groups.edit", "groups.delete"],
  },
  {
    label: "FPAS (Faculty Appraisal)",
    permissions: ["fpas.fill", "fpas.export", "fpas.manage"],
  },
].map((m) => ({
  label: m.label,
  permissions: m.permissions.map((id) => ({
    id,
    label: PERMISSION_LABELS[id]?.label ?? id,
    description: PERMISSION_LABELS[id]?.description ?? "",
  })),
  scopes: m.scopes,
}));

// Validate that all PERMISSIONS exist in the matrix.
const _allIds = new Set<string>(PERMISSIONS);
PERMISSIONS_BY_MODULE.forEach((m) => m.permissions.forEach((p) => _allIds.delete(p.id)));
// _allIds should be empty in production; left as runtime no-op.

// ═══════════════════════════════════════════════════════════════
// RoleListPage
// ═══════════════════════════════════════════════════════════════

export function RoleListPage() {
  const { setCurrentPage } = useAuthStore();
  const { has } = usePermissions();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [toggleTarget, setToggleTarget] = useState<Role | null>(null);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    variant: "danger" | "warning";
    onConfirm: () => void;
  } | null>(null);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ roles: Role[] }>("/api/roles");
      setRoles(data.roles ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q)
    );
  }, [roles, search]);

  const { currentData, controls } = usePagination(filtered, { defaultPageSize: 15 });

  const handleToggleActive = async (role?: Role) => {
    const target = role ?? toggleTarget;
    if (!target) return;
    setToggling(true);
    try {
      if (target.active) {
        await apiFetch(`/api/roles/${target.id}`, { method: "DELETE" });
      } else {
        await apiFetch(`/api/roles/${target.id}`, {
          method: "PATCH",
          body: JSON.stringify({ active: true }),
        });
      }
      setToggleTarget(null);
      loadRoles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed.");
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-rcc-text-primary">Roles &amp; Permissions</h1>
          <p className="text-sm text-rcc-text-muted mt-0.5">
            Define roles, scope flags, and granular permissions.
          </p>
        </div>
        {has("roles.create") && (
          <button
            onClick={() => setCurrentPage("roles", "create")}
            className="inline-flex items-center gap-2 bg-rcc-primary text-rcc-primary-foreground px-4 py-2 rounded-md text-sm font-semibold hover:bg-rcc-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Role
          </button>
        )}
      </div>

      {/* Search */}
      <div className="bg-rcc-surface rounded-lg border border-rcc-border p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-rcc-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search roles by name or description..."
            className="w-full pl-10 pr-3 py-2 bg-rcc-bg border border-rcc-border rounded-md text-sm text-rcc-text-primary focus:outline-none focus:ring-2 focus:ring-rcc-accent/40"
          />
        </div>
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
                <th className="text-left text-xs font-semibold text-rcc-text-muted uppercase tracking-wide px-4 py-3">Role</th>
                <th className="text-left text-xs font-semibold text-rcc-text-muted uppercase tracking-wide px-4 py-3">Permissions</th>
                <th className="text-left text-xs font-semibold text-rcc-text-muted uppercase tracking-wide px-4 py-3">Employees</th>
                <th className="text-left text-xs font-semibold text-rcc-text-muted uppercase tracking-wide px-4 py-3">Flags</th>
                {has("roles.edit") && (
                  <th className="text-right text-xs font-semibold text-rcc-text-muted uppercase tracking-wide px-4 py-3">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-rcc-border">
              {loading ? (
                <tr>
                  <td colSpan={has("roles.edit") ? 5 : 4} className="px-4 py-10 text-center text-rcc-text-muted">
                    Loading roles...
                  </td>
                </tr>
              ) : currentData.length === 0 ? (
                <tr>
                  <td colSpan={has("roles.edit") ? 5 : 4} className="px-4 py-10 text-center text-rcc-text-muted">
                    No roles found. {search && "Try adjusting your search."}
                  </td>
                </tr>
              ) : (
                currentData.map((role) => (
                  <tr key={role.id} className="hover:bg-rcc-bg/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-md bg-rcc-primary/10 text-rcc-primary flex items-center justify-center shrink-0">
                          <ShieldCheck className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-rcc-text-primary truncate">
                            {role.name}
                            {role.isSystem && (
                              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-rcc-primary/10 text-rcc-primary border border-rcc-primary/20">
                                SYSTEM
                              </span>
                            )}
                          </p>
                          {role.description && (
                            <p className="text-xs text-rcc-text-muted truncate max-w-md">
                              {role.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-rcc-text-secondary font-medium tabular-nums">
                      {role.permissions.length}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-rcc-text-secondary">
                        <UsersIcon className="h-3.5 w-3.5" />
                        <span className="tabular-nums">{role.employeeCount ?? 0}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {role.scopeAllLeave && <FlagBadge color="amber" icon={Globe}>All Leave</FlagBadge>}
                        {role.scopeAllAttendance && <FlagBadge color="amber" icon={Globe}>All Attendance</FlagBadge>}
                        {role.scopeGroupAttendance && !role.scopeAllAttendance && <FlagBadge color="amber" icon={Globe}>Group Attendance</FlagBadge>}
                        {role.canSelfApproveLeave && <FlagBadge color="violet" icon={BadgeCheck}>Self-Approve</FlagBadge>}
                        {role.isSystem && <FlagBadge color="primary" icon={Lock}>System</FlagBadge>}
                        {role.active ? (
                          <FlagBadge color="green" icon={Unlock}>Active</FlagBadge>
                        ) : (
                          <FlagBadge color="red" icon={Lock}>Inactive</FlagBadge>
                        )}
                      </div>
                    </td>
                    {has("roles.edit") && (
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => setCurrentPage("roles", `edit:${role.id}`)}
                            className="p-1.5 rounded-md text-rcc-text-secondary hover:bg-rcc-bg hover:text-rcc-primary transition-colors"
                            title="Edit role"
                            aria-label="Edit role"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {has("roles.delete") && !role.isSystem && (
                          <button
                            onClick={() => setConfirmState({
                              open: true,
                              title: `${role.active ? "Disable" : "Enable"} role \u201c${role.name}\u201d?`,
                              message: role.active
                                ? "This role will be hidden from new employee assignments. Existing employees will keep their role."
                                : "This role will become available for new employee assignments.",
                              variant: "warning",
                              onConfirm: () => handleToggleActive(role),
                            })}
                            className={`p-1.5 rounded-md transition-colors ${
                              role.active
                                ? "text-rcc-text-secondary hover:bg-red-50 hover:text-rcc-error"
                                : "text-rcc-text-secondary hover:bg-green-50 hover:text-green-600"
                            }`}
                            title={role.active ? "Disable role" : "Enable role"}
                            aria-label={role.active ? "Disable role" : "Enable role"}
                          >
                              {role.active ? (
                                <ToggleRight className="h-3.5 w-3.5" />
                              ) : (
                                <ToggleLeft className="h-3.5 w-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls {...controls} />
      </div>

      {/* Enable/Disable confirmation */}
      <ConfirmDialog
        open={confirmState?.open ?? false}
        title={confirmState?.title ?? ""}
        message={confirmState?.message ?? ""}
        variant={confirmState?.variant ?? "warning"}
        onConfirm={() => { confirmState?.onConfirm(); setConfirmState(null); }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}

function FlagBadge({
  color,
  icon: Icon,
  children,
}: {
  color: "amber" | "violet" | "primary" | "green" | "red";
  icon: typeof Globe;
  children: ReactNode;
}) {
  const colorMap: Record<string, string> = {
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
    primary: "bg-rcc-primary/10 text-rcc-primary border-rcc-primary/20",
    green: "bg-green-50 text-green-700 border-green-200",
    red: "bg-red-50 text-rcc-error border-red-200",
  };
  return (
    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-semibold border ${colorMap[color]}`}>
      <Icon className="h-2.5 w-2.5" />
      {children}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════
// RoleFormPage
// ═══════════════════════════════════════════════════════════════

export function RoleFormPage({ mode, roleId }: { mode: "create" | "edit"; roleId?: string }) {
  const { setCurrentPage } = useAuthStore();
  const { has } = usePermissions();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopeAllProfiling, setScopeAllProfiling] = useState(false);
  const [scopeAllEvaluation, setScopeAllEvaluation] = useState(false);
  const [scopeAllLeave, setScopeAllLeave] = useState(false);
  const [scopeAllReports, setScopeAllReports] = useState(false);
  const [scopeAllAttendance, setScopeAllAttendance] = useState(false);
  const [scopeGroupAttendance, setScopeGroupAttendance] = useState(false);
  const [canSelfApproveLeave, setCanSelfApproveLeave] = useState(false);
  const [canEditProfile, setCanEditProfile] = useState(false);
  const [canChangePassword, setCanChangePassword] = useState(false);
  const [canManageBiometrics, setCanManageBiometrics] = useState(false);
  const [active, setActive] = useState(true);
  const [isSystem, setIsSystem] = useState(false);
  const [perms, setPerms] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dirty detection
  const snapshotRef = useRef<Record<string, unknown>>({});
  const isDirty = useMemo(() => {
    const current: Record<string, unknown> = {
      name, description, scopeAllProfiling, scopeAllEvaluation, scopeAllLeave,
      scopeAllReports, scopeAllAttendance, scopeGroupAttendance, canSelfApproveLeave,
      canEditProfile, canChangePassword, canManageBiometrics, active,
      perms: Array.from(perms),
    };
    return JSON.stringify(current) !== JSON.stringify(snapshotRef.current);
  }, [name, description, scopeAllProfiling, scopeAllEvaluation, scopeAllLeave, scopeAllReports,
    scopeAllAttendance, scopeGroupAttendance, canSelfApproveLeave, canEditProfile,
    canChangePassword, canManageBiometrics, active, perms]);
  useUnsavedChanges(isDirty);
  const { requestNavigation, navDialogProps } = useNavigationGuard(isDirty);

  // System configuration state (for config panel at bottom)
  const [cfgGroups, setCfgGroups] = useState<{ id: string; name: string; code: string }[]>([]);
  const [cfgFpasIds, setCfgFpasIds] = useState<string[]>([]);

  useEffect(() => {
    if (mode !== "edit" || !roleId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await apiFetch<{ role: Role }>(`/api/roles/${roleId}`);
        if (cancelled) return;
        const r = data.role;
        setName(r.name);
        setDescription(r.description ?? "");
        setScopeAllProfiling(r.scopeAllProfiling);
        setScopeAllEvaluation(r.scopeAllEvaluation);
        setScopeAllLeave(r.scopeAllLeave);
        setScopeAllReports(r.scopeAllReports);
        setScopeAllAttendance(r.scopeAllAttendance);
        setScopeGroupAttendance(r.scopeGroupAttendance);
        setCanSelfApproveLeave(r.canSelfApproveLeave);
        setCanEditProfile(r.canEditProfile);
        setCanChangePassword(r.canChangePassword);
        setCanManageBiometrics(r.canManageBiometrics);
        setActive(r.active);
        setIsSystem(r.isSystem);
        setPerms(new Set(r.permissions));
        snapshotRef.current = {
          name: r.name, description: r.description ?? "",
          scopeAllProfiling: r.scopeAllProfiling, scopeAllEvaluation: r.scopeAllEvaluation,
          scopeAllLeave: r.scopeAllLeave, scopeAllReports: r.scopeAllReports,
          scopeAllAttendance: r.scopeAllAttendance, scopeGroupAttendance: r.scopeGroupAttendance,
          canSelfApproveLeave: r.canSelfApproveLeave, canEditProfile: r.canEditProfile,
          canChangePassword: r.canChangePassword, canManageBiometrics: r.canManageBiometrics,
          active: r.active, perms: r.permissions,
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load role.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, roleId]);

  // Load system configuration for config panel
  useEffect(() => {
    (async () => {
      try {
        const [groupsData, fpasData] = await Promise.all([
          apiFetch<{ groups: { id: string; name: string; code: string }[] }>("/api/groups"),
          apiFetch<{ enabledGroupIds: string[] }>("/api/fpas/settings"),
        ]);
        setCfgGroups(groupsData.groups ?? []);
        setCfgFpasIds(fpasData.enabledGroupIds ?? []);
      } catch {
        // non-fatal
      }
    })();
  }, []);

  const togglePerm = (id: string) => {
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const scopeState: Record<ScopeKey, [boolean, (v: boolean) => void]> = {
    scopeAllProfiling: [scopeAllProfiling, setScopeAllProfiling],
    scopeAllEvaluation: [scopeAllEvaluation, setScopeAllEvaluation],
    scopeAllLeave: [scopeAllLeave, setScopeAllLeave],
    scopeAllReports: [scopeAllReports, setScopeAllReports],
    scopeAllAttendance: [scopeAllAttendance, setScopeAllAttendance],
    scopeGroupAttendance: [scopeGroupAttendance, setScopeGroupAttendance],
    canSelfApproveLeave: [canSelfApproveLeave, setCanSelfApproveLeave],
    canEditProfile: [canEditProfile, setCanEditProfile],
    canChangePassword: [canChangePassword, setCanChangePassword],
    canManageBiometrics: [canManageBiometrics, setCanManageBiometrics],
  };

  const handleSave = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Role name is required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        scopeAllProfiling,
        scopeAllEvaluation,
        scopeAllLeave,
        scopeAllReports,
        scopeAllAttendance,
        scopeGroupAttendance,
        canSelfApproveLeave,
        canEditProfile,
        canChangePassword,
        canManageBiometrics,
        active,
        permissions: Array.from(perms),
      };
      if (mode === "create") {
        await apiFetch("/api/roles", { method: "POST", body: JSON.stringify(payload) });
      } else if (roleId) {
        await apiFetch(`/api/roles/${roleId}`, { method: "PATCH", body: JSON.stringify(payload) });
      }
      setCurrentPage("roles");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-rcc-text-muted">Loading role...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-full">
      {navDialogProps && <ConfirmDialog {...navDialogProps} />}
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => requestNavigation(() => setCurrentPage("roles"))}
          className="inline-flex items-center gap-1 text-sm text-rcc-text-secondary hover:text-rcc-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to roles
        </button>
      </div>
      <div>
        <h1 className="text-xl font-bold text-rcc-text-primary">
          {mode === "create" ? "Create Role" : `Edit Role: ${name}`}
        </h1>
        <p className="text-sm text-rcc-text-muted mt-0.5">
          Configure name, permissions, and module scope flags.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-rcc-error">
          {error}
        </div>
      )}

      {/* Basic info */}
      <section className="bg-rcc-surface rounded-lg border border-rcc-border p-6 space-y-4">
        <h2 className="text-sm font-semibold text-rcc-text-primary uppercase tracking-wide">
          Basic Information
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Role Name" required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dean of Studies"
              className="w-full px-3 py-2 bg-rcc-bg border border-rcc-border rounded-md text-sm text-rcc-text-primary focus:outline-none focus:ring-2 focus:ring-rcc-accent/40"
            />
          </Field>
          <Field label="Description">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description of this role..."
              className="w-full px-3 py-2 bg-rcc-bg border border-rcc-border rounded-md text-sm text-rcc-text-primary focus:outline-none focus:ring-2 focus:ring-rcc-accent/40"
            />
          </Field>
        </div>
        <label className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors w-fit pr-6 ${
          active ? "border-rcc-accent/40 bg-rcc-accent/5" : "border-rcc-border hover:bg-rcc-bg/40"
        }`}>
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-rcc-border text-rcc-accent focus:ring-rcc-accent/40"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-rcc-text-primary">Active</p>
            <p className="text-xs text-rcc-text-muted mt-0.5">Inactive roles cannot be assigned to employees.</p>
          </div>
        </label>
        {isSystem && (
          <div className="bg-rcc-primary/5 border border-rcc-primary/20 rounded-md p-3 text-xs text-rcc-text-secondary flex items-center gap-2">
            <Lock className="h-3.5 w-3.5" />
            This is a system role. The system flag and critical permissions cannot be removed.
          </div>
        )}
      </section>

      {/* Permission Matrix */}
      <section className="bg-rcc-surface rounded-lg border border-rcc-border p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-rcc-text-primary uppercase tracking-wide">
            Permission Matrix
          </h2>
          <p className="text-xs text-rcc-text-muted mt-0.5">
            Toggle individual permissions, or use &ldquo;select all&rdquo; per module.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PERMISSIONS_BY_MODULE.map((mod) => {
            const all = mod.permissions.map((p) => p.id);
            const granted = all.filter((id) => perms.has(id));
            const allChecked = granted.length === all.length;
            const someChecked = granted.length > 0 && !allChecked;
            return (
              <div key={mod.label} className="border border-rcc-border rounded-lg overflow-hidden">
                <div className="bg-rcc-bg/40 px-4 py-2.5 border-b border-rcc-border flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = someChecked;
                      }}
                      onChange={() => {
                        setPerms((prev) => {
                          const next = new Set(prev);
                          if (allChecked) all.forEach((id) => next.delete(id));
                          else all.forEach((id) => next.add(id));
                          return next;
                        });
                      }}
                      className="h-4 w-4 rounded border-rcc-border text-rcc-accent focus:ring-rcc-accent/40"
                    />
                    <span className="text-sm font-semibold text-rcc-text-primary">{mod.label}</span>
                  </label>
                  <span className="text-xs text-rcc-text-muted tabular-nums">
                    {granted.length} / {all.length}
                  </span>
                </div>
                <div className="divide-y divide-rcc-border">
                  {mod.permissions.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-rcc-bg/30 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={perms.has(p.id)}
                        onChange={() => togglePerm(p.id)}
                        className="mt-0.5 h-4 w-4 rounded border-rcc-border text-rcc-accent focus:ring-rcc-accent/40"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-rcc-text-primary">{p.label}</p>
                        <p className="text-xs text-rcc-text-muted">{p.description}</p>
                      </div>
                      <code className="text-[10px] text-rcc-text-muted bg-rcc-bg px-1.5 py-0.5 rounded shrink-0">
                        {p.id}
                      </code>
                    </label>
                  ))}
                </div>
                {mod.scopes && mod.scopes.length > 0 && (
                  <div className="bg-amber-50/40 divide-y divide-amber-100 border-t border-amber-100">
                    {mod.scopes.map((s) => {
                      const [checked, onChange] = scopeState[s.key];
                      return (
                        <label
                          key={s.key}
                          className="flex items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-amber-50/70 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => onChange(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-rcc-border text-rcc-accent focus:ring-rcc-accent/40"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-rcc-text-primary">
                              {s.label}{" "}
                              <span className="text-[9px] uppercase tracking-wide font-semibold text-amber-700 bg-amber-100 px-1 py-0.5 rounded align-middle">
                                Scope
                              </span>
                            </p>
                            <p className="text-xs text-rcc-text-muted">{s.description}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* System Configuration */}
      <section className="bg-rcc-surface rounded-lg border border-rcc-border p-6 space-y-4">
        <h2 className="text-sm font-semibold text-rcc-text-primary uppercase tracking-wide">
          System Configuration
        </h2>
        <p className="text-xs text-rcc-text-muted -mt-2">
          Current FPAS and profile edit settings across the system.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-rcc-border rounded-lg p-4 space-y-2">
            <h3 className="text-xs font-semibold text-rcc-text-secondary uppercase tracking-wide">FPAS Enabled Groups</h3>
            {cfgFpasIds.length === 0 ? (
              <p className="text-xs text-rcc-text-muted">No groups enabled.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {cfgFpasIds.map(id => {
                  const g = cfgGroups.find(gr => gr.id === id);
                  return (
                    <span key={id} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-rcc-primary/10 text-rcc-primary border border-rcc-primary/20">
                      {g ? g.name : id}
                    </span>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-rcc-text-muted">Configure in Employee Records &rarr; FPAS Configuration.</p>
          </div>

          <div className="border border-rcc-border rounded-lg p-4 space-y-2">
            <h3 className="text-xs font-semibold text-rcc-text-secondary uppercase tracking-wide">Profile Edit Access</h3>
            <p className="text-xs text-rcc-text-muted">Controls whether users with this role can fill/edit their own profile sections.</p>
            <div className="flex items-center gap-2 mt-1">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold ${canEditProfile ? "bg-green-50 text-green-700 border border-green-200" : "bg-rcc-bg text-rcc-text-muted border border-rcc-border"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${canEditProfile ? "bg-green-500" : "bg-rcc-text-muted"}`} />
                {canEditProfile ? "Enabled" : "Disabled"}
              </span>
              <span className="text-xs text-rcc-text-muted">Toggle in Employee Profiling &rarr; Scope Flags.</span>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={() => requestNavigation(() => setCurrentPage("roles"))}
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
          {saving ? "Saving..." : mode === "create" ? "Create Role" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

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
