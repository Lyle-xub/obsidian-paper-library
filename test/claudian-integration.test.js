const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const bundle = fs.readFileSync(path.join(root, "vendor", "claudian.bundle.js"), "utf8");
const cliProviders = fs.readFileSync(path.join(root, "vendor", "paper-composer-cli-providers.cjs"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const runtimeStyles = fs.readFileSync(path.join(root, "vendor", "claudian.css"), "utf8");
const cliProviderFactory = require(path.join(root, "vendor", "paper-composer-cli-providers.cjs"));
const kimiRegistration = cliProviderFactory().find((provider) => provider.id === "kimi");
const kimiSettings = {
  providerConfigs: {
    kimi: {
      enabled: true,
      visibleModels: ["kimi-code/kimi-for-coding", "kimi-code/k3"],
      modelAliases: { "kimi-code/k3": "K3 Research" }
    }
  }
};
assert.deepEqual(
  kimiRegistration.chatUIConfig.getModelOptions(kimiSettings).map(({ value, label }) => ({ value, label })),
  [
    { value: "kimi:kimi-code/kimi-for-coding", label: "Kimi For Coding" },
    { value: "kimi:kimi-code/k3", label: "K3 Research" }
  ],
  "Kimi must publish every selected model, in order, with aliases"
);
assert.equal(
  kimiRegistration.chatUIConfig.getDefaultModel(kimiSettings),
  "kimi:kimi-code/kimi-for-coding",
  "the first selected Kimi model must be the provider default"
);
const kimiCatalogFixture = cliProviderFactory.parseKimiModelConfig(`
default_model = "kimi-code/k3"

[models."kimi-code/k3"]
max_context_size = 1048576
capabilities = [ "thinking", "always_thinking", "image_in" ]
display_name = "K3"
support_efforts = [ "low", "high", "max" ]
default_effort = "high"

[models."kimi-code/legacy"]
capabilities = [ "thinking", "always_thinking" ]
`);
assert.deepEqual(kimiCatalogFixture.modelDetails["kimi-code/k3"].supportEfforts, ["low", "high", "max"], "Kimi model effort levels must come from the local CLI config");
assert.equal(kimiCatalogFixture.modelDetails["kimi-code/k3"].defaultEffort, "high", "Kimi model default effort must come from the local CLI config");
assert.deepEqual(
  cliProviderFactory.getCliReasoningOptions(cliProviderFactory.PROVIDERS.kimi, "kimi:kimi-code/k3", kimiCatalogFixture).map(({ value, label }) => ({ value, label })),
  [{ value: "low", label: "Low" }, { value: "high", label: "High" }, { value: "xhigh", label: "Max" }],
  "K3 efforts must project into the Composer reasoning selector while preserving the CLI max level"
);
assert.equal(
  cliProviderFactory.resolveCliThinkingEffort(cliProviderFactory.PROVIDERS.kimi, "kimi-code/k3", "xhigh", kimiCatalogFixture),
  "max",
  "the Composer maximum level must reach Kimi CLI as its native max effort"
);
assert.equal(kimiRegistration.capabilities.reasoningControl, "effort", "Kimi models with effort metadata must expose the Composer reasoning control");
const kimiStoredConversation = {
  providerState: { retainedSetting: true },
  messages: [
    { id: "user-1", role: "user", content: "分析图片", timestamp: 1, images: [{ id: "image-1", name: "figure.png", mediaType: "image/png", data: "AA==" }] },
    { id: "assistant-1", role: "assistant", content: "结论", timestamp: 2 }
  ]
};
const kimiPersistedState = kimiRegistration.historyService.buildPersistedProviderState(kimiStoredConversation);
const kimiRestoredConversation = { providerState: kimiPersistedState, messages: [] };
kimiRegistration.historyService.hydrateConversationHistory(kimiRestoredConversation);
assert.deepEqual(kimiRestoredConversation.messages, kimiStoredConversation.messages, "Kimi conversation messages and image cards must survive a plugin restart");
assert.notEqual(kimiRestoredConversation.messages, kimiStoredConversation.messages, "restored Kimi messages must not reuse mutable live state");
assert.equal(kimiPersistedState.retainedSetting, true, "Kimi transcript persistence must preserve unrelated provider state");

assert.ok(bundle.includes("paperlib-paper-composer-view"), "embedded view type must be isolated");
assert.ok(bundle.includes("paperlib-paper-composer-collab-detail"), "collaboration view type must be isolated");
assert.ok(bundle.includes(".paperlib-claudian"), "runtime storage must be isolated");
assert.ok(bundle.includes("paperlib.claudian.deviceSettingsKey"), "device settings key must be isolated");
assert.ok(bundle.includes('getIcon(){return"paper-composer"}'), "embedded view must use the Paper Composer icon");
assert.ok(!runtimeStyles.includes(".claudian-"), "embedded runtime CSS classes must remain isolated from other plugins");
assert.ok(!runtimeStyles.includes("--claudian-"), "embedded runtime CSS variables must remain isolated from other plugins");

assert.ok(main.includes("loadEmbeddedClaudian"), "parent plugin must load the embedded runtime");
assert.ok(main.includes('id: "paper-library-paper-composer-runtime"'), "embedded runtime must use an independent plugin id");
assert.ok(main.includes('name: "Paper Composer"'), "embedded runtime must use the Paper Composer identity");
assert.ok(main.includes('.replace(/\\bClaudian\\b/g, "Paper Composer")'), "all remaining visible upstream labels must be normalized at load time");
assert.ok(main.includes('displayName:"ChatGPT"'), "the direct OpenAI-account provider must be presented as ChatGPT");
assert.ok(main.includes('PAPER_COMPOSER_CHATGPT_FALLBACK_MODEL = "gpt-5.4"'), "ChatGPT must have a durable catalog fallback");
assert.ok(main.includes('PAPER_COMPOSER_CHATGPT_BUNDLED_CODEX_PATH = "/Applications/ChatGPT.app/Contents/Resources/codex"'), "ChatGPT must prefer its current bundled Codex CLI when no path was configured");
assert.ok(main.includes('codex.catalogFingerprint = ""'), "switching to the bundled Codex CLI must invalidate the stale five-model catalog");
assert.ok(main.includes('String(alias || "").trim() === "ChatGPT"'), "the generated ChatGPT model alias must be migrated away");
assert.ok(!main.includes('[chatGptRuntimeModel]: codex.modelAliases?.[chatGptRuntimeModel] || "ChatGPT"'), "GPT-5.6 must keep its catalog model name by default");
assert.ok(main.includes('PAPER_COMPOSER_CLI_PROVIDERS = new Set(["kimi"])'), "Kimi must be an independent CLI provider");
assert.ok(main.includes('previousOptionsVersion < 1 || !settings.settingsProvider'), "new Composer conversations must default to ChatGPT without overriding an existing provider choice");
assert.ok(main.includes('settings.lastSelectedChatModel = { providerId: "codex", model: chatGptSelection }'), "the ChatGPT default must reach new conversations");
assert.ok(main.includes('paperComposerModelOptionsVersion: 0'), "model defaults must use an explicit one-time migration marker");
assert.ok(main.includes("activateIsolatedPaperComposerView"), "Paper Composer activation must own a dedicated view leaf");
const composerActivation = main.slice(main.indexOf("async activateIsolatedPaperComposerView"), main.indexOf("async addFileToPaperComposer"));
assert.ok(composerActivation.includes("workspace.getRightLeaf?.(false)"), "Paper Composer must open as a tab in the existing right-sidebar group");
assert.ok(!composerActivation.includes("workspace.getRightLeaf?.(true)"), "Paper Composer must not create a bottom split in the right sidebar");
assert.ok(main.includes("installPaperComposerWorkspaceBridge"), "Paper Composer must own its Markdown-link lifecycle");
assert.ok(main.includes("syncPaperComposerLinkedMarkdown"), "Markdown file opens must be routed to Paper Composer independently");
assert.ok(main.includes("syncPaperComposerLinkedPdf"), "document file opens must update Paper Composer attachments");
assert.ok(main.includes('key: `vault:${path}`'), "linked document files must keep a reusable document context");
const linkedPdfSyncStart = main.indexOf("async syncPaperComposerLinkedPdf");
const linkedPdfRelationStart = main.indexOf('  syncComposerPdfLinkedContent(tab, pdfPath = "") {');
const linkedPdfSync = main.slice(linkedPdfSyncStart, linkedPdfRelationStart);
const linkedPdfRelation = main.slice(linkedPdfRelationStart, main.indexOf("  replaceComposerWorkspaceLinkedPdf(tab, descriptor", linkedPdfRelationStart));
const linkedMarkdownSync = main.slice(main.indexOf("async syncPaperComposerLinkedMarkdown"), main.indexOf("async openSmartComposer"));
assert.ok(!linkedPdfSync.includes("ensureComposerTabForDocumentSources"), "clicking a document file must stay in the active conversation");
assert.ok(linkedPdfSync.includes("syncComposerPdfLinkedContent(tab, path)"), "clicking a document file must retain the native Linked content relationship");
assert.ok(linkedPdfRelation.includes("controller.selectExplicit(path)"), "PDF Linked content must persist through the native controller");
assert.ok(!linkedPdfRelation.includes("controller.selectExplicit(null)"), "attaching a PDF must not clear its Linked content relationship");
assert.ok(!linkedMarkdownSync.includes("createNewTab") && !linkedMarkdownSync.includes("openNewTab"), "clicking Markdown must stay in the active conversation");
assert.ok(linkedMarkdownSync.includes("controller.selectExplicit(path)"), "Markdown file actions must render the native linked-content chip");
assert.ok(main.includes("reconcileComposerLinkedPdfState"), "restored and removed PDF links must synchronize their backing context");
assert.ok(main.includes("!pending.includes(item) || item.workspaceLinked"), "workspace-linked PDF context must remain available after each turn");
assert.ok(main.includes("visibleAttachments = state.attachments.filter((attachment) => !attachment.workspaceLinked)"), "native PDF Linked content must be the only visible input card");
assert.ok(main.includes('status.className = "paperlib-linked-pdf-status"'), "linked PDF parsing must render detailed progress inside the native card");
assert.ok(main.includes('`${progress.stage || "本地解析"} · ${percent}%${eta}`'), "linked PDF progress must show its stage, percentage, and ETA");
assert.ok(main.includes("${processedPages}/${totalPages} 页 · ${characterCount} 字符"), "completed linked PDF parsing must retain concrete page and character counts");
assert.ok(main.includes("clearComposerWorkspaceLinkedPdf"), "switching linked files must remove the previous automatic document card");
assert.ok(main.includes("tab.ui?.linkedContentController"), "Paper Composer must update only its own linked-content controller");
assert.ok(main.includes('.replace(/\\bClaudian\\b/g, "Paper Composer")'), "embedded file menus must inherit the Paper Composer identity");
assert.ok(main.includes("paperLibraryAddFileToActiveChat"), "the Paper Composer file action must use its own attachment router");
assert.ok(main.includes("element.paperLibraryAttachment === attachment"), "progress updates must reuse the existing document card");
assert.ok(!main.includes("strip.replaceChildren()"), "progress updates must not recreate and reanimate every document card");
assert.ok(bundle.includes('setTitle("Add to Claudian")'), "the vendored upstream action must remain intact before runtime isolation");
assert.ok(main.includes("registerPaperComposerIcon"), "Paper Composer must register its own icon");
assert.ok(main.includes('transform="scale(4.1666667)"'), "the custom 24px artwork must fill Obsidian's 100-unit icon viewBox");
assert.ok(main.includes("refreshPaperComposerLeafIcon"), "restored Composer leaves must refresh their custom icon");
assert.ok(main.includes('"paper-composer": ["sparkles", "file-text"]'), "the custom icon must have a visible fallback");
assert.ok(main.includes("LEGACY_CLAUDIAN_VIEW_TYPES.forEach"), "upgrades must detach legacy embedded view leaves");
assert.ok(main.includes("runtime.addSettingTab = (settingTab)"), "embedded runtime must not register a second Obsidian settings entry");
assert.ok(main.includes("removeLegacyComposerSettingTabs"), "upgrades must remove the former standalone settings entry without requiring an app restart");
assert.ok(main.includes("this.claudianSettingTab = settingTab"), "parent plugin must capture the complete embedded settings renderer");
assert.ok(main.includes("paperlib-composer-embedded-settings"), "complete Composer settings must live inside Paper Library settings");
assert.ok(main.includes("normalizeEmbeddedComposerSurface"), "embedded settings must present Paper Composer as a Paper Library feature");
assert.ok(main.includes("syncRefreshedComposerModels"), "a forced ChatGPT catalog refresh must update the visible chat models");
assert.ok(main.includes("config.visibleModels = models"), "newly detected ChatGPT models must become selectable immediately after refresh");
assert.ok(main.includes("this.app.setting?.openTabById?.(this.manifest.id)"), "Composer settings commands must open the Paper Library tab");
assert.ok(!main.includes('openTabById?.("paper-library-claudian-runtime")'), "no standalone runtime settings tab may remain");
assert.ok(main.includes('getDesktopPluginPath("vendor/claudian.bundle.js")'), "runtime must resolve from an absolute plugin path in Electron");
assert.ok(main.includes('const compile = new Function(') && main.includes('"paperComposerObsidianComponents", source'), "runtime must inject Obsidian UI components into nested providers");
assert.ok(main.includes("paperComposerCliProviders({taskResultInterpreter:Q6e,obsidianComponents:paperComposerObsidianComponents})"), "the isolated runtime must register the independent Kimi CLI provider");
assert.ok(main.includes("delete require.cache[require.resolve(cliProviderPath)]"), "Kimi provider adapter must refresh when the plugin is toggled or updated");
assert.ok(main.includes("renderPaperComposerCliSettings"), "the default provider selector must live in Paper Library settings");
const genericProviderSettings = main.slice(main.indexOf("renderPaperComposerCliSettings(container)"), main.indexOf("renderPluginUpdateSettings(containerEl)"));
assert.ok(!genericProviderSettings.includes('id: "kimi"'), "the general provider selector must not duplicate Kimi settings");
assert.ok(!genericProviderSettings.includes("重新检测"), "provider-specific CLI controls must stay on their Provider pages");
assert.ok(main.includes("selectPaperComposerSettingsProvider"), "settings must select the default CLI provider");
assert.ok(cliProviders.includes('binary: "kimi"'), "Kimi must invoke the Kimi Code CLI directly");
assert.ok(cliProviders.includes('defaultArgs: ["-p", "{prompt}", "--output-format", "text"]'), "Kimi must use its supported non-interactive mode");
assert.ok(cliProviders.includes("const child = spawn(command, args"), "CLI provider responses must come from an actual subprocess");
assert.ok(cliProviders.includes('settingsTabRenderer: {'), "Kimi provider settings must expose the runtime's render() contract");
assert.ok(!cliProviders.includes('require("obsidian")'), "nested provider settings must not resolve Obsidian as a filesystem module");
assert.ok(cliProviders.includes('path.join(os.homedir(), ".kimi-code", "bin", "kimi")'), "Kimi CLI discovery must include the official user install path");
assert.ok(cliProviders.includes("function discoverCliModels(spec)"), "Kimi settings must discover the locally configured model aliases");
assert.ok(cliProviders.includes('.setName("Enable Kimi")'), "Kimi must expose the same enable control as ChatGPT");
assert.ok(cliProviders.includes('.setName("Visible models")'), "Kimi must use the same visible-model picker structure as ChatGPT");
assert.ok(cliProviders.includes("paper-composer-provider-model-picker-selected-row"), "Kimi selected models must support ordered cards and aliases");
assert.ok(cliProviders.includes("visibleModels: normalized") && cliProviders.includes("modelAliases"), "Kimi model selection must persist multiple visible models and aliases");
assert.ok(cliProviders.includes("decodeCliModel(this.spec, request.configuration?.model)"), "the active conversation model must reach the Kimi CLI invocation");
assert.ok(cliProviders.includes('args.unshift("--model", selectedModel)'), "the active Kimi model must reach the CLI invocation");
assert.ok(cliProviders.includes('request.configuration?.reasoning'), "the selected reasoning level must reach the Kimi CLI adapter");
assert.ok(cliProviders.includes('env[KIMI_EFFORT_ENV] = thinkingEffort'), "Kimi reasoning must use the CLI per-process environment override");
assert.ok(cliProviders.includes("module.exports.createChatUIConfig = createChatUIConfig"), "Paper Composer must be able to project enabled Kimi models into its unified menu");
assert.ok(main.includes("getPaperComposerCliMenuOptions()"), "the unified Composer menu must include enabled independent CLI models");
assert.ok(main.includes("chooseComposerCliModel(tab, control, option)"), "Kimi choices must remain selectable from existing Composer tabs");
assert.ok(!cliProviders.includes('id: "glm"') && !cliProviders.includes('binary: "glm"'), "GLM must be removed from the CLI provider runtime");
assert.ok(!cliProviders.includes('binary: "opencode"'), "Kimi must not be routed through OpenCode");
assert.ok(main.includes("addComposerDrop(snapshot, { tab: targetTab })"), "drop bridge must preserve the exact Composer input under the pointer");
assert.ok(main.includes("findComposerTabForInputWrapper"), "drop routing must resolve the destination tab from its input wrapper");
assert.ok(main.includes("files: Array.from(event.dataTransfer?.files || [])"), "drop bridge must retain File references before DataTransfer expires");
assert.ok(main.includes('pdfSelectionRaw: event.dataTransfer?.getData("application/x-paperlib-pdf-selection")'), "native document selections must keep structured drag metadata");
assert.ok(main.includes('pdfFigureRaw: event.dataTransfer?.getData("application/x-paperlib-pdf-figure")'), "recognized document images must keep structured drag metadata");
assert.ok(main.includes('transfer.setData("application/x-paperlib-pdf-figure"'), "recognized images in both readers must expose a Composer drag payload");
const figureDragPayload = main.slice(main.indexOf('transfer.setData("application/x-paperlib-pdf-figure"') - 1200, main.indexOf('transfer.setData("application/x-paperlib-pdf-figure"') + 500);
assert.ok(!figureDragPayload.includes('transfer.setData("text/plain"'), "recognized image metadata must not leak into the visible message text");
assert.ok(main.includes("installPdfFigureDragZones(pages, pdfPath, paper, catalog)"), "workspace document pages must expose recognized image drag zones");
assert.ok(main.includes("ensureNativePdfFigureDragZones(leaf, container"), "native document pages must expose recognized image drag zones");
assert.ok(main.includes("readRecognizedPdfFigureAsset"), "image drops must read the existing recognized image asset");
assert.ok(main.includes("resolveRecognizedPdfFigureCache"), "recognized image drags must recover an existing cache after its source hash changes");
assert.ok(main.includes("figures.filter((figure) => expected.has(signature(figure))).length"), "legacy image caches must be matched by the saved layout coordinates");
assert.ok(main.includes('zone.classList.remove("is-unavailable")'), "recognized image previews must be retryable after a transient cache miss");
const figureDropAttachment = main.slice(main.indexOf("async pdfFigureDragToAIAttachment"), main.indexOf("async migratePortablePdfFigureCatalogs"));
assert.ok(!figureDropAttachment.includes("renderPdfFigure("), "recognized-image drops must not crop the original page as a fallback");
assert.ok(main.includes("if (preparedContext) this.beginExcerptDrag(moveEvent"), "workspace text drag must begin on movement instead of being cancelled");
assert.ok(main.includes("const selectedLayer = selectedSpan?.closest?."), "workspace Ask AI must resolve the active selection even when the menu target is not a text span");
assert.ok(main.includes("addClaudianContexts"), "Paper Library context must be routed to the Composer runtime");
assert.ok(main.includes('.setTitle("添加到 Paper Composer")') && main.includes("addPaperToPaperComposer(paper)"), "library rows must expose a Paper Composer context-menu action");
assert.ok(main.includes("bindComposerLinkedContent(tab, list, options)"), "every Composer context must bind its source as Linked content before insertion");
assert.ok(main.includes("resolveComposerLinkedContentPath"), "text, image, region, node, and paper contexts must resolve a shared source path");
assert.ok(main.includes('sourcePath: this.app.workspace.getActiveFile?.()?.path || ""'), "plain text and external drops must retain the active source for Linked content");
assert.ok(main.includes("attachment.key === key || normalizePath(attachment.path || \"\") === path"), "Linked PDF reconciliation must reuse source-equivalent cards instead of duplicating them");
assert.ok(main.includes("claudianImageFromAttachment"), "image attachments must be bridged");
assert.ok(main.includes('if (attachment?.dataUrl && attachment?.type === "image") return ""'), "images must render as images without placeholder markup");
assert.ok(main.includes("decorateClaudianImageTray"), "Paper Library images must receive a real thumbnail preview");
assert.ok(main.includes("decorateClaudianSentImageCards"), "sent image attachments must be decorated after live and restored message renders");
assert.ok(main.includes("recordComposerSentPdfCards"), "sent PDF attachments must be bound to the admitted user message");
assert.ok(main.includes("decorateClaudianSentPdfCards"), "sent PDF cards must be restored when a conversation is rendered again");
assert.ok(main.includes("paperComposerPdfMessageCards: {}"), "sent PDF cards must have durable Paper Library storage");
const pdfSendBridge = main.slice(main.indexOf("async sendClaudianMessageWithPdf"), main.indexOf("async addClaudianContexts"));
assert.ok(pdfSendBridge.indexOf("const sentPdfCardTask") < pdfSendBridge.indexOf("result = await sendTask"), "the PDF card must bind while the answer is streaming instead of after completion");
assert.ok(pdfSendBridge.includes("sentPdfCardCancellation.cancelled = true"), "a rejected send must cancel its pending PDF card binding");
assert.ok(!main.includes("<paper-library-context"), "visible prompts must not contain internal context tags");
assert.ok(main.includes('closest?.(".paper-composer-input-wrapper")'), "pointer-dragged PDF text must target Composer directly");
assert.ok(main.includes("scheduleNativePdfSelectionDrag"), "native reader text drag must not depend only on browser dragstart");
assert.ok(main.includes("beginNativePdfSelectionPointerDrag"), "native reader text selections must use a pointer-driven drag bridge");
assert.ok(main.includes("savePdfInkStroke"), "freehand strokes must be persisted in the shared research workspace");
assert.ok(main.includes("beginNativePdfInkStroke"), "the native reader must expose freehand drawing");
assert.ok(main.includes("beginPdfInkStroke"), "the research workspace must expose freehand drawing");
assert.ok(main.includes("removePdfInkStroke"), "freehand strokes must support synchronized deletion");
assert.ok(main.includes('setPaperlibIcon(ink, "pencil")'), "the native freehand tool must retain a pencil icon after reader remounts");
assert.ok(main.includes('setPaperlibIcon(select, "mouse-pointer-2")'), "the native reader toolbar must expose an explicit mouse/select tool");
assert.ok(main.includes('state.mode = "";'), "the native mouse/select tool must leave annotation modes");
assert.ok(main.includes('iconButton(modeGroup, "pencil", "自由画笔"'), "the workspace freehand tool must use a pencil instead of a brush");
assert.ok(main.includes("getCoalescedEvents?.()"), "freehand drawing must consume real-time coalesced pointer samples");
assert.ok(main.includes('this.inkColor = "yellow"'), "workspace ink and highlighter colors must use independent state");
assert.ok(main.includes("this.colorPaletteOpen = false"), "workspace color selection must close its palette");
assert.ok(main.includes('color: this.inkColor'), "workspace strokes must use the independent ink color");
assert.ok(main.includes('state.inkColor = color.id'), "native reader ink color must not overwrite the highlighter color");
assert.ok(main.includes('state.highlightColor = color.id'), "native reader highlighter color must not overwrite the ink color");
assert.ok(main.includes('state.paletteOpen = false'), "native reader color selection must close its palette");
assert.ok(main.includes("capturePdfInkRegionAttachment"), "freehand-bounded regions must be capturable as images");
assert.ok(main.includes("schedulePdfInkRegionDrag"), "right-button ink-region drags must route to Paper Composer");
assert.ok(main.includes("作为图片添加到 Paper Composer"), "ink context menus must expose an image attachment action");
assert.ok(main.includes("addComposerPdfAttachments"), "PDF attachments must be retained in the Composer tray");
assert.ok(main.includes("sendClaudianMessageWithPdf"), "Composer send must inject the selected PDF mode");
assert.ok(main.includes("ensureComposerTopControls"), "Composer must expose its settings from the upper navigation row");
assert.ok(main.includes("paperlib-composer-settings-btn"), "the upper settings control must have a Paper Library visual treatment");
assert.ok(main.includes("toggleComposerPdfModeMenu"), "the upper settings control must switch document handling inline");
assert.ok(main.includes("ensureComposerTabForDocumentSources"), "explicit Ask AI document contexts may still request conversation isolation");
assert.ok(main.includes("async addComposerDrop(snapshot = {}, options = {})"), "drop handling must accept an explicit destination tab");
assert.ok(!main.includes("composerPdfSourceKeysFromDrop"), "dragged documents must not create or switch conversations by source identity");
assert.ok(main.includes("view.createNewTab()"), "document changes must create a distinct Composer tab instead of recycling a draft");
assert.ok(main.includes("getCachedConversation?.(tab.conversationId)"), "persisted conversations must be recognized before document routing");
assert.ok(main.includes("runtime.collabSurfaceFactory = null"), "the fused Composer must not expose the collaboration surface");
assert.ok(main.includes("runtime.isCollabEnabled = () => false"), "legacy collaboration settings must not reactivate the removed surface");
assert.ok(!main.includes("PaperLibraryAIView"), "the fused plugin must not keep a standalone Paper AI view");

assert.ok(styles.includes('[data-type="paperlib-paper-composer-view"]'), "custom Composer view styles must be scoped");
assert.ok(styles.includes("paperlib-paper-composer-drag-over"), "drop interaction must have visual feedback");
assert.ok(styles.includes("paperlib-paper-composer-image-preview"), "image context must have thumbnail styling");
assert.ok(styles.includes("paperlib-composer-pdf-strip"), "Composer must include integrated document context cards");
assert.ok(styles.includes("display: contents"), "document cards must visually join the native context chips");
assert.ok(styles.includes("paper-composer-welcome-linked-content .paper-composer-linked-content-selector-row > button.paper-composer-linked-content-selector"), "long linked Markdown titles must shrink inside the sidebar");
assert.ok(styles.includes("background-color: transparent !important"), "Composer buttons must override native grey surfaces");
assert.ok(styles.includes(".paper-composer-input-container"), "Composer input surfaces must inherit the surrounding panel background");
assert.ok(styles.includes(".paper-composer-active-input-slot"), "the Composer input slot must not paint a grey outer surface");
assert.ok(styles.includes("button.paper-composer-tab-badge"), "Composer tab buttons must override native white button fills");
assert.ok(styles.includes("button.paper-composer-input-nav-btn"), "Composer navigation buttons must remain transparent at rest");
assert.ok(styles.includes("backdrop-filter: none !important"), "the tab bar must not paint a white glass surface behind tab buttons");
assert.ok(styles.includes("flex: 0 0 24px"), "the Composer settings control must match the other navigation buttons");
assert.ok(styles.includes(".paperlib-native-pdf-ink-layer"), "native reader strokes must have a dedicated overlay");
assert.ok(styles.includes(".paperlib-research-root.is-ink-mode"), "research workspace must expose an ink interaction state");
assert.ok(styles.includes(".paperlib-ink-region-drag-ghost"), "ink-region drags must have an image preview ghost");
assert.ok(styles.includes("background-size: 16px 3px !important"), "workspace drawing-tool color bars must be anchored to their own button backgrounds");
assert.ok(styles.includes(".paperlib-highlighter-tool") && styles.includes(".paperlib-ink-tool"), "both workspace drawing tools must display their selected color");
assert.ok(styles.includes(".paperlib-canvas-toolbar .paperlib-icon-button::after"), "workspace tools must suppress theme-generated pseudo underlines");
assert.ok(styles.includes(".paperlib-native-pdf-tool.is-ink > .paperlib-native-pdf-color-bar"), "native reader pencil must display its own color bar");
assert.ok(main.includes('inkColorBar.className = "paperlib-native-pdf-color-bar"'), "native reader pencil must create a real color-bar element");
assert.ok(styles.includes(".paperlib-native-pdf-tools .paperlib-native-pdf-tool::after"), "native reader tools must suppress theme-generated pseudo underlines");
assert.ok(!styles.includes(".paperlib-native-pdf-tool.is-ai-region > .paperlib-native-pdf-color-bar"), "region selection must not display a color bar");
const inkCapture = main.slice(main.indexOf("capturePdfInkRegionAttachment"), main.indexOf("async addPdfInkRegionToComposer"));
assert.ok(inkCapture.includes("context.drawImage(canvas"), "ink-bounded image capture must retain the original page pixels");
assert.ok(!inkCapture.includes("context.stroke()"), "ink-bounded image capture must not render the guide stroke into the inserted image");
assert.ok(main.includes("ensureComposerCodexInput"), "Paper Composer must install the Codex-style input controls");
assert.ok(main.includes("composerMountObserver = new MutationObserver"), "restored Composer inputs must receive the new UI before user interaction");
assert.ok(main.includes('this.app.workspace?.onLayoutReady?.(mountComposerInputs)'), "startup layout restoration must decorate Composer immediately");
assert.ok(main.includes("paperlib-codex-attach-btn"), "the Codex-style plus button must open a real attachment picker");
assert.ok(main.includes('toolbar.querySelector(".paperlib-codex-voice-btn")?.remove?.()'), "legacy microphone controls must be removed from the Composer input");
assert.ok(!main.includes('setIcon(voiceButton, "mic")'), "the Composer input must not create a microphone button");
assert.ok(main.includes('setIcon(sendButton, streaming ? "square" : "arrow-up")'), "the Codex-style send control must switch to a stop control while streaming");
assert.ok(main.includes('YOLO: "完全访问"'), "the Codex-style permission control must use a human-readable access label");
assert.ok(main.includes("ensureComposerUnifiedModelControl"), "model, reasoning, and speed must share one Codex-style control");
assert.ok(main.includes('label: "模型"') && main.includes('label: "推理强度"') && main.includes('label: "速度"'), "the unified model menu must expose all three selection pages");
assert.ok(main.includes('setIcon(bolt, "zap")'), "the lightning icon must be part of the unified model trigger");
assert.ok(main.includes("const speedActive = values.speedAvailable && values.speedFast"), "the lightning icon must only represent an active supported acceleration mode");
assert.ok(main.includes('bolt.toggleAttribute("hidden", !speedActive)'), "the lightning icon must stay hidden for standard-speed and unsupported models");
assert.ok(main.includes("formatComposerReasoningDisplayLabel"), "reasoning labels must match the localized Codex-style menu");
assert.ok(!main.includes("hideSettingsOnlyComposerModels"), "selected Kimi models must remain available in the chat model menu like ChatGPT models");
assert.ok(main.includes("cleanupComposerUnifiedModelControl"), "the unified model menu must release document listeners with its tab");
assert.ok(styles.includes("Paper Composer · Codex-style prompt surface"), "Paper Composer must include the Codex-style visual surface");
assert.ok(styles.includes("button.paperlib-codex-send-btn"), "the Codex-style input must use a circular send button");
assert.ok(styles.includes("min-height: 116px"), "the Codex-style prompt surface must use the compact height");
assert.ok(styles.includes("width: min(220px, calc(100vw - 20px))"), "the unified model menu must stay compact in the sidebar");
assert.ok(main.includes('row.addEventListener("pointerdown"') && main.includes("openSubmenu();"), "submenu navigation must survive Composer toolbar refreshes between pointerdown and click");
assert.ok(main.includes("activateOnPointerDown = false") && main.includes("pointerHandled = true"), "model and reasoning choices must commit before Composer replaces their menu nodes");
assert.ok((main.match(/activateOnPointerDown: true/g) || []).length >= 4, "every selectable model-menu page must use immediate pointer activation");
assert.ok(styles.includes("background: var(--background-primary) !important"), "the prompt surface must blend with the surrounding panel instead of painting a grey card");
assert.ok(styles.includes(".paperlib-codex-model-control"), "the Codex-style input must visually combine lightning, model, and effort");
assert.ok(styles.includes(".paperlib-codex-model-menu-row"), "the unified model control must open a click-driven selection menu");
assert.ok(styles.includes(".paperlib-pdf-figure-drag-zone"), "recognized PDF images must expose a visible drag affordance");
assert.ok(!styles.includes(".paperlib-pdf-figure-drag-zone.is-unavailable,\n.paperlib-research-root"), "a transient preview miss must not permanently block image dragging");
assert.ok(styles.includes("button.paper-composer-message-image") && styles.includes("width: 58px"), "sent images must remain compact cards above the user message");
assert.ok(styles.includes("button.paperlib-paper-composer-sent-image") && styles.includes("max-width: 58px !important"), "sent image card dimensions must override the embedded runtime's 120px default");
assert.ok(styles.includes(".paperlib-paper-composer-sent-pdf") && styles.includes("height: 58px"), "sent PDF context must render as a compact card above the message body");
assert.ok(styles.includes(".paperlib-composer-pdf-chip:hover"), "input PDF cards must provide hover feedback");
assert.ok(styles.includes(".paperlib-paper-composer-linked-pdf-chip:hover"), "linked PDF cards must provide native hover feedback");
assert.ok(styles.includes(".paperlib-linked-pdf-status"), "linked PDF cards must expose a visible detailed progress row");
assert.ok(styles.includes(".paperlib-paper-composer-linked-pdf-chip.has-status"), "linked PDF status must remain visible after fast or cached parsing");
assert.ok(main.includes("paperlib-ai-region-tool"), "the research region-selection tool must have an independent visual class");
assert.ok(styles.includes(".paperlib-canvas-toolbar .paperlib-icon-button::after") && styles.includes("content: none !important"), "research tools must not receive theme-generated color bars");
assert.ok(!main.includes('paperlib-ai-region-tool paperlib-canvas-tool-color-bar'), "the research region-selection tool must not create a drawing-color bar");
assert.ok(styles.includes(".paperlib-paper-composer-sent-pdf:hover"), "sent PDF cards must provide hover feedback");
assert.ok(styles.includes(".paper-composer-messages:has(> .paper-composer-welcome:not(.paper-composer-hidden))"), "only a visible welcome page may suppress the message scrollbar");
assert.ok(!styles.includes(".paper-composer-messages:has(> .paper-composer-welcome) {"), "a hidden welcome node must not freeze conversation scrolling");
assert.ok(styles.includes("overflow-y: clip !important"), "the welcome state must keep its scroll geometry stable while mounting");
assert.ok(!styles.includes("from { opacity: 0; transform: translateY(14px) scale(.98); }"), "the welcome animation must not enlarge the scrollable overflow");

console.log("Paper Composer integration tests passed.");
