import { httpRequest } from "../../../core/network/httpClient.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../../config.js";

function buildHeaders(extra = {}, useSession = true) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    ...extra
  };
  if (!useSession && headers.Authorization == null) {
    headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  }
  return headers;
}

export const SupabaseApi = {

  rpc(functionName, body = {}, useSession = true) {
    return httpRequest(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      headers: buildHeaders({ "Content-Type": "application/json" }, useSession),
      includeSessionAuth: useSession,
      body: JSON.stringify(body)
    });
  },

  select(table, query = "", useSession = true) {
    const suffix = query ? `?${query}` : "";
    return httpRequest(`${SUPABASE_URL}/rest/v1/${table}${suffix}`, {
      method: "GET",
      headers: buildHeaders({}, useSession),
      includeSessionAuth: useSession
    });
  },

  upsert(table, rows, onConflict = null, useSession = true) {
    const query = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
    return httpRequest(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
      method: "POST",
      headers: buildHeaders({
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation"
      }, useSession),
      includeSessionAuth: useSession,
      body: JSON.stringify(rows)
    });
  },

  delete(table, query, useSession = true) {
    return httpRequest(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      method: "DELETE",
      headers: buildHeaders({ Prefer: "return=representation" }, useSession),
      includeSessionAuth: useSession
    });
  }

};
