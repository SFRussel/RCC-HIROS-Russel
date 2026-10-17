"use client";

import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/store/auth-store";
import LoginPage from "@/components/login-page";
import ChangePasswordModal from "@/components/shared/change-password-modal";
import AppLayout from "@/components/shared/app-layout";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { DynamicDashboard } from "@/components/shared/dashboard";
import { useEffect, useState, Component, type ReactNode } from "react";

import { EmployeeListPage, EmployeeFormPage, EmployeeProfilePage } from "@/components/profiling/employee-pages";
import { ContractTypeManagementPage } from "@/components/profiling/contract-type-pages";
import { AttendanceListPage, AttendanceConfigurationPage } from "@/components/attendance/attendance-pages";
import { LeavePage } from "@/components/leave/leave-pages";
import { EvaluationPage } from "@/components/evaluation/evaluation-pages";
import { ReportsPage } from "@/components/reports/report-pages";
import { RoleListPage, RoleFormPage } from "@/components/admin/role-pages";
import { GroupListPage, GroupFormPage } from "@/components/admin/group-pages";
import { FpasPage, FpasExportPage } from "@/components/fpas/fpas-pages";

// ═══════════════════════════════════════════════════════════════
// Error Boundary — catches render errors in page components
// ═══════════════════════════════════════════════════════════════
interface ErrorBoundaryState { hasError: boolean; error: Error | null; }
class PageErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="text-4xl">⚠️</div>
          <h2 className="text-lg font-bold text-rcc-text-primary">Something went wrong</h2>
          <p className="text-sm text-rcc-text-muted max-w-md text-center">{this.state.error?.message ?? "An unexpected error occurred."}</p>
          <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            className="mt-2 px-4 py-2 rounded-md text-sm font-semibold bg-rcc-primary text-rcc-primary-foreground hover:bg-rcc-primary/90">
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function HomePage() {
  const { user, isAuthenticated, isLoading, mustChangePassword } = useAuth();
  const { currentPage, currentSubpage } = useAuthStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Don't render anything on SSR — prevents hydration mismatch
  if (!mounted) return null;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-rcc-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-rcc-primary border-t-transparent" />
          <p className="text-sm text-rcc-text-muted">Loading session…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) return <LoginPage />;
  if (mustChangePassword) return <ChangePasswordModal />;

  let content: React.ReactNode;
  switch (currentPage) {
    case "dashboard": content = <DynamicDashboard />; break;
    case "profiling":
      content = currentSubpage === "myprofile" ? (
        user?.id ? <EmployeeProfilePage employeeId={user.id} /> : <PermissionDenied />
      ) : currentSubpage === "contract-types" ? (
        <PermissionGuard require="profiling.edit" fallback={<PermissionDenied />}><ContractTypeManagementPage /></PermissionGuard>
      ) : (
        <PermissionGuard require="profiling.view" fallback={<PermissionDenied />}>
          {currentSubpage === "create" ? (
            <PermissionGuard require="profiling.create" fallback={<PermissionDenied />}><EmployeeFormPage mode="create" /></PermissionGuard>
          ) : currentSubpage?.startsWith("edit:") ? (
            <PermissionGuard require="profiling.edit" fallback={<PermissionDenied />}><EmployeeFormPage mode="edit" employeeId={currentSubpage.slice(5)} /></PermissionGuard>
          ) : currentSubpage?.startsWith("view:") ? (
            <EmployeeProfilePage employeeId={currentSubpage.slice(5)} />
          ) : <EmployeeListPage />}
        </PermissionGuard>
      ); break;
    case "attendance":
      content = currentSubpage === "premises" ? (
        <PermissionGuard any={["attendance.edit", "roles.edit"]} fallback={<PermissionDenied />}><AttendanceConfigurationPage /></PermissionGuard>
      ) : (
        <PermissionGuard require="attendance.view" fallback={<PermissionDenied />}><AttendanceListPage /></PermissionGuard>
      ); break;
    case "leave":
      content = (
        <PermissionGuard any={["leave.request", "leave.approve_l1", "leave.approve_l2", "leave.view_all", "leave.manage_types"]} fallback={<PermissionDenied />}>
          <LeavePage />
        </PermissionGuard>
      ); break;
    case "evaluation":
      content = (
        <PermissionGuard any={["evaluation.view", "evaluation.view_results", "evaluation.submit", "evaluation.manage_forms"]} fallback={<PermissionDenied />}>
          <EvaluationPage />
        </PermissionGuard>
      ); break;
    case "reports":
      content = <PermissionGuard require="reports.view" fallback={<PermissionDenied />}><ReportsPage /></PermissionGuard>; break;
    case "roles":
      content = (
        <PermissionGuard require="roles.view" fallback={<PermissionDenied />}>
          {currentSubpage === "create" ? (
            <PermissionGuard require="roles.create" fallback={<PermissionDenied />}><RoleFormPage mode="create" /></PermissionGuard>
          ) : currentSubpage?.startsWith("edit:") ? (
            <PermissionGuard require="roles.edit" fallback={<PermissionDenied />}><RoleFormPage mode="edit" roleId={currentSubpage.slice(5)} /></PermissionGuard>
          ) : <RoleListPage />}
        </PermissionGuard>
      ); break;
    case "groups":
      content = (
        <PermissionGuard require="groups.view" fallback={<PermissionDenied />}>
          {currentSubpage === "create" ? (
            <PermissionGuard require="groups.create" fallback={<PermissionDenied />}><GroupFormPage mode="create" /></PermissionGuard>
          ) : currentSubpage?.startsWith("edit:") ? (
            <PermissionGuard require="groups.edit" fallback={<PermissionDenied />}><GroupFormPage mode="edit" groupId={currentSubpage.slice(5)} /></PermissionGuard>
          ) : <GroupListPage />}
        </PermissionGuard>
      ); break;
    case "fpas":
      content = currentSubpage === "settings" ? (
        <PermissionGuard require="fpas.manage" fallback={<PermissionDenied />}>
          <FpasPage showSettings />
        </PermissionGuard>
      ) : currentSubpage === "export" ? (
        <PermissionGuard any={["fpas.export", "fpas.manage"]} fallback={<PermissionDenied />}>
          <FpasExportPage />
        </PermissionGuard>
      ) : (
        <PermissionGuard any={["fpas.fill", "fpas.manage"]} fallback={<PermissionDenied />}>
          <FpasPage
            employeeId={currentSubpage?.startsWith("emp:") ? currentSubpage.slice(4) : undefined}
            submissionId={currentSubpage?.startsWith("view:") ? currentSubpage.slice(5) : undefined}
          />
        </PermissionGuard>
      ); break;
    default: content = <DynamicDashboard />;
  }

  return <AppLayout><PageErrorBoundary>{content}</PageErrorBoundary></AppLayout>;
}
