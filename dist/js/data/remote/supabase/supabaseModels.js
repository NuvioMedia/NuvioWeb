export function mapSupabaseProfile(row = {}) {
  return {
    id: row.id || "",
    name: row.name || "User",
    avatarColorHex: row.avatar_color_hex || "#1E88E5",
    isPrimary: Boolean(row.is_primary)
  };
}
