import { NextResponse } from "next/server";
import { getAppUpdate, noAppUpdate } from "@/lib/app-update";
import { createRefreshingCache } from "@/lib/refreshing-cache";
import { errorMessage } from "@/lib/errors";
import { isPiOffline } from "@/lib/pi-offline";

export const dynamic = "force-dynamic";

const loadUpdateStatus = createRefreshingCache("pi-web-ex:app-update", 12 * 60 * 60 * 1000, () => getAppUpdate());

export async function GET() {
  if (process.env.PI_WEB_SKIP_VERSION_CHECK === "1" || isPiOffline()) {
    return NextResponse.json(noAppUpdate());
  }
  try {
    return NextResponse.json(await loadUpdateStatus());
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 502 });
  }
}
