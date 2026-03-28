const STANDARD_HTTP_PORT = 2710;
const STANDARD_HTTPS_PORT = 3710;
const PORT_FALLBACK_COUNT = 5;

function buildPortCandidates(basePort, count) {
  return Array.from({ length: count }, (_, index) => basePort + index);
}

module.exports = {
  STANDARD_HTTP_PORT,
  STANDARD_HTTPS_PORT,
  PORT_FALLBACK_COUNT,
  PORT_CANDIDATES: buildPortCandidates(STANDARD_HTTP_PORT, PORT_FALLBACK_COUNT)
};
