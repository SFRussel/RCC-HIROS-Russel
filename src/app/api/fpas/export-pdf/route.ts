import { NextRequest, NextResponse } from "next/server";
import type { ReactElement } from "react";
import type { DocumentProps } from "@react-pdf/renderer";
import { renderToBuffer } from "@react-pdf/renderer";
import { db } from "@/lib/db";
import { requireAnyPermission } from "@/lib/auth-token";
import type { FpasFormData } from "@/lib/fpas-form";
import { FpasPdfBundle, FpasPdfDocument } from "@/components/fpas/fpas-pdf";
import { fpasPdfFilename, safeFilePart } from "@/lib/pdf-export";
import { createZip } from "@/lib/zip-store";

// ═══════════════════════════════════════════════════════════════
// GET /api/fpas/export-pdf — department FPAS bundle (fpas.manage
// or fpas.export). `fpas.manage` may export any scope (ALL);
// `fpas.export`-only holders are locked to their OWN department —
// any requested groupCode/ALL is overridden server-side, so no
// client parameter can widen their scope (including submissionIds,
// which are AND-scoped by the same group filter).
//   ?schoolYear=YYYY-YYYY (required) &groupCode=XXX (optional, ALL)
//   &submissionIds=id1,id2 (optional, max 100 — exact members, e.g.
//   the hub's ticked selection; whole scope when omitted)
//   &format=pdf (one merged file) | zip (one file per member)
// ═══════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAnyPermission(request, [
      "fpas.manage",
      "fpas.export",
    ]);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const schoolYear = searchParams.get("schoolYear")?.trim() || "";
    let groupCode = searchParams.get("groupCode") || "ALL";
    const format = searchParams.get("format") === "zip" ? "zip" : "pdf";
    const submissionIds = (searchParams.get("submissionIds") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);

    if (!schoolYear) {
      return NextResponse.json(
        { error: "schoolYear is required" },
        { status: 400 }
      );
    }

    // `fpas.manage` = unrestricted scope. Export-only holders are
    // pinned to their own department's group code.
    const canManage =
      auth.user.isSystem || auth.user.permissions.includes("fpas.manage");
    if (!canManage) {
      const me = await db.employee.findUnique({
        where: { id: auth.user.id },
        select: { group: { select: { code: true } } },
      });
      if (!me?.group?.code) {
        return NextResponse.json(
          { error: "Forbidden - you are not associated with a department" },
          { status: 403 }
        );
      }
      groupCode = me.group.code;
    }

    let groupId: string | undefined;
    if (groupCode !== "ALL") {
      const grp = await db.group.findUnique({ where: { code: groupCode } });
      if (!grp) {
        return NextResponse.json({ error: "Group not found" }, { status: 404 });
      }
      groupId = grp.id;
    }

    const submissions = await db.fpasSubmission.findMany({
      where: {
        schoolYear,
        ...(groupId ? { employee: { groupId } } : {}),
        ...(submissionIds.length > 0 ? { id: { in: submissionIds } } : {}),
      },
      include: {
        employee: {
          select: {
            employeeId: true,
            firstName: true,
            lastName: true,
            group: { select: { code: true } },
            role: { select: { isSystem: true } },
          },
        },
      },
      orderBy: { employee: { employeeId: "asc" } },
    });
    const rows = submissions.filter((s) => !s.employee?.role?.isSystem);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No submitted FPAS forms for this scope" },
        { status: 404 }
      );
    }

    const tag = submissionIds.length > 0
      ? `${safeFilePart(schoolYear)}-selected-${rows.length}`
      : `${safeFilePart(schoolYear)}-${safeFilePart(groupCode)}`;

    if (format === "zip") {
      const entries: { name: string; data: Uint8Array }[] = [];
      for (const s of rows) {
        const formData = JSON.parse(s.formData) as FpasFormData;
        const pdf = await renderToBuffer(
          FpasPdfDocument({ formData, schoolYear }) as unknown as ReactElement<DocumentProps>
        );
        const name = s.employee
          ? `${s.employee.firstName} ${s.employee.lastName}`.trim()
          : s.employeeId;
        entries.push({
          name: fpasPdfFilename(s.employee?.employeeId ?? s.employeeId, name, schoolYear),
          data: new Uint8Array(pdf),
        });
      }
      const zip = createZip(entries);
      return new NextResponse(new Uint8Array(zip), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="fpas-${tag}.zip"`,
        },
      });
    }

    const buffer = await renderToBuffer(
      FpasPdfBundle({
        docs: rows.map((s) => ({
          formData: JSON.parse(s.formData) as FpasFormData,
          schoolYear,
        })),
      }) as unknown as ReactElement<DocumentProps>
    );
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="fpas-${tag}.pdf"`,
      },
    });
  } catch (error) {
    console.error("[API /fpas/export-pdf] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

