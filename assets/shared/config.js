// ════════════════════════════════════════════════════════════════
// CLINICA CENTRAL — Configurare medii (staging vs production)
// Detectare automata pe baza de hostname.
// ════════════════════════════════════════════════════════════════

(function() {
  // Hostname-ul pe care ruleaza versiunea de PROD.
  // Schimba aici cand muti la domeniul final.
  var PROD_HOSTNAMES = [
    "cerere.clinicacentral.ro"
  ];

  // Configurare PROD
  var PROD_CONFIG = {
    ENV: "production",
    SUPABASE_URL: "https://hqfobteziomffildcssy.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxZm9idGV6aW9tZmZpbGRjc3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNjA3MjIsImV4cCI6MjA5MjczNjcyMn0.fVvWISCGZY-RzI0f1VC8xDOzn5NYWbCtxQwztqenJp0"
  };

  // Configurare STAGING
  var STAGING_CONFIG = {
    ENV: "staging",
    SUPABASE_URL: "https://bqlypbpxyhvvdmjybygw.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxbHlwYnB4eWh2dmRtanlieWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NTgzOTEsImV4cCI6MjA5MzQzNDM5MX0.fGdjLm1fJfNW6dZJQSG9E3A-L1XrPtUHFN9YtO5q9o0"
  };

  // Detecteaza mediul curent
  var hostname = location.hostname;
  var isProduction = PROD_HOSTNAMES.indexOf(hostname) !== -1;
  var isStaging = !isProduction;

  window.CLINICA_CONFIG = isProduction ? PROD_CONFIG : STAGING_CONFIG;

  // ────────────────────────────────────────────────────────────────
  // Gemini API key (Google AI Studio) — same for staging & prod.
  // Inlocuieste valoarea de mai jos cu cheia ta de la
  // https://aistudio.google.com/apikey
  // ────────────────────────────────────────────────────────────────
  window.CLINICA_CONFIG.GEMINI_API_KEY = "AQ.Ab8RN6KS1BqRxNl-_ZQOAm5F26UdzLhK4wM2BAHQE_1uDPkKrA";

  // Banner vizibil pe staging — ca sa nu confunzi mediile
  if (isStaging) {
    window.addEventListener("DOMContentLoaded", function() {
      var banner = document.createElement("div");
      banner.id = "stagingBanner";
      banner.style.cssText = "position:fixed;top:0;left:0;right:0;background:#f59e0b;color:#000;padding:6px;text-align:center;font-family:monospace;font-size:11px;font-weight:700;letter-spacing:0.1em;z-index:99999;border-bottom:2px solid #000";
      banner.textContent = "\u26A0 STAGING ENVIRONMENT \u2014 DATELE NU SUNT REALE \u26A0";
      document.body.appendChild(banner);
      document.body.style.paddingTop = "28px";
    });
  }

  console.log("[Clinica Central] Environment:", window.CLINICA_CONFIG.ENV);
})();
