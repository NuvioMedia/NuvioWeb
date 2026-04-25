import { httpRequest } from "../../../core/network/httpClient.js";

function trimSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

export const AddonApi = {

  async getManifest(baseUrl) {
    return httpRequest(`${trimSlash(baseUrl)}/manifest.json`, {
      includeSessionAuth: false
    });
  },

  async getMeta(url) {
    return httpRequest(url, {
      includeSessionAuth: false
    });
  },

  async getStreams(url) {
    return httpRequest(url, {
      includeSessionAuth: false
    });
  },

  async getSubtitles(url) {
    return httpRequest(url, {
      includeSessionAuth: false
    });
  }

};
