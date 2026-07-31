import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Point an external uptime pinger (UptimeRobot, Better Stack, cron-job.org,
// a scheduled GitHub Action, etc.) at this route. A Supabase outage both
// fails the ping (uptime alert) and reports to Sentry (error alert) from the
// same check.
export async function GET() {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("categories").select("slug").limit(1);
    if (error) throw error;
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
