function parseVersion(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [0, 0, 0];
  const parts = raw.split(".");
  const safe = [];
  for (let i = 0; i < 3; i += 1) {
    const token = String(parts[i] ?? "").trim();
    const match = token.match(/^(\d+)/);
    const numeric = match ? Number(match[1]) : 0;
    safe.push(Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0);
  }
  return safe;
}

function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (va[i] > vb[i]) return 1;
    if (va[i] < vb[i]) return -1;
  }
  return 0;
}

function getLogger(moduleId) {
  return {
    info: (...args) => console.info(`[${moduleId}] migration`, ...args),
    warn: (...args) => console.warn(`[${moduleId}] migration`, ...args),
    error: (...args) => console.error(`[${moduleId}] migration`, ...args)
  };
}

function isActiveGmUser() {
  if (!game.user?.isGM) return false;
  const activeGmId = String(game.users?.activeGM?.id ?? "").trim();
  if (!activeGmId) return true;
  return activeGmId === String(game.user.id ?? "").trim();
}

export async function runModuleMigrations({
  moduleId,
  settingKey,
  targetVersion,
  steps = []
}) {
  const logger = getLogger(moduleId);

  if (!moduleId || !settingKey) {
    logger.warn("configuration invalide, migration ignoree");
    return { executed: false, reason: "invalid-config", ranSteps: [] };
  }

  if (!isActiveGmUser()) {
    const reason = game.user?.isGM ? "not-active-gm" : "not-gm";
    logger.info("ignoree", { reason });
    return { executed: false, reason, ranSteps: [] };
  }

  const currentSchemaVersion = String(game.settings.get(moduleId, settingKey) ?? "0.0.0");
  const resolvedTargetVersion = String(targetVersion ?? "0.0.0");
  const orderedSteps = [...steps]
    .filter(step => step && typeof step.run === "function" && step.version)
    .sort((a, b) => compareVersions(a.version, b.version));

  const pendingSteps = orderedSteps.filter((step) => (
    compareVersions(step.version, currentSchemaVersion) > 0
    && compareVersions(step.version, resolvedTargetVersion) <= 0
  ));

  if (!pendingSteps.length) {
    if (compareVersions(currentSchemaVersion, resolvedTargetVersion) < 0) {
      await game.settings.set(moduleId, settingKey, resolvedTargetVersion);
      logger.info("schema version avancee sans migration", {
        from: currentSchemaVersion,
        to: resolvedTargetVersion
      });
    }
    return {
      executed: true,
      fromVersion: currentSchemaVersion,
      toVersion: resolvedTargetVersion,
      ranSteps: []
    };
  }

  const context = {
    moduleId,
    logger,
    getSetting: (key) => game.settings.get(moduleId, key),
    setSetting: (key, value) => game.settings.set(moduleId, key, value)
  };

  const ranSteps = [];
  for (const step of pendingSteps) {
    const stepLabel = step.label || step.version;
    logger.info("start", { version: step.version, label: stepLabel });
    try {
      await step.run(context);
      ranSteps.push(step.version);
      logger.info("ok", { version: step.version, label: stepLabel });
    } catch (error) {
      logger.error("failed", { version: step.version, label: stepLabel, error });
      throw error;
    }
  }

  await game.settings.set(moduleId, settingKey, resolvedTargetVersion);
  logger.info("completed", {
    from: currentSchemaVersion,
    to: resolvedTargetVersion,
    ranSteps
  });

  return {
    executed: true,
    fromVersion: currentSchemaVersion,
    toVersion: resolvedTargetVersion,
    ranSteps
  };
}
