// app/common.js

function getExamFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("exam") || "sat").toLowerCase();
}

function getConfigPath(examId) {
  // da /app/*.html a /packs/<examId>/config.json
  return `../packs/${examId}/config.json?v=${Date.now()}`;

}

async function loadConfig(examId) {
  const res = await fetch(getConfigPath(examId), { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load config for "${examId}"`);
  return res.json();
}

function accessKey(examId) {
  return `accessGranted_${examId}`;
}

function isAccessGranted(examId) {
  return localStorage.getItem(accessKey(examId)) === "yes";
}

function grantAccess(examId) {
  localStorage.setItem(accessKey(examId), "yes");
}

function revokeAccess(examId) {
  localStorage.removeItem(accessKey(examId));
}

function goToApp(examId) {
  window.location.href = `app.html?exam=${encodeURIComponent(examId)}`;
}

function goToWelcome(examId) {
  window.location.href = `index.html?exam=${encodeURIComponent(examId)}`;
}
function applyTheme(theme) {
  document.body.classList.remove("theme-light", "theme-dark");
  document.body.classList.add(theme === "light" ? "theme-light" : "theme-dark");
}