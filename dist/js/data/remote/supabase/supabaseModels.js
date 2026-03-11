export function mapSupabaseProfile(row = {}) {
  return {
    id: row.id || "",
    name: row.name || "User",
    avatarColorHex: row.avatar_color_hex || "#1E88E5",
    avatarId: row.avatar_id || row.avatarId || null,
    usesPrimaryAddons: Boolean(row.uses_primary_addons || row.usesPrimaryAddons),
    usesPrimaryPlugins: Boolean(row.uses_primary_plugins || row.usesPrimaryPlugins),
    isPrimary: Boolean(row.is_primary)
  };
}
