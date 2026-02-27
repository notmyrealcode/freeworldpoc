import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected =
    "Basic " + Buffer.from(`${process.env.AUTH_USER}:${process.env.AUTH_PASS}`).toString("base64");

  if (!auth || auth !== expected) {
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="SNAP Apply"' },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/token|_next/static|_next/image|favicon.png).*)"],
};
