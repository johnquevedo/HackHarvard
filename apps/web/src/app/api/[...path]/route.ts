import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "host", "content-length"]);

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  const base = process.env.API_BASE_URL ?? "http://localhost:4104";
  const target = new URL(`/api/${path.join("/")}${request.nextUrl.search}`, base);
  const headers = new Headers(request.headers);
  for (const name of HOP) headers.delete(name);
  const token = process.env.DENNIS_ADMIN_TOKEN;
  if (token) headers.set("x-dennis-admin", token);
  const init: RequestInit = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }
  const response = await fetch(target, init);
  const out = new Headers(response.headers);
  return new NextResponse(response.body, { status: response.status, headers: out });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
