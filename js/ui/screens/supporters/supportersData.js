export function parseTimestamp(rawDate) {
  const timestamp = Date.parse(String(rawDate || ""));
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function normalizeSupporterDonations(rawDonations) {
  if (!Array.isArray(rawDonations)) return [];

  return rawDonations
    .map((donation, index) => {
      const name = String(donation?.name || "").trim();
      const rawDate = donation?.date == null ? donation?.createdAt : donation.date;
      const date = String(rawDate || "").trim();
      if (!name || !date) return null;

      const donationId = String(donation?.id || "").trim();
      return {
        id: `${donationId || `${name}|${date}`}#${index}`,
        name,
        date,
        message: String(donation?.message || "").trim(),
        sortTimestamp: parseTimestamp(date)
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.sortTimestamp - left.sortTimestamp);
}

export function normalizeContributors(rawContributors) {
  if (!Array.isArray(rawContributors)) return [];

  return rawContributors
    .map((contributor, index) => {
      const name = String(contributor?.name || "").trim();
      const totalContributions = Number(contributor?.total || 0);
      if (!name || totalContributions <= 0) return null;

      const rawProfile = typeof contributor?.profile === "string" ? contributor.profile : "";
      const profileUrl = rawProfile.trim() ? rawProfile : null;
      const profileParts = String(profileUrl || "").split("/");
      const githubLogin = profileParts[profileParts.length - 1] || null;
      const rawAvatar = typeof contributor?.avatar === "string" ? contributor.avatar : "";
      return {
        id: profileUrl || `${name}|${index}`,
        name,
        githubLogin,
        avatarUrl: rawAvatar.trim() ? rawAvatar : null,
        profileUrl,
        totalContributions,
        tvContributions: Number(contributor?.tv || 0),
        mobileContributions: Number(contributor?.mobile || 0),
        webContributions: Number(contributor?.web || 0)
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        right.totalContributions - left.totalContributions ||
        right.tvContributions - left.tvContributions ||
        right.mobileContributions - left.mobileContributions ||
        right.webContributions - left.webContributions ||
        compareNames(left.name, right.name)
    );
}

function compareNames(leftName, rightName) {
  const left = leftName.toLowerCase();
  const right = rightName.toLowerCase();
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function parseSponsorNames(rawNames) {
  return String(rawNames || "")
    .split(",")
    .map((rawName, index) => {
      const name = rawName.trim();
      if (!name) return null;

      return {
        id: `${name.toLowerCase()}|${index}`,
        name,
        channelUrl: null,
        createdAt: "",
        sortTimestamp: 2147483647 - index
      };
    })
    .filter(Boolean);
}
