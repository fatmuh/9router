import { NextResponse } from "next/server";
import { buildSelectableModels } from "@/lib/selectableModels";

export const dynamic = "force-dynamic";

/**
 * GET /api/keys/models — full list of selectable models grouped by provider
 * (for the "Allowed Models" checkbox picker UI). Combos returned separately.
 */
export async function GET() {
  try {
    return NextResponse.json(await buildSelectableModels());
  } catch (error) {
    console.log("Error fetching selectable models:", error);
    return NextResponse.json({ error: "Failed to fetch selectable models" }, { status: 500 });
  }
}
