import { runModuleMigrations } from "./migrations.mjs";

const MODULE_ID = "bm-gestion-macros";
const REQUEST_RETENTION_MS = 2 * 60 * 1000;
const DEFAULT_BACKGROUND_SRC = `modules/${MODULE_ID}/images/des_destin.png`;
const VOYANCE_CHAT_CARD_FLAG = "voyanceChatCard";
const GM_MACRO_NAME = "Bloodman - Jet du destin";
const GM_MACRO_ICON = `modules/${MODULE_ID}/images/icon_macro_des_destin.jpg`;
const GM_MACRO_FLAG = "autoJetDestinMacro";
const SETTING_ENABLE_GM_MACRO = "enableGmHotbarMacro";
const SETTING_GM_MACRO_SLOT = "gmHotbarMacroSlot";
const GM_MACRO_SLOT_DEFAULT = 1;
const GM_MACRO_SLOT_MIN = 1;
const GM_MACRO_SLOT_MAX = 50;
const TILE_MACRO_NAME = "Bloodman - Tuiles (Toggle)";
const TILE_MACRO_ICON = `modules/${MODULE_ID}/images/icon_macro_tuile.png`;
const TILE_MACRO_FLAG = "autoTileVisibilityMacro";
const TILE_VISIBILITY_STATE_FLAG = "tileVisibilityHiddenState";
const SETTING_ENABLE_TILE_MACRO = "enableTileVisibilityMacro";
const SETTING_TILE_MACRO_SLOT = "tileVisibilityMacroSlot";
const NOTES_MACRO_NAME = "Bloodman - Notes GM";
const NOTES_MACRO_ICON = `modules/${MODULE_ID}/images/icon_notes.jpg`;
const NOTES_MACRO_FLAG = "autoNotesMacro";
const SETTING_ENABLE_NOTES_MACRO = "enableNotesHotbarMacro";
const SETTING_NOTES_MACRO_SLOT = "notesHotbarMacroSlot";
const SETTING_SCHEMA_VERSION = "schemaVersion";
const NOTES_JOURNAL_FLAG = "gmNotesJournal";
const NOTES_JOURNAL_PAGE_FLAG = "gmNotesJournalPage";
const NOTES_JOURNAL_NAME = "Bloodman - Notes GM";
const NOTES_JOURNAL_PAGE_NAME = "Notes";
const TILE_MACRO_SLOT_DEFAULT = 2;
const NOTES_MACRO_SLOT_DEFAULT = 3;
const IMAGE_DISPLAY_RETRY_DELAYS = Object.freeze([0, 120, 260]);
const IMAGE_DISPLAY_CACHE_TTL_MS = 5 * 60 * 1000;
const IMAGE_DISPLAY_CACHE_MAX = 512;
const GM_MACRO_COMMAND = `const api = game.modules.get("${MODULE_ID}")?.api;
if (!api || typeof api.rollJetDestin !== "function") {
  ui.notifications?.warn("Module ${MODULE_ID} inactif ou API indisponible.");
} else {
  await api.rollJetDestin();
}`;
const TILE_MACRO_COMMAND = `const api = game.modules.get("${MODULE_ID}")?.api;
if (!api || typeof api.toggleCurrentSceneTilesVisibility !== "function") {
  ui.notifications?.warn("Module ${MODULE_ID} inactif ou API indisponible.");
} else {
  await api.toggleCurrentSceneTilesVisibility();
}`;
const NOTES_MACRO_COMMAND = `const api = game.modules.get("${MODULE_ID}")?.api;
if (!api || typeof api.openGmNotesWindow !== "function") {
  ui.notifications?.warn("Module ${MODULE_ID} inactif ou API indisponible.");
} else {
  await api.openGmNotesWindow();
}`;
function getModuleTargetVersion() {
  const module = game.modules?.get?.(MODULE_ID);
  return String(module?.version || "0.0.0");
}

function clampSlotMigrationValue(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = Math.floor(numeric);
  return Math.max(GM_MACRO_SLOT_MIN, Math.min(GM_MACRO_SLOT_MAX, normalized));
}

function getMigrationSteps() {
  return [
    {
      version: "1.0.15",
      label: "Sanitize macro slot settings",
      run: async ({ getSetting, setSetting, logger }) => {
        const updates = [];
        const gmSlot = clampSlotMigrationValue(getSetting(SETTING_GM_MACRO_SLOT), GM_MACRO_SLOT_DEFAULT);
        if (gmSlot !== Number(getSetting(SETTING_GM_MACRO_SLOT))) {
          updates.push({ key: SETTING_GM_MACRO_SLOT, value: gmSlot });
        }

        const tileSlot = clampSlotMigrationValue(getSetting(SETTING_TILE_MACRO_SLOT), TILE_MACRO_SLOT_DEFAULT);
        if (tileSlot !== Number(getSetting(SETTING_TILE_MACRO_SLOT))) {
          updates.push({ key: SETTING_TILE_MACRO_SLOT, value: tileSlot });
        }

        const notesSlot = clampSlotMigrationValue(getSetting(SETTING_NOTES_MACRO_SLOT), NOTES_MACRO_SLOT_DEFAULT);
        if (notesSlot !== Number(getSetting(SETTING_NOTES_MACRO_SLOT))) {
          updates.push({ key: SETTING_NOTES_MACRO_SLOT, value: notesSlot });
        }

        for (const update of updates) {
          await setSetting(update.key, update.value);
        }

        logger.info("slot-sanitization", { updated: updates.map(update => update.key) });
      }
    }
  ];
}

const PROCESSED_REQUESTS = new Map();
const DISPLAYABLE_IMAGE_CACHE = new Map();

function t(key, fallback, data = null) {
  const localized = data
    ? game?.i18n?.format?.(key, data)
    : game?.i18n?.localize?.(key);
  if (localized && localized !== key) return localized;
  return fallback;
}

function escapeHtml(value) {
  const raw = String(value ?? "");
  if (foundry.utils?.escapeHTML) return foundry.utils.escapeHTML(raw);
  return raw.replace(/[&<>"']/g, chr => (
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[chr] || chr)
  ));
}

function rememberRequest(requestId) {
  const id = String(requestId || "").trim();
  if (!id) return;
  const now = Date.now();
  PROCESSED_REQUESTS.set(id, now);
  for (const [key, value] of PROCESSED_REQUESTS.entries()) {
    if (now - value > REQUEST_RETENTION_MS) PROCESSED_REQUESTS.delete(key);
  }
}

function wasRequestProcessed(requestId) {
  const id = String(requestId || "").trim();
  if (!id) return false;
  return PROCESSED_REQUESTS.has(id);
}

function buildScopedRequestId(scope, requestId) {
  const rawScope = String(scope || "").trim();
  const rawId = String(requestId || "").trim();
  if (!rawScope || !rawId) return "";
  return `${rawScope}:${rawId}`;
}

function rememberScopedRequest(scope, requestId) {
  const scopedId = buildScopedRequestId(scope, requestId);
  if (!scopedId) return;
  rememberRequest(scopedId);
}

function wasScopedRequestProcessed(scope, requestId) {
  const scopedId = buildScopedRequestId(scope, requestId);
  if (!scopedId) return false;
  return wasRequestProcessed(scopedId);
}

function normalizeVoyanceAnswer(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "oui" ? "oui" : "non";
}

async function canDisplayImageSource(src) {
  const candidate = String(src || "").trim();
  if (!candidate) return false;
  return new Promise(resolve => {
    const img = new Image();
    const done = ok => {
      img.onload = null;
      img.onerror = null;
      resolve(ok);
    };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = candidate;
  });
}

function pruneDisplayableImageCache(now = Date.now()) {
  for (const [src, timestamp] of DISPLAYABLE_IMAGE_CACHE.entries()) {
    if (!Number.isFinite(timestamp) || (now - timestamp) > IMAGE_DISPLAY_CACHE_TTL_MS) {
      DISPLAYABLE_IMAGE_CACHE.delete(src);
    }
  }
  if (DISPLAYABLE_IMAGE_CACHE.size <= IMAGE_DISPLAY_CACHE_MAX) return;
  const overflow = DISPLAYABLE_IMAGE_CACHE.size - IMAGE_DISPLAY_CACHE_MAX;
  const oldest = Array.from(DISPLAYABLE_IMAGE_CACHE.entries())
    .sort((a, b) => a[1] - b[1])
    .slice(0, overflow);
  for (const [src] of oldest) DISPLAYABLE_IMAGE_CACHE.delete(src);
}

function rememberDisplayableImageSource(src) {
  const candidate = String(src || "").trim();
  if (!candidate) return;
  DISPLAYABLE_IMAGE_CACHE.set(candidate, Date.now());
  if (DISPLAYABLE_IMAGE_CACHE.size > IMAGE_DISPLAY_CACHE_MAX) pruneDisplayableImageCache();
}

function isDisplayableImageSourceCached(src) {
  const candidate = String(src || "").trim();
  if (!candidate) return false;
  pruneDisplayableImageCache();
  const timestamp = DISPLAYABLE_IMAGE_CACHE.get(candidate);
  if (!Number.isFinite(timestamp)) return false;
  if ((Date.now() - timestamp) > IMAGE_DISPLAY_CACHE_TTL_MS) {
    DISPLAYABLE_IMAGE_CACHE.delete(candidate);
    return false;
  }
  return true;
}

function waitMs(delayMs) {
  const timeout = Math.max(0, Math.floor(Number(delayMs) || 0));
  return new Promise(resolve => setTimeout(resolve, timeout));
}

async function canDisplayImageSourceWithRetry(src, retryDelays = IMAGE_DISPLAY_RETRY_DELAYS) {
  const candidate = String(src || "").trim();
  if (!candidate) return false;
  if (isDisplayableImageSourceCached(candidate)) return true;
  for (const delay of retryDelays) {
    if (delay > 0) await waitMs(delay);
    if (await canDisplayImageSource(candidate)) {
      rememberDisplayableImageSource(candidate);
      return true;
    }
  }
  return false;
}


function buildVoyanceChatCardContent(payload = {}) {
  const answer = normalizeVoyanceAnswer(payload.answer);
  const formula = String(payload.formula || "1d20").trim() || "1d20";
  const thresholdRaw = Number(payload.threshold);
  const threshold = Number.isFinite(thresholdRaw) ? Math.max(1, Math.floor(thresholdRaw)) : 10;
  const totalRaw = Number(payload.total);
  const total = Number.isFinite(totalRaw) ? Math.floor(totalRaw) : 0;
  const hasBackground = Boolean(payload.hasBackground && payload.backgroundSrc);
  const backgroundSrc = hasBackground ? String(payload.backgroundSrc).trim() : "";

  const title = t("BJD.Chat.Title", "Automate de voyance");
  const resultLabel = t("BJD.Chat.ResultLabel", "Resultat");
  const successLabel = t("BJD.Chat.Success", "oui");
  const failureLabel = t("BJD.Chat.Failure", "non");
  const rollLabel = t("BJD.Chat.RollLabel", "Jet");
  const totalLabel = t("BJD.Chat.TotalLabel", "Total");
  const thresholdLabel = t("BJD.Chat.ThresholdLabel", "Seuil");

  const escapedTitle = escapeHtml(title);
  const escapedResultLabel = escapeHtml(resultLabel);
  const escapedStatus = escapeHtml(answer === "oui" ? successLabel : failureLabel);
  const escapedRollLabel = escapeHtml(rollLabel);
  const escapedTotalLabel = escapeHtml(totalLabel);
  const escapedThresholdLabel = escapeHtml(thresholdLabel);
  const escapedFormula = escapeHtml(formula);
  const escapedBackground = escapeHtml(backgroundSrc);

  return `
    <article class="bjd-voyance-chat-card ${answer === "oui" ? "is-success" : "is-failure"}">
      <div class="bjd-voyance-chat-card-media">
        <div class="bjd-voyance-chat-card-bg-fallback" aria-hidden="true"></div>
        ${hasBackground ? `<img class="bjd-voyance-chat-card-bg-image" src="${escapedBackground}" alt="${escapedTitle}" />` : ""}
        <div class="bjd-voyance-chat-card-overlay" aria-hidden="true"></div>
        <div class="bjd-voyance-chat-card-body">
          <p class="bjd-voyance-chat-card-title">${escapedTitle}</p>
          <p class="bjd-voyance-chat-card-result-label">${escapedResultLabel}</p>
          <p class="bjd-voyance-chat-card-result-value">${escapedStatus}</p>
        </div>
      </div>
      <div class="bjd-voyance-chat-card-meta">
        <span class="bjd-voyance-chat-card-meta-item">${escapedRollLabel}: <strong>${escapedFormula}</strong></span>
        <span class="bjd-voyance-chat-card-meta-item">${escapedTotalLabel}: <strong>${total}</strong></span>
        <span class="bjd-voyance-chat-card-meta-item">${escapedThresholdLabel}: <strong>${threshold}</strong></span>
      </div>
    </article>
  `;
}

async function postVoyanceChatCard(payload = {}) {
  const requestId = String(payload.requestId || "").trim()
    || (foundry.utils?.randomID ? foundry.utils.randomID() : Math.random().toString(36).slice(2));
  const backgroundSrc = String(payload.backgroundSrc || DEFAULT_BACKGROUND_SRC).trim() || DEFAULT_BACKGROUND_SRC;
  const hasBackground = backgroundSrc
    ? await canDisplayImageSourceWithRetry(backgroundSrc, [0, 120])
    : false;

  const content = buildVoyanceChatCardContent({
    ...payload,
    backgroundSrc,
    hasBackground
  });
  const messageData = {
    speaker: ChatMessage.getSpeaker(),
    flavor: content,
    flags: {
      [MODULE_ID]: {
        [VOYANCE_CHAT_CARD_FLAG]: true
      }
    }
  };
  const roll = payload.roll;
  let message = null;
  if (roll && typeof roll.toMessage === "function") {
    try {
      message = await roll.toMessage(messageData, { create: true });
    } catch (error) {
      console.warn(`[${MODULE_ID}] roll.toMessage failed, fallback to ChatMessage.create`, error);
    }
  }
  if (!message) {
    message = await ChatMessage.create({ ...messageData, content });
  }
  return {
    requestId,
    messageId: String(message?.id || "")
  };
}


async function rollJetDestin(options = {}) {
  try {
    const formula = String(options.formula || "1d20").trim() || "1d20";
    const thresholdRaw = Number(options.threshold);
    const threshold = Number.isFinite(thresholdRaw) ? Math.max(1, Math.floor(thresholdRaw)) : 10;

    const roll = await new Roll(formula).evaluate({ async: true });
    const total = Number(roll.total || 0);
    const answer = total <= threshold ? "oui" : "non";

    const chatMessage = await postVoyanceChatCard({
      answer,
      roll,
      formula,
      total,
      threshold,
      backgroundSrc: options.backgroundSrc,
    });

    return {
      roll,
      total,
      answer,
      requestId: chatMessage.requestId,
      messageId: chatMessage.messageId
    };
  } catch (error) {
    console.error(`[${MODULE_ID}] roll failed`, error);
    ui.notifications?.error(t("BJD.Notify.RollFailed", "Impossible de lancer le jet du destin."));
    return null;
  }
}

function getCurrentViewedScene() {
  return canvas?.scene || game.scenes?.current || null;
}

function getNextTileHiddenState(scene) {
  const previousState = scene?.getFlag?.(MODULE_ID, TILE_VISIBILITY_STATE_FLAG);
  if (typeof previousState !== "boolean") return false; // First click: show all tiles.
  return !previousState;
}

async function toggleCurrentSceneTilesVisibility() {
  if (!game.user?.isGM) {
    ui.notifications?.warn(t("BJD.Notify.GMOnly", "Seul un GM peut modifier la visibilite de toutes les tuiles."));
    return null;
  }

  const scene = getCurrentViewedScene();
  if (!scene) {
    ui.notifications?.warn(t("BJD.Notify.NoActiveScene", "Aucune scene active trouvee."));
    return null;
  }

  const tileDocs = scene.tiles?.contents || [];
  const targetHidden = getNextTileHiddenState(scene);

  const updates = tileDocs
    .filter(tile => Boolean(tile.hidden) !== targetHidden)
    .map(tile => ({
      _id: tile.id,
      hidden: targetHidden
    }));

  if (updates.length > 0) {
    // Batch document updates keep Foundry sync and history behavior for scene changes.
    await scene.updateEmbeddedDocuments("Tile", updates);
  }

  await scene.setFlag(MODULE_ID, TILE_VISIBILITY_STATE_FLAG, targetHidden);

  const notificationKey = targetHidden ? "BJD.Notify.TilesHidden" : "BJD.Notify.TilesShown";
  const fallback = targetHidden
    ? "Toutes les tuiles de la scene sont maintenant cachees."
    : "Toutes les tuiles de la scene sont maintenant visibles.";
  ui.notifications?.info(t(notificationKey, fallback));

  return {
    sceneId: scene.id,
    hidden: targetHidden,
    totalTiles: tileDocs.length,
    updatedTiles: updates.length
  };
}

function getJournalHtmlFormatValue() {
  const htmlFormat = Number(CONST?.JOURNAL_ENTRY_PAGE_FORMATS?.HTML);
  return Number.isFinite(htmlFormat) ? htmlFormat : 1;
}

function findManagedGmNotesJournal() {
  const journals = game.journal?.contents || [];
  const byFlag = journals.find(entry => entry.getFlag(MODULE_ID, NOTES_JOURNAL_FLAG) === true);
  if (byFlag) return byFlag;
  return journals.find(entry => entry?.name === NOTES_JOURNAL_NAME) || null;
}

function findManagedGmNotesPage(journal) {
  const pages = journal?.pages?.contents || [];
  const byFlag = pages.find(page => page.getFlag?.(MODULE_ID, NOTES_JOURNAL_PAGE_FLAG) === true);
  if (byFlag) return byFlag;
  const byName = pages.find(page => page?.type === "text" && page?.name === NOTES_JOURNAL_PAGE_NAME);
  if (byName) return byName;
  return pages.find(page => page?.type === "text") || null;
}

async function ensureGmNotesJournal() {
  const htmlFormat = getJournalHtmlFormatValue();
  let journal = findManagedGmNotesJournal();

  if (journal) {
    if (journal.name !== NOTES_JOURNAL_NAME) {
      journal = await journal.update({ name: NOTES_JOURNAL_NAME });
    }
    if (journal.getFlag(MODULE_ID, NOTES_JOURNAL_FLAG) !== true) {
      await journal.setFlag(MODULE_ID, NOTES_JOURNAL_FLAG, true);
    }
  } else {
    journal = await JournalEntry.create({
      name: NOTES_JOURNAL_NAME,
      pages: [{
        name: NOTES_JOURNAL_PAGE_NAME,
        type: "text",
        text: {
          content: "",
          format: htmlFormat
        },
        flags: {
          [MODULE_ID]: {
            [NOTES_JOURNAL_PAGE_FLAG]: true
          }
        }
      }],
      flags: {
        [MODULE_ID]: {
          [NOTES_JOURNAL_FLAG]: true
        }
      }
    });
  }

  let page = findManagedGmNotesPage(journal);
  if (!page) {
    const createdPages = await journal.createEmbeddedDocuments("JournalEntryPage", [{
      name: NOTES_JOURNAL_PAGE_NAME,
      type: "text",
      text: {
        content: "",
        format: htmlFormat
      },
      flags: {
        [MODULE_ID]: {
          [NOTES_JOURNAL_PAGE_FLAG]: true
        }
      }
    }]);
    page = createdPages?.[0] || null;
  } else {
    const updates = {};
    if (page.name !== NOTES_JOURNAL_PAGE_NAME) updates.name = NOTES_JOURNAL_PAGE_NAME;
    const currentFormat = Number(page.text?.format);
    if (!Number.isFinite(currentFormat)) updates["text.format"] = htmlFormat;
    if (Object.keys(updates).length > 0) {
      page = await page.update(updates);
    }
    if (page?.getFlag?.(MODULE_ID, NOTES_JOURNAL_PAGE_FLAG) !== true) {
      await page.setFlag(MODULE_ID, NOTES_JOURNAL_PAGE_FLAG, true);
    }
  }

  return { journal, page };
}

async function openGmNotesWindow() {
  if (!game.user?.isGM) {
    ui.notifications?.warn(t("BJD.Notify.GMOnlyNotes", "Seul un GM peut ouvrir la fenetre des notes."));
    return null;
  }

  try {
    const { journal, page } = await ensureGmNotesJournal();
    const baseRenderOptions = {
      width: 980,
      height: 760
    };
    if (page?.sheet) {
      page.sheet.render(true, baseRenderOptions);
    } else if (journal?.sheet) {
      const renderOptions = page?.id
        ? { ...baseRenderOptions, pageId: page.id }
        : baseRenderOptions;
      journal.sheet.render(true, renderOptions);
    } else {
      ui.notifications?.warn(t("BJD.Notify.NotesSheetUnavailable", "Aucune feuille de notes disponible."));
      return null;
    }

    return {
      journalId: String(journal?.id || ""),
      pageId: String(page?.id || "")
    };
  } catch (error) {
    console.error(`[${MODULE_ID}] failed to open GM notes window`, error);
    ui.notifications?.error(t("BJD.Notify.NotesOpenFailed", "Impossible d'ouvrir la fenetre de notes."));
    return null;
  }
}


function isGmMacroAutomationEnabled() {
  return Boolean(game.settings?.get?.(MODULE_ID, SETTING_ENABLE_GM_MACRO));
}

function getConfiguredGmMacroSlot() {
  const rawValue = Number(game.settings?.get?.(MODULE_ID, SETTING_GM_MACRO_SLOT));
  if (!Number.isFinite(rawValue)) return GM_MACRO_SLOT_DEFAULT;
  const normalized = Math.floor(rawValue);
  return Math.max(GM_MACRO_SLOT_MIN, Math.min(GM_MACRO_SLOT_MAX, normalized));
}

function isTileMacroAutomationEnabled() {
  return Boolean(game.settings?.get?.(MODULE_ID, SETTING_ENABLE_TILE_MACRO));
}

function getConfiguredTileMacroSlot() {
  const rawValue = Number(game.settings?.get?.(MODULE_ID, SETTING_TILE_MACRO_SLOT));
  if (!Number.isFinite(rawValue)) return TILE_MACRO_SLOT_DEFAULT;
  const normalized = Math.floor(rawValue);
  return Math.max(GM_MACRO_SLOT_MIN, Math.min(GM_MACRO_SLOT_MAX, normalized));
}

function isNotesMacroAutomationEnabled() {
  return Boolean(game.settings?.get?.(MODULE_ID, SETTING_ENABLE_NOTES_MACRO));
}

function getConfiguredNotesMacroSlot() {
  const rawValue = Number(game.settings?.get?.(MODULE_ID, SETTING_NOTES_MACRO_SLOT));
  if (!Number.isFinite(rawValue)) return NOTES_MACRO_SLOT_DEFAULT;
  const normalized = Math.floor(rawValue);
  return Math.max(GM_MACRO_SLOT_MIN, Math.min(GM_MACRO_SLOT_MAX, normalized));
}

async function clearUserHotbarSlots(slotNumbers = []) {
  const user = game.user;
  if (!user) return;

  const normalizedSlots = [...new Set(
    slotNumbers
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value >= GM_MACRO_SLOT_MIN)
  )];
  if (normalizedSlots.length === 0) return;

  const hotbar = foundry.utils.deepClone(user.hotbar || {});
  let changed = false;
  for (const slot of normalizedSlots) {
    if (hotbar[slot] !== undefined) {
      delete hotbar[slot];
      changed = true;
    }
  }
  if (!changed) return;

  await user.update({ hotbar });
}

function getAssignedMacroSlots(macroId) {
  const id = String(macroId || "").trim();
  if (!id) return [];

  return Object.entries(game.user?.hotbar || {})
    .filter(([, assignedMacroId]) => String(assignedMacroId || "").trim() === id)
    .map(([slot]) => Number(slot))
    .filter(slot => Number.isInteger(slot) && slot >= GM_MACRO_SLOT_MIN);
}

async function detachManagedMacroFromHotbar() {
  const macro = findManagedJetDestinMacro();
  const macroId = String(macro?.id || "").trim();
  if (!macroId) return;

  const slotsToClear = getAssignedMacroSlots(macroId);

  await clearUserHotbarSlots(slotsToClear);
}

function findManagedJetDestinMacro() {
  const macros = game.macros?.contents || [];
  const byFlag = macros.find(macro => macro.getFlag(MODULE_ID, GM_MACRO_FLAG) === true);
  if (byFlag) return byFlag;

  return macros.find(macro => (
    macro?.type === "script"
    && macro?.name === GM_MACRO_NAME
    && String(macro?.command || "").includes(`game.modules.get("${MODULE_ID}")`)
  ));
}

async function getOrCreateJetDestinMacro() {
  let macro = findManagedJetDestinMacro();
  if (macro) {
    const updates = {};
    if (macro.name !== GM_MACRO_NAME) updates.name = GM_MACRO_NAME;
    if (macro.command !== GM_MACRO_COMMAND) updates.command = GM_MACRO_COMMAND;
    if (macro.img !== GM_MACRO_ICON) updates.img = GM_MACRO_ICON;
    if (Object.keys(updates).length > 0) {
      macro = await macro.update(updates);
    }

    if (macro.getFlag(MODULE_ID, GM_MACRO_FLAG) !== true) {
      await macro.setFlag(MODULE_ID, GM_MACRO_FLAG, true);
    }
    return macro;
  }

  return Macro.create({
    name: GM_MACRO_NAME,
    type: "script",
    img: GM_MACRO_ICON,
    command: GM_MACRO_COMMAND,
    flags: {
      [MODULE_ID]: {
        [GM_MACRO_FLAG]: true
      }
    }
  });
}

async function detachManagedTileMacroFromHotbar() {
  const macro = findManagedTileVisibilityMacro();
  const macroId = String(macro?.id || "").trim();
  if (!macroId) return;

  const slotsToClear = getAssignedMacroSlots(macroId);
  await clearUserHotbarSlots(slotsToClear);
}

function findManagedTileVisibilityMacro() {
  const macros = game.macros?.contents || [];
  const byFlag = macros.find(macro => macro.getFlag(MODULE_ID, TILE_MACRO_FLAG) === true);
  if (byFlag) return byFlag;

  return macros.find(macro => (
    macro?.type === "script"
    && macro?.name === TILE_MACRO_NAME
    && String(macro?.command || "").includes(`game.modules.get("${MODULE_ID}")`)
    && String(macro?.command || "").includes("toggleCurrentSceneTilesVisibility")
  ));
}

async function getOrCreateTileVisibilityMacro() {
  let macro = findManagedTileVisibilityMacro();
  if (macro) {
    const updates = {};
    if (macro.name !== TILE_MACRO_NAME) updates.name = TILE_MACRO_NAME;
    if (macro.command !== TILE_MACRO_COMMAND) updates.command = TILE_MACRO_COMMAND;
    if (macro.img !== TILE_MACRO_ICON) updates.img = TILE_MACRO_ICON;
    if (Object.keys(updates).length > 0) {
      macro = await macro.update(updates);
    }

    if (macro.getFlag(MODULE_ID, TILE_MACRO_FLAG) !== true) {
      await macro.setFlag(MODULE_ID, TILE_MACRO_FLAG, true);
    }
    return macro;
  }

  return Macro.create({
    name: TILE_MACRO_NAME,
    type: "script",
    img: TILE_MACRO_ICON,
    command: TILE_MACRO_COMMAND,
    flags: {
      [MODULE_ID]: {
        [TILE_MACRO_FLAG]: true
      }
    }
  });
}

async function detachManagedNotesMacroFromHotbar() {
  const macro = findManagedNotesMacro();
  const macroId = String(macro?.id || "").trim();
  if (!macroId) return;

  const slotsToClear = getAssignedMacroSlots(macroId);
  await clearUserHotbarSlots(slotsToClear);
}

function findManagedNotesMacro() {
  const macros = game.macros?.contents || [];
  const byFlag = macros.find(macro => macro.getFlag(MODULE_ID, NOTES_MACRO_FLAG) === true);
  if (byFlag) return byFlag;

  return macros.find(macro => (
    macro?.type === "script"
    && macro?.name === NOTES_MACRO_NAME
    && String(macro?.command || "").includes(`game.modules.get("${MODULE_ID}")`)
    && String(macro?.command || "").includes("openGmNotesWindow")
  ));
}

async function getOrCreateNotesMacro() {
  let macro = findManagedNotesMacro();
  if (macro) {
    const updates = {};
    if (macro.name !== NOTES_MACRO_NAME) updates.name = NOTES_MACRO_NAME;
    if (macro.command !== NOTES_MACRO_COMMAND) updates.command = NOTES_MACRO_COMMAND;
    if (macro.img !== NOTES_MACRO_ICON) updates.img = NOTES_MACRO_ICON;
    if (Object.keys(updates).length > 0) {
      macro = await macro.update(updates);
    }

    if (macro.getFlag(MODULE_ID, NOTES_MACRO_FLAG) !== true) {
      await macro.setFlag(MODULE_ID, NOTES_MACRO_FLAG, true);
    }
    return macro;
  }

  return Macro.create({
    name: NOTES_MACRO_NAME,
    type: "script",
    img: NOTES_MACRO_ICON,
    command: NOTES_MACRO_COMMAND,
    flags: {
      [MODULE_ID]: {
        [NOTES_MACRO_FLAG]: true
      }
    }
  });
}

async function ensureGmHotbarMacro(options = {}) {
  if (!game.user?.isGM) return;
  const forceTargetSlot = Boolean(options.forceTargetSlot);

  try {
    if (!isGmMacroAutomationEnabled()) {
      await detachManagedMacroFromHotbar();
      return;
    }

    const macro = await getOrCreateJetDestinMacro();
    if (!macro) return;

    const targetSlot = getConfiguredGmMacroSlot();
    const macroId = String(macro.id || "").trim();
    const assignedSlots = getAssignedMacroSlots(macroId);

    if (!forceTargetSlot && assignedSlots.length > 0 && !assignedSlots.includes(targetSlot)) {
      const currentSlot = assignedSlots[0];
      if (currentSlot !== targetSlot) {
        await game.settings.set(MODULE_ID, SETTING_GM_MACRO_SLOT, currentSlot);
      }
      return;
    }

    const slotsToClear = assignedSlots.filter(slot => slot !== targetSlot);
    await clearUserHotbarSlots(slotsToClear);

    const currentSlotMacroId = String(game.user?.hotbar?.[targetSlot] || "").trim();
    if (currentSlotMacroId === macroId) return;

    await game.user.assignHotbarMacro(macro, targetSlot);
  } catch (error) {
    console.error(`[${MODULE_ID}] failed to ensure GM hotbar macro`, error);
  }
}

async function ensureTileVisibilityHotbarMacro(options = {}) {
  if (!game.user?.isGM) return;
  const forceTargetSlot = Boolean(options.forceTargetSlot);

  try {
    if (!isTileMacroAutomationEnabled()) {
      await detachManagedTileMacroFromHotbar();
      return;
    }

    const macro = await getOrCreateTileVisibilityMacro();
    if (!macro) return;

    const targetSlot = getConfiguredTileMacroSlot();
    const macroId = String(macro.id || "").trim();
    const assignedSlots = getAssignedMacroSlots(macroId);

    if (!forceTargetSlot && assignedSlots.length > 0 && !assignedSlots.includes(targetSlot)) {
      const currentSlot = assignedSlots[0];
      if (currentSlot !== targetSlot) {
        await game.settings.set(MODULE_ID, SETTING_TILE_MACRO_SLOT, currentSlot);
      }
      return;
    }

    const slotsToClear = assignedSlots.filter(slot => slot !== targetSlot);
    await clearUserHotbarSlots(slotsToClear);

    const currentSlotMacroId = String(game.user?.hotbar?.[targetSlot] || "").trim();
    if (currentSlotMacroId === macroId) return;

    await game.user.assignHotbarMacro(macro, targetSlot);
  } catch (error) {
    console.error(`[${MODULE_ID}] failed to ensure tile visibility hotbar macro`, error);
  }
}

async function ensureNotesHotbarMacro(options = {}) {
  if (!game.user?.isGM) return;
  const forceTargetSlot = Boolean(options.forceTargetSlot);

  try {
    if (!isNotesMacroAutomationEnabled()) {
      await detachManagedNotesMacroFromHotbar();
      return;
    }

    const macro = await getOrCreateNotesMacro();
    if (!macro) return;

    const targetSlot = getConfiguredNotesMacroSlot();
    const macroId = String(macro.id || "").trim();
    const assignedSlots = getAssignedMacroSlots(macroId);

    if (!forceTargetSlot && assignedSlots.length > 0 && !assignedSlots.includes(targetSlot)) {
      const currentSlot = assignedSlots[0];
      if (currentSlot !== targetSlot) {
        await game.settings.set(MODULE_ID, SETTING_NOTES_MACRO_SLOT, currentSlot);
      }
      return;
    }

    const slotsToClear = assignedSlots.filter(slot => slot !== targetSlot);
    await clearUserHotbarSlots(slotsToClear);

    const currentSlotMacroId = String(game.user?.hotbar?.[targetSlot] || "").trim();
    if (currentSlotMacroId === macroId) return;

    await game.user.assignHotbarMacro(macro, targetSlot);
  } catch (error) {
    console.error(`[${MODULE_ID}] failed to ensure notes hotbar macro`, error);
  }
}


function getRenderedChatMessageRoot(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  if (html[0] instanceof HTMLElement) return html[0];
  if (typeof html.get === "function") {
    const first = html.get(0);
    if (first instanceof HTMLElement) return first;
  }
  return null;
}

function registerModuleSettings() {
  game.settings.register(MODULE_ID, SETTING_SCHEMA_VERSION, {
    name: "Schema Version",
    scope: "world",
    config: false,
    type: String,
    default: "0.0.0"
  });

  game.settings.register(MODULE_ID, SETTING_ENABLE_GM_MACRO, {
    name: t("BJD.Settings.EnableGmMacro.Name", "Activer la macro automatique du destin"),
    hint: t("BJD.Settings.EnableGmMacro.Hint", "Cree ou met a jour la macro et l'attribue automatiquement au slot configure."),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: async () => {
      if (!game.ready || !game.user?.isGM) return;
      await ensureGmHotbarMacro({ forceTargetSlot: true });
    }
  });

  game.settings.register(MODULE_ID, SETTING_GM_MACRO_SLOT, {
    name: t("BJD.Settings.GmMacroSlot.Name", "Slot de la macro GM"),
    hint: t("BJD.Settings.GmMacroSlot.Hint", "Numero de slot (1 a 50) dans la hotbar GM pour attribuer la macro."),
    scope: "world",
    config: true,
    type: Number,
    default: GM_MACRO_SLOT_DEFAULT,
    onChange: async () => {
      if (!game.ready || !game.user?.isGM) return;
      await ensureGmHotbarMacro({ forceTargetSlot: true });
    }
  });

  game.settings.register(MODULE_ID, SETTING_ENABLE_TILE_MACRO, {
    name: t("BJD.Settings.EnableTileMacro.Name", "Activer la macro de visibilite des tuiles"),
    hint: t("BJD.Settings.EnableTileMacro.Hint", "Cree ou met a jour automatiquement la macro de toggle des tuiles et l'assigne a la hotbar du GM."),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: async () => {
      if (!game.ready || !game.user?.isGM) return;
      await ensureTileVisibilityHotbarMacro({ forceTargetSlot: true });
    }
  });

  game.settings.register(MODULE_ID, SETTING_TILE_MACRO_SLOT, {
    name: t("BJD.Settings.TileMacroSlot.Name", "Slot hotbar macro tuiles"),
    hint: t("BJD.Settings.TileMacroSlot.Hint", "Choisir le slot de hotbar (1 a 50) pour la macro de toggle des tuiles."),
    scope: "world",
    config: true,
    type: Number,
    default: TILE_MACRO_SLOT_DEFAULT,
    onChange: async () => {
      if (!game.ready || !game.user?.isGM) return;
      await ensureTileVisibilityHotbarMacro({ forceTargetSlot: true });
    }
  });

  game.settings.register(MODULE_ID, SETTING_ENABLE_NOTES_MACRO, {
    name: t("BJD.Settings.EnableNotesMacro.Name", "Activer la macro automatique des notes"),
    hint: t("BJD.Settings.EnableNotesMacro.Hint", "Cree ou met a jour automatiquement la macro de notes et l'assigne a la hotbar du GM."),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: async () => {
      if (!game.ready || !game.user?.isGM) return;
      await ensureNotesHotbarMacro({ forceTargetSlot: true });
    }
  });

  game.settings.register(MODULE_ID, SETTING_NOTES_MACRO_SLOT, {
    name: t("BJD.Settings.NotesMacroSlot.Name", "Slot hotbar macro notes"),
    hint: t("BJD.Settings.NotesMacroSlot.Hint", "Choisir le slot de hotbar (1 a 50) pour la macro de notes."),
    scope: "world",
    config: true,
    type: Number,
    default: NOTES_MACRO_SLOT_DEFAULT,
    onChange: async () => {
      if (!game.ready || !game.user?.isGM) return;
      await ensureNotesHotbarMacro({ forceTargetSlot: true });
    }
  });
}

Hooks.once("init", () => {
  registerModuleSettings();

  const api = {
    rollJetDestin,
    toggleCurrentSceneTilesVisibility,
    openGmNotesWindow
  };

  const module = game.modules?.get?.(MODULE_ID);
  if (module) module.api = api;
  globalThis.bloodmanJetDestin = api;
});

Hooks.once("ready", async () => {
  try {
    await runModuleMigrations({
      moduleId: MODULE_ID,
      settingKey: SETTING_SCHEMA_VERSION,
      targetVersion: getModuleTargetVersion(),
      steps: getMigrationSteps()
    });
  } catch (error) {
    console.error(`[${MODULE_ID}] migration failed`, error);
    ui.notifications?.error("Migration Bloodman interrompue. Consultez la console.");
  }
  await ensureGmHotbarMacro();
  await ensureTileVisibilityHotbarMacro();
  await ensureNotesHotbarMacro();
});

Hooks.on("renderChatMessage", (message, html) => {
  const root = getRenderedChatMessageRoot(html);
  if (!root) return;

  const flagValue = message?.getFlag?.(MODULE_ID, VOYANCE_CHAT_CARD_FLAG);
  const isFlaggedVoyanceCard = Boolean(flagValue ?? message?.flags?.[MODULE_ID]?.[VOYANCE_CHAT_CARD_FLAG]);
  const hasVoyanceMarkup = Boolean(root.querySelector?.(".bjd-voyance-chat-card"));
  const isVoyanceCard = isFlaggedVoyanceCard || hasVoyanceMarkup;
  if (!isVoyanceCard) return;

  root.classList.add("bjd-voyance-chat-message");
  root.style.setProperty("background", "#05070d", "important");
  root.style.setProperty("border", "1px solid #000", "important");
  root.style.setProperty("color", "#e7ecf7", "important");
});

export {
  rollJetDestin,
  toggleCurrentSceneTilesVisibility,
  openGmNotesWindow
};
