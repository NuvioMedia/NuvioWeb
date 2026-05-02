var STANDARD_HTTP_PORT = 2710;
var STANDARD_HTTPS_PORT = 3710;
var PORT_FALLBACK_COUNT = 5;

function buildPortCandidates(basePort, count) {
  var ports = [];
  for (var index = 0; index < count; index += 1) {
    ports.push(basePort + index);
  }
  return ports;
}

module.exports = {
  STANDARD_HTTP_PORT: STANDARD_HTTP_PORT,
  STANDARD_HTTPS_PORT: STANDARD_HTTPS_PORT,
  PORT_FALLBACK_COUNT: PORT_FALLBACK_COUNT,
  PORT_CANDIDATES: buildPortCandidates(STANDARD_HTTP_PORT, PORT_FALLBACK_COUNT)
};
