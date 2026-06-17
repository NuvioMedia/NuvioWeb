import { runAresCli } from "./aresCli.mjs";

const defaultAppId = "space.nuvio.webos";

function hasAppOrServiceArg(args) {
  return args.some((arg, index) => {
    if (arg === "-s" || arg === "--service" || arg === "-a" || arg === "--app") {
      return true;
    }
    const previous = args[index - 1] || "";
    return (
      !arg.startsWith("-") &&
      previous !== "-d" &&
      previous !== "--device" &&
      previous !== "-P" &&
      previous !== "--host-port"
    );
  });
}

async function main() {
  const args = process.argv.slice(2);
  const inspectArgs = hasAppOrServiceArg(args) ? args : [defaultAppId, ...args];

  await runAresCli("ares-inspect", inspectArgs);
}

try {
  await main();
} catch (error) {
  console.error("\nwebOS inspect failed:");
  console.error(error);
  process.exit(1);
}
