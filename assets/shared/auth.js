// ════════════════════════════════════════════════════════════════
// CLINICA CENTRAL — Auth helpers
// Verifica sesiunea + accesul la aplicatie (tabela cc_useri_acces).
// ════════════════════════════════════════════════════════════════

window.ClinicaAuth = (function() {

  // Returns: { user, hasAccess, accesInfo } sau null daca nu e logat
  async function checkAuth() {
    if (!window.sb) return null;

    var sessionResult = await window.sb.auth.getSession();
    var session = sessionResult.data.session;
    if (!session || !session.user) return null;

    var user = session.user;

    // Verifica daca userul are acces in tabela cc_useri_acces
    var accessResult = await window.sb
      .from("cc_useri_acces")
      .select("user_id, email, nume, acces_central, is_admin")
      .eq("user_id", user.id)
      .maybeSingle();

    if (accessResult.error) {
      console.warn("[Auth] Eroare la verificare acces:", accessResult.error.message);
    }

    var accesInfo = accessResult.data;
    var hasAccess = !!(accesInfo && accesInfo.acces_central);

    return {
      user: user,
      hasAccess: hasAccess,
      accesInfo: accesInfo
    };
  }

  // Foloseste pe paginile protejate (app-source.html, etc.) — daca nu e logat sau nu are acces, redirect la login.
  async function requireAuth() {
    var auth = await checkAuth();
    if (!auth) {
      // Nu e logat — la login
      window.location.href = "login.html";
      return null;
    }
    if (!auth.hasAccess) {
      // E logat dar nu are acces — afiseaza mesaj + buton de logout
      document.body.innerHTML =
        '<div style="max-width:480px;margin:80px auto;padding:32px;background:#fff;border:2px solid #c8392b;border-radius:8px;font-family:DM Sans,sans-serif;text-align:center">' +
        '<h2 style="font-family:DM Serif Display,serif;color:#c8392b;margin-bottom:16px">Nu ai acces la aceasta aplicatie</h2>' +
        '<p style="margin-bottom:8px">Esti autentificat ca <strong>' + esc(auth.user.email) + '</strong> dar nu ai permisiunea de a folosi Clinica Central — Cerere analize.</p>' +
        '<p style="margin-bottom:24px;font-size:13px;color:#666">Contacteaza administratorul daca crezi ca ar trebui sa ai acces.</p>' +
        '<button onclick="ClinicaAuth.logout()" style="padding:12px 24px;background:#0F1117;color:#fff;border:none;border-radius:4px;font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;cursor:pointer">Deconecteaza-te</button>' +
        '</div>';
      return null;
    }
    return auth;
  }

  async function logout() {
    if (!window.sb) {
      window.location.href = "login.html";
      return;
    }
    await window.sb.auth.signOut();
    window.location.href = "login.html";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function(c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  return {
    checkAuth: checkAuth,
    requireAuth: requireAuth,
    logout: logout
  };
})();
