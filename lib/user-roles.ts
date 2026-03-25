export type UserRole = {
  user_id: string;
  email: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
};

export async function getIsAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("is_admin").eq("user_id", userId).maybeSingle();
  return data?.is_admin ?? false;
}
