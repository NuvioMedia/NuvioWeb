import { NetworkResult } from "./networkResult.js";

export async function safeApiCall(apiCall) {

  try {
    const response = await apiCall();

    return NetworkResult.success(response);

  } catch (error) {

    if (error instanceof Response) {
      return NetworkResult.error(
        error.statusText || "HTTP error",
        error.status
      );
    }

    return NetworkResult.error(
      error.message || "Unknown error occurred"
    );
  }
}