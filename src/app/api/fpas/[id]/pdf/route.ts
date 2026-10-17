import { NextRequest, NextResponse } from "next/server";
import type { ReactElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { db } from "@/lib/db";
import { requireAnyPermission } from "@/lib/auth-token";
import type { FpasFormData } from "@/lib/fpas-form";
import { FpasPdfDocument } from "@/components/fpas/fpas-pdf";
import { fpasPdfFilename } from "@/lib/pdf-export";

// ═══════════════════════════════════════════════════════════════
// GET /api/fpas/[id]/pdf — download a single FPAS form as PDF.
// Access: owner, fpas.export (own department only), or fpas.manage
// (mirrors GET /api/fpas/[id]).
// ═══════════════════════════════════════════════════════════════
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAnyPermission(request, [
      "fpas.fill",
      "fpas.export",
      "fpas.manage",
    ]);
    if (!auth.ok) return auth.response;
    const { user } = auth;
    const { id } = await params;

    const submission = await db.fpasSubmission.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            employeeId: true,
            firstName: true,
            lastName: true,
            middleName: true,
            group: { select: { id: true } },
          },
        },
      },
    });

    if (!submission) {
      return NextResponse.json(
        { error: "Submission not found" },
        { status: 404 }
      );
    }

    const canManage = user.isSystem || user.permissions.includes("fpas.manage");
    let allowed = submission.employeeId === user.id || canManage;
    if (!allowed && user.permissions.includes("fpas.export")) {
      const me = await db.employee.findUnique({
        where: { id: user.id },
        select: { groupId: true },
      });
      allowed = !!me?.groupId && me.groupId === submission.employee?.group?.id;
    }
    if (!allowed) {
      return NextResponse.json(
        { error: "Forbidden - you are not allowed to view this submission" },
        { status: 403 }
      );
    }

    const formData = JSON.parse(submission.formData) as FpasFormData;
    const buffer = await renderToBuffer(
      FpasPdfDocument({ formData, schoolYear: submission.schoolYear }) as unknown as ReactElement<DocumentProps>
    );

    const name = submission.employee
      ? `${submission.employee.firstName} ${submission.employee.lastName}`.trim()
      : submission.employeeId;
    const fname = fpasPdfFilename(
      submission.employee?.employeeId ?? submission.employeeId,
      name,
      submission.schoolYear
    );

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fname}"`,
      },
    });
  } catch (error) {
    console.error("[API /fpas/[id]/pdf] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
