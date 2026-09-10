import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getIsAdmin } from "@/lib/user-roles";
import { FINE_PDF_BUCKET } from "@/lib/fine-notices";

export async function GET(_request: Request, { params }: { params: Promise<{ vehicleId: string; fineId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !(await getIsAdmin(supabase, user.id))) return new Response("Forbidden", { status: 403 });
  const { vehicleId, fineId } = await params;
  const { data: fine, error } = await supabase.from("vehicle_fine_notices").select("attachment_path, attachment_name").eq("id", fineId).eq("vehicle_id", vehicleId).maybeSingle();
  if (error) return new Response("Unable to load attachment", { status: 500 });
  if (!fine?.attachment_path) return new Response("Not found", { status: 404 });
  const { data, error: downloadError } = await createAdminClient().storage.from(FINE_PDF_BUCKET).download(fine.attachment_path);
  if (downloadError || !data) return new Response("Unable to download attachment", { status: 502 });
  const filename = String(fine.attachment_name ?? "fine-notice.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
  return new Response(data, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
