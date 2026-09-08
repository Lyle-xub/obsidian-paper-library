"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");

const KIMI_EFFORT_ENV = "KIMI_MODEL_THINKING_EFFORT";
const KIMI_TO_COMPOSER_EFFORT = Object.freeze({ max: "xhigh" });
const COMPOSER_TO_KIMI_EFFORT = Object.freeze({ xhigh: "max" });
const REASONING_LABELS = Object.freeze({
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Max",
  max: "Max"
});

const PROVIDERS = {
  kimi: {
    id: "kimi",
    displayName: "Kimi",
    binary: "kimi",
    defaultArgs: ["-p", "{prompt}", "--output-format", "text"],
    knownPaths: [
      path.join(os.homedir(), ".kimi-code", "bin", "kimi"),
      path.join(os.homedir(), ".kimi", "bin", "kimi"),
      path.join(os.homedir(), ".local", "bin", "kimi"),
      path.join(os.homedir(), ".bun", "bin", "kimi"),
      path.join(os.homedir(), "Library", "pnpm", "kimi"),
      "/opt/homebrew/bin/kimi",
      "/usr/local/bin/kimi"
    ],
    configPaths: [
      ...(process.env.KIMI_CODE_HOME ? [path.join(process.env.KIMI_CODE_HOME, "config.toml")] : []),
      path.join(os.homedir(), ".kimi-code", "config.toml"),
      path.join(os.homedir(), ".config", "kimi", "config.toml")
    ],
    environmentKeyPatterns: [/^KIMI_/i]
  }
};

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function providerConfig(settings, id) {
  return objectValue(objectValue(settings?.providerConfigs)[id]);
}

function writeProviderConfig(settings, id, patch) {
  const configs = { ...objectValue(settings.providerConfigs) };
  configs[id] = { ...objectValue(configs[id]), ...patch };
  settings.providerConfigs = configs;
}

function splitPath(value) {
  return String(value || "").split(path.delimiter).map((item) => item.trim()).filter(Boolean);
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch (_) {
    return false;
  }
}

function resolveCliPath(settings, spec) {
  const configured = String(providerConfig(settings, spec.id).cliPath || "").trim();
  if (configured && isExecutable(configured)) return configured;
  const suffixes = process.platform === "win32"
    ? [".exe", ".cmd", ".bat", ""]
    : [""];
  const candidates = [
    ...spec.knownPaths,
    ...splitPath(process.env.PATH).flatMap((directory) => suffixes.map((suffix) => path.join(directory, `${spec.binary}${suffix}`)))
  ];
  return candidates.find(isExecutable) || configured || null;
}

function tomlString(value) {
  const match = String(value || "").trim().match(/^(?:"((?:\\.|[^"\\])*)"|'([^']*)')/s);
  if (!match) return "";
  if (match[1] === undefined) return match[2] || "";
  try { return JSON.parse('"' + match[1] + '"'); } catch (_) { return match[1]; }
}

function tomlStringArray(value) {
  const match = String(value || "").match(/\[([\s\S]*?)\]/);
  if (!match) return [];
  return Array.from(match[1].matchAll(/"((?:\\.|[^"\\])*)"|'([^']*)'/g), (item) => {
    if (item[1] === undefined) return item[2] || "";
    try { return JSON.parse('"' + item[1] + '"'); } catch (_) { return item[1]; }
  }).map((item) => item.trim()).filter(Boolean);
}

function modelField(block, field) {
  const pattern = new RegExp("^\\s*" + field + "\\s*=\\s*([^\\n]*(?:\\n(?!\\s*[A-Za-z_][A-Za-z0-9_]*\\s*=)[^\\n]*)*)", "m");
  return String(block || "").match(pattern)?.[1]?.trim() || "";
}

function parseKimiModelConfig(source) {
  const models = [];
  const modelDetails = {};
  const text = String(source || "");
  const headers = Array.from(text.matchAll(/^\s*\[([^\]\r\n]+)\]\s*$/gm));
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    const modelMatch = String(header[1] || "").match(/^models\.(?:"((?:\\.|[^"\\])*)"|'([^']*)')$/);
    if (!modelMatch) continue;
    const rawId = modelMatch[1] === undefined ? modelMatch[2] : modelMatch[1];
    const id = tomlString('"' + (rawId || "") + '"').trim();
    if (!id) continue;
    const start = header.index + header[0].length;
    const end = index + 1 < headers.length ? headers[index + 1].index : text.length;
    const block = text.slice(start, end);
    const supportEfforts = uniqueModelIds(tomlStringArray(modelField(block, "support_efforts")));
    const capabilities = uniqueModelIds(tomlStringArray(modelField(block, "capabilities")));
    const configuredDefault = tomlString(modelField(block, "default_effort"));
    const maxContextSize = Number.parseInt(modelField(block, "max_context_size"), 10);
    models.push(id);
    modelDetails[id] = Object.freeze({
      id,
      displayName: tomlString(modelField(block, "display_name")),
      supportEfforts,
      defaultEffort: supportEfforts.includes(configuredDefault) ? configuredDefault : "",
      capabilities,
      ...(Number.isFinite(maxContextSize) && maxContextSize > 0 ? { maxContextSize } : {})
    });
  }
  const defaultModel = tomlString(text.match(/^\s*default_model\s*=\s*([^\r\n]+)/m)?.[1]);
  return { models: uniqueModelIds(models), defaultModel, modelDetails };
}

function discoverCliModels(spec) {
  const models = [];
  const modelDetails = {};
  let defaultModel = "";
  let configPath = "";
  for (const candidate of spec.configPaths || []) {
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      const source = fs.readFileSync(candidate, "utf8");
      const parsed = parseKimiModelConfig(source);
      defaultModel = parsed.defaultModel;
      models.push(...parsed.models);
      Object.assign(modelDetails, parsed.modelDetails);
      configPath = candidate;
      break;
    } catch (_) { /* Try the next standard Kimi configuration path. */ }
  }
  if (defaultModel && !models.includes(defaultModel)) models.unshift(defaultModel);
  return { models: uniqueModelIds(models), defaultModel, configPath, modelDetails };
}

function cliModelLabel(value) {
  const raw = String(value || "").trim();
  const short = raw.includes("/") ? raw.slice(raw.lastIndexOf("/") + 1) : raw;
  return short
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => /^(k\d|\d)/i.test(part) ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function uniqueModelIds(values) {
  const result = [];
  const seen = new Set();
  for (const value of values || []) {
    const model = String(value || "").trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    result.push(model);
  }
  return result;
}

function configuredCliModels(settings, spec, catalog = discoverCliModels(spec)) {
  const config = providerConfig(settings, spec.id);
  const available = uniqueModelIds([
    ...(catalog.models || []),
    catalog.defaultModel,
    ...(Array.isArray(config.visibleModels) ? config.visibleModels : []),
    config.model
  ]);
  if (Array.isArray(config.visibleModels)) {
    const selected = uniqueModelIds(config.visibleModels);
    return selected.filter((model) => available.includes(model));
  }
  const legacyModel = String(config.model || "").trim();
  if (legacyModel) return [legacyModel];
  return uniqueModelIds(catalog.models?.length ? catalog.models : [catalog.defaultModel]);
}

function encodeCliModel(spec, rawModel) {
  const model = String(rawModel || "").trim();
  return model ? `${spec.id}:${model}` : "";
}

function decodeCliModel(spec, value) {
  const candidate = String(value || "").trim();
  const prefix = `${spec.id}:`;
  return candidate.startsWith(prefix) ? candidate.slice(prefix.length).trim() : "";
}

function toComposerEffort(value) {
  const effort = String(value || "").trim().toLowerCase();
  return KIMI_TO_COMPOSER_EFFORT[effort] || effort;
}

function toKimiEffort(value) {
  const effort = String(value || "").trim().toLowerCase();
  return COMPOSER_TO_KIMI_EFFORT[effort] || effort;
}

function getCliModelDetails(spec, candidate, catalog = discoverCliModels(spec)) {
  const rawModel = decodeCliModel(spec, candidate) || String(candidate || "").trim();
  return objectValue(catalog.modelDetails)[rawModel] || null;
}

function getCliReasoningOptions(spec, candidate, catalog = discoverCliModels(spec)) {
  const details = getCliModelDetails(spec, candidate, catalog);
  return uniqueModelIds(details?.supportEfforts).map((kimiEffort) => {
    const value = toComposerEffort(kimiEffort);
    return {
      value,
      label: REASONING_LABELS[value] || REASONING_LABELS[kimiEffort] || kimiEffort,
      description: `Kimi CLI thinking effort: ${kimiEffort}`
    };
  });
}

function getDefaultCliReasoningValue(spec, candidate, catalog = discoverCliModels(spec)) {
  const details = getCliModelDetails(spec, candidate, catalog);
  const supported = uniqueModelIds(details?.supportEfforts);
  if (!supported.length) return "";
  const selected = supported.includes(details.defaultEffort)
    ? details.defaultEffort
    : supported.includes("high") ? "high" : supported[Math.floor(supported.length / 2)];
  return toComposerEffort(selected);
}

function resolveCliThinkingEffort(spec, selectedModel, requestedEffort, catalog = discoverCliModels(spec)) {
  const details = getCliModelDetails(spec, selectedModel, catalog);
  const supported = uniqueModelIds(details?.supportEfforts);
  if (!supported.length) return "";
  const requested = toKimiEffort(requestedEffort);
  if (supported.includes(requested)) return requested;
  const fallback = toKimiEffort(getDefaultCliReasoningValue(spec, selectedModel, catalog));
  return supported.includes(fallback) ? fallback : "";
}

function probeCliVersion(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["--version"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch (_) {}
      if (!settled) settled = true, reject(new Error("CLI detection timed out"));
    }, 8000);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output.trim().split(/\r?\n/)[0] || "");
    };
    child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.once("error", finish);
    child.once("close", (code) => finish(code === 0 ? null : new Error(output.trim() || `CLI exited with code ${code}`)));
  });
}

function parseEnvironment(text) {
  const result = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const normalized = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
    const separator = normalized.indexOf("=");
    if (separator <= 0) continue;
    const key = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}

function parseArgsTemplate(value, fallback) {
  const source = String(value || "").trim();
  if (!source) return [...fallback];
  const args = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = "";
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) args.push(current), current = "";
    } else {
      current += character;
    }
  }
  if (current) args.push(current);
  return args.length ? args : [...fallback];
}

function normalizeContent(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (typeof value.content === "string") return value.content;
  if (typeof value.text === "string") return value.text;
  return "";
}

function buildPrompt(request, imagePaths = []) {
  const sections = [];
  const instructions = request.configuration?.systemInstructions;
  if (instructions?.kind === "explicit" && String(instructions.instructions || "").trim()) {
    sections.push(`System instructions:\n${String(instructions.instructions).trim()}`);
  } else if (Array.isArray(instructions?.dynamicSections)) {
    const dynamic = instructions.dynamicSections.map((item) => String(item || "").trim()).filter(Boolean);
    if (dynamic.length) sections.push(`System instructions:\n${dynamic.join("\n\n")}`);
  }
  const history = Array.isArray(request.conversationHistory) ? request.conversationHistory : [];
  if (history.length) {
    const transcript = history.map((message) => {
      const role = message?.role === "assistant" ? "Assistant" : "User";
      return `${role}: ${normalizeContent(message)}`;
    }).filter((line) => !line.endsWith(": "));
    if (transcript.length) sections.push(`Conversation history:\n${transcript.join("\n\n")}`);
  }
  const context = objectValue(request.context);
  if (context.linkedContent) {
    const linked = objectValue(context.linkedContent);
    sections.push(`Linked content (${linked.path || "document"}):\n${linked.content || "Use the linked file path above as context."}`);
  }
  for (const key of ["editorSelection", "browserSelection", "canvasSelection"]) {
    const selection = context[key];
    if (!selection) continue;
    const value = normalizeContent(selection) || JSON.stringify(selection);
    if (value) sections.push(`${key}:\n${value}`);
  }
  const inputText = (Array.isArray(request.input) ? request.input : [])
    .filter((item) => item?.type === "text")
    .map((item) => String(item.text || ""))
    .filter(Boolean)
    .join("\n");
  if (inputText) sections.push(inputText);
  if (imagePaths.length) {
    sections.push(`Attached images (read these local files before answering):\n${imagePaths.join("\n")}`);
  }
  return sections.join("\n\n").trim();
}

function imageExtension(mediaType) {
  return ({
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
    "image/gif": "gif", "image/webp": "webp"
  })[String(mediaType || "").toLowerCase()] || "png";
}

function materializeImages(request, sessionInstanceId) {
  const images = (Array.isArray(request.input) ? request.input : [])
    .filter((item) => item?.type === "image" && item.image?.data);
  if (!images.length) return { paths: [], cleanup: () => {} };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `paper-composer-${sessionInstanceId.slice(0, 8)}-`));
  const paths = images.map((item, index) => {
    const image = item.image;
    const filePath = path.join(directory, `image-${index + 1}.${imageExtension(image.mediaType)}`);
    fs.writeFileSync(filePath, Buffer.from(String(image.data), "base64"));
    return filePath;
  });
  return {
    paths,
    cleanup: () => {
      try { fs.rmSync(directory, { recursive: true, force: true }); } catch (_) {}
    }
  };
}

class AsyncEventQueue {
  constructor(onReturn) {
    this.onReturn = onReturn;
    this.values = [];
    this.waiters = [];
    this.closed = false;
  }
  [Symbol.asyncIterator]() { return this; }
  next() {
    if (this.values.length) return Promise.resolve({ done: false, value: this.values.shift() });
    if (this.closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  return() {
    if (!this.closed) this.onReturn?.();
    return Promise.resolve({ done: true, value: undefined });
  }
  push(value) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
  }
}

class CliRun {
  constructor(session) {
    this.session = session;
    this.executionId = crypto.randomUUID();
    this.turnId = crypto.randomUUID();
    this.sequence = 0;
    this.terminal = false;
    this.events = new AsyncEventQueue(() => this.cancel());
  }
  scope() {
    return {
      kind: "requested",
      sessionInstanceId: this.session.sessionInstanceId,
      executionId: this.executionId,
      turnId: this.turnId,
      sequence: ++this.sequence
    };
  }
  emit(event) {
    if (!this.terminal) this.events.push({ ...event, scope: this.scope() });
  }
  finish(event) {
    if (this.terminal) return;
    this.terminal = true;
    this.events.push({ ...event, scope: this.scope() });
    this.events.close();
  }
  cancel() { this.session.cancelRun(this); }
}

class CliSession {
  constructor(plugin, config, spec) {
    this.plugin = plugin;
    this.config = config;
    this.spec = spec;
    this.providerId = spec.id;
    this.sessionInstanceId = crypto.randomUUID();
    this.activeRun = null;
    this.child = null;
    this.listeners = new Set();
    this.disposed = false;
    this.revision = 0;
    this.snapshot = this.makeSnapshot("idle");
  }
  makeSnapshot(status, invalidation) {
    const base = { providerId: this.providerId, revision: this.revision++, status };
    return Object.freeze(invalidation ? { ...base, invalidation: Object.freeze(invalidation) } : base);
  }
  execute(request) {
    if (this.disposed) throw new Error(`${this.spec.displayName} CLI session is disposed`);
    if (this.activeRun) throw new Error(`${this.spec.displayName} CLI is already responding`);
    const run = new CliRun(this);
    this.activeRun = run;
    const abort = () => run.cancel();
    request.signal?.addEventListener?.("abort", abort, { once: true });
    void this.start(run, request).finally(() => request.signal?.removeEventListener?.("abort", abort));
    return run;
  }
  async start(run, request) {
    const config = providerConfig(this.plugin.settings, this.providerId);
    const command = resolveCliPath(this.plugin.settings, this.spec) || String(config.cliPath || "").trim() || this.spec.binary;
    let imageFiles = { paths: [], cleanup: () => {} };
    try {
      imageFiles = materializeImages(request, this.sessionInstanceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.snapshot = this.makeSnapshot("invalidated", { reason: "attachment-error", recoverable: true, message });
      run.finish({ type: "execution_error", category: "provider", recoverable: true, message });
      if (this.activeRun === run) this.activeRun = null;
      return;
    }
    const prompt = buildPrompt(request, imageFiles.paths);
    const args = parseArgsTemplate(config.argsTemplate, this.spec.defaultArgs)
      .map((value) => value.replaceAll("{prompt}", prompt));
    const catalog = discoverCliModels(this.spec);
    const requestedModel = decodeCliModel(this.spec, request.configuration?.model);
    const selectedModel = requestedModel || configuredCliModels(this.plugin.settings, this.spec, catalog)[0]
      || String(config.model || "").trim();
    if (selectedModel && !args.some((value) => value === "-m" || value === "--model" || value.startsWith("--model="))) {
      args.unshift("--model", selectedModel);
    }
    if (!args.some((value) => value.includes(prompt)) && !args.includes(prompt)) args.push(prompt);
    const cwd = this.config.vaultWorkingDirectory || process.cwd();
    const env = { ...process.env, ...parseEnvironment(config.environmentVariables) };
    const thinkingEffort = resolveCliThinkingEffort(
      this.spec,
      selectedModel,
      request.configuration?.reasoning,
      catalog
    );
    if (thinkingEffort) env[KIMI_EFFORT_ENV] = thinkingEffort;
    this.snapshot = this.makeSnapshot("executing");
    run.emit({ type: "turn_started", accepted: true });
    run.emit({ type: "user_message_started" });
    run.emit({ type: "assistant_message_started" });
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
        this.child = child;
        const stdoutDecoder = new StringDecoder("utf8");
        const stderrDecoder = new StringDecoder("utf8");
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          const text = stdoutDecoder.write(chunk).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
          if (text) run.emit({ type: "text_delta", text });
        });
        child.stderr.on("data", (chunk) => {
          stderr += stderrDecoder.write(chunk);
          if (stderr.length > 12000) stderr = stderr.slice(-12000);
        });
        child.once("error", reject);
        child.once("close", (code, signal) => {
          const tail = stdoutDecoder.end().replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
          if (tail) run.emit({ type: "text_delta", text: tail });
          stderr += stderrDecoder.end();
          if (run.terminal) return resolve();
          if (code === 0) return resolve();
          const detail = stderr.trim().split(/\r?\n/).slice(-6).join("\n");
          reject(new Error(detail || `${this.spec.displayName} CLI exited with ${signal || `code ${code}`}`));
        });
      });
      if (!run.terminal) {
        this.snapshot = this.makeSnapshot("idle");
        run.finish({ type: "turn_completed", reason: "completed" });
      }
    } catch (error) {
      if (!run.terminal) {
        const message = error instanceof Error ? error.message : String(error);
        this.snapshot = this.makeSnapshot("invalidated", { reason: "provider-error", recoverable: true, message });
        run.finish({ type: "execution_error", category: "provider", recoverable: true, message });
      }
    } finally {
      imageFiles.cleanup();
      this.child = null;
      if (this.activeRun === run) this.activeRun = null;
    }
  }
  cancelRun(run) {
    if (this.activeRun !== run || run.terminal) return;
    try { this.child?.kill?.("SIGTERM"); } catch (_) {}
    this.snapshot = this.makeSnapshot("idle");
    run.finish({ type: "cancelled", reason: "cancelled" });
    this.activeRun = null;
  }
  cancel() { this.activeRun?.cancel(); }
  getSnapshot() { return this.snapshot; }
  getStatus() { return this.snapshot.status; }
  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async dispose() {
    this.disposed = true;
    this.activeRun?.cancel();
    this.listeners.clear();
    this.snapshot = this.makeSnapshot("disposed");
  }
}

class CliBackend {
  constructor(plugin, spec) {
    this.plugin = plugin;
    this.spec = spec;
    this.providerId = spec.id;
  }
  createSession(config) { return new CliSession(this.plugin, config, this.spec); }
}

function createChatUIConfig(spec) {
  const selectedReasoning = (candidate, settings) => {
    const options = getCliReasoningOptions(spec, candidate);
    if (!options.length) return "";
    const allowed = new Set(options.map((option) => option.value));
    const rawModel = decodeCliModel(spec, candidate);
    const preferred = objectValue(providerConfig(settings, spec.id).preferredReasoningByModel)[rawModel];
    return allowed.has(preferred) ? preferred : getDefaultCliReasoningValue(spec, candidate);
  };
  return {
    getModelOptions(settings) {
      const config = providerConfig(settings, spec.id);
      const aliases = objectValue(config.modelAliases);
      return configuredCliModels(settings, spec).map((model) => ({
        value: encodeCliModel(spec, model),
        label: String(aliases[model] || "").trim() || cliModelLabel(model),
        description: `${spec.displayName} Code CLI · ${model}`
      }));
    },
    getDefaultModel(settings) { return this.getModelOptions(settings)[0]?.value || null; },
    ownsModel(candidate, settings) {
      const raw = decodeCliModel(spec, candidate);
      return Boolean(raw && this.getModelOptions(settings).some((option) => option.value === candidate));
    },
    isAdaptiveReasoningModel(candidate) {
      return getCliReasoningOptions(spec, candidate).length > 0;
    },
    getReasoningOptions(candidate) {
      return getCliReasoningOptions(spec, candidate);
    },
    getDefaultReasoningValue(candidate, settings) {
      return selectedReasoning(candidate, settings);
    },
    getContextWindowSize(candidate) {
      return getCliModelDetails(spec, candidate)?.maxContextSize || 200000;
    },
    isDefaultModel(candidate, settings) { return candidate === this.getDefaultModel(settings); },
    applyModelDefaults(candidate, settings) {
      if (!decodeCliModel(spec, candidate) || !settings || typeof settings !== "object") return;
      settings.model = candidate;
      const effort = selectedReasoning(candidate, settings);
      if (effort) settings.effortLevel = effort;
      else delete settings.effortLevel;
    },
    applyModelProjectionDefaults(candidate, settings) {
      if (!settings || typeof settings !== "object") return;
      const effort = selectedReasoning(candidate, settings);
      if (effort) settings.effortLevel = effort;
      else delete settings.effortLevel;
    },
    applyReasoningSelection(candidate, effort, settings) {
      if (!settings || typeof settings !== "object") return;
      const rawModel = decodeCliModel(spec, candidate);
      if (!rawModel) return;
      const allowed = new Set(getCliReasoningOptions(spec, candidate).map((option) => option.value));
      const config = providerConfig(settings, spec.id);
      const preferredReasoningByModel = { ...objectValue(config.preferredReasoningByModel) };
      if (allowed.has(effort)) {
        preferredReasoningByModel[rawModel] = effort;
        settings.effortLevel = effort;
      } else {
        delete preferredReasoningByModel[rawModel];
        const fallback = getDefaultCliReasoningValue(spec, candidate);
        if (fallback) settings.effortLevel = fallback;
        else delete settings.effortLevel;
      }
      writeProviderConfig(settings, spec.id, { preferredReasoningByModel });
    },
    normalizeModelVariant: (candidate) => candidate,
    getCustomModelIds: () => new Set(),
    getModeSelector: () => null,
    getPermissionModeToggle: () => null,
    resolvePermissionMode: () => "normal",
    applyPermissionMode() {},
    getProviderIcon: () => null
  };
}

const CLI_TRANSCRIPT_STATE_KEY = "paperComposerTranscript";

function cloneConversationMessages(messages) {
  if (!Array.isArray(messages)) return [];
  try {
    return JSON.parse(JSON.stringify(messages));
  } catch (_) {
    // Composer messages are normally JSON values. If a future runtime adds a
    // non-serializable transient field, preserve the durable chat fields
    // instead of dropping the whole Kimi conversation.
    return messages.map((message) => ({
      id: message?.id,
      role: message?.role,
      content: String(message?.content || ""),
      displayContent: message?.displayContent,
      timestamp: message?.timestamp,
      images: Array.isArray(message?.images) ? message.images : undefined,
      toolCalls: Array.isArray(message?.toolCalls) ? message.toolCalls : undefined,
      contentBlocks: Array.isArray(message?.contentBlocks) ? message.contentBlocks : undefined,
      userMessageId: message?.userMessageId,
      assistantMessageId: message?.assistantMessageId,
      durationSeconds: message?.durationSeconds
    }));
  }
}

function createHistoryService() {
  return {
    hasConversationModelRecoverySource: () => false,
    recoverConversationModelSelection: async () => null,
    hydrateConversationHistory: (conversation) => {
      if (!conversation || conversation.messages?.length) return;
      const transcript = objectValue(conversation.providerState)[CLI_TRANSCRIPT_STATE_KEY];
      if (Array.isArray(transcript) && transcript.length) {
        conversation.messages = cloneConversationMessages(transcript);
      }
    },
    resolveMissingConversationSession: async () => "preserve",
    resolveSessionIdForConversation: () => null,
    isPendingForkConversation: () => false,
    buildForkProviderState: () => ({}),
    buildPersistedProviderState: (conversation) => {
      const providerState = { ...objectValue(conversation?.providerState) };
      const messages = cloneConversationMessages(conversation?.messages);
      if (messages.length) providerState[CLI_TRANSCRIPT_STATE_KEY] = messages;
      else if (!Array.isArray(providerState[CLI_TRANSCRIPT_STATE_KEY])) delete providerState[CLI_TRANSCRIPT_STATE_KEY];
      return Object.keys(providerState).length ? providerState : undefined;
    }
  };
}

function moveModel(models, model, targetIndex) {
  const current = models.indexOf(model);
  if (current < 0) return [...models];
  const next = [...models];
  next.splice(current, 1);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, model);
  return next;
}

function renderKimiModelPicker(container, { plugin, spec, catalog, config, update, render, Setting }) {
  new Setting(container).setName("Models").setHeading();
  new Setting(container)
    .setName("Visible models")
    .setDesc("Choose which models are available in the chat selector. Drag to reorder them; the first model is the default. Select at least one model to use this provider.")
    .settingEl.addClass("paper-composer-provider-model-picker-setting");

  const picker = container.createDiv({
    cls: "paper-composer-provider-model-picker paper-composer-provider-model-picker--kimi"
  });
  const summary = picker.createDiv({ cls: "paper-composer-provider-model-picker-summary" });
  const selectedContainer = picker.createDiv({ cls: "paper-composer-provider-model-picker-selected" });
  const catalogDetails = picker.createEl("details", { cls: "paper-composer-provider-model-picker-catalog" });
  catalogDetails.open = container.dataset.kimiCatalogOpen === "true"
    || configuredCliModels(plugin.settings, spec, catalog).length === 0;
  catalogDetails.addEventListener("toggle", () => {
    container.dataset.kimiCatalogOpen = String(catalogDetails.open);
  });
  const catalogSummary = catalogDetails.createEl("summary", {
    cls: "paper-composer-provider-model-picker-catalog-summary"
  });
  catalogSummary.createSpan({ cls: "paper-composer-provider-model-picker-catalog-caret", text: "▸" });
  catalogSummary.createSpan({ cls: "paper-composer-provider-model-picker-catalog-title", text: "Browse models" });
  const catalogCount = catalogSummary.createSpan({ cls: "paper-composer-provider-model-picker-catalog-count" });
  const controls = catalogDetails.createDiv({ cls: "paper-composer-provider-model-picker-controls" });
  const search = controls.createEl("input", {
    cls: "paper-composer-provider-model-picker-search",
    type: "search"
  });
  search.placeholder = "Filter by model name or ID...";
  const refresh = controls.createEl("button", {
    cls: "paper-composer-provider-model-picker-action",
    text: catalog.models.length ? "Refresh" : "Discover"
  });
  refresh.type = "button";
  refresh.addEventListener("click", () => render());
  const list = catalogDetails.createDiv({ cls: "paper-composer-provider-model-picker-list" });
  let draggedModel = "";

  const state = () => {
    const latestConfig = providerConfig(plugin.settings, spec.id);
    const selectedIds = configuredCliModels(plugin.settings, spec, catalog);
    const aliases = objectValue(latestConfig.modelAliases);
    const models = uniqueModelIds([
      ...(catalog.models || []),
      catalog.defaultModel,
      ...selectedIds,
      latestConfig.model
    ]);
    return { aliases, models, selectedIds };
  };
  const persistSelected = async (selectedIds) => {
    const normalized = uniqueModelIds(selectedIds);
    await update({ visibleModels: normalized, model: normalized[0] || "" });
    render();
  };
  const persistAliases = async (aliases) => update({ modelAliases: aliases });

  const renderSummary = () => {
    const current = state();
    summary.empty();
    summary.createSpan({ text: "Visible: " });
    summary.createSpan({ cls: "paper-composer-provider-model-picker-summary-value", text: String(current.selectedIds.length) });
    summary.createSpan({ text: ` of ${current.models.length} discovered` });
    catalogCount.setText(current.models.length ? `${current.models.length} available` : "No models discovered yet");
  };
  const renderSelected = () => {
    const current = state();
    selectedContainer.empty();
    selectedContainer.toggleClass("paper-composer-hidden", current.selectedIds.length === 0);
    if (!current.selectedIds.length) return;
    const header = selectedContainer.createDiv({ cls: "paper-composer-provider-model-picker-selected-header" });
    header.createSpan({
      cls: "paper-composer-provider-model-picker-selected-label",
      text: `Selected (${current.selectedIds.length})`
    });
    const clear = header.createEl("button", {
      cls: "paper-composer-provider-model-picker-selected-clear",
      text: "Clear all"
    });
    clear.type = "button";
    clear.setAttribute("aria-label", "Clear all selected Kimi models");
    clear.addEventListener("click", () => persistSelected([]));
    const rows = selectedContainer.createDiv({ cls: "paper-composer-provider-model-picker-selected-rows" });
    for (const model of current.selectedIds) {
      const row = rows.createDiv({ cls: "paper-composer-provider-model-picker-selected-row" });
      row.dataset.modelId = model;
      row.addEventListener("dragover", (event) => {
        if (!draggedModel || draggedModel === model) return;
        event.preventDefault();
        row.addClass("paper-composer-provider-model-picker-selected-row--drop-target");
      });
      row.addEventListener("dragleave", () => row.removeClass("paper-composer-provider-model-picker-selected-row--drop-target"));
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        row.removeClass("paper-composer-provider-model-picker-selected-row--drop-target");
        const source = draggedModel || event.dataTransfer?.getData("text/plain") || "";
        draggedModel = "";
        if (!source || source === model) return;
        persistSelected(moveModel(state().selectedIds, source, state().selectedIds.indexOf(model)));
      });
      const drag = row.createEl("button", {
        cls: "paper-composer-provider-model-picker-selected-drag",
        text: "⋮⋮"
      });
      drag.type = "button";
      drag.draggable = current.selectedIds.length > 1;
      drag.setAttribute("aria-label", `Reorder ${model}; drag or use the Up and Down Arrow keys`);
      drag.title = "Drag or use arrow keys to reorder";
      drag.addEventListener("dragstart", (event) => {
        draggedModel = model;
        row.addClass("paper-composer-provider-model-picker-selected-row--dragging");
        event.dataTransfer?.setData("text/plain", model);
      });
      drag.addEventListener("dragend", () => {
        draggedModel = "";
        row.removeClass("paper-composer-provider-model-picker-selected-row--dragging");
      });
      drag.addEventListener("keydown", (event) => {
        const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
        if (!step) return;
        event.preventDefault();
        const selected = state().selectedIds;
        const from = selected.indexOf(model);
        const target = from + step;
        if (from >= 0 && target >= 0 && target < selected.length) persistSelected(moveModel(selected, model, target));
      });
      const info = row.createDiv({ cls: "paper-composer-provider-model-picker-selected-info" });
      const title = info.createDiv({ cls: "paper-composer-provider-model-picker-selected-title" });
      title.createSpan({ cls: "paper-composer-provider-model-picker-selected-name", text: cliModelLabel(model) });
      if (model === current.selectedIds[0]) {
        title.createSpan({ cls: "paper-composer-provider-model-picker-selected-default", text: "Default" });
      }
      info.createDiv({ cls: "paper-composer-provider-model-picker-selected-id", text: model });
      const selectedControls = row.createDiv({ cls: "paper-composer-provider-model-picker-selected-controls" });
      const aliasField = selectedControls.createEl("label", {
        cls: "paper-composer-provider-model-picker-selected-alias-field"
      });
      aliasField.createSpan({ cls: "paper-composer-provider-model-picker-selected-alias-label", text: "Alias (optional)" });
      const alias = aliasField.createEl("input", {
        cls: "paper-composer-provider-model-picker-selected-alias",
        type: "text"
      });
      alias.placeholder = cliModelLabel(model);
      alias.value = String(current.aliases[model] || "");
      alias.setAttribute("aria-label", `Alias for ${model}`);
      const saveAlias = async () => {
        const next = { ...state().aliases };
        const value = alias.value.trim();
        if (value) next[model] = value;
        else delete next[model];
        await persistAliases(next);
      };
      alias.addEventListener("blur", saveAlias);
      alias.addEventListener("keydown", (event) => {
        if (event.key === "Enter") event.preventDefault(), alias.blur();
        if (event.key === "Escape") {
          event.preventDefault();
          alias.value = String(state().aliases[model] || "");
          alias.blur();
        }
      });
      const remove = selectedControls.createEl("button", {
        cls: "paper-composer-provider-model-picker-selected-remove",
        text: "×"
      });
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${model}`);
      remove.addEventListener("click", () => persistSelected(state().selectedIds.filter((item) => item !== model)));
    }
  };
  const renderCatalog = () => {
    const current = state();
    const selected = new Set(current.selectedIds);
    const query = search.value.trim().toLowerCase();
    list.empty();
    const matches = current.models.filter((model) => !query || `${model} ${cliModelLabel(model)}`.toLowerCase().includes(query));
    if (!matches.length) {
      list.createDiv({
        cls: "paper-composer-provider-model-picker-empty",
        text: current.models.length ? "No models match your filter." : "No Kimi models discovered. Check the CLI configuration and click Discover."
      });
      return;
    }
    for (const model of matches) {
      const row = list.createEl("label", { cls: "paper-composer-provider-model-picker-row" });
      row.title = model;
      row.toggleClass("paper-composer-provider-model-picker-row--selected", selected.has(model));
      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = selected.has(model);
      checkbox.addEventListener("change", () => {
        const latest = state().selectedIds;
        persistSelected(checkbox.checked ? [...latest, model] : latest.filter((item) => item !== model));
      });
      const text = row.createDiv({ cls: "paper-composer-provider-model-picker-row-text" });
      const heading = text.createDiv({ cls: "paper-composer-provider-model-picker-row-header" });
      heading.createSpan({ cls: "paper-composer-provider-model-picker-row-name", text: cliModelLabel(model) });
      if (model === catalog.defaultModel) {
        heading.createSpan({ cls: "paper-composer-provider-model-picker-row-badge", text: "Default" });
      }
      text.createDiv({ cls: "paper-composer-provider-model-picker-row-meta", text: model });
      text.createDiv({ cls: "paper-composer-provider-model-picker-row-desc", text: "Kimi Code CLI model" });
    }
  };
  search.addEventListener("input", renderCatalog);
  renderSummary();
  renderSelected();
  renderCatalog();
}

function renderProviderSettings(container, context, spec, obsidianComponents) {
  const plugin = context?.plugin;
  if (!container || !plugin) return;
  const { Notice, Setting } = obsidianComponents || {};
  if (typeof Setting !== "function" || typeof Notice !== "function") {
    throw new Error("Paper Composer did not provide the Obsidian settings components");
  }
  const render = () => {
    container.empty?.();
    if (!container.empty) container.replaceChildren();
    container.addClass?.("paperlib-kimi-provider-settings");
    const config = providerConfig(plugin.settings, spec.id);
    const resolvedPath = resolveCliPath(plugin.settings, spec);
    const catalog = discoverCliModels(spec);
    const update = async (patch, refresh = false) => {
      await plugin.mutateSettings((settings) => writeProviderConfig(settings, spec.id, patch));
      await plugin.notifyProviderChatOptionsChanged?.(spec.id);
      if (refresh) render();
    };

    new Setting(container).setName("Setup").setHeading();
    new Setting(container)
      .setName("Enable Kimi")
      .setDesc(resolvedPath
        ? `Make selected Kimi models available for new conversations. Detected ${resolvedPath}`
        : "Kimi Code CLI was not detected. Install it or provide a path below.")
      .addToggle((toggle) => toggle
        .setValue(config.enabled === true)
        .onChange(async (enabled) => update({ enabled }, true)));

    new Setting(container)
      .setName("Kimi CLI path")
      .setDesc("Custom path to the local Kimi CLI. Leave empty to prefer known Kimi installs, then PATH.")
      .addText((text) => text
        .setPlaceholder(path.join(os.homedir(), ".kimi-code", "bin", "kimi"))
        .setValue(String(config.cliPath || ""))
        .onChange(async (cliPath) => update({ cliPath: cliPath.trim() })));

    renderKimiModelPicker(container, { plugin, spec, catalog, config, update, render, Setting });

    new Setting(container).setName("Advanced").setHeading();
    new Setting(container)
      .setName("Startup arguments")
      .setDesc("{prompt} is replaced with the conversation. The active chat model is passed through --model.")
      .addText((text) => text
        .setPlaceholder(spec.defaultArgs.join(" "))
        .setValue(String(config.argsTemplate || ""))
        .onChange(async (argsTemplate) => update({ argsTemplate: argsTemplate.trim() })));

    new Setting(container)
      .setName("Environment variables")
      .setDesc("Optional KEY=VALUE entries, one per line. Kimi CLI continues to own its login token.")
      .addTextArea((area) => {
        area.inputEl.rows = 4;
        return area
          .setPlaceholder("KIMI_SETTING=value")
          .setValue(String(config.environmentVariables || ""))
          .onChange(async (environmentVariables) => update({ environmentVariables }));
      });
  };
  render();
}

function createRegistration(spec, taskResultInterpreter, obsidianComponents) {
  const chatUIConfig = createChatUIConfig(spec);
  return {
    id: spec.id,
    displayName: spec.displayName,
    blankTabOrder: 14,
    isEnabled: (settings) => providerConfig(settings, spec.id).enabled === true,
    setEnabled: (settings, enabled) => writeProviderConfig(settings, spec.id, { enabled: Boolean(enabled) }),
    capabilities: Object.freeze({
      providerId: spec.id,
      commandDiscoveryDeadline: "none",
      supportsNativeHistory: false,
      supportsPlanMode: false,
      supportsRewind: false,
      supportsFork: false,
      supportsProviderCommands: false,
      supportsImageAttachments: true,
      supportsInstructionMode: false,
      supportsTurnSteer: false,
      reasoningControl: "effort"
    }),
    environmentKeyPatterns: spec.environmentKeyPatterns,
    chatUIConfig,
    createExecutionBackend: (plugin) => new CliBackend(plugin, spec),
    resolveTitleGenerationModel: () => undefined,
    historyService: createHistoryService(),
    settingsReconciler: {
      handleEnvironmentChange: () => false,
      invalidateConversationSessions: () => [],
      reconcileModelWithEnvironment: () => ({ changed: false, invalidatedConversations: [] }),
      normalizeModelVariantSettings: () => false
    },
    settingsStorage: {
      hostScopedFields: [],
      normalizeStored: () => false
    },
    taskResultInterpreter,
    workspace: {
      initialize: async ({ plugin }) => ({
        cliResolver: { resolveFromSettings: (settings) => resolveCliPath(settings, spec) },
        settingsTabRenderer: {
          render: (container, context) => renderProviderSettings(container, context, spec, obsidianComponents)
        },
        dispose: async () => {}
      })
    }
  };
}

module.exports = function createPaperComposerCliProviders(options = {}) {
  return Object.values(PROVIDERS).map((spec) => createRegistration(
    spec,
    options.taskResultInterpreter,
    options.obsidianComponents
  ));
};

module.exports.PROVIDERS = PROVIDERS;
module.exports.providerConfig = providerConfig;
module.exports.resolveCliPath = resolveCliPath;
module.exports.parseKimiModelConfig = parseKimiModelConfig;
module.exports.discoverCliModels = discoverCliModels;
module.exports.configuredCliModels = configuredCliModels;
module.exports.encodeCliModel = encodeCliModel;
module.exports.decodeCliModel = decodeCliModel;
module.exports.getCliReasoningOptions = getCliReasoningOptions;
module.exports.getDefaultCliReasoningValue = getDefaultCliReasoningValue;
module.exports.resolveCliThinkingEffort = resolveCliThinkingEffort;
module.exports.createChatUIConfig = createChatUIConfig;
