export const NetworkResult = {

  loading() {
    return { status: "loading" };
  },

  success(data) {
    return { status: "success", data };
  },

  error(message, code = null) {
    return {
      status: "error",
      message: message || "Unknown error",
      code
    };
  }

};
