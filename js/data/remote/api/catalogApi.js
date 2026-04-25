import { httpRequest } from "../../../core/network/httpClient.js";

export const CatalogApi = {

  async getCatalog(url) {
    return httpRequest(url, {
      includeSessionAuth: false
    });
  }

};
