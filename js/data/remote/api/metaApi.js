import { httpRequest } from "../../../core/network/httpClient.js";

export const MetaApi = {

  async getMeta(url) {
    return httpRequest(url, {
      includeSessionAuth: false
    });
  }

};
