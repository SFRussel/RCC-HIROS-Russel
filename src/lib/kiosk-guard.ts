import { NextRequest, NextResponse } from "next/server";

// ═══════════════════════════════════════════════════════════════
// RCC-HIROS — kiosk network guard
//
// The ZK endpoints are unauthenticated by design: the kiosk browser has no
// user session, it just presents a fingerprint. On a public hostname that
// means anyone can POST to them, so access is limited to the networks that
// actually host the scanner.
//
// KIOSK_ALLOWED_IPS is a comma-separated allowlist of public egress IPs
// (the school's internet connection, as seen by Cloudflare). When it is
// empty the guard is inert, which keeps local demos working out of the box.
// Cloudflare's WAF rule on /api/biometric/zk/* is the outer layer.
// ═══════════════════════════════════════════════════════════════

export function clientIp(request: NextRequest): string | null {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;

  return request.headers.get("x-real-ip")?.trim() || null;
}

/**
 * Returns a 403 response when the caller is outside the allowlist,
 * or null when the request may proceed.
 */
export function requireKioskNetwork(
  request: NextRequest
): NextResponse | null {
  const allowed = (process.env.KIOSK_ALLOWED_IPS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (allowed.length === 0) return null;

  const ip = clientIp(request);
  if (ip && allowed.includes(ip)) return null;

  console.warn(
    `[kiosk-guard] blocked ${request.nextUrl.pathname} from ${ip ?? "unknown IP"}`
  );

  return NextResponse.json(
    { error: "Kiosk endpoints are restricted to authorised networks" },
    { status: 403 }
  );
}
