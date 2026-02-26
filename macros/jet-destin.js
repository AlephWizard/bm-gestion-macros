const api = game.modules.get("bm-gestion-macros")?.api;
if (!api || typeof api.rollJetDestin !== "function") {
  ui.notifications?.warn("Module bm-gestion-macros inactif ou API indisponible.");
} else {
  await api.rollJetDestin();
}

