export function createUserProfile({
  id,
  name,
  avatarColorHex = "#1E88E5",
  isPrimary = false,
  avatarId = null
}) {
  return {
    id,
    name,
    avatarColorHex,
    isPrimary,
    avatarId
  };
}
