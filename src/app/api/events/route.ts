import { NextRequest, NextResponse } from "next/server";
import { eventsSince, recentEvents } from "@/lib/engine/events";
import { getEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";

/** Polling fallback for realtime events (used when socket relay is unreachable). */
export async function GET(req: NextRequest) {
  await getEngine().ensureStarted();
  const since = parseInt(req.nextUrl.searchParams.get("since") || "-1", 10);
  const events = since >= 0 ? eventsSince(since) : recentEvents(30);
  const lastSeq = events.length ? events[events.length - 1].seq : Math.max(since, 0);
  return NextResponse.json({ events, lastSeq });
}
