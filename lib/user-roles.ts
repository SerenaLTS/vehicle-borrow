export type UserRole = {
  user_id: string;
  email: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
};

type AdminLookupClient = {
  from: (table: "user_roles") => {
    select: (columns: "is_admin") => {
      eq: (column: "user_id", value: string) => {
        maybeSingle: () => Promise<{ data: { is_admin?: boolean } | null }>;
      };
    };
  };
};

export async function getIsAdmin(supabase: unknown, userId: string) {
  const client = supabase as AdminLookupClient;
  const { data } = await client.from("user_roles").select("is_admin").eq("user_id", userId).maybeSingle();
  return data?.is_admin ?? false;
}
