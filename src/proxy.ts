import { NextResponse, type NextRequest } from "next/server";

/**
 * HTTP basic auth for the whole app (pages and API). Candidate PII lives here, so production
 * refuses to serve anything unless DASHBOARD_PASSWORD is set.
 */
export function proxy(req: NextRequest) {
  const pass = process.env.DASHBOARD_PASSWORD;
  const user = process.env.DASHBOARD_USER || "arjun";

  // Cron worker can authenticate with a bearer secret instead.
  const cron = process.env.CRON_SECRET;
  if (cron && req.nextUrl.pathname === "/api/process" && req.headers.get("authorization") === `Bearer ${cron}`) {
    return NextResponse.next();
  }

  if (!pass) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("DASHBOARD_PASSWORD is not configured.", { status: 503 });
    }
    return NextResponse.next(); // local development
  }
  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const i = decoded.indexOf(":");
    const u = decoded.slice(0, i);
    const p = decoded.slice(i + 1);
    if (u === user && p === pass) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Kargo Hiring", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
