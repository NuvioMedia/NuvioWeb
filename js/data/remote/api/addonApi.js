import { httpRequest } from "../../../core/network/httpClient.js";

export const AddonApi = {
  async getManifest(url) {
    return httpRequest(url, {
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
