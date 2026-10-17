// ═══════════════════════════════════════════════════════════════
// RCC-HIROS — Permissions & Modules catalog
// Single source of truth for RBAC identifiers and sidebar modules.
// ═══════════════════════════════════════════════════════════════

/** Top-level module keys — drives sidebar grouping. */
export type ModuleKey =
  | "dashboard"
  | "profiling"
  | "attendance"
  | "evaluation"
  | "leave"
  | "reports"
  | "roles"
  | "groups";

/** Every permission identifier granted/revoked via RolePermission. */
export const PERMISSIONS = [
  // Dashboard
  "dashboard.view",

  // Employee profiling
  "profiling.view",
  "profiling.view_inactive",
  "profiling.create",
  "profiling.edit",
  "profiling.editIdentity",
  "profiling.editEmployment",
  "profiling.editSalary",
  "profiling.editStatus",
  "profiling.delete",
  "profile.selfEdit",
  "profile.editAll",

  // Attendance
  "attendance.view",
  "attendance.clock_in",
  "attendance.edit",
  "attendance.edit_on_premise",
  "attendance.view_all",

  // Performance evaluation
  "evaluation.view",
  "evaluation.submit",
  "evaluation.view_results",
  "evaluation.manage_forms",
  "evaluation.reset",

  // Leave management
  "leave.request",
  "leave.approve_l1",
  "leave.approve_l2",
  "leave.view_all",
  "leave.manage_types",

  // Reports
  "reports.view",
  "reports.export",

  // FPAS (Faculty Performance Appraisal)
  "fpas.fill",
  "fpas.export",
  "fpas.manage",

  // Roles
  "roles.view",
  "roles.create",
  "roles.edit",
  "roles.delete",

  // Groups
  "groups.view",
  "groups.create",
  "groups.edit",
  "groups.delete",

  // Biometric / Fingerprint
  "biometric.enroll",
  "biometric.manage",
] as const;

export type PermissionIdentifier = (typeof PERMISSIONS)[number];

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  description?: string;
  icon:
    | "LayoutDashboard"
    | "Users"
    | "Clock"
    | "ClipboardCheck"
    | "CalendarClock"
    | "BarChart3"
    | "ShieldCheck"
    | "Building2";
  /** Identifiers relevant to this module — module is visible if user has ANY of them. */
  permissions: readonly string[];
}

/** Module catalog (drives sidebar rendering). */
export const MODULES: readonly ModuleDef[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: "LayoutDashboard",
    permissions: ["dashboard.view"],
  },
  {
    key: "profiling",
    label: "Employee Records",
    icon: "Users",
    permissions: [
      "profiling.view",
      "profiling.view_inactive",
      "profiling.create",
      "profiling.edit",
      "profiling.editIdentity",
      "profiling.editEmployment",
      "profiling.editSalary",
      "profiling.editStatus",
      "profiling.delete",
    ],
  },
  {
    key: "attendance",
    label: "Attendance",
    icon: "Clock",
    permissions: [
      "attendance.view",
      "attendance.clock_in",
      "attendance.edit",
      "attendance.edit_on_premise",
      "attendance.view_all",
    ],
  },
  {
    key: "evaluation",
    label: "Performance Evaluation",
    icon: "ClipboardCheck",
    permissions: [
      "evaluation.view",
      "evaluation.submit",
      "evaluation.view_results",
      "evaluation.manage_forms",
    ],
  },
  {
    key: "leave",
    label: "Leave Management",
    icon: "CalendarClock",
    permissions: [
      "leave.request",
      "leave.approve_l1",
      "leave.approve_l2",
      "leave.view_all",
      "leave.manage_types",
    ],
  },
  {
    key: "reports",
    label: "Reports",
    icon: "BarChart3",
    permissions: ["reports.view", "reports.export"],
  },
  {
    key: "roles",
    label: "Roles & Permissions",
    icon: "ShieldCheck",
    permissions: ["roles.view", "roles.create", "roles.edit", "roles.delete"],
  },
  {
    key: "groups",
    label: "Groups",
    icon: "Building2",
    permissions: ["groups.view", "groups.create", "groups.edit", "groups.delete"],
  },
] as const;

/**
 * Compute the visible module list for a user given their permission set.
 * Special cases:
 *  - evaluation: visible if user has ANY of view/submit/view_results
 *  - attendance: visible if user has ANY of view/clock_in
 */
export function getVisibleModules(permissions: string[]): ModuleDef[] {
  const set = new Set(permissions);
  return MODULES.filter((m) => {
    // Special cases
    if (m.key === "evaluation") {
      return (
        set.has("evaluation.view") ||
        set.has("evaluation.submit") ||
        set.has("evaluation.view_results") ||
        set.has("evaluation.manage_forms") ||
        set.has("evaluation.reset")
      );
    }
    if (m.key === "attendance") {
      return (
        set.has("attendance.view") ||
        set.has("attendance.clock_in") ||
        set.has("attendance.edit") ||
        set.has("attendance.edit_on_premise") ||
        set.has("attendance.view_all")
      );
    }
    // Default: visible if user has ANY of the module's permissions
    return m.permissions.some((p) => set.has(p));
  });
}

/** Check whether a permission set contains a specific identifier. */
export function hasPermission(
  permissions: string[],
  identifier: string
): boolean {
  return permissions.includes(identifier);
}

/** Check whether a permission set contains ANY of the given identifiers. */
export function hasAnyPermission(
  permissions: string[],
  identifiers: string[]
): boolean {
  if (identifiers.length === 0) return false;
  const set = new Set(permissions);
  return identifiers.some((id) => set.has(id));
}
