import { httpRequest } from "../../../core/network/httpClient.js";

export const SubtitleApi = {

  async getSubtitles(url) {
    return httpRequest(url, {
      includeSessionAuth: false
    });
  }

};
