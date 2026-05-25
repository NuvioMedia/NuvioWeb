function findPlaceholderEnd(text, start) {
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && (index === 0 || text[index - 1] !== "\\")) {
        quote = null;
      }
    } else if (char === "'" || char === "\"") {
      quote = char;
    } else if (char === "}") {
      return index;
    }
  }
  return -1;
}

function findTopLevelChar(text, target) {
  let quote = null;
  let parenDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && (index === 0 || text[index - 1] !== "\\")) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (char === target && parenDepth === 0) {
      return index;
    }
  }
  return -1;
}

function splitOps(text) {
  const tokens = [];
  let quote = null;
  let parenDepth = 0;
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (quote) {
      if (char === quote && text[index - 1] !== "\\") {
        quote = null;
      }
      index += 1;
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (char === ":" && text[index + 1] === ":" && parenDepth === 0) {
      tokens.push(text.slice(start, index).trim());
      index += 2;
      start = index;
      continue;
    }
    index += 1;
  }
  tokens.push(text.slice(start).trim());
  return tokens.filter(Boolean);
}

function findBranchSeparator(text) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && text[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
    } else if (char === "|" && text[index + 1] === "|") {
      return index;
    }
  }
  return -1;
}

function parseQuoted(raw) {
  const trimmed = String(raw || "").trim();
  const isQuoted = trimmed.length >= 2
    && ((trimmed[0] === "\"" && trimmed[trimmed.length - 1] === "\"")
      || (trimmed[0] === "'" && trimmed[trimmed.length - 1] === "'"));
  const unquoted = isQuoted ? trimmed.slice(1, -1) : trimmed;
  return unquoted
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}

function parseBranches(text) {
  const split = findBranchSeparator(text);
  if (split < 0) {
    return [parseQuoted(text), ""];
  }
  return [parseQuoted(text.slice(0, split)), parseQuoted(text.slice(split + 2))];
}

function parseArgs(op) {
  const start = op.indexOf("(");
  const end = op.lastIndexOf(")");
  if (start < 0 || end <= start) {
    return [];
  }
  const body = op.slice(start + 1, end);
  const args = [];
  let quote = null;
  let argStart = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === quote && body[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
    } else if (char === ",") {
      args.push(parseQuoted(body.slice(argStart, index)));
      argStart = index + 1;
    }
  }
  args.push(parseQuoted(body.slice(argStart)));
  return args;
}

function isFieldPath(value) {
  return value.startsWith("stream.") || value.startsWith("service.") || value.startsWith("addon.");
}

function exists(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function isTruthy(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return exists(value);
}

function asBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return null;
}

function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function valueToText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value.map((entry) => valueToText(entry)).filter((entry) => entry.trim()).join(", ");
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(Math.trunc(value)) : String(value);
  }
  return String(value);
}

function compareNumber(value, rawTarget, compare) {
  const left = asNumber(value);
  const right = Number(String(rawTarget || "").trim());
  return left != null && Number.isFinite(right) ? compare(left, right) : false;
}

function equalsText(value, target) {
  const normalized = String(target || "").trim().toLowerCase();
  if (Array.isArray(value)) {
    return value.some((entry) => valueToText(entry).trim().toLowerCase() === normalized);
  }
  return valueToText(value).trim().toLowerCase() === normalized;
}

function containsText(value, target) {
  const normalized = String(target || "").trim().toLowerCase();
  if (Array.isArray(value)) {
    return value.some((entry) => valueToText(entry).toLowerCase().includes(normalized));
  }
  return valueToText(value).toLowerCase().includes(normalized);
}

function titleCased(value) {
  return valueToText(value).split(/\s+/).map((word) => {
    if (!word) return word;
    const lowered = word.toLowerCase();
    return lowered.charAt(0).toUpperCase() + lowered.slice(1);
  }).join(" ");
}

function formatBytes(value) {
  const source = Number(value || 0);
  const bytes = Math.abs(source);
  if (bytes < 1024) return `${Math.trunc(source)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let current = bytes;
  let unitIndex = -1;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  const signed = source < 0 ? -current : current;
  return Number.isInteger(signed) ? `${Math.trunc(signed)} ${units[unitIndex]}` : `${signed.toFixed(1)} ${units[unitIndex]}`;
}

function formatTime(value) {
  const seconds = Math.trunc(Number(value || 0));
  const hours = Math.trunc(seconds / 3600);
  const minutes = Math.trunc((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function applyTransform(value, op) {
  if (op === "title") return titleCased(value);
  if (op === "lower") return valueToText(value).toLowerCase();
  if (op === "upper") return valueToText(value).toUpperCase();
  if (op === "bytes") return asNumber(value) == null ? "" : formatBytes(asNumber(value));
  if (op === "time") return asNumber(value) == null ? "" : formatTime(asNumber(value));
  if (op.startsWith("join(")) {
    const separator = parseArgs(op)[0] ?? ", ";
    return Array.isArray(value)
      ? value.map((entry) => valueToText(entry)).filter((entry) => entry.trim()).join(separator)
      : valueToText(value);
  }
  if (op.startsWith("replace(")) {
    const args = parseArgs(op);
    return args.length < 2 ? valueToText(value) : valueToText(value).split(args[0]).join(args[1]);
  }
  return value;
}

function evaluateSingleCondition(value, ops) {
  if (!ops.length) return isTruthy(value);
  let result = false;
  let hasResult = false;
  ops.forEach((op) => {
    if (op === "exists") {
      result = exists(value);
      hasResult = true;
    } else if (op === "istrue") {
      result = hasResult ? result : asBoolean(value) === true;
      hasResult = true;
    } else if (op === "isfalse") {
      result = hasResult ? !result : asBoolean(value) === false;
      hasResult = true;
    } else if (op.startsWith("~=")) {
      result = containsText(value, op.slice(2).trim());
      hasResult = true;
    } else if (op.startsWith("~")) {
      result = containsText(value, op.slice(1).trim());
      hasResult = true;
    } else if (op.startsWith("=")) {
      result = equalsText(value, op.slice(1).trim());
      hasResult = true;
    } else if (op.startsWith(">=")) {
      result = compareNumber(value, op.slice(2), (left, right) => left >= right);
      hasResult = true;
    } else if (op.startsWith("<=")) {
      result = compareNumber(value, op.slice(2), (left, right) => left <= right);
      hasResult = true;
    } else if (op.startsWith(">")) {
      result = compareNumber(value, op.slice(1), (left, right) => left > right);
      hasResult = true;
    } else if (op.startsWith("<")) {
      result = compareNumber(value, op.slice(1), (left, right) => left < right);
      hasResult = true;
    }
  });
  return result;
}

function evaluateCondition(expression, values) {
  const tokens = splitOps(expression).filter(Boolean);
  if (!tokens.length) return false;
  const groups = [];
  let currentGroup = [];
  let index = 0;
  while (index < tokens.length) {
    if (tokens[index] === "or") {
      groups.push(currentGroup);
      currentGroup = [];
      index += 1;
    } else if (tokens[index] === "and") {
      index += 1;
    } else {
      const field = tokens[index];
      index += 1;
      const ops = [];
      while (index < tokens.length && tokens[index] !== "and" && tokens[index] !== "or" && !isFieldPath(tokens[index])) {
        ops.push(tokens[index]);
        index += 1;
      }
      currentGroup.push(evaluateSingleCondition(values[field], ops));
    }
  }
  groups.push(currentGroup);
  return groups.some((group) => group.length > 0 && group.every(Boolean));
}

function renderExpression(expression, values) {
  const bracket = findTopLevelChar(expression, "[");
  if (bracket >= 0 && expression.endsWith("]")) {
    const condition = expression.slice(0, bracket);
    const branches = parseBranches(expression.slice(bracket + 1, -1));
    return DebridStreamTemplateEngine.render(evaluateCondition(condition, values) ? branches[0] : branches[1], values);
  }
  const tokens = splitOps(expression);
  if (!tokens.length) return "";
  let value = values[tokens[0]];
  tokens.slice(1).forEach((op) => {
    value = applyTransform(value, op);
  });
  return valueToText(value);
}

export const DebridStreamTemplateEngine = {
  render(template = "", values = {}) {
    if (!template) return "";
    let output = "";
    let index = 0;
    while (index < template.length) {
      const start = template.indexOf("{", index);
      if (start < 0) {
        output += template.slice(index);
        break;
      }
      output += template.slice(index, start);
      const end = findPlaceholderEnd(template, start + 1);
      if (end < 0) {
        output += template.slice(start);
        break;
      }
      output += renderExpression(template.slice(start + 1, end), values);
      index = end + 1;
    }
    return output;
  }
};
