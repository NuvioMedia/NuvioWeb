import { httpRequest } from "../../../core/network/httpClient.js";

export const StreamApi = {

  async getStreams(url) {
    return httpRequest(url, {
      includeSessionAuth: false
    });
  }

};
