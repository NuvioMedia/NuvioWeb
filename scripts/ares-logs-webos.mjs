import { runAresCli } from "./aresCli.mjs";

const defaultPatterns = [
  "nuvio",
  "com.nuvio",
  "app.bundle",
  "WebAppMgr",
  "WAM",
  "JS"
];

function parseArgs(args) {
  const passthrough = [];
  let showAll = false;
  let enableDevLogs = false;
  let diagnose = false;

  for (const arg of args) {
    if (arg === "--all") {
      showAll = true;
      continue;
    }
    if (arg === "--enable-devlogs") {
      enableDevLogs = true;
      continue;
    }
    if (arg === "--diagnose") {
      diagnose = true;
      continue;
    }
    passthrough.push(arg);
  }

  return { passthrough, showAll, enableDevLogs, diagnose };
}

function shouldPrintLine(line) {
  const lowerLine = line.toLowerCase();
  return defaultPatterns.some((pattern) => lowerLine.includes(pattern.toLowerCase()));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

async function enableDeveloperLogs(passthroughArgs) {
  const command = [
    "luna-send -n 1 -f luna://com.webos.service.config/setConfigs '{\"configs\":{\"system.collectDevLogs\":true}}'",
    "luna-send -n 1 -f 'luna://com.webos.pmlogd/setdevlogstatus' '{\"recordDevLogs\":true}'",
    "PmLogCtl set WAM debug"
  ].join("; ");

  await runAresCli("ares-novacom", ["--run", command, ...passthroughArgs]);
}

async function streamLogs({ passthrough, showAll }) {
  const remoteScript = `
if command -v journalctl >/dev/null 2>&1; then
  echo "[logs:webos] streaming journalctl -f" >&2
  journalctl -n 300 -f
  exit $?
fi

if command -v logread >/dev/null 2>&1; then
  echo "[logs:webos] streaming logread -f" >&2
  logread -f
  exit $?
fi

files=""
for file in \\
  /var/log/messages \\
  /var/log/legacy-log \\
  /var/log/messages.0 \\
  /var/log/legacy-log.0 \\
  /tmp/messages \\
  /tmp/log/messages \\
  /media/developer/log/messages \\
  /media/developer/log/legacy-log
do
  if [ -r "$file" ]; then
    files="$files $file"
  fi
done

if [ -n "$files" ]; then
  echo "[logs:webos] streaming:$files" >&2
  tail -n 300 -f $files
  exit $?
fi

echo "[logs:webos] no readable log backend found"
echo "[logs:webos] /var/log:"
ls -la /var/log 2>&1
echo "[logs:webos] /tmp:"
ls -la /tmp 2>&1
exit 2
`;
  const command = `sh -c ${shellQuote(remoteScript)}`;
  const child = await runAresCli("ares-novacom", ["--run", command, ...passthrough], {
    pipeStdout: true,
    pipeStderr: true
  });
  let pending = "";

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";

    for (const line of lines) {
      if (showAll || shouldPrintLine(line)) {
        console.log(line);
      }
    }
  });
}

async function diagnoseLogs(passthrough) {
  const remoteScript = `
echo "[logs:webos] command availability:"
for command in journalctl logread tail PmLogCtl luna-send ls ps; do
  if command -v "$command" >/dev/null 2>&1; then
    echo "  $command: $(command -v "$command")"
  else
    echo "  $command: missing"
  fi
done

echo "[logs:webos] readable log candidates:"
for file in \\
  /var/log/messages \\
  /var/log/legacy-log \\
  /var/log/messages.0 \\
  /var/log/legacy-log.0 \\
  /tmp/messages \\
  /tmp/log/messages \\
  /media/developer/log/messages \\
  /media/developer/log/legacy-log
do
  if [ -e "$file" ]; then
    ls -l "$file"
  fi
done

echo "[logs:webos] /var/log:"
ls -la /var/log 2>&1
echo "[logs:webos] /tmp:"
ls -la /tmp 2>&1
echo "[logs:webos] process hints:"
ps -ef 2>/dev/null | grep -Ei 'nuvio|wam|webapp|com.webos.app' | grep -v grep
`;
  const command = `sh -c ${shellQuote(remoteScript)}`;
  await runAresCli("ares-novacom", ["--run", command, ...passthrough]);
}

async function main() {
  const { passthrough, showAll, enableDevLogs, diagnose } = parseArgs(process.argv.slice(2));

  if (enableDevLogs) {
    await enableDeveloperLogs(passthrough);
  }

  if (diagnose) {
    await diagnoseLogs(passthrough);
    return;
  }

  await streamLogs({ passthrough, showAll });
}

try {
  await main();
} catch (error) {
  console.error("\nwebOS log streaming failed:");
  console.error(error);
  process.exit(1);
}
