// ════════════════════════════════════════════════════════════════
// CLINICA CENTRAL — unified app
// View 1: Cart (CNP + search + process)
// View 2: Browse (legacy table explorer)
// ════════════════════════════════════════════════════════════════

var DATA = window.__ANALIZE_DATA__ || [];
var DETAILS = {
  "Clinica Sante": window.__DETAILS_SANTE__ || {},
  "Binisan":       window.__DETAILS_BINISAN__ || {},
  "Poliana":       window.__DETAILS_POLIANA__ || {},
  "Solomed":       window.__DETAILS_SOLOMED__ || {},
  "Medilab":       window.__DETAILS_MEDILAB__ || {}
};

var DEFAULT_DISCOUNTS = {
  "Clinica Sante": 25, "Binisan": 20, "Derzelius": 10,
  "Medilab": 15, "Poliana": 0, "Solomed": 20
};
var discounts = Object.assign({}, DEFAULT_DISCOUNTS);

// ────────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────────
function discPct(lab) {
  var v = discounts[lab];
  return (typeof v === "number" && !isNaN(v)) ? Math.max(0, Math.min(90, v)) : 0;
}
function finalPrice(orig, lab) {
  return Math.round(orig * (1 - discPct(lab) / 100));
}
function labCls(lab) {
  var map = { "Clinica Sante":"sante", "Binisan":"binisan", "Derzelius":"derzelius",
              "Medilab":"medilab", "Poliana":"poliana", "Solomed":"solomed" };
  return map[lab] || "sante";
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
  });
}
function normName(s) {
  if (!s) return "";
  s = s.toLowerCase().trim();
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/[^\w\s]/g, " ");
  return s.replace(/\s+/g, " ").trim();
}
function fmtRon(n) { return Number(n).toLocaleString("ro-RO") + " RON"; }

// Build a safe filename based on patient name + CNP + date
function buildPatientFilename(prefix) {
  var fullName = (cartState.prenume.trim() + "_" + cartState.nume.trim())
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // strip diacritics
    .replace(/[^a-z0-9_]/g, "")
    .substring(0, 40);
  var date = new Date();
  var dateStr = date.getFullYear() + "-" + String(date.getMonth()+1).padStart(2,"0") + "-" + String(date.getDate()).padStart(2,"0");
  var parts = [prefix];
  if (fullName) parts.push(fullName);
  if (cartState.cnp) parts.push(cartState.cnp);
  parts.push(dateStr);
  return parts.join("_");
}

function getDetails(lab, denumire) {
  var map = DETAILS[lab];
  if (!map) return null;
  return map[normName(denumire)] || null;
}

// Pret Clinica Central (catalog propriu) — keyed by normalized name
var PRETURI_CC = window.__PRETURI_CC__ || {};
function getCCPrice(denumire) {
  var p = PRETURI_CC[normName(denumire)];
  return (typeof p === "number") ? p : null;
}
// Effective price = pret CC if available, else lab discounted price + 5% markup.
// Used for the FINAL report (modal + Excel + JSON + Istoric) so we charge
// our own catalog price; lab pricing stays visible only in cart for comparison.
function effectivePrice(denumire, laborator, pretLista) {
  var cc = getCCPrice(denumire);
  if (cc !== null) return { price: cc, source: "cc" };
  // Fallback: discounted lab price + 5%
  var discounted = finalPrice(pretLista, laborator);
  return { price: Math.round(discounted * 1.05 * 100) / 100, source: "lab+5%" };
}

// Cached base64 representation of the topbar logo, used for PDF exports.
// We convert via canvas once, then reuse. Returns { dataUrl, w, h } or null if unavailable.
var __LOGO_CACHE__ = null;
function getLogoForPdf() {
  if (__LOGO_CACHE__) return __LOGO_CACHE__;
  try {
    var img = document.querySelector(".topbar-logo");
    if (!img || !img.complete || !img.naturalWidth) return null;
    var canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    __LOGO_CACHE__ = {
      dataUrl: canvas.toDataURL("image/jpeg", 0.92),
      w: img.naturalWidth,
      h: img.naturalHeight
    };
    return __LOGO_CACHE__;
  } catch (e) {
    console.warn("[getLogoForPdf] cannot read logo:", e);
    return null;
  }
}

function fmtRecipient(d) {
  if (!d) return "";
  var parts = [];
  if (d.Recipient) parts.push(d.Recipient);
  if (d.CuloareDop) parts.push("dop " + d.CuloareDop);
  return parts.join(" — ");
}

// Build summary of physical tubes needed.
// Rule: 1 tube per (location, recipient_type) — analize at the SAME location with SAME tube type share one tube.
// "Location" comes from LaboratorSubcontractant (where the sample is physically processed).
// If a lab has no LaboratorSubcontractant in details, we fall back to the lab name.
// items: array of { offer: { Laborator, Denumire }, ... }
// Returns: array of { tip, count, breakdown: { location: count } } sorted by count desc
function buildEprubetSummary(items) {
  // Step 1: per (location, tip_eprubeta) — collect unique tubes
  var locTubeSet = {};  // key: location + "|||" + tip → { location, tip }
  var locTubeAnalize = {};  // key → array of denumiri (for tooltip / detail)

  for (var i = 0; i < items.length; i++) {
    var lab = items[i].offer.Laborator;
    var d = getDetails(lab, items[i].offer.Denumire);
    if (!d) continue;  // no detail = unknown tube → skip
    var tip = fmtRecipient(d);
    if (!tip) continue;
    // Use location from details, fallback to lab name
    var loc = d.LaboratorSubcontractant || lab;
    var key = loc + "|||" + tip;
    if (!locTubeSet[key]) {
      locTubeSet[key] = { location: loc, tip: tip };
      locTubeAnalize[key] = [];
    }
    locTubeAnalize[key].push(items[i].offer.Denumire);
  }

  // Step 2: aggregate by tip → count tubes (= unique locations per tip)
  var byTip = {};  // tip → { count, breakdown: {location: count}, denumiri: [...] }
  var keys = Object.keys(locTubeSet);
  for (var k = 0; k < keys.length; k++) {
    var entry = locTubeSet[keys[k]];
    if (!byTip[entry.tip]) byTip[entry.tip] = { tip: entry.tip, count: 0, breakdown: {}, denumiri: [] };
    byTip[entry.tip].count += 1;
    byTip[entry.tip].breakdown[entry.location] = (byTip[entry.tip].breakdown[entry.location] || 0) + 1;
    byTip[entry.tip].denumiri = byTip[entry.tip].denumiri.concat(locTubeAnalize[keys[k]]);
  }

  // Convert to array and sort
  var result = Object.values(byTip);
  result.sort(function(a, b) { return b.count - a.count || a.tip.localeCompare(b.tip); });
  return result;
}

// Build analize index: normalized name → { displayName, offers: [records] }
var ANALIZE_INDEX = (function() {
  var idx = {};
  for (var i = 0; i < DATA.length; i++) {
    var r = DATA[i];
    var key = normName(r.Denumire);
    if (!idx[key]) idx[key] = { key: key, displayName: r.Denumire, offers: [] };
    idx[key].offers.push(r);
  }
  return idx;
})();
var ANALIZE_LIST = Object.keys(ANALIZE_INDEX).map(function(k){ return ANALIZE_INDEX[k]; });

function cheapestOffer(entry) {
  var best = null, bestPrice = Infinity;
  for (var i = 0; i < entry.offers.length; i++) {
    var o = entry.offers[i];
    var fp = finalPrice(o.Pret, o.Laborator);
    if (fp < bestPrice) { bestPrice = fp; best = o; }
  }
  return { offer: best, finalPrice: bestPrice };
}

// ════════════════════════════════════════════════════════════════
// TAB SWITCHER
// ════════════════════════════════════════════════════════════════
function switchView(name) {
  document.getElementById("viewCart").style.display = (name === "cart") ? "block" : "none";
  document.getElementById("viewBrowse").style.display = (name === "browse") ? "block" : "none";
  document.getElementById("viewIstoric").style.display = (name === "istoric") ? "block" : "none";
  var bordEl = document.getElementById("viewBorderouri");
  if (bordEl) bordEl.style.display = (name === "borderouri") ? "block" : "none";
  var tabs = document.querySelectorAll(".topbar-tab");
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    var isActive = t.getAttribute("data-view") === name;
    t.classList.toggle("active", isActive);
    t.setAttribute("aria-selected", isActive ? "true" : "false");
  }
  if (name === "cart") {
    if (!cartState.pacientValid) {
      if (!cartState.prenumeValid) prenumeInput.focus();
      else if (!cartState.numeValid) numeInput.focus();
      else cnpInput.focus();
    } else {
      cartSearchInput.focus();
    }
  } else if (name === "browse") {
    document.getElementById("q").focus();
  } else if (name === "istoric") {
    if (typeof loadIstoric === "function") loadIstoric();
  } else if (name === "borderouri") {
    if (typeof loadBorderouri === "function") loadBorderouri();
  }
}
var tabs = document.querySelectorAll(".topbar-tab");
for (var i = 0; i < tabs.length; i++) {
  (function(t) {
    t.addEventListener("click", function() { switchView(t.getAttribute("data-view")); });
  })(tabs[i]);
}

// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
// VIEW 1: CART
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════

var cartState = {
  cart: [],
  // Patient fields
  prenume: "",
  nume: "",
  cnp: "",
  email: "",
  telefonPrefix: "+40",
  telefonNumar: "",
  // Validation flags
  prenumeValid: false,
  numeValid: false,
  cnpValid: false,
  pacientValid: false  // true when all required fields are valid
};

var cnpInput = document.getElementById("cnpInput");
var cnpStatus = document.getElementById("cnpStatus");
var cnpError = document.getElementById("cnpError");
var prenumeInput = document.getElementById("pacientPrenume");
var numeInput = document.getElementById("pacientNume");
var emailInput = document.getElementById("pacientEmail");
var telefonPrefixSelect = document.getElementById("pacientTelefonPrefix");
var telefonNumarInput = document.getElementById("pacientTelefonNumar");
var cartSearchInput = document.getElementById("cartSearchInput");
var cartSuggestionsEl = document.getElementById("cartSuggestions");
var cartEmptyHintEl = document.getElementById("cartEmptyHint");
var cartListEl = document.getElementById("cartList");
var cartCountEl = document.getElementById("cartCount");
var cartTotalEl = document.getElementById("cartTotal");
var cartEmptyEl = document.getElementById("cartEmpty");
var btnProcess = document.getElementById("btnProcess");

// ─── Lista prefixe telefon (tari sortate alfabetic, RO primul) ───
var TELEFON_PREFIXES = [
  { code: "RO", prefix: "+40", name: "Romania" },
  // Restul sortate alfabetic dupa nume
  { code: "AF", prefix: "+93", name: "Afganistan" },
  { code: "AL", prefix: "+355", name: "Albania" },
  { code: "DZ", prefix: "+213", name: "Algeria" },
  { code: "AD", prefix: "+376", name: "Andorra" },
  { code: "AO", prefix: "+244", name: "Angola" },
  { code: "AR", prefix: "+54", name: "Argentina" },
  { code: "AM", prefix: "+374", name: "Armenia" },
  { code: "AU", prefix: "+61", name: "Australia" },
  { code: "AT", prefix: "+43", name: "Austria" },
  { code: "AZ", prefix: "+994", name: "Azerbaidjan" },
  { code: "BH", prefix: "+973", name: "Bahrain" },
  { code: "BD", prefix: "+880", name: "Bangladesh" },
  { code: "BY", prefix: "+375", name: "Belarus" },
  { code: "BE", prefix: "+32", name: "Belgia" },
  { code: "BZ", prefix: "+501", name: "Belize" },
  { code: "BJ", prefix: "+229", name: "Benin" },
  { code: "BO", prefix: "+591", name: "Bolivia" },
  { code: "BA", prefix: "+387", name: "Bosnia si Hertegovina" },
  { code: "BW", prefix: "+267", name: "Botswana" },
  { code: "BR", prefix: "+55", name: "Brazilia" },
  { code: "BN", prefix: "+673", name: "Brunei" },
  { code: "BG", prefix: "+359", name: "Bulgaria" },
  { code: "BF", prefix: "+226", name: "Burkina Faso" },
  { code: "BI", prefix: "+257", name: "Burundi" },
  { code: "BT", prefix: "+975", name: "Bhutan" },
  { code: "KH", prefix: "+855", name: "Cambodgia" },
  { code: "CM", prefix: "+237", name: "Camerun" },
  { code: "CA", prefix: "+1", name: "Canada" },
  { code: "CV", prefix: "+238", name: "Cape Verde" },
  { code: "TD", prefix: "+235", name: "Ciad" },
  { code: "CL", prefix: "+56", name: "Chile" },
  { code: "CN", prefix: "+86", name: "China" },
  { code: "CY", prefix: "+357", name: "Cipru" },
  { code: "CO", prefix: "+57", name: "Columbia" },
  { code: "KM", prefix: "+269", name: "Comore" },
  { code: "CG", prefix: "+242", name: "Congo" },
  { code: "CD", prefix: "+243", name: "Congo (RDC)" },
  { code: "KP", prefix: "+850", name: "Coreea de Nord" },
  { code: "KR", prefix: "+82", name: "Coreea de Sud" },
  { code: "CR", prefix: "+506", name: "Costa Rica" },
  { code: "CI", prefix: "+225", name: "Coasta de Fildes" },
  { code: "HR", prefix: "+385", name: "Croatia" },
  { code: "CU", prefix: "+53", name: "Cuba" },
  { code: "DK", prefix: "+45", name: "Danemarca" },
  { code: "DJ", prefix: "+253", name: "Djibouti" },
  { code: "DM", prefix: "+1767", name: "Dominica" },
  { code: "DO", prefix: "+1809", name: "Republica Dominicana" },
  { code: "EC", prefix: "+593", name: "Ecuador" },
  { code: "EG", prefix: "+20", name: "Egipt" },
  { code: "SV", prefix: "+503", name: "El Salvador" },
  { code: "AE", prefix: "+971", name: "Emiratele Arabe Unite" },
  { code: "ER", prefix: "+291", name: "Eritreea" },
  { code: "EE", prefix: "+372", name: "Estonia" },
  { code: "ET", prefix: "+251", name: "Etiopia" },
  { code: "FJ", prefix: "+679", name: "Fiji" },
  { code: "PH", prefix: "+63", name: "Filipine" },
  { code: "FI", prefix: "+358", name: "Finlanda" },
  { code: "FR", prefix: "+33", name: "Franta" },
  { code: "GA", prefix: "+241", name: "Gabon" },
  { code: "GM", prefix: "+220", name: "Gambia" },
  { code: "GE", prefix: "+995", name: "Georgia" },
  { code: "DE", prefix: "+49", name: "Germania" },
  { code: "GH", prefix: "+233", name: "Ghana" },
  { code: "GR", prefix: "+30", name: "Grecia" },
  { code: "GD", prefix: "+1473", name: "Grenada" },
  { code: "GT", prefix: "+502", name: "Guatemala" },
  { code: "GN", prefix: "+224", name: "Guineea" },
  { code: "GW", prefix: "+245", name: "Guineea-Bissau" },
  { code: "GQ", prefix: "+240", name: "Guineea Ecuatoriala" },
  { code: "GY", prefix: "+592", name: "Guyana" },
  { code: "HT", prefix: "+509", name: "Haiti" },
  { code: "HN", prefix: "+504", name: "Honduras" },
  { code: "IN", prefix: "+91", name: "India" },
  { code: "ID", prefix: "+62", name: "Indonezia" },
  { code: "IQ", prefix: "+964", name: "Irak" },
  { code: "IR", prefix: "+98", name: "Iran" },
  { code: "IE", prefix: "+353", name: "Irlanda" },
  { code: "IS", prefix: "+354", name: "Islanda" },
  { code: "IL", prefix: "+972", name: "Israel" },
  { code: "IT", prefix: "+39", name: "Italia" },
  { code: "JM", prefix: "+1876", name: "Jamaica" },
  { code: "JP", prefix: "+81", name: "Japonia" },
  { code: "JO", prefix: "+962", name: "Iordania" },
  { code: "KZ", prefix: "+7", name: "Kazahstan" },
  { code: "KE", prefix: "+254", name: "Kenya" },
  { code: "KG", prefix: "+996", name: "Kirghistan" },
  { code: "KI", prefix: "+686", name: "Kiribati" },
  { code: "KW", prefix: "+965", name: "Kuwait" },
  { code: "LA", prefix: "+856", name: "Laos" },
  { code: "LS", prefix: "+266", name: "Lesotho" },
  { code: "LV", prefix: "+371", name: "Letonia" },
  { code: "LB", prefix: "+961", name: "Liban" },
  { code: "LR", prefix: "+231", name: "Liberia" },
  { code: "LY", prefix: "+218", name: "Libia" },
  { code: "LI", prefix: "+423", name: "Liechtenstein" },
  { code: "LT", prefix: "+370", name: "Lituania" },
  { code: "LU", prefix: "+352", name: "Luxemburg" },
  { code: "MK", prefix: "+389", name: "Macedonia" },
  { code: "MG", prefix: "+261", name: "Madagascar" },
  { code: "MY", prefix: "+60", name: "Malaezia" },
  { code: "MW", prefix: "+265", name: "Malawi" },
  { code: "MV", prefix: "+960", name: "Maldive" },
  { code: "ML", prefix: "+223", name: "Mali" },
  { code: "MT", prefix: "+356", name: "Malta" },
  { code: "MA", prefix: "+212", name: "Maroc" },
  { code: "MH", prefix: "+692", name: "Insulele Marshall" },
  { code: "MR", prefix: "+222", name: "Mauritania" },
  { code: "MU", prefix: "+230", name: "Mauritius" },
  { code: "MX", prefix: "+52", name: "Mexic" },
  { code: "FM", prefix: "+691", name: "Micronezia" },
  { code: "MD", prefix: "+373", name: "Moldova" },
  { code: "MC", prefix: "+377", name: "Monaco" },
  { code: "MN", prefix: "+976", name: "Mongolia" },
  { code: "ME", prefix: "+382", name: "Muntenegru" },
  { code: "MZ", prefix: "+258", name: "Mozambic" },
  { code: "MM", prefix: "+95", name: "Myanmar" },
  { code: "NA", prefix: "+264", name: "Namibia" },
  { code: "NR", prefix: "+674", name: "Nauru" },
  { code: "NP", prefix: "+977", name: "Nepal" },
  { code: "NI", prefix: "+505", name: "Nicaragua" },
  { code: "NE", prefix: "+227", name: "Niger" },
  { code: "NG", prefix: "+234", name: "Nigeria" },
  { code: "NO", prefix: "+47", name: "Norvegia" },
  { code: "NZ", prefix: "+64", name: "Noua Zeelanda" },
  { code: "NL", prefix: "+31", name: "Olanda" },
  { code: "OM", prefix: "+968", name: "Oman" },
  { code: "PK", prefix: "+92", name: "Pakistan" },
  { code: "PW", prefix: "+680", name: "Palau" },
  { code: "PS", prefix: "+970", name: "Palestina" },
  { code: "PA", prefix: "+507", name: "Panama" },
  { code: "PG", prefix: "+675", name: "Papua Noua Guinee" },
  { code: "PY", prefix: "+595", name: "Paraguay" },
  { code: "PE", prefix: "+51", name: "Peru" },
  { code: "PL", prefix: "+48", name: "Polonia" },
  { code: "PT", prefix: "+351", name: "Portugalia" },
  { code: "QA", prefix: "+974", name: "Qatar" },
  { code: "GB", prefix: "+44", name: "Regatul Unit" },
  { code: "CZ", prefix: "+420", name: "Cehia" },
  { code: "CF", prefix: "+236", name: "Republica Centrafricana" },
  { code: "RU", prefix: "+7", name: "Rusia" },
  { code: "RW", prefix: "+250", name: "Rwanda" },
  { code: "KN", prefix: "+1869", name: "Saint Kitts si Nevis" },
  { code: "LC", prefix: "+1758", name: "Saint Lucia" },
  { code: "VC", prefix: "+1784", name: "Saint Vincent" },
  { code: "WS", prefix: "+685", name: "Samoa" },
  { code: "SM", prefix: "+378", name: "San Marino" },
  { code: "ST", prefix: "+239", name: "Sao Tome si Principe" },
  { code: "SA", prefix: "+966", name: "Arabia Saudita" },
  { code: "SN", prefix: "+221", name: "Senegal" },
  { code: "RS", prefix: "+381", name: "Serbia" },
  { code: "SC", prefix: "+248", name: "Seychelles" },
  { code: "SL", prefix: "+232", name: "Sierra Leone" },
  { code: "SG", prefix: "+65", name: "Singapore" },
  { code: "SK", prefix: "+421", name: "Slovacia" },
  { code: "SI", prefix: "+386", name: "Slovenia" },
  { code: "SB", prefix: "+677", name: "Insulele Solomon" },
  { code: "SO", prefix: "+252", name: "Somalia" },
  { code: "ES", prefix: "+34", name: "Spania" },
  { code: "LK", prefix: "+94", name: "Sri Lanka" },
  { code: "SD", prefix: "+249", name: "Sudan" },
  { code: "SS", prefix: "+211", name: "Sudanul de Sud" },
  { code: "SE", prefix: "+46", name: "Suedia" },
  { code: "CH", prefix: "+41", name: "Elvetia" },
  { code: "SR", prefix: "+597", name: "Surinam" },
  { code: "SZ", prefix: "+268", name: "Eswatini" },
  { code: "SY", prefix: "+963", name: "Siria" },
  { code: "TJ", prefix: "+992", name: "Tadjikistan" },
  { code: "TZ", prefix: "+255", name: "Tanzania" },
  { code: "TH", prefix: "+66", name: "Thailanda" },
  { code: "TL", prefix: "+670", name: "Timorul de Est" },
  { code: "TG", prefix: "+228", name: "Togo" },
  { code: "TO", prefix: "+676", name: "Tonga" },
  { code: "TT", prefix: "+1868", name: "Trinidad si Tobago" },
  { code: "TN", prefix: "+216", name: "Tunisia" },
  { code: "TR", prefix: "+90", name: "Turcia" },
  { code: "TM", prefix: "+993", name: "Turkmenistan" },
  { code: "TV", prefix: "+688", name: "Tuvalu" },
  { code: "UA", prefix: "+380", name: "Ucraina" },
  { code: "UG", prefix: "+256", name: "Uganda" },
  { code: "HU", prefix: "+36", name: "Ungaria" },
  { code: "UY", prefix: "+598", name: "Uruguay" },
  { code: "US", prefix: "+1", name: "Statele Unite" },
  { code: "UZ", prefix: "+998", name: "Uzbekistan" },
  { code: "VU", prefix: "+678", name: "Vanuatu" },
  { code: "VA", prefix: "+39", name: "Vatican" },
  { code: "VE", prefix: "+58", name: "Venezuela" },
  { code: "VN", prefix: "+84", name: "Vietnam" },
  { code: "YE", prefix: "+967", name: "Yemen" },
  { code: "ZM", prefix: "+260", name: "Zambia" },
  { code: "ZW", prefix: "+263", name: "Zimbabwe" }
];

// Populate native <select> with one <option> per country
function populateTelefonPrefixes() {
  var html = "";
  for (var i = 0; i < TELEFON_PREFIXES.length; i++) {
    var t = TELEFON_PREFIXES[i];
    // Put country name FIRST so browser's type-to-search works
    // (apesi "R" -> sare la prima cu R; "F" -> Franta; etc.)
    html += '<option value="' + esc(t.prefix) + '"' +
      (t.prefix === "+40" ? ' selected' : '') + '>' +
      esc(t.name) + ' (' + esc(t.prefix) + ')</option>';
  }
  telefonPrefixSelect.innerHTML = html;
}
populateTelefonPrefixes();

// ─── Validation helpers ───
function isCnpValid(s) { return /^\d{13}$/.test(s); }
function isEmailValid(s) { return s === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

function updatePacientValidation() {
  cartState.prenumeValid = cartState.prenume.trim().length >= 2;
  cartState.numeValid = cartState.nume.trim().length >= 2;
  cartState.cnpValid = isCnpValid(cartState.cnp);
  // Email and phone are optional, but if filled, email should be valid
  var emailOk = cartState.email === "" || isEmailValid(cartState.email);

  cartState.pacientValid =
    cartState.prenumeValid && cartState.numeValid && cartState.cnpValid && emailOk;

  cartSearchInput.disabled = !cartState.pacientValid;
  if (cartState.pacientValid) {
    cartSearchInput.placeholder = "Ex: TSH, hemoleucograma, vitamina D...";
  } else {
    cartSearchInput.placeholder = "Completeaza datele pacientului mai sus...";
    if (cartSearchInput.value) {
      cartSearchInput.value = "";
      cartSuggestionsEl.classList.remove("visible");
      cartEmptyHintEl.style.display = "block";
    }
  }
}

// ─── CNP ───
function updateCnpUi() {
  var raw = cnpInput.value;
  var digits = raw.replace(/\D/g, "").slice(0, 13);
  if (digits !== raw) cnpInput.value = digits;
  cartState.cnp = digits;

  cnpInput.classList.remove("valid", "invalid");
  cnpStatus.classList.remove("valid", "invalid");
  cnpStatus.textContent = "";
  cnpError.textContent = "";

  if (digits.length === 0) {
    // neutral
  } else if (digits.length < 13) {
    cnpInput.classList.add("invalid");
    cnpStatus.classList.add("invalid");
    cnpStatus.textContent = "\u2717";
    cnpError.textContent = "CNP incomplet (" + digits.length + "/13 cifre)";
  } else {
    cnpInput.classList.add("valid");
    cnpStatus.classList.add("valid");
    cnpStatus.textContent = "\u2713";
  }
  updatePacientValidation();
}
cnpInput.addEventListener("input", updateCnpUi);
cnpInput.addEventListener("blur", updateCnpUi);

// ─── Other patient fields ───
function updateNumeField(input, stateKey, validKey) {
  var v = input.value;
  // Allow letters (incl Romanian diacritics), spaces, hyphens, apostrophes
  // We don't strip — let the user type, just validate
  var trimmed = v.trim();
  cartState[stateKey] = v;
  input.classList.remove("valid", "invalid");
  if (trimmed.length === 0) {
    // neutral
  } else if (trimmed.length < 2) {
    input.classList.add("invalid");
  } else {
    input.classList.add("valid");
  }
  updatePacientValidation();
}

prenumeInput.addEventListener("input", function() { updateNumeField(prenumeInput, "prenume"); });
prenumeInput.addEventListener("blur", function() { updateNumeField(prenumeInput, "prenume"); });
numeInput.addEventListener("input", function() { updateNumeField(numeInput, "nume"); });
numeInput.addEventListener("blur", function() { updateNumeField(numeInput, "nume"); });

emailInput.addEventListener("input", function() {
  var v = emailInput.value.trim();
  cartState.email = v;
  emailInput.classList.remove("valid", "invalid");
  if (v.length === 0) {
    // neutral - email is optional
  } else if (isEmailValid(v)) {
    emailInput.classList.add("valid");
  } else {
    emailInput.classList.add("invalid");
  }
  updatePacientValidation();
});

// Simple native select change
telefonPrefixSelect.addEventListener("change", function() {
  cartState.telefonPrefix = telefonPrefixSelect.value;
});
telefonNumarInput.addEventListener("input", function() {
  // Strip everything except digits and spaces
  var v = telefonNumarInput.value.replace(/[^\d\s]/g, '');
  if (v !== telefonNumarInput.value) telefonNumarInput.value = v;
  cartState.telefonNumar = v.trim();
});

// ─── Cart search ───
function doCartSearch() {
  var q = cartSearchInput.value.trim().toLowerCase();
  if (q.length < 2) {
    cartSuggestionsEl.classList.remove("visible");
    cartEmptyHintEl.style.display = "block";
    return;
  }
  cartEmptyHintEl.style.display = "none";

  // Iterate over the FLAT list of offers — show each (Denumire, Laborator) as separate result
  var starts = [], contains = [];
  for (var i = 0; i < DATA.length; i++) {
    var r = DATA[i];
    var nm = r.Denumire.toLowerCase();
    if (nm.indexOf(q) === 0) starts.push(r);
    else if (nm.indexOf(q) !== -1) contains.push(r);
  }
  function byCheapest(a, b) {
    return finalPrice(a.Pret, a.Laborator) - finalPrice(b.Pret, b.Laborator);
  }
  starts.sort(byCheapest);
  contains.sort(byCheapest);
  var results = starts.concat(contains).slice(0, 60);

  if (results.length === 0) {
    cartSuggestionsEl.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(15,17,23,0.4);font-size:13px">Nicio analiza potrivita.</div>';
    cartSuggestionsEl.classList.add("visible");
    return;
  }

  var html = "";
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var k = normName(r.Denumire);
    // "in cart" = exact same (key + lab) is already added
    var inCart = cartState.cart.some(function(c){ return c.key === k && c.lab === r.Laborator; });
    var fp = finalPrice(r.Pret, r.Laborator);
    var disc = discPct(r.Laborator);
    var hasDetails = !!getDetails(r.Laborator, r.Denumire);
    // Encode offer identifier in data attrs
    html += '<div class="suggestion" data-key="' + esc(k) + '" data-lab="' + esc(r.Laborator) + '"' + (inCart ? ' style="opacity:0.5;pointer-events:none"' : '') + '>';
    html += '<div class="suggestion-info">';
    html += '<div class="suggestion-name">' + esc(r.Denumire) + (inCart ? ' <em style="font-style:normal;color:#4ade80;font-size:11px;font-weight:600">(in cerere)</em>' : '') + '</div>';
    html += '<div class="suggestion-meta">';
    html += '<span class="suggestion-lab lab-bg-' + labCls(r.Laborator) + '">' + esc(r.Laborator) + '</span>';
    if (r.Timp && r.Timp !== "N/A") {
      html += '<span class="suggestion-timp">' + esc(r.Timp) + '</span>';
    }
    if (hasDetails) {
      html += '<span class="suggestion-has-details" title="Are instructiuni de recoltare">&#9432; detalii</span>';
    }
    html += '</div></div>';
    html += '<div style="display:flex;align-items:center;gap:14px">';
    html += '<div class="suggestion-add-hint">+ Adauga</div>';
    html += '<div class="suggestion-prices">';
    html += '<div class="suggestion-price">' + fp + '<small>' + (disc > 0 ? "cu " + disc + "% disc" : "RON") + '</small></div>';
    var ccp = getCCPrice(r.Denumire);
    if (ccp !== null) {
      html += '<div class="suggestion-price-cc" title="Pret Clinica Central">' + ccp.toFixed(0) + '<small>CC</small></div>';
    }
    html += '</div>';
    html += '</div></div>';
  }
  cartSuggestionsEl.innerHTML = html;
  cartSuggestionsEl.classList.add("visible");

  var items = cartSuggestionsEl.querySelectorAll(".suggestion");
  for (var j = 0; j < items.length; j++) {
    (function(el) {
      el.addEventListener("click", function() {
        addToCart(el.getAttribute("data-key"), el.getAttribute("data-lab"));
      });
    })(items[j]);
  }
}
cartSearchInput.addEventListener("input", doCartSearch);
cartSearchInput.addEventListener("focus", function() {
  if (cartSearchInput.value.trim().length >= 2) doCartSearch();
});

function addToCart(key, lab) {
  if (!ANALIZE_INDEX[key]) return;
  // Need to find the specific offer for the chosen lab
  var entry = ANALIZE_INDEX[key];
  var offer = null;
  for (var i = 0; i < entry.offers.length; i++) {
    if (entry.offers[i].Laborator === lab) { offer = entry.offers[i]; break; }
  }
  if (!offer) return;
  // De-dup: same (key + lab) already in cart
  if (cartState.cart.some(function(c){ return c.key === key && c.lab === lab; })) return;
  cartState.cart.push({ key: key, lab: lab, displayName: entry.displayName, offer: offer });
  renderCart();
  doCartSearch();
  cartSearchInput.select();
}

function removeFromCart(key, lab) {
  cartState.cart = cartState.cart.filter(function(c){ return !(c.key === key && c.lab === lab); });
  renderCart();
  doCartSearch();
}

function renderCart() {
  cartCountEl.textContent = cartState.cart.length;
  btnProcess.disabled = cartState.cart.length === 0;
  var eprubeteSummaryEl = document.getElementById("eprubeteSummary");

  if (cartState.cart.length === 0) {
    cartEmptyEl.style.display = "block";
    cartListEl.innerHTML = '';
    cartListEl.appendChild(cartEmptyEl);
    cartTotalEl.textContent = "— RON";
    if (eprubeteSummaryEl) eprubeteSummaryEl.style.display = "none";
    return;
  }
  cartEmptyEl.style.display = "none";

  var total = 0;
  var html = "";
  for (var i = 0; i < cartState.cart.length; i++) {
    var c = cartState.cart[i];
    var offer = c.offer;
    if (!offer) continue;
    var fp = finalPrice(offer.Pret, offer.Laborator);
    var lab = offer.Laborator;
    var disc = discPct(lab);
    total += fp;
    var d = getDetails(lab, c.displayName);
    html += '<div class="cart-item">';
    html += '<div class="cart-item-info">';
    html += '<div class="cart-item-name">' + esc(c.displayName) + '</div>';
    html += '<div class="cart-item-meta">';
    html += '<span class="cart-item-lab lab-bg-' + labCls(lab) + '">' + esc(lab) + '</span>';
    if (offer.Timp && offer.Timp !== "N/A") {
      html += '<span>' + esc(offer.Timp) + '</span>';
    }
    html += '</div>';
    if (d) {
      var recipient = fmtRecipient(d);
      var chunks = [];
      if (recipient) chunks.push('<span title="Eprubeta">&#9887; ' + esc(recipient) + '</span>');
      if (d.CantitateMinima) chunks.push('<span title="Cantitate">&#128167; ' + esc(d.CantitateMinima) + '</span>');
      if (chunks.length) {
        html += '<div class="cart-item-details">' + chunks.join('') + '</div>';
      }
    }
    html += '</div>';
    html += '<div class="cart-item-right">';
    html += '<div class="cart-item-price">' + fp + ' RON</div>';
    if (disc > 0) {
      html += '<div class="cart-item-price-orig">' + offer.Pret.toFixed(0) + ' RON</div>';
    }
    var ccp = getCCPrice(c.displayName);
    if (ccp !== null) {
      html += '<div class="cart-item-price-cc" title="Pret Clinica Central">CC: ' + ccp.toFixed(0) + ' RON</div>';
    }
    html += '<button class="cart-item-remove" data-key="' + esc(c.key) + '" data-lab="' + esc(lab) + '" title="Sterge">&times;</button>';
    html += '</div></div>';
  }
  cartListEl.innerHTML = html;
  cartTotalEl.textContent = fmtRon(total);

  // ─── Live eprubete summary ───
  var summaryItems = [];
  for (var i = 0; i < cartState.cart.length; i++) {
    if (cartState.cart[i].offer) summaryItems.push({ offer: cartState.cart[i].offer });
  }
  var eprubeteSummary = buildEprubetSummary(summaryItems);
  if (eprubeteSummary.length === 0) {
    eprubeteSummaryEl.style.display = "none";
  } else {
    var labCount = {};
    for (var s = 0; s < eprubeteSummary.length; s++) {
      var br = eprubeteSummary[s].breakdown;
      for (var lb in br) labCount[lb] = (labCount[lb] || 0) + br[lb];
    }
    var labs = Object.keys(labCount);
    var sumHtml = "";
    for (var s = 0; s < eprubeteSummary.length; s++) {
      var item = eprubeteSummary[s];
      var brKeys = Object.keys(item.breakdown);
      sumHtml += '<li class="eprubete-item">';
      sumHtml += '<span class="eprubete-count">' + item.count + '×</span>';
      sumHtml += '<span class="eprubete-text">' + esc(item.tip);
      // Show locations on separate lines for clarity
      if (brKeys.length > 0) {
        var locLines = brKeys.map(function(loc){
          var cnt = item.breakdown[loc];
          return (cnt > 1 ? cnt + "× " : "") + "→ " + loc;
        });
        sumHtml += '<small>' + esc(locLines.join(" • ")) + '</small>';
      }
      sumHtml += '</span></li>';
    }
    document.getElementById("eprubeteList").innerHTML = sumHtml;
    eprubeteSummaryEl.style.display = "block";
  }

  var removes = cartListEl.querySelectorAll(".cart-item-remove");
  for (var j = 0; j < removes.length; j++) {
    (function(btn) {
      btn.addEventListener("click", function() {
        removeFromCart(btn.getAttribute("data-key"), btn.getAttribute("data-lab"));
      });
    })(removes[j]);
  }
}

document.getElementById("btnClearCart").addEventListener("click", function() {
  if (cartState.cart.length === 0) return;
  if (confirm("Vrei sa golesti cererea de analize?")) {
    cartState.cart = [];
    renderCart();
    doCartSearch();
  }
});

// ─── Cart discount panel ───
var discPanelCart = document.getElementById("discPanelCart");
(function() {
  var html = "";
  var labs = Object.keys(DEFAULT_DISCOUNTS);
  for (var i = 0; i < labs.length; i++) {
    var lab = labs[i];
    html += '<div class="disc-row-cart"><label>' + esc(lab) + '</label>';
    html += '<input type="number" min="0" max="90" step="1" data-lab="' + esc(lab) + '" value="' + DEFAULT_DISCOUNTS[lab] + '"></div>';
  }
  discPanelCart.innerHTML = html;
  var inputs = discPanelCart.querySelectorAll("input[data-lab]");
  for (var j = 0; j < inputs.length; j++) {
    (function(inp) {
      inp.addEventListener("input", function() {
        var v = parseFloat(inp.value);
        if (isNaN(v)) v = 0;
        v = Math.max(0, Math.min(90, v));
        discounts[inp.getAttribute("data-lab")] = v;
        renderCart();
        doCartSearch();
        // Also update browse view if rendered
        if (typeof browseState !== "undefined" && browseState.lastResults.length) {
          renderBrowseTable(browseState.lastResults);
        }
      });
    })(inputs[j]);
  }
})();
document.getElementById("discToggleCart").addEventListener("click", function() {
  discPanelCart.classList.toggle("visible");
});

// ─── Process / Report ───
btnProcess.addEventListener("click", openReport);
document.getElementById("reportClose").addEventListener("click", closeReport);
document.getElementById("reportOverlay").addEventListener("click", function(e) {
  if (e.target === this) closeReport();
});
document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") {
    // Only close (and reset) if report is actually visible
    if (document.getElementById("reportOverlay").classList.contains("visible")) {
      closeReport();
    }
    closeDetailsModal();
  }
});

function buildReport() {
  var items = [], grandTotal = 0, grandListTotal = 0;
  for (var i = 0; i < cartState.cart.length; i++) {
    var c = cartState.cart[i];
    if (!c.offer) continue;
    // Reference: lab pricing (kept for comparison)
    var labFinal = finalPrice(c.offer.Pret, c.offer.Laborator);
    // OFFICIAL price for the report = Clinica Central pricing (CC catalog or lab+5%)
    var eff = effectivePrice(c.displayName, c.offer.Laborator, c.offer.Pret);
    grandTotal += eff.price;
    grandListTotal += c.offer.Pret;
    items.push({
      key: c.key,
      displayName: c.displayName,
      offer: c.offer,
      finalPrice: eff.price,       // CC price (or lab+5% fallback) — used everywhere downstream
      labFinalPrice: labFinal,     // Kept for reference if needed
      priceSource: eff.source,     // "cc" or "lab+5%"
      discount: discPct(c.offer.Laborator)
    });
  }
  var groups = {};
  for (var i = 0; i < items.length; i++) {
    var lab = items[i].offer.Laborator;
    if (!groups[lab]) groups[lab] = { lab: lab, items: [], total: 0, listTotal: 0 };
    groups[lab].items.push(items[i]);
    groups[lab].total += items[i].finalPrice;
    groups[lab].listTotal += items[i].offer.Pret;
  }
  var groupsList = Object.keys(groups).map(function(l){ return groups[l]; });
  groupsList.sort(function(a, b){ return b.total - a.total; });
  return { items: items, groups: groupsList, grandTotal: grandTotal, grandListTotal: grandListTotal };
}

function openReport() {
  if (cartState.cart.length === 0) return;
  var r = buildReport();

  var statsHtml = '<div class="report-stat"><span class="report-stat-num">' + r.items.length + '</span><span class="report-stat-label">Analize</span></div>';
  statsHtml += '<div class="report-stat"><span class="report-stat-num">' + r.groups.length + '</span><span class="report-stat-label">Laboratoare</span></div>';
  statsHtml += '<div class="report-stat"><span class="report-stat-num">' + Math.round(r.grandTotal) + '</span><span class="report-stat-label">RON total</span></div>';
  document.getElementById("reportStats").innerHTML = statsHtml;

  // Patient info header
  var fullName = [cartState.prenume.trim(), cartState.nume.trim()].filter(Boolean).join(" ");
  var patientHtml = '';
  patientHtml += '<div class="report-patient-row"><span class="label">Pacient</span><strong>' + esc(fullName) + '</strong></div>';
  patientHtml += '<div class="report-patient-row"><span class="label">CNP</span><strong>' + esc(cartState.cnp) + '</strong></div>';
  if (cartState.email) {
    patientHtml += '<div class="report-patient-row"><span class="label">Email</span><strong>' + esc(cartState.email) + '</strong></div>';
  }
  if (cartState.telefonNumar) {
    patientHtml += '<div class="report-patient-row"><span class="label">Telefon</span><strong>' + esc(cartState.telefonPrefix + " " + cartState.telefonNumar) + '</strong></div>';
  }
  document.getElementById("reportPatient").innerHTML = patientHtml;

  var body = '';

  // ─── Eprubete summary section ───
  var reportEprubete = buildEprubetSummary(r.items);
  if (reportEprubete.length > 0) {
    body += '<div class="eprubete-summary-report">';
    body += '<div class="eprubete-label">&#9887; Eprubete necesare pentru recoltare</div>';
    body += '<ul class="eprubete-list">';
    for (var s = 0; s < reportEprubete.length; s++) {
      var item = reportEprubete[s];
      var brKeys = Object.keys(item.breakdown);
      body += '<li class="eprubete-item">';
      body += '<span class="eprubete-count">' + item.count + '×</span>';
      body += '<span class="eprubete-text">' + esc(item.tip);
      if (brKeys.length > 0) {
        var locLines = brKeys.map(function(loc){
          var cnt = item.breakdown[loc];
          return (cnt > 1 ? cnt + "× " : "") + "→ " + loc;
        });
        body += '<small>' + esc(locLines.join(" • ")) + '</small>';
      }
      body += '</span></li>';
    }
    body += '</ul></div>';
  }

  body += '<div class="report-section-title">Unde mergi si ce platesti</div>';
  body += '<p class="report-section-sub">Fiecare analiza e optimizata pentru pret minim. Mai jos vezi grupat pe laboratoare.</p>';

  for (var g = 0; g < r.groups.length; g++) {
    var grp = r.groups[g];
    var cls = labCls(grp.lab);
    body += '<div class="lab-group">';
    body += '<div class="lab-group-header">';
    body += '<div class="lab-group-name"><span class="suggestion-lab lab-bg-' + cls + '" style="font-size:11px;padding:3px 10px">' + esc(grp.lab) + '</span>';
    body += '<strong>' + esc(grp.lab) + '</strong>';
    body += '<span class="lab-group-count">&bull; ' + grp.items.length + ' analize</span>';
    body += '</div>';
    body += '<div class="lab-group-total">' + grp.total + ' RON <small>Subtotal</small></div>';
    body += '</div>';
    body += '<div class="lab-group-items">';
    for (var i = 0; i < grp.items.length; i++) {
      var it = grp.items[i];
      var d = getDetails(grp.lab, it.displayName);
      body += '<div class="lab-group-item">';
      body += '<div class="lab-group-item-name">' + esc(it.displayName);
      if (it.offer.Timp && it.offer.Timp !== "N/A") {
        body += ' <span style="color:rgba(15,17,23,0.4);font-size:12px">&bull; ' + esc(it.offer.Timp) + '</span>';
      }
      if (d) {
        body += '<div class="item-details">';
        var rows = [];
        var recipient = fmtRecipient(d);
        if (recipient) rows.push(['&#9887; Eprubeta', recipient]);
        if (d.MaterialBiologic) rows.push(['&#129514; Material', d.MaterialBiologic]);
        if (d.CantitateMinima) rows.push(['&#128167; Cantitate', d.CantitateMinima]);
        if (d.LaboratorSubcontractant) rows.push(['&#128205; Se trimite la', d.LaboratorSubcontractant]);
        if (d.Observatii) rows.push(['&#9888; Atentie', d.Observatii]);
        for (var r2 = 0; r2 < rows.length; r2++) {
          body += '<div class="item-details-row"><span class="item-details-label">' + rows[r2][0] + '</span><span class="item-details-val">' + esc(rows[r2][1]) + '</span></div>';
        }
        body += '</div>';
      }
      body += '</div>';
      body += '<div class="lab-group-item-price">' + Math.round(it.finalPrice) + ' RON';
      if (it.priceSource === "lab+5%") {
        body += '<span class="lab-group-item-price-src" title="Nu exista pret in catalogul Clinica Central; folosit pret laborator cu discount +5%">lab + 5%</span>';
      } else {
        body += '<span class="lab-group-item-price-src" title="Pret din catalogul Clinica Central">CC</span>';
      }
      body += '</div></div>';
    }
    body += '</div></div>';
  }

  body += '<div class="report-grand-total">';
  body += '<span class="report-grand-total-label">Total de plata</span>';
  body += '<span class="report-grand-total-value">' + fmtRon(r.grandTotal) + '</span>';
  body += '</div>';

  body += '<div class="report-actions">';
  body += '<button class="report-btn primary" id="btnExportPdf">&#11015; Export PDF</button>';
  body += '<button class="report-btn" id="btnExportReport">&#11015; Export Excel</button>';
  body += '<button class="report-btn" id="btnExportJson">&#11015; Export JSON</button>';
  body += '<button class="report-btn" id="btnCloseReport">Inchide</button>';
  body += '</div>';

  document.getElementById("reportBody").innerHTML = body;
  document.getElementById("reportOverlay").classList.add("visible");
  document.body.style.overflow = "hidden";

  document.getElementById("btnCloseReport").addEventListener("click", closeReport);
  document.getElementById("btnExportPdf").addEventListener("click", function() { exportReportPdf(r); });
  document.getElementById("btnExportReport").addEventListener("click", function() { exportReportXlsx(r); });
  document.getElementById("btnExportJson").addEventListener("click", function() { exportReportJson(r); });

  // Auto-save the cerere to Supabase (non-blocking, but show status)
  saveCerere(r);
}
function closeReport() {
  document.getElementById("reportOverlay").classList.remove("visible");
  document.body.style.overflow = "";

  // Reset complet — start fresh pentru urmatoarea cerere
  // 1. Cart
  cartState.cart = [];
  // 2. Patient fields
  cartState.prenume = "";
  cartState.nume = "";
  cartState.cnp = "";
  cartState.email = "";
  cartState.telefonPrefix = "+40";
  cartState.telefonNumar = "";
  cartState.prenumeValid = false;
  cartState.numeValid = false;
  cartState.cnpValid = false;
  cartState.pacientValid = false;
  // 3. Clear DOM inputs
  prenumeInput.value = "";
  numeInput.value = "";
  cnpInput.value = "";
  emailInput.value = "";
  telefonNumarInput.value = "";
  telefonPrefixSelect.value = "+40";
  // 4. Remove valid/invalid classes
  prenumeInput.classList.remove("valid", "invalid");
  numeInput.classList.remove("valid", "invalid");
  cnpInput.classList.remove("valid", "invalid");
  emailInput.classList.remove("valid", "invalid");
  cnpStatus.classList.remove("valid", "invalid");
  cnpStatus.textContent = "";
  cnpError.textContent = "";
  // 5. Search input
  cartSearchInput.value = "";
  cartSuggestionsEl.classList.remove("visible");
  cartEmptyHintEl.style.display = "block";
  // 6. Update UI
  updatePacientValidation();
  renderCart();
  // 7. Focus first field
  prenumeInput.focus();
}

function exportReportXlsx(r) {
  var fullName = [cartState.prenume.trim(), cartState.nume.trim()].filter(Boolean).join(" ");
  var rows = [];
  rows.push({ "Laborator": "CERERE ANALIZE" });
  rows.push({ "Laborator": "Pacient:", "Denumire Analiza": fullName });
  rows.push({ "Laborator": "CNP:", "Denumire Analiza": cartState.cnp });
  if (cartState.email) {
    rows.push({ "Laborator": "Email:", "Denumire Analiza": cartState.email });
  }
  if (cartState.telefonNumar) {
    rows.push({ "Laborator": "Telefon:", "Denumire Analiza": cartState.telefonPrefix + " " + cartState.telefonNumar });
  }
  rows.push({ "Laborator": "Data generare:", "Denumire Analiza": new Date().toLocaleString("ro-RO") });
  rows.push({});
  for (var g = 0; g < r.groups.length; g++) {
    var grp = r.groups[g];
    for (var i = 0; i < grp.items.length; i++) {
      var it = grp.items[i];
      var d = getDetails(grp.lab, it.displayName);
      rows.push({
        "Pacient": fullName,
        "CNP pacient": cartState.cnp,
        "Laborator": grp.lab,
        "Denumire Analiza": it.displayName,
        "Eprubeta / Recipient": d ? fmtRecipient(d) : "",
        "Material biologic": d && d.MaterialBiologic ? d.MaterialBiologic : "",
        "Cantitate": d && d.CantitateMinima ? d.CantitateMinima : "",
        "Se trimite la": d && d.LaboratorSubcontractant ? d.LaboratorSubcontractant : "",
        "Observatii": d && d.Observatii ? d.Observatii : "",
        "Timp Executie": it.offer.Timp !== "N/A" ? it.offer.Timp : "",
        "Pret (RON)": Math.round(it.finalPrice * 100) / 100,
        "Sursa Pret": it.priceSource === "cc" ? "Catalog Clinica Central" : "Laborator cu discount + 5%"
      });
    }
    rows.push({ "Pacient": "", "CNP pacient": "", "Laborator": grp.lab + " — Subtotal", "Denumire Analiza": "", "Eprubeta / Recipient": "", "Material biologic": "", "Cantitate": "", "Se trimite la": "", "Observatii": "", "Timp Executie": "", "Pret (RON)": Math.round(grp.total * 100) / 100, "Sursa Pret": "" });
    rows.push({});
  }
  rows.push({ "Pacient": "", "CNP pacient": "", "Laborator": "TOTAL GENERAL", "Denumire Analiza": "", "Eprubeta / Recipient": "", "Material biologic": "", "Cantitate": "", "Se trimite la": "", "Observatii": "", "Timp Executie": "", "Pret (RON)": Math.round(r.grandTotal * 100) / 100, "Sursa Pret": "" });

  var ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{wch:22},{wch:15},{wch:22},{wch:45},{wch:34},{wch:18},{wch:14},{wch:28},{wch:40},{wch:18},{wch:14},{wch:24}];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cerere analize");

  // ─── Sheet 2: Eprubete summary ───
  var eprubeteForExcel = buildEprubetSummary(r.items);
  if (eprubeteForExcel.length > 0) {
    var eRows = [];
    eRows.push({ "Tip eprubeta": "REZUMAT EPRUBETE NECESARE" });
    eRows.push({ "Tip eprubeta": "Pacient:", "Total bucati": fullName });
    eRows.push({ "Tip eprubeta": "CNP:", "Total bucati": cartState.cnp });
    eRows.push({});
    var totalTubes = 0;
    for (var s = 0; s < eprubeteForExcel.length; s++) {
      var item = eprubeteForExcel[s];
      totalTubes += item.count;
      var brKeys = Object.keys(item.breakdown);
      var brParts = brKeys.map(function(k){
        var c = item.breakdown[k];
        return (c > 1 ? c + "× " : "") + k;
      });
      eRows.push({
        "Tip eprubeta": item.tip,
        "Total bucati": item.count,
        "Locatii (laboratoare destinatare)": brParts.join(" | ")
      });
    }
    eRows.push({});
    eRows.push({
      "Tip eprubeta": "TOTAL EPRUBETE",
      "Total bucati": totalTubes
    });
    var ws2 = XLSX.utils.json_to_sheet(eRows);
    ws2["!cols"] = [{wch:35},{wch:15},{wch:60}];
    XLSX.utils.book_append_sheet(wb, ws2, "Eprubete");
  }

  var date = new Date();
  var fn = buildPatientFilename("cerere_analize") + ".xlsx";
  XLSX.writeFile(wb, fn);
}

function exportReportPdf(r) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  var pageWidth = doc.internal.pageSize.getWidth();
  var pageHeight = doc.internal.pageSize.getHeight();
  var margin = 15;
  var contentWidth = pageWidth - 2 * margin;
  var y = margin;

  // Strip diacritics for Helvetica (Latin1 only)
  function s(text) {
    if (!text) return "";
    return String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function ensureSpace(needed) {
    if (y + needed > pageHeight - 15) {
      doc.addPage();
      y = margin;
    }
  }

  function addLine(text, opts) {
    opts = opts || {};
    var fontSize = opts.fontSize || 10;
    var style = opts.style || "normal";
    var color = opts.color || [15, 17, 23];
    var spacing = opts.spacing || (fontSize * 0.5);
    doc.setFontSize(fontSize);
    doc.setFont("helvetica", style);
    doc.setTextColor(color[0], color[1], color[2]);
    var lines = doc.splitTextToSize(s(text), contentWidth);
    ensureSpace(lines.length * fontSize * 0.4 + spacing);
    doc.text(lines, margin, y);
    y += lines.length * fontSize * 0.4 + spacing;
  }

  // ─── Header: only a small black square behind the logo, rest stays clean white ───
  var logo = getLogoForPdf();
  var logoBoxSize = 20;       // square box on page (slightly bigger now that it's standalone)
  var titleX = margin;        // default: where title starts if no logo
  if (logo) {
    // Small black rounded square ONLY behind logo (saves ink, makes logo pop)
    doc.setFillColor(15, 17, 23);
    doc.roundedRect(margin, margin - 2, logoBoxSize, logoBoxSize, 2, 2, "F");
    // Compute fit-inside dimensions preserving aspect ratio
    var pad = 2;
    var maxW = logoBoxSize - 2 * pad;
    var maxH = logoBoxSize - 2 * pad;
    var ratio = logo.w / logo.h;
    var dw, dh;
    if (ratio > maxW / maxH) {
      dw = maxW; dh = maxW / ratio;
    } else {
      dh = maxH; dw = maxH * ratio;
    }
    var dx = margin + (logoBoxSize - dw) / 2;
    var dy = (margin - 2) + (logoBoxSize - dh) / 2;
    try {
      doc.addImage(logo.dataUrl, "JPEG", dx, dy, dw, dh);
    } catch (e) { /* silent fail */ }
    titleX = margin + logoBoxSize + 6;
  }

  // Title text in black/gold next to logo (on white page background)
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 17, 23);  // dark ink (text only, minimal ink)
  doc.text("CLINICA CENTRAL", titleX, margin + 5);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(184, 151, 58); // gold subtitle
  doc.text("Cerere analize", titleX, margin + 11);

  // Top-right meta (black text on white)
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  var now = new Date();
  doc.text("Generat: " + now.toLocaleString("ro-RO"), pageWidth - margin, margin + 5, { align: "right" });
  doc.text("Pitesti, Romania", pageWidth - margin, margin + 10, { align: "right" });

  // Thin gold rule under the entire header area
  doc.setDrawColor(184, 151, 58);
  doc.setLineWidth(0.4);
  doc.line(margin, margin + 20, pageWidth - margin, margin + 20);

  y = margin + 26;

  // ─── Pacient ───
  var fullName = [cartState.prenume.trim(), cartState.nume.trim()].filter(Boolean).join(" ");
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(184, 151, 58);
  doc.text("PACIENT", margin, y);
  y += 5;
  doc.setDrawColor(184, 151, 58);
  doc.setLineWidth(0.4);
  doc.line(margin, y, margin + 30, y);
  y += 4;

  doc.setFontSize(10);
  doc.setTextColor(15, 17, 23);
  doc.setFont("helvetica", "bold");
  doc.text(s(fullName || "—"), margin, y);
  doc.setFont("helvetica", "normal");
  doc.text("CNP: " + s(cartState.cnp || "—"), pageWidth - margin, y, { align: "right" });
  y += 5;

  if (cartState.email) {
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.text("Email: " + s(cartState.email), margin, y);
    y += 4;
  }
  if (cartState.telefonNumar) {
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.text("Telefon: " + s(cartState.telefonPrefix + " " + cartState.telefonNumar), margin, y);
    y += 4;
  }
  y += 4;

  // ─── Stats row (ink-light: no fill, gray rules) ───
  ensureSpace(15);
  doc.setDrawColor(220, 217, 207);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  doc.line(margin, y + 12, pageWidth - margin, y + 12);
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.setFont("helvetica", "normal");
  var col1x = margin + 2;
  var col2x = margin + contentWidth / 2 + 2;
  doc.text("ANALIZE", col1x, y + 4);
  doc.text("TOTAL", col2x, y + 4);
  doc.setFontSize(14);
  doc.setTextColor(15, 17, 23);
  doc.setFont("helvetica", "bold");
  doc.text(String(r.items.length), col1x, y + 10);
  doc.text(Math.round(r.grandTotal) + " RON", col2x, y + 10);
  y += 18;

  // ─── Eprubete summary ───
  var eprubete = buildEprubetSummary(r.items);
  if (eprubete.length > 0) {
    ensureSpace(15);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(184, 151, 58);
    doc.text("EPRUBETE NECESARE PENTRU RECOLTARE", margin, y);
    y += 4;
    doc.setDrawColor(184, 151, 58);
    doc.line(margin, y, margin + 70, y);
    y += 5;

    var epBody = eprubete.map(function(item) {
      return [String(item.count) + "x", s(item.tip)];
    });
    doc.autoTable({
      body: epBody,
      startY: y,
      theme: "plain",
      styles: { fontSize: 9, cellPadding: 2.5, valign: "top" },
      columnStyles: {
        0: { cellWidth: 14, halign: "center", fontStyle: "bold", textColor: [184, 151, 58] },
        1: { fontStyle: "bold" }
      },
      didDrawCell: function(data) {
        // Bottom hairline between rows
        if (data.section === "body" && data.column.index === 0) {
          doc.setDrawColor(230, 228, 220);
          doc.setLineWidth(0.15);
          doc.line(data.cell.x, data.cell.y + data.cell.height,
                   pageWidth - margin, data.cell.y + data.cell.height);
        }
      },
      margin: { left: margin, right: margin }
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ─── Analize per laborator ───
  ensureSpace(15);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(184, 151, 58);
  doc.text("ANALIZE", margin, y);
  y += 4;
  doc.setDrawColor(184, 151, 58);
  doc.line(margin, y, margin + 25, y);
  y += 6;

  // Flatten all items across labs into one list (no lab name shown)
  var allItems = [];
  for (var g = 0; g < r.groups.length; g++) {
    for (var i = 0; i < r.groups[g].items.length; i++) {
      allItems.push({ item: r.groups[g].items[i], lab: r.groups[g].lab });
    }
  }
  // Sort alphabetically by name for a clean look
  allItems.sort(function(a, b) {
    return a.item.displayName.localeCompare(b.item.displayName, "ro");
  });

  var allBody = [];
  for (var i = 0; i < allItems.length; i++) {
    var entry = allItems[i];
    var it = entry.item;
    var d = getDetails(entry.lab, it.displayName);
    var detLines = [];
    if (d) {
      var recipient = fmtRecipient(d);
      if (recipient) detLines.push("Eprubeta: " + recipient);
      if (d.MaterialBiologic) detLines.push("Material: " + d.MaterialBiologic);
      if (d.CantitateMinima) detLines.push("Cantitate: " + d.CantitateMinima);
      // Note: "Se trimite la" (subcontractant) intentionally omitted to hide lab info
      if (d.Observatii) detLines.push("Atentie: " + d.Observatii);
    }
    if (it.offer.Timp && it.offer.Timp !== "N/A") {
      detLines.unshift("Timp: " + it.offer.Timp);
    }
    allBody.push([
      String(i + 1),
      s(it.displayName),
      s(detLines.join("\n")),
      Math.round(it.finalPrice) + " RON"
    ]);
  }

  ensureSpace(20);
  doc.autoTable({
    head: [["#", "Denumire analiza", "Detalii recoltare", "Pret"]],
    body: allBody,
    startY: y,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 2.5, valign: "top" },
    headStyles: { textColor: [184, 151, 58], fontStyle: "bold", fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 8, halign: "center", textColor: [120, 120, 120] },
      1: { cellWidth: 70, fontStyle: "bold" },
      2: { fontSize: 7.5, textColor: [80, 80, 80] },
      3: { cellWidth: 24, halign: "right", fontStyle: "bold", textColor: [15, 17, 23] }
    },
    didDrawCell: function(data) {
      // Gold rule under header, gray hairlines under body rows
      if (data.column.index === 0) {
        if (data.section === "head") {
          doc.setDrawColor(184, 151, 58);
          doc.setLineWidth(0.4);
        } else {
          doc.setDrawColor(230, 228, 220);
          doc.setLineWidth(0.15);
        }
        doc.line(data.cell.x, data.cell.y + data.cell.height,
                 pageWidth - margin, data.cell.y + data.cell.height);
      }
    },
    margin: { left: margin, right: margin }
  });
  y = doc.lastAutoTable.finalY + 6;

  // ─── Grand total (ink-light: gold rules instead of filled bar) ───
  ensureSpace(20);
  y += 4;
  doc.setDrawColor(184, 151, 58);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageWidth - margin, y);          // top rule
  doc.line(margin, y + 14, pageWidth - margin, y + 14); // bottom rule
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(120, 120, 120);
  doc.text("TOTAL DE PLATA", margin + 2, y + 9);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(184, 151, 58);
  doc.text(Math.round(r.grandTotal) + " RON", pageWidth - margin - 2, y + 9, { align: "right" });
  y += 20;

  // ─── Footer on each page ───
  var totalPages = doc.internal.getNumberOfPages();
  for (var p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.setFont("helvetica", "normal");
    doc.text("Clinica Central Pitesti  |  Cerere analize  |  " + s(fullName),
             margin, pageHeight - 8);
    doc.text("Pagina " + p + " / " + totalPages,
             pageWidth - margin, pageHeight - 8, { align: "right" });
  }

  doc.save(buildPatientFilename("cerere_analize") + ".pdf");
}

function exportReportJson(r) {
  var now = new Date();
  var eprubeteForJson = buildEprubetSummary(r.items).map(function(item) {
    return {
      tip: item.tip,
      bucati: item.count,
      pentruLocatii: item.breakdown
    };
  });
  var totalEprubete = eprubeteForJson.reduce(function(sum, e){ return sum + e.bucati; }, 0);
  var fullName = [cartState.prenume.trim(), cartState.nume.trim()].filter(Boolean).join(" ");
  var out = {
    generatedAt: now.toISOString(),
    pacient: {
      prenume: cartState.prenume.trim(),
      nume: cartState.nume.trim(),
      numeComplet: fullName,
      cnp: cartState.cnp,
      email: cartState.email || null,
      telefon: cartState.telefonNumar ? {
        prefix: cartState.telefonPrefix,
        numar: cartState.telefonNumar,
        complet: cartState.telefonPrefix + " " + cartState.telefonNumar
      } : null
    },
    // Backwards compat
    cnpPacient: cartState.cnp,
    summary: {
      totalAnalize: r.items.length,
      totalLaboratoare: r.groups.length,
      totalRON: Math.round(r.grandTotal * 100) / 100,
      totalEprubete: totalEprubete,
      pretSursa: "Catalog Clinica Central (fallback: laborator cu discount + 5%)"
    },
    eprubete: eprubeteForJson,
    discountsApplied: Object.assign({}, discounts),
    groups: r.groups.map(function(g) {
      return {
        laborator: g.lab,
        numarAnalize: g.items.length,
        subtotalRON: Math.round(g.total * 100) / 100,
        analize: g.items.map(function(it) {
          var d = getDetails(g.lab, it.displayName);
          var entry = {
            denumire: it.displayName,
            pret: Math.round(it.finalPrice * 100) / 100,
            sursaPret: it.priceSource === "cc" ? "Catalog Clinica Central" : "Laborator cu discount + 5%",
            timpExecutie: (it.offer.Timp && it.offer.Timp !== "N/A") ? it.offer.Timp : null,
            categorie: (it.offer.Categorie && it.offer.Categorie !== "N/A") ? it.offer.Categorie : null
          };
          if (d) {
            entry.recoltare = {
              recipient: d.Recipient || null,
              culoareDop: d.CuloareDop || null,
              eprubetaCompleta: fmtRecipient(d) || null,
              materialBiologic: d.MaterialBiologic || null,
              cantitateMinima: d.CantitateMinima || null,
              seTrimiteLa: d.LaboratorSubcontractant || null,
              observatii: d.Observatii || null
            };
          }
          return entry;
        })
      };
    })
  };
  var jsonStr = JSON.stringify(out, null, 2);
  var blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = buildPatientFilename("cerere_analize") + ".json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 100);
}

// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
// VIEW 2: BROWSE (legacy explorer)
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════

var browseState = {
  lastResults: [],
  sortCol: "Pret",
  sortDir: 1,
  activeTab: ""
};

// Build discount grid
(function() {
  var colors = { "Clinica Sante":"#4ade80", "Binisan":"#fb923c", "Derzelius":"#d946ef",
                 "Medilab":"#2dd4bf", "Poliana":"#60a5fa", "Solomed":"#facc15" };
  var grid = document.getElementById("discGrid");
  var html = "";
  var labs = Object.keys(DEFAULT_DISCOUNTS);
  for (var i = 0; i < labs.length; i++) {
    var lab = labs[i];
    html += '<div class="disc-row"><label><span class="dot" style="background:' + colors[lab] + '"></span>' + esc(lab) + '</label>';
    html += '<div class="disc-input-wrap"><input type="number" min="0" max="90" step="1" data-lab="' + esc(lab) + '" value="' + DEFAULT_DISCOUNTS[lab] + '"><span class="pct">%</span></div></div>';
  }
  grid.innerHTML = html;
  var inputs = grid.querySelectorAll("input[data-lab]");
  for (var j = 0; j < inputs.length; j++) {
    (function(inp) {
      inp.addEventListener("input", function() {
        var v = parseFloat(inp.value);
        if (isNaN(v)) v = 0;
        v = Math.max(0, Math.min(90, v));
        discounts[inp.getAttribute("data-lab")] = v;
        renderCart();
        doCartSearch();
        if (browseState.lastResults.length) renderBrowseTable(browseState.lastResults);
        // Sync cart discount panel too
        var cartInp = discPanelCart.querySelector('input[data-lab="' + inp.getAttribute("data-lab") + '"]');
        if (cartInp && cartInp !== inp) cartInp.value = v;
      });
    })(inputs[j]);
  }
})();

document.getElementById("discToggle").addEventListener("click", function() {
  document.getElementById("discPanel").classList.toggle("visible");
});
document.getElementById("btnResetDisc").addEventListener("click", function() {
  discounts = Object.assign({}, DEFAULT_DISCOUNTS);
  var inputs = document.querySelectorAll('#discGrid input[data-lab], #discPanelCart input[data-lab]');
  for (var i = 0; i < inputs.length; i++) inputs[i].value = DEFAULT_DISCOUNTS[inputs[i].getAttribute("data-lab")];
  renderCart();
  if (browseState.lastResults.length) renderBrowseTable(browseState.lastResults);
});

// Browse search
var qInput = document.getElementById("q");
var labFilter = document.getElementById("labFilter");
var emptyState = document.getElementById("emptyState");

function doBrowseSearch() {
  var q = qInput.value.trim().toLowerCase();
  var labF = labFilter.value;
  if (q.length < 2 && !labF) {
    browseState.lastResults = [];
    hideBrowseResults();
    return;
  }
  var results = [];
  for (var i = 0; i < DATA.length; i++) {
    var r = DATA[i];
    if (q.length >= 2 && r.Denumire.toLowerCase().indexOf(q) === -1) continue;
    if (labF && r.Laborator !== labF) continue;
    results.push(r);
  }
  browseState.lastResults = results;
  renderBrowseTable(results);
}
qInput.addEventListener("input", doBrowseSearch);
labFilter.addEventListener("change", function() {
  // Set tab accordingly
  browseState.activeTab = labFilter.value;
  updateFilterTabs();
  doBrowseSearch();
});
document.getElementById("btnClearBrowse").addEventListener("click", function() {
  qInput.value = "";
  labFilter.value = "";
  browseState.activeTab = "";
  updateFilterTabs();
  browseState.lastResults = [];
  hideBrowseResults();
  qInput.focus();
});
document.getElementById("btnShowAll").addEventListener("click", function() {
  qInput.value = "";
  labFilter.value = browseState.activeTab;
  browseState.lastResults = browseState.activeTab
    ? DATA.filter(function(r){ return r.Laborator === browseState.activeTab; })
    : DATA.slice();
  renderBrowseTable(browseState.lastResults);
});

// Filter tabs
var filterTabs = document.querySelectorAll(".filter-tab");
for (var i = 0; i < filterTabs.length; i++) {
  (function(tab) {
    tab.addEventListener("click", function() {
      browseState.activeTab = tab.getAttribute("data-lab");
      labFilter.value = browseState.activeTab;
      updateFilterTabs();
      if (qInput.value.trim().length >= 2 || browseState.activeTab) doBrowseSearch();
      else hideBrowseResults();
    });
  })(filterTabs[i]);
}
function updateFilterTabs() {
  for (var i = 0; i < filterTabs.length; i++) {
    filterTabs[i].classList.toggle("active", filterTabs[i].getAttribute("data-lab") === browseState.activeTab);
  }
}

function hideBrowseResults() {
  document.getElementById("tableArea").innerHTML = "";
  document.getElementById("recCard").style.display = "none";
  document.getElementById("infoBar").style.display = "none";
  emptyState.style.display = "block";
}

function renderBrowseTable(results) {
  emptyState.style.display = "none";
  document.getElementById("infoBar").style.display = "flex";
  document.getElementById("resCount").textContent = results.length + " rezultat" + (results.length === 1 ? "" : "e");

  if (results.length === 0) {
    document.getElementById("tableArea").innerHTML = '<p style="padding:40px;text-align:center;color:rgba(15,17,23,0.4)">Nicio analiza potrivita.</p>';
    document.getElementById("recCard").style.display = "none";
    return;
  }

  // Find cheapest across results (by final price)
  var sorted = results.slice().map(function(r){ return { r: r, fp: finalPrice(r.Pret, r.Laborator) }; });
  var minFp = Math.min.apply(Math, sorted.map(function(x){ return x.fp; }));
  var best = sorted.find(function(x){ return x.fp === minFp; });
  var maxFp = Math.max.apply(Math, sorted.map(function(x){ return x.fp; }));

  // Rec card
  if (best) {
    var b = best.r;
    var d = discPct(b.Laborator);
    var hasDetails = !!getDetails(b.Laborator, b.Denumire);
    var nameHtml = esc(b.Denumire);
    if (hasDetails) {
      nameHtml += ' <button class="info-btn info-btn-rec" type="button" data-lab="' + esc(b.Laborator) + '" data-den="' + esc(b.Denumire) + '" title="Vezi detalii">i</button>';
    }
    document.getElementById("recName").innerHTML = nameHtml;
    document.getElementById("recMeta").textContent = b.Laborator + (b.Timp !== "N/A" ? "  •  " + b.Timp : "") + (d > 0 ? "  •  " + d + "% disc" : "");
    document.getElementById("recPrice").textContent = best.fp.toFixed(0);
    document.getElementById("recRange").textContent = results.length + " rezultate  •  Interval: " + minFp + " – " + maxFp + " RON";
    document.getElementById("recCard").style.display = "block";
  } else {
    document.getElementById("recCard").style.display = "none";
  }

  // Sort
  var sc = browseState.sortCol, sd = browseState.sortDir;
  var rows = results.slice().sort(function(a, b) {
    var va, vb;
    if (sc === "Pret") { va = finalPrice(a.Pret, a.Laborator); vb = finalPrice(b.Pret, b.Laborator); }
    else { va = (a[sc] || "").toString().toLowerCase(); vb = (b[sc] || "").toString().toLowerCase(); }
    if (va < vb) return -1 * sd;
    if (va > vb) return 1 * sd;
    return 0;
  });

  // Table
  var h = '<table class="results-table"><thead><tr>';
  h += '<th data-col="Laborator">Laborator</th>';
  h += '<th data-col="Denumire">Analiza</th>';
  h += '<th data-col="Categorie">Categorie</th>';
  h += '<th data-col="Timp">Timp</th>';
  h += '<th data-col="Pret" class="price-col">Pret (cu disc.)</th>';
  h += '<th class="price-col price-col-cc">Pret Clinica Central</th>';
  h += '</tr></thead><tbody>';

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var cc = labCls(r.Laborator);
    var fp = finalPrice(r.Pret, r.Laborator);
    var isBest = fp === minFp;
    var hasDet = !!getDetails(r.Laborator, r.Denumire);
    var denHtml = esc(r.Denumire);
    if (hasDet) {
      denHtml += ' <button class="info-btn" type="button" data-lab="' + esc(r.Laborator) + '" data-den="' + esc(r.Denumire) + '" title="Vezi detalii">i</button>';
    }
    h += '<tr class="' + (isBest ? "best-row" : "") + '">';
    h += '<td data-label="Laborator"><span class="badge badge-' + cc + '">' + esc(r.Laborator) + '</span></td>';
    h += '<td data-label="Analiza" class="den-cell">' + denHtml + '</td>';
    h += '<td data-label="Categorie">' + esc(r.Categorie !== "N/A" ? r.Categorie : "") + '</td>';
    h += '<td data-label="Timp">' + esc(r.Timp !== "N/A" ? r.Timp : "") + '</td>';
    h += '<td data-label="Pret (cu disc.)" class="price-cell' + (isBest ? " cheapest" : "") + '">';
    h += '<span class="price-final">' + fp.toFixed(0) + ' RON</span>';
    if (discPct(r.Laborator) > 0) h += '<span class="price-orig">' + r.Pret.toFixed(0) + ' RON</span>';
    h += '</td>';
    // Pret Clinica Central
    var ccp = getCCPrice(r.Denumire);
    h += '<td data-label="Pret Clinica Central" class="price-cell-cc">';
    if (ccp !== null) {
      h += '<span class="price-cc">' + ccp.toFixed(0) + ' RON</span>';
    } else {
      h += '<span class="price-cc-na">—</span>';
    }
    h += '</td></tr>';
  }
  h += '</tbody></table>';
  document.getElementById("tableArea").innerHTML = h;

  // Wire up sort clicks
  var ths = document.querySelectorAll(".results-table th");
  for (var t = 0; t < ths.length; t++) {
    (function(th) {
      th.addEventListener("click", function() {
        var col = th.getAttribute("data-col");
        if (browseState.sortCol === col) browseState.sortDir = -browseState.sortDir;
        else { browseState.sortCol = col; browseState.sortDir = 1; }
        renderBrowseTable(browseState.lastResults);
      });
    })(ths[t]);
  }

  // Wire up info buttons
  var infoBtns = document.querySelectorAll(".info-btn");
  for (var ib = 0; ib < infoBtns.length; ib++) {
    (function(btn) {
      btn.addEventListener("click", function(e) {
        e.stopPropagation();
        showDetailsModal(btn.getAttribute("data-lab"), btn.getAttribute("data-den"));
      });
    })(infoBtns[ib]);
  }
}

// Excel export from browse view
document.getElementById("btnExport").addEventListener("click", function() {
  if (!browseState.lastResults.length) return;
  var rows = browseState.lastResults.map(function(r) {
    return {
      "Laborator": r.Laborator,
      "Denumire Analiza": r.Denumire,
      "Categorie": r.Categorie !== "N/A" ? r.Categorie : "",
      "Timp Executie": r.Timp !== "N/A" ? r.Timp : "",
      "Pret Lista (RON)": r.Pret,
      "Discount (%)": discPct(r.Laborator),
      "Pret Final (RON)": finalPrice(r.Pret, r.Laborator),
      "Economie (RON)": r.Pret - finalPrice(r.Pret, r.Laborator)
    };
  });
  var ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{wch:18},{wch:50},{wch:22},{wch:20},{wch:14},{wch:10},{wch:14},{wch:12}];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rezultate");
  var date = new Date();
  XLSX.writeFile(wb, "export_analize_" + date.getFullYear() + "-" + String(date.getMonth()+1).padStart(2,"0") + "-" + String(date.getDate()).padStart(2,"0") + ".xlsx");
});

// ════════════════════════════════════════════════════════════════
// SCAN FEATURE (OCR cu Claude API)
// ════════════════════════════════════════════════════════════════
var scanModal = document.getElementById("scanModal");
var scanResultModal = document.getElementById("scanResultModal");
var scanPickerArea = document.getElementById("scanPickerArea");
var scanProcessingArea = document.getElementById("scanProcessingArea");
var scanErrorArea = document.getElementById("scanErrorArea");

document.getElementById("btnScan").addEventListener("click", function() {
  resetScanModal();
  scanModal.classList.add("visible");
});
document.getElementById("scanModalClose").addEventListener("click", function() {
  scanModal.classList.remove("visible");
});
scanModal.addEventListener("click", function(e) {
  if (e.target === scanModal) scanModal.classList.remove("visible");
});
document.getElementById("scanResultClose").addEventListener("click", function() {
  scanResultModal.classList.remove("visible");
});
scanResultModal.addEventListener("click", function(e) {
  if (e.target === scanResultModal) scanResultModal.classList.remove("visible");
});
document.getElementById("scanRetryBtn").addEventListener("click", resetScanModal);

function resetScanModal() {
  scanPickerArea.style.display = "block";
  scanProcessingArea.style.display = "none";
  scanErrorArea.style.display = "none";
  document.getElementById("scanCameraInput").value = "";
  document.getElementById("scanFileInput").value = "";
}

document.getElementById("scanCameraInput").addEventListener("change", function(e) {
  if (e.target.files[0]) handleScanFile(e.target.files[0]);
});
document.getElementById("scanFileInput").addEventListener("change", function(e) {
  if (e.target.files[0]) handleScanFile(e.target.files[0]);
});

async function handleScanFile(file) {
  scanPickerArea.style.display = "none";
  scanErrorArea.style.display = "none";
  scanProcessingArea.style.display = "block";

  // Show preview
  var reader = new FileReader();
  reader.onload = function(ev) {
    document.getElementById("scanPreviewImg").src = ev.target.result;
  };
  reader.readAsDataURL(file);

  // Convert file to base64 for Claude API
  var base64Data;
  try {
    base64Data = await fileToBase64(file);
  } catch (e) {
    showScanError("Nu pot citi fisierul imagine: " + e.message);
    return;
  }

  // Detect media type
  var mediaType = file.type || "image/jpeg";
  if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType)) {
    mediaType = "image/jpeg";
  }

  // Call Claude API
  document.getElementById("scanStatusText").textContent = "Se analizeaza biletul...";
  document.getElementById("scanStatusSub").textContent = "Claude citeste imaginea si extrage datele";

  try {
    var extracted = await extractFromImage(base64Data, mediaType);
    showScanResults(extracted);
  } catch (e) {
    showScanError("Eroare la procesare: " + (e.message || e));
  }
}

function fileToBase64(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() {
      var b64 = reader.result.split(",")[1];
      resolve(b64);
    };
    reader.onerror = function() { reject(new Error("FileReader failed")); };
    reader.readAsDataURL(file);
  });
}

function showScanError(msg) {
  scanProcessingArea.style.display = "none";
  scanErrorArea.style.display = "block";
  document.getElementById("scanErrorText").textContent = msg;
}

async function extractFromImage(base64Data, mediaType) {
  var prompt = "Analizeaza acest bilet de trimitere medical romanesc (CAS). Extrage:\n\n" +
    "1. **Numele si prenumele pacientului** — cauta in campul 'Nume si Prenume' sau similar\n" +
    "2. **CNP-ul pacientului** (13 cifre) — cauta in campul 'CID/CNP/CE/PASS'\n" +
    "3. **Lista analizelor medicale** recomandate (coloana 'Investigatii recomandate')\n\n" +
    "Pentru fiecare analiza, returneaza EXACT textul asa cum e scris pe bilet (chiar daca are typo-uri sau abrevieri).\n\n" +
    "Pentru nume/prenume: pe bilete romanesti de obicei ordinea este NUME PRENUME (familie, apoi prenume). Daca poti distinge clar, separa-le. Daca nu esti sigur, lasa pe null.\n\n" +
    "Raspunde DOAR cu JSON valid, fara alte comentarii, fara code blocks. Format:\n" +
    "{\n" +
    '  "nume": "string sau null",\n' +
    '  "prenume": "string sau null",\n' +
    '  "cnp": "string 13 cifre sau null daca nu e clar",\n' +
    '  "analize": ["denumire analiza 1", "denumire analiza 2", ...]\n' +
    "}\n\n" +
    "Daca biletul nu e lizibil sau nu e un bilet medical, returneaza { \"nume\": null, \"prenume\": null, \"cnp\": null, \"analize\": [] }.";

  var response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
            { type: "text", text: prompt }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    var errText = await response.text();
    throw new Error("API a raspuns cu " + response.status + ": " + errText.substring(0, 200));
  }

  var result = await response.json();
  var textBlocks = result.content.filter(function(b){ return b.type === "text"; });
  if (!textBlocks.length) throw new Error("Raspuns gol de la API");

  var responseText = textBlocks.map(function(b){ return b.text; }).join("\n").trim();
  responseText = responseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  var parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch (e) {
    throw new Error("Nu pot parsa raspunsul AI: " + responseText.substring(0, 150));
  }

  if (!parsed.analize || !Array.isArray(parsed.analize)) {
    throw new Error("Format neasteptat de raspuns (lipseste lista de analize)");
  }

  return {
    nume: parsed.nume || null,
    prenume: parsed.prenume || null,
    cnp: parsed.cnp || null,
    analize: parsed.analize
  };
}

function findBestMatch(extractedText) {
  // Try to find this analysis in ANALIZE_INDEX using fuzzy matching
  var target = normName(extractedText);
  if (!target) return null;

  // Try exact match first
  if (ANALIZE_INDEX[target]) {
    return { entry: ANALIZE_INDEX[target], score: 1.0 };
  }

  // Scored matching: startsWith > contains > word overlap
  var targetWords = target.split(" ").filter(function(w){ return w.length >= 3; });
  var best = null;
  var bestScore = 0;

  for (var i = 0; i < ANALIZE_LIST.length; i++) {
    var entry = ANALIZE_LIST[i];
    var key = entry.key;
    var score = 0;

    if (key === target) { score = 1.0; }
    else if (key.indexOf(target) === 0) { score = 0.9; }
    else if (target.indexOf(key) === 0) { score = 0.85; }
    else if (key.indexOf(target) !== -1) { score = 0.75; }
    else if (target.indexOf(key) !== -1) { score = 0.7; }
    else if (targetWords.length >= 2) {
      // Word overlap
      var keyWords = key.split(" ");
      var matched = 0;
      for (var w = 0; w < targetWords.length; w++) {
        if (keyWords.indexOf(targetWords[w]) !== -1) matched++;
      }
      if (matched >= Math.min(2, targetWords.length)) {
        score = 0.5 + (matched / targetWords.length) * 0.3;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  return bestScore >= 0.6 ? { entry: best, score: bestScore } : null;
}

function showScanResults(extracted) {
  scanModal.classList.remove("visible");

  // Match each extracted analiza against our database
  var matched = [];
  var unmatched = [];
  for (var i = 0; i < extracted.analize.length; i++) {
    var txt = extracted.analize[i];
    var match = findBestMatch(txt);
    if (match) {
      matched.push({ extracted: txt, entry: match.entry, score: match.score, checked: true });
    } else {
      unmatched.push(txt);
    }
  }

  // Summary
  var summaryHtml = '';
  if (extracted.prenume || extracted.nume) {
    var fullName = [extracted.prenume, extracted.nume].filter(Boolean).join(" ");
    summaryHtml += '<div class="scan-result-cnp"><span class="label">Pacient</span><strong>' + esc(fullName) + '</strong></div>';
  }
  if (extracted.cnp && /^\d{13}$/.test(extracted.cnp)) {
    summaryHtml += '<div class="scan-result-cnp"><span class="label">CNP detectat</span><strong>' + esc(extracted.cnp) + '</strong></div>';
  }
  summaryHtml += '<span class="stat"><strong>' + matched.length + '</strong> gasite</span>';
  if (unmatched.length) summaryHtml += '<span class="stat" style="color:var(--accent)"><strong>' + unmatched.length + '</strong> necunoscute</span>';
  document.getElementById("scanResultSummary").innerHTML = summaryHtml;

  // Body
  var body = '';
  if (matched.length > 0) {
    body += '<div class="scan-section-title">Analize gasite in baza (selecteaza care vrei sa adaugi)</div>';
    body += '<ul class="scan-items" id="scanMatchedList">';
    for (var i = 0; i < matched.length; i++) {
      var m = matched[i];
      var ch = cheapestOffer(m.entry);
      body += '<li class="scan-item" data-idx="' + i + '">';
      body += '<div class="scan-item-check checked" data-idx="' + i + '"></div>';
      body += '<div class="scan-item-info">';
      body += '<div class="scan-item-name">' + esc(m.entry.displayName);
      body += '<span class="scan-item-lab lab-bg-' + labCls(ch.offer.Laborator) + '">' + esc(ch.offer.Laborator) + '</span></div>';
      if (normName(m.extracted) !== m.entry.key) {
        body += '<div class="scan-item-extracted">pe bilet: „' + esc(m.extracted) + '"</div>';
      }
      body += '</div>';
      body += '<div class="scan-item-price">' + ch.finalPrice + ' RON</div>';
      body += '</li>';
    }
    body += '</ul>';
  }

  if (unmatched.length > 0) {
    body += '<div class="scan-section-title">Analize care nu au fost gasite</div>';
    body += '<ul class="scan-items">';
    for (var i = 0; i < unmatched.length; i++) {
      body += '<li class="scan-item">';
      body += '<div style="width:20px;flex-shrink:0;text-align:center;color:rgba(15,17,23,0.3);font-size:18px">&times;</div>';
      body += '<div class="scan-item-info">';
      body += '<div class="scan-item-name" style="color:rgba(15,17,23,0.6)">' + esc(unmatched[i]) + '</div>';
      body += '<div class="scan-item-nomatch">nu exista in nicio lista de laborator</div>';
      body += '</div></li>';
    }
    body += '</ul>';
  }

  if (matched.length === 0 && unmatched.length === 0) {
    body += '<p style="padding:32px;text-align:center;color:rgba(15,17,23,0.5)">Nicio analiza detectata pe bilet. Incearca o poza mai clara.</p>';
  }

  body += '<div class="scan-result-actions">';
  if (matched.length > 0) {
    body += '<button class="primary" id="btnAddAllScan">Adauga ' + matched.length + ' analize selectate</button>';
  }
  body += '<button id="btnCancelScan">Anuleaza</button>';
  body += '</div>';

  document.getElementById("scanResultBody").innerHTML = body;
  scanResultModal.classList.add("visible");

  // Store matched for adding later
  window.__scanMatched = matched;
  window.__scanCnp = extracted.cnp;
  window.__scanNume = extracted.nume;
  window.__scanPrenume = extracted.prenume;

  // Wire up checkboxes
  var checks = document.querySelectorAll("#scanMatchedList .scan-item-check");
  for (var i = 0; i < checks.length; i++) {
    (function(el) {
      el.addEventListener("click", function() {
        var idx = parseInt(el.getAttribute("data-idx"));
        window.__scanMatched[idx].checked = !window.__scanMatched[idx].checked;
        el.classList.toggle("checked");
      });
    })(checks[i]);
  }

  document.getElementById("btnCancelScan").addEventListener("click", function() {
    scanResultModal.classList.remove("visible");
  });

  var addBtn = document.getElementById("btnAddAllScan");
  if (addBtn) {
    addBtn.addEventListener("click", function() {
      // Pre-populate name fields if detected (only if currently empty)
      if (window.__scanPrenume && !prenumeInput.value.trim()) {
        prenumeInput.value = window.__scanPrenume;
        updateNumeField(prenumeInput, "prenume");
      }
      if (window.__scanNume && !numeInput.value.trim()) {
        numeInput.value = window.__scanNume;
        updateNumeField(numeInput, "nume");
      }
      // Pre-populate CNP if detected
      if (window.__scanCnp && /^\d{13}$/.test(window.__scanCnp)) {
        cnpInput.value = window.__scanCnp;
        updateCnpUi();
      }
      // Add selected analize to cart
      var added = 0;
      for (var i = 0; i < window.__scanMatched.length; i++) {
        if (window.__scanMatched[i].checked) {
          addToCart(window.__scanMatched[i].entry.key);
          added++;
        }
      }
      scanResultModal.classList.remove("visible");
      // Small visual feedback
      if (added > 0) {
        var toast = document.createElement("div");
        toast.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--paper);padding:12px 20px;border-radius:var(--radius);font-size:14px;z-index:2000;box-shadow:0 8px 24px rgba(0,0,0,0.3)";
        toast.textContent = "✓ " + added + " analize adaugate in cerere";
        document.body.appendChild(toast);
        setTimeout(function() { toast.style.opacity = "0"; toast.style.transition = "opacity 0.3s"; }, 2000);
        setTimeout(function() { toast.remove(); }, 2500);
      }
    });
  }
}

// ════════════════════════════════════════════════════════════════
// DETAILS MODAL (shared)
// ════════════════════════════════════════════════════════════════
function showDetailsModal(lab, denumire) {
  var d = getDetails(lab, denumire);
  if (!d) return;
  var modal = document.getElementById("detailsModal");
  var body = document.getElementById("detailsModalBody");
  var title = document.getElementById("detailsModalTitle");
  title.textContent = denumire;

  var rows = [];
  if (d.LaboratorSubcontractant) rows.push(["Locatie / Laborator", d.LaboratorSubcontractant]);
  if (d.Recipient || d.CuloareDop) {
    var recipient = d.Recipient || "";
    if (d.CuloareDop) recipient += (recipient ? " — " : "") + "dop " + d.CuloareDop;
    rows.push(["Eprubeta", recipient]);
  }
  if (d.MaterialBiologic) rows.push(["Material biologic", d.MaterialBiologic]);
  if (d.CantitateMinima) rows.push(["Cantitate minima", d.CantitateMinima]);
  if (d.TermenExecutie) rows.push(["Termen executie", d.TermenExecutie]);
  if (d.Observatii) rows.push(["Observatii", d.Observatii]);

  var html = '<dl class="details-list">';
  for (var i = 0; i < rows.length; i++) {
    html += '<dt>' + esc(rows[i][0]) + '</dt><dd>' + esc(rows[i][1]) + '</dd>';
  }
  html += '</dl>';
  html += '<div class="details-meta">Laborator: <strong>' + esc(lab) + '</strong></div>';
  body.innerHTML = html;
  modal.classList.add("visible");
}
function closeDetailsModal() {
  document.getElementById("detailsModal").classList.remove("visible");
}
document.getElementById("detailsModalClose").addEventListener("click", closeDetailsModal);
document.getElementById("detailsModal").addEventListener("click", function(e) {
  if (e.target === this) closeDetailsModal();
});

// ════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════
updateCnpUi();
renderCart();
prenumeInput.focus();


// ════════════════════════════════════════════════════════════════
// SUPABASE — save cerere to DB (auto-called on openReport)
// ════════════════════════════════════════════════════════════════
async function saveCerere(r) {
  if (!window.sb || !window.__CURRENT_USER__) {
    console.warn("[saveCerere] Supabase sau user lipseste, nu pot salva.");
    return null;
  }

  var totalEprubete = 0;
  var eprubete = buildEprubetSummary(r.items).map(function(e) {
    totalEprubete += e.count;
    return { tip: e.tip, bucati: e.count, pentruLocatii: e.breakdown };
  });

  var payload = {
    cnp_pacient: cartState.cnp,
    pacient_prenume: cartState.prenume.trim(),
    pacient_nume: cartState.nume.trim(),
    pacient_email: cartState.email.trim() || null,
    pacient_telefon_prefix: cartState.telefonNumar ? cartState.telefonPrefix : null,
    pacient_telefon_numar: cartState.telefonNumar.trim() || null,
    user_id: window.__CURRENT_USER__.id,
    user_email: window.__CURRENT_USER__.email,
    numar_analize: r.items.length,
    numar_laboratoare: r.groups.length,
    numar_eprubete: totalEprubete,
    total_lista_ron: r.grandListTotal,
    total_final_ron: r.grandTotal,
    economie_ron: r.grandListTotal - r.grandTotal,
    items: r.items.map(function(it) {
      var d = getDetails(it.offer.Laborator, it.displayName);
      return {
        denumire: it.displayName,
        laborator: it.offer.Laborator,
        pret_lista: it.offer.Pret,
        pret_final: Math.round(it.finalPrice * 100) / 100,
        pret_sursa: it.priceSource,
        discount: it.discount,
        timp: (it.offer.Timp && it.offer.Timp !== "N/A") ? it.offer.Timp : null,
        categorie: (it.offer.Categorie && it.offer.Categorie !== "N/A") ? it.offer.Categorie : null,
        detalii: d ? {
          recipient: d.Recipient || null,
          culoareDop: d.CuloareDop || null,
          materialBiologic: d.MaterialBiologic || null,
          cantitateMinima: d.CantitateMinima || null,
          laboratorSubcontractant: d.LaboratorSubcontractant || null,
          observatii: d.Observatii || null
        } : null
      };
    }),
    groups: r.groups.map(function(g) {
      return {
        laborator: g.lab,
        numar_analize: g.items.length,
        subtotal_lista: g.listTotal,
        subtotal_final: g.total,
        economie: g.listTotal - g.total
      };
    }),
    eprubete: eprubete,
    discounts: Object.assign({}, discounts)
  };

  try {
    var result = await window.sb.from("cc_cereri").insert([payload]).select().single();
    if (result.error) {
      console.error("[saveCerere] Eroare salvare:", result.error);
      showSaveStatus(false, result.error.message);
      return null;
    }
    console.log("[saveCerere] Cerere salvata:", result.data.id);
    showSaveStatus(true);
    return result.data;
  } catch (e) {
    console.error("[saveCerere] Exceptie:", e);
    showSaveStatus(false, e.message);
    return null;
  }
}

function showSaveStatus(success, errorMsg) {
  var existing = document.getElementById("saveStatusToast");
  if (existing) existing.remove();

  var toast = document.createElement("div");
  toast.id = "saveStatusToast";
  toast.style.cssText = "position:fixed;top:24px;right:24px;padding:12px 18px;border-radius:6px;font-family:DM Sans,sans-serif;font-size:13px;font-weight:500;z-index:2000;box-shadow:0 8px 24px rgba(0,0,0,0.15)";
  if (success) {
    toast.style.background = "#dcfce7";
    toast.style.color = "#166534";
    toast.style.border = "1px solid #86efac";
    toast.textContent = "\u2713 Cerere salvata in baza de date";
  } else {
    toast.style.background = "#fee2e2";
    toast.style.color = "#7c2015";
    toast.style.border = "1px solid #fca5a5";
    toast.textContent = "\u2717 Eroare la salvare: " + (errorMsg || "necunoscuta");
  }
  document.body.appendChild(toast);
  setTimeout(function() {
    toast.style.transition = "opacity 0.3s";
    toast.style.opacity = "0";
  }, 3000);
  setTimeout(function() { toast.remove(); }, 3400);
}

// ════════════════════════════════════════════════════════════════
// ISTORIC VIEW — load & display cereri din DB
// ════════════════════════════════════════════════════════════════
var istoricState = {
  loaded: false,
  cereri: [],
  filterCnp: "",
  filterFrom: null,
  filterTo: null
};

async function loadIstoric() {
  var listEl = document.getElementById("istoricList");
  listEl.innerHTML = '<div class="istoric-loading">Se incarca...</div>';

  if (!window.sb) {
    listEl.innerHTML = '<div class="istoric-error">Eroare: Supabase nu e disponibil.</div>';
    return;
  }

  try {
    var result = await window.sb
      .from("cc_cereri")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (result.error) {
      listEl.innerHTML = '<div class="istoric-error">Eroare incarcare: ' + esc(result.error.message) + '</div>';
      return;
    }
    istoricState.cereri = result.data || [];
    istoricState.loaded = true;
    renderIstoric();
  } catch (e) {
    listEl.innerHTML = '<div class="istoric-error">Eroare: ' + esc(e.message) + '</div>';
  }
}

function renderIstoric() {
  var listEl = document.getElementById("istoricList");
  var statsEl = document.getElementById("istoricStats");

  // Apply filters
  var filtered = istoricState.cereri.filter(function(c) {
    if (istoricState.filterCnp) {
      // Search by CNP digits OR by name (case-insensitive substring)
      var q = istoricState.filterCnp.toLowerCase();
      var matchCnp = c.cnp_pacient && c.cnp_pacient.indexOf(istoricState.filterCnp) !== -1;
      var fullName = ((c.pacient_prenume || "") + " " + (c.pacient_nume || "")).toLowerCase();
      var matchName = fullName.indexOf(q) !== -1;
      if (!matchCnp && !matchName) return false;
    }
    if (istoricState.filterFrom) {
      var d = new Date(c.created_at);
      var from = new Date(istoricState.filterFrom + "T00:00:00");
      if (d < from) return false;
    }
    if (istoricState.filterTo) {
      var d = new Date(c.created_at);
      var to = new Date(istoricState.filterTo + "T23:59:59");
      if (d > to) return false;
    }
    return true;
  });

  // Stats
  var totalRon = filtered.reduce(function(s, c){ return s + Number(c.total_final_ron); }, 0);
  var totalAnalize = filtered.reduce(function(s, c){ return s + c.numar_analize; }, 0);
  var uniqueCnps = {};
  filtered.forEach(function(c){ uniqueCnps[c.cnp_pacient] = true; });

  statsEl.innerHTML =
    '<div class="istoric-stat"><span class="num">' + filtered.length + '</span><span class="lab">cereri</span></div>' +
    '<div class="istoric-stat"><span class="num">' + Object.keys(uniqueCnps).length + '</span><span class="lab">pacienti unici</span></div>' +
    '<div class="istoric-stat"><span class="num">' + totalAnalize + '</span><span class="lab">analize totale</span></div>' +
    '<div class="istoric-stat"><span class="num">' + Math.round(totalRon) + '</span><span class="lab">RON total</span></div>';

  if (filtered.length === 0) {
    if (istoricState.cereri.length === 0) {
      listEl.innerHTML = '<div class="istoric-empty"><h3>Nicio cerere salvata</h3><p>Cererile procesate de pe tab-ul „Cerere analize" vor aparea aici automat.</p></div>';
    } else {
      listEl.innerHTML = '<div class="istoric-empty"><h3>Niciun rezultat pentru filtrele aplicate</h3><p>Modifica filtrele sau apasa „Reseteaza filtre".</p></div>';
    }
    return;
  }

  var html = "";
  for (var i = 0; i < filtered.length; i++) {
    var c = filtered[i];
    var date = new Date(c.created_at);
    var dateStr = date.toLocaleString("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    // Build patient name from columns (or fallback to CNP only if old data)
    var fullName = [c.pacient_prenume, c.pacient_nume].filter(Boolean).join(" ").trim();
    html += '<div class="istoric-row" data-id="' + esc(c.id) + '">';
    html += '<div class="istoric-row-main">';
    if (fullName) {
      html += '<div class="istoric-row-cnp">' + esc(fullName) + ' <small style="font-family:monospace;font-weight:400;color:rgba(15,17,23,0.5)">(' + esc(c.cnp_pacient) + ')</small></div>';
    } else {
      html += '<div class="istoric-row-cnp">' + esc(c.cnp_pacient) + '</div>';
    }
    html += '<div class="istoric-row-meta">';
    html += '<span>' + esc(dateStr) + '</span>';
    html += '<span>' + c.numar_analize + ' analize</span>';
    html += '<span>' + c.numar_laboratoare + ' lab' + (c.numar_laboratoare === 1 ? '' : '.') + '</span>';
    html += '<span>' + c.numar_eprubete + ' eprubete</span>';
    if (c.user_email) html += '<span class="istoric-user">' + esc(c.user_email) + '</span>';
    html += '</div></div>';
    html += '<div class="istoric-row-price"><strong>' + Math.round(c.total_final_ron) + '</strong> RON</div>';
    html += '<div class="istoric-row-actions">';
    html += '<button class="istoric-row-btn" data-act="detalii" data-id="' + esc(c.id) + '">Detalii</button>';
    html += '<button class="istoric-row-btn istoric-btn-pdf" data-act="pdf" data-id="' + esc(c.id) + '">PDF</button>';
    html += '<button class="istoric-row-btn istoric-btn-xlsx" data-act="xlsx" data-id="' + esc(c.id) + '">Excel</button>';
    html += '<button class="istoric-row-btn istoric-btn-json" data-act="json" data-id="' + esc(c.id) + '">JSON</button>';
    html += '<button class="istoric-row-btn istoric-btn-new" data-act="noua" data-id="' + esc(c.id) + '">Cerere noua</button>';
    html += '<button class="istoric-row-btn istoric-btn-same" data-act="same" data-id="' + esc(c.id) + '">Aceeasi cerere</button>';
    html += '</div>';
    html += '</div>';
  }
  listEl.innerHTML = html;

  var btns = listEl.querySelectorAll(".istoric-row-btn");
  for (var i = 0; i < btns.length; i++) {
    (function(btn) {
      btn.addEventListener("click", function() {
        var id = btn.getAttribute("data-id");
        var act = btn.getAttribute("data-act");
        if (act === "detalii") showIstoricDetail(id);
        else if (act === "pdf") exportIstoricPdf(id);
        else if (act === "xlsx") exportIstoricXlsx(id);
        else if (act === "json") exportIstoricJson(id);
        else if (act === "noua") cerereNouaDinIstoric(id);
        else if (act === "same") aceeasiCerereDinIstoric(id);
      });
    })(btns[i]);
  }
}

// ─── Helper: rebuild a report-like object from a saved cerere ───
function rebuildReportFromCerere(c) {
  // c.items is the JSONB array saved at process time
  var items = (c.items || []).map(function(it) {
    return {
      displayName: it.denumire,
      offer: {
        Laborator: it.laborator,
        Denumire: it.denumire,
        Pret: it.pret_lista,
        Timp: it.timp || "N/A",
        Categorie: it.categorie || "N/A"
      },
      finalPrice: it.pret_final,
      priceSource: it.pret_sursa || "cc",  // backwards-compatible default
      discount: it.discount
    };
  });
  // Group by lab
  var groupsMap = {};
  for (var i = 0; i < items.length; i++) {
    var lab = items[i].offer.Laborator;
    if (!groupsMap[lab]) groupsMap[lab] = { lab: lab, items: [], total: 0, listTotal: 0 };
    groupsMap[lab].items.push(items[i]);
    groupsMap[lab].total += items[i].finalPrice;
    groupsMap[lab].listTotal += items[i].offer.Pret;
  }
  var groups = Object.keys(groupsMap).map(function(k){ return groupsMap[k]; });
  return {
    items: items,
    groups: groups,
    grandTotal: c.total_final_ron,
    grandListTotal: c.total_lista_ron
  };
}

// ─── Export Excel from istoric ───
function exportIstoricXlsx(id) {
  var c = istoricState.cereri.find(function(x){ return x.id === id; });
  if (!c) return;
  // Temporarily set cartState patient fields so export header is correct
  var saved = {
    prenume: cartState.prenume, nume: cartState.nume, cnp: cartState.cnp,
    email: cartState.email, telefonPrefix: cartState.telefonPrefix, telefonNumar: cartState.telefonNumar
  };
  cartState.prenume = c.pacient_prenume || "";
  cartState.nume = c.pacient_nume || "";
  cartState.cnp = c.cnp_pacient || "";
  cartState.email = c.pacient_email || "";
  cartState.telefonPrefix = c.pacient_telefon_prefix || "+40";
  cartState.telefonNumar = c.pacient_telefon_numar || "";
  var r = rebuildReportFromCerere(c);
  exportReportXlsx(r);
  // Restore
  cartState.prenume = saved.prenume; cartState.nume = saved.nume; cartState.cnp = saved.cnp;
  cartState.email = saved.email; cartState.telefonPrefix = saved.telefonPrefix; cartState.telefonNumar = saved.telefonNumar;
}

// ─── Export PDF from istoric ───
function exportIstoricPdf(id) {
  var c = istoricState.cereri.find(function(x){ return x.id === id; });
  if (!c) return;
  var saved = {
    prenume: cartState.prenume, nume: cartState.nume, cnp: cartState.cnp,
    email: cartState.email, telefonPrefix: cartState.telefonPrefix, telefonNumar: cartState.telefonNumar
  };
  cartState.prenume = c.pacient_prenume || "";
  cartState.nume = c.pacient_nume || "";
  cartState.cnp = c.cnp_pacient || "";
  cartState.email = c.pacient_email || "";
  cartState.telefonPrefix = c.pacient_telefon_prefix || "+40";
  cartState.telefonNumar = c.pacient_telefon_numar || "";
  var r = rebuildReportFromCerere(c);
  exportReportPdf(r);
  cartState.prenume = saved.prenume; cartState.nume = saved.nume; cartState.cnp = saved.cnp;
  cartState.email = saved.email; cartState.telefonPrefix = saved.telefonPrefix; cartState.telefonNumar = saved.telefonNumar;
}

// ─── Export JSON from istoric ───
function exportIstoricJson(id) {
  var c = istoricState.cereri.find(function(x){ return x.id === id; });
  if (!c) return;
  var saved = {
    prenume: cartState.prenume, nume: cartState.nume, cnp: cartState.cnp,
    email: cartState.email, telefonPrefix: cartState.telefonPrefix, telefonNumar: cartState.telefonNumar
  };
  cartState.prenume = c.pacient_prenume || "";
  cartState.nume = c.pacient_nume || "";
  cartState.cnp = c.cnp_pacient || "";
  cartState.email = c.pacient_email || "";
  cartState.telefonPrefix = c.pacient_telefon_prefix || "+40";
  cartState.telefonNumar = c.pacient_telefon_numar || "";
  var r = rebuildReportFromCerere(c);
  exportReportJson(r);
  cartState.prenume = saved.prenume; cartState.nume = saved.nume; cartState.cnp = saved.cnp;
  cartState.email = saved.email; cartState.telefonPrefix = saved.telefonPrefix; cartState.telefonNumar = saved.telefonNumar;
}

// ─── Cerere noua din istoric: pastreaza DOAR pacientul ───
function cerereNouaDinIstoric(id) {
  var c = istoricState.cereri.find(function(x){ return x.id === id; });
  if (!c) return;
  // Fill patient fields, empty cart
  prenumeInput.value = c.pacient_prenume || "";
  numeInput.value = c.pacient_nume || "";
  cnpInput.value = c.cnp_pacient || "";
  emailInput.value = c.pacient_email || "";
  telefonPrefixSelect.value = c.pacient_telefon_prefix || "+40";
  telefonNumarInput.value = c.pacient_telefon_numar || "";
  cartState.prenume = c.pacient_prenume || "";
  cartState.nume = c.pacient_nume || "";
  cartState.email = c.pacient_email || "";
  cartState.telefonPrefix = c.pacient_telefon_prefix || "+40";
  cartState.telefonNumar = c.pacient_telefon_numar || "";
  cartState.cart = [];
  updateNumeField(prenumeInput, "prenume");
  updateNumeField(numeInput, "nume");
  updateCnpUi();
  renderCart();
  switchView("cart");
}

// ─── Aceeasi cerere din istoric: pacient + analize (preturi/data se recalculeaza) ───
function aceeasiCerereDinIstoric(id) {
  var c = istoricState.cereri.find(function(x){ return x.id === id; });
  if (!c) return;
  // Fill patient
  prenumeInput.value = c.pacient_prenume || "";
  numeInput.value = c.pacient_nume || "";
  cnpInput.value = c.cnp_pacient || "";
  emailInput.value = c.pacient_email || "";
  telefonPrefixSelect.value = c.pacient_telefon_prefix || "+40";
  telefonNumarInput.value = c.pacient_telefon_numar || "";
  cartState.prenume = c.pacient_prenume || "";
  cartState.nume = c.pacient_nume || "";
  cartState.email = c.pacient_email || "";
  cartState.telefonPrefix = c.pacient_telefon_prefix || "+40";
  cartState.telefonNumar = c.pacient_telefon_numar || "";
  // Rebuild cart from saved items — re-resolve current best offer for each analiza
  cartState.cart = [];
  var notFound = [];
  var items = c.items || [];
  for (var i = 0; i < items.length; i++) {
    var den = items[i].denumire;
    var key = normName(den);
    var entry = ANALIZE_INDEX[key];
    if (entry) {
      // Pick the cheapest offer now (prices may have changed since the original)
      var best = cheapestOffer(entry);
      if (best.offer) {
        addToCart(key, best.offer.Laborator);
      } else {
        notFound.push(den);
      }
    } else {
      notFound.push(den);
    }
  }
  updateNumeField(prenumeInput, "prenume");
  updateNumeField(numeInput, "nume");
  updateCnpUi();
  renderCart();
  switchView("cart");
  if (notFound.length) {
    setTimeout(function() {
      alert("Atentie: " + notFound.length + " analize nu au mai fost gasite in catalogul curent si nu au fost adaugate:\n\n" + notFound.join("\n"));
    }, 300);
  }
}

function showIstoricDetail(id) {
  var c = istoricState.cereri.find(function(x){ return x.id === id; });
  if (!c) return;

  var modal = document.getElementById("istoricDetailModal");
  var title = document.getElementById("istoricDetailTitle");
  var meta = document.getElementById("istoricDetailMeta");
  var body = document.getElementById("istoricDetailBody");

  var fullName = [c.pacient_prenume, c.pacient_nume].filter(Boolean).join(" ").trim();
  title.textContent = fullName || ("CNP " + c.cnp_pacient);
  var dateStr = new Date(c.created_at).toLocaleString("ro-RO");

  var metaHtml = '';
  metaHtml += '<div class="istoric-detail-meta-row"><span>CNP:</span><strong>' + esc(c.cnp_pacient) + '</strong></div>';
  if (c.pacient_email) {
    metaHtml += '<div class="istoric-detail-meta-row"><span>Email:</span><strong>' + esc(c.pacient_email) + '</strong></div>';
  }
  if (c.pacient_telefon_numar) {
    var tel = (c.pacient_telefon_prefix || "") + " " + c.pacient_telefon_numar;
    metaHtml += '<div class="istoric-detail-meta-row"><span>Telefon:</span><strong>' + esc(tel.trim()) + '</strong></div>';
  }
  metaHtml += '<div class="istoric-detail-meta-row"><span>Procesat la:</span><strong>' + esc(dateStr) + '</strong></div>';
  if (c.user_email) {
    metaHtml += '<div class="istoric-detail-meta-row"><span>De catre:</span><strong>' + esc(c.user_email) + '</strong></div>';
  }
  metaHtml += '<div class="istoric-detail-meta-row"><span>Total:</span><strong>' + Math.round(c.total_final_ron) + ' RON</strong></div>';
  meta.innerHTML = metaHtml;

  // Body — show groups + items
  var html = '';
  html += '<div class="istoric-detail-section-title">Analize pe laboratoare</div>';
  var groups = c.groups || [];
  for (var g = 0; g < groups.length; g++) {
    var grp = groups[g];
    var grpItems = (c.items || []).filter(function(it){ return it.laborator === grp.laborator; });
    html += '<div class="istoric-detail-group">';
    html += '<div class="istoric-detail-group-header"><span class="suggestion-lab lab-bg-' + labCls(grp.laborator) + '">' + esc(grp.laborator) + '</span>';
    html += '<span class="istoric-detail-group-subtotal">' + Math.round(grp.subtotal_final) + ' RON</span></div>';
    html += '<ul class="istoric-detail-group-items">';
    for (var i = 0; i < grpItems.length; i++) {
      var it = grpItems[i];
      var srcBadge = '';
      if (it.pret_sursa === "lab+5%") {
        srcBadge = ' <small style="color:rgba(15,17,23,0.4);font-size:10px">(lab+5%)</small>';
      } else if (it.pret_sursa === "cc") {
        srcBadge = ' <small style="color:var(--gold);font-size:10px">(CC)</small>';
      }
      html += '<li><span class="den">' + esc(it.denumire) + srcBadge + '</span><span class="prc">' + Math.round(it.pret_final) + ' RON</span></li>';
    }
    html += '</ul></div>';
  }

  // Eprubete summary
  if (c.eprubete && c.eprubete.length) {
    html += '<div class="istoric-detail-section-title">Eprubete necesare (' + c.numar_eprubete + ')</div>';
    html += '<ul class="istoric-detail-eprubete">';
    for (var e = 0; e < c.eprubete.length; e++) {
      var ep = c.eprubete[e];
      html += '<li><span class="ep-count">' + ep.bucati + '\u00d7</span><span class="ep-text">' + esc(ep.tip);
      var locs = Object.keys(ep.pentruLocatii || {});
      if (locs.length) {
        html += '<small>' + esc(locs.map(function(l){
          return (ep.pentruLocatii[l] > 1 ? ep.pentruLocatii[l] + "\u00d7 " : "") + "\u2192 " + l;
        }).join(" \u2022 ")) + '</small>';
      }
      html += '</span></li>';
    }
    html += '</ul>';
  }

  body.innerHTML = html;
  modal.classList.add("visible");
  document.body.style.overflow = "hidden";
}

function closeIstoricDetail() {
  document.getElementById("istoricDetailModal").classList.remove("visible");
  document.body.style.overflow = "";
}

// Wire up Istoric controls
document.getElementById("btnIstoricRefresh").addEventListener("click", loadIstoric);
document.getElementById("istoricDetailClose").addEventListener("click", closeIstoricDetail);
document.getElementById("istoricDetailModal").addEventListener("click", function(e){
  if (e.target === this) closeIstoricDetail();
});

document.getElementById("istoricSearchCnp").addEventListener("input", function(e) {
  // Accept any input (digits for CNP, letters for name)
  istoricState.filterCnp = e.target.value.trim();
  if (istoricState.loaded) renderIstoric();
});
document.getElementById("istoricFilterFrom").addEventListener("change", function(e) {
  istoricState.filterFrom = e.target.value;
  if (istoricState.loaded) renderIstoric();
});
document.getElementById("istoricFilterTo").addEventListener("change", function(e) {
  istoricState.filterTo = e.target.value;
  if (istoricState.loaded) renderIstoric();
});
document.getElementById("btnIstoricClearFilters").addEventListener("click", function() {
  istoricState.filterCnp = "";
  istoricState.filterFrom = null;
  istoricState.filterTo = null;
  document.getElementById("istoricSearchCnp").value = "";
  document.getElementById("istoricFilterFrom").value = "";
  document.getElementById("istoricFilterTo").value = "";
  if (istoricState.loaded) renderIstoric();
});

// ════════════════════════════════════════════════════════════════
// VIEW 4: BORDEROURI (generare PDF pe laborator/data)
// ════════════════════════════════════════════════════════════════
var borderouState = {
  loaded: false,
  cereri: [],
  selectedDate: "",
  dateField: "created_at",
  selectedLab: ""
};

// Labs with PDF templates currently implemented
// Derzelius and Poliana have their own dedicated templates.
// Sante template is reused (with lab name swapped) for Clinica Sante, Binisan, Solomed, Medilab
// until proper templates are provided.
var BORDEROU_TEMPLATES = ["Derzelius", "Clinica Sante", "Poliana", "Binisan", "Solomed", "Medilab"];
var SANTE_TEMPLATE_LABS = ["Clinica Sante", "Binisan", "Solomed", "Medilab"];

// Classify an analiza into a borderou column key
// Returns one of: HLG, COAG, VSH, BCH, URINA, FECALE, TEXUDA, ALTELE
// Uses BOTH name-based rules AND vacutainer info (recipient + culoare + material)
// for much higher precision (was ~70% ALTELE, now ~25% ALTELE).
// Optional lab parameter lets us look up vacutainer info from getDetails().
function classifyAnaliza(denumire, categorie, lab) {
  var d = (denumire || "").toLowerCase();
  var c = (categorie || "");
  // Look up vacutainer info from details_*.json if lab is provided
  var recipient = "", culoare = "", material = "";
  if (lab) {
    var det = getDetails(lab, denumire);
    if (det) {
      recipient = (det.Recipient || "").toLowerCase();
      culoare = (det.CuloareDop || "").toLowerCase();
      material = (det.MaterialBiologic || "").toLowerCase();
      // Strip diacritics from culoare for matching (e.g. "Roșu" -> "rosu")
      culoare = culoare.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      recipient = recipient.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }
  }
  var rc = recipient + " " + culoare; // combined for color/recipient checks

  // ─── LAME / Citologie ───
  if (d.indexOf("babes-papanicolau") !== -1 || d.indexOf("babes papanicolau") !== -1 ||
      d.indexOf("papanicolau") !== -1 || d.indexOf("thinprep") !== -1 ||
      d.indexOf("pap test") !== -1 || d.indexOf("pap-test") !== -1 ||
      d.indexOf("citologic") !== -1 || d.indexOf("citologie") !== -1) return "LAME";
  if (recipient.indexOf("lama") !== -1 || recipient.indexOf("lame") !== -1) return "LAME";

  // ─── EXUDAT / secretii (key TEXUDA for PDF compatibility) ───
  if (d.indexOf("exsudat") !== -1 || d.indexOf("exudat") !== -1 ||
      d.indexOf("tampon ") !== -1 || d.indexOf("tampon nazal") !== -1 ||
      d.indexOf("tampon vagin") !== -1 || d.indexOf("tampon uretral") !== -1 ||
      d.indexOf("tampon faringian") !== -1 ||
      d.indexOf("secretie nazal") !== -1 || d.indexOf("secretie vagin") !== -1 ||
      d.indexOf("secretie uretral") !== -1 || d.indexOf("secretie conjunctiv") !== -1 ||
      d.indexOf("secretie otic") !== -1 || d.indexOf("secretie auric") !== -1 ||
      d.indexOf("cultura faringian") !== -1 || d.indexOf("cultura nazal") !== -1) return "TEXUDA";
  if (recipient.indexOf("eswab") !== -1 || recipient.indexOf("tampon") !== -1 ||
      recipient.indexOf("swab") !== -1) return "TEXUDA";
  if (c === "EXSUDATE" || c === "SECRETII") return "TEXUDA";

  // ─── FECALE / coprocultura ───
  if (d.indexOf("coproparazit") !== -1 || d.indexOf("coprocultur") !== -1 ||
      d.indexOf("materii fecale") !== -1 || d.indexOf("fecale") !== -1 ||
      d.indexOf("scaun") !== -1 || d.indexOf("calprotectin") !== -1 ||
      d.indexOf("h. pylori antigen") !== -1 || d.indexOf("helicobacter pylori antigen") !== -1 ||
      d.indexOf("antigen helicobacter") !== -1 || d.indexOf("rotavirus") !== -1 ||
      d.indexOf("adenovirus fecal") !== -1 || d.indexOf("sange ocult") !== -1 ||
      d.indexOf("hemoragii oculte") !== -1 || d.indexOf("lactoferin") !== -1 ||
      d.indexOf("hemoglobina umana din secretii") !== -1 ||
      d.indexOf("coprologie") !== -1 || d.indexOf("amprenta anala") !== -1) return "FECALE";
  if (material.indexOf("materii fecale") !== -1 || material.indexOf("scaun") !== -1 ||
      material.indexOf("fecale") !== -1 || material.indexOf("coprocitograma") !== -1) return "FECALE";
  if (recipient.indexOf("coprorecolt") !== -1) return "FECALE";
  if (c === "MATERII FECALE" || c === "Coprologie și screening digestiv") return "FECALE";

  // ─── URINA ───
  if (d.indexOf("urocultur") !== -1 || d.indexOf("sumar urina") !== -1 ||
      d.indexOf("sumar de urina") !== -1 || d.indexOf("sumar urinar") !== -1 ||
      d.indexOf("examen urina") !== -1 || d.indexOf("urina spontana") !== -1 ||
      d.indexOf("urina/24 ore") !== -1 || d.indexOf(" urinar") !== -1 ||
      d.indexOf("microalbumin") !== -1 || d.indexOf("proteinurie") !== -1 ||
      d.indexOf("albumin urin") !== -1 || d.indexOf("sediment urinar") !== -1 ||
      d.indexOf("calciu urinar") !== -1 || d.indexOf("cortizol urinar") !== -1 ||
      d.indexOf("creatinina urinar") !== -1 || d.indexOf("magneziu urinar") !== -1 ||
      d.indexOf("potasiu urinar") !== -1 || d.indexOf("sodiu urinar") !== -1 ||
      d.indexOf("uree urinar") !== -1 || d.indexOf("acid uric urinar") !== -1 ||
      d.indexOf("glucoza urinar") !== -1 || d.indexOf("fosfat urinar") !== -1 ||
      d.indexOf("clor urinar") !== -1 || d.indexOf("in urina") !== -1) return "URINA";
  if (material.indexOf("urin") !== -1 || recipient.indexOf("urin") !== -1) return "URINA";
  if (c === "URINA") return "URINA";

  // ─── COAG ───
  if (d.indexOf("coagular") !== -1 || d.indexOf("aptt") !== -1 || d.indexOf("ttpa") !== -1 ||
      d.indexOf("fibrinogen") !== -1 || d.indexOf("d-dimer") !== -1 ||
      d.indexOf("d dimer") !== -1 || d.indexOf("ddimer") !== -1 ||
      d.indexOf("antitrombina") !== -1 || d.indexOf("antitrombin") !== -1 ||
      d.indexOf("proteina c") !== -1 || d.indexOf("proteina s") !== -1 ||
      d.indexOf("timp quick") !== -1 || d.indexOf("timp de protrombina") !== -1 ||
      d.indexOf("protrombin") !== -1 || d.indexOf("pt inr") !== -1 ||
      d.indexOf("pt, inr") !== -1 || d.indexOf("factor v ") !== -1 ||
      d.indexOf("factor viii") !== -1 || d.indexOf("factor ix") !== -1 ||
      d.indexOf("factor x ") !== -1 || d.indexOf("factor xi") !== -1 ||
      d.indexOf("lupus anticoagulant") !== -1 || d.indexOf("timp de trombina") !== -1) return "COAG";
  var dt = d.trim();
  if (dt === "pt" || dt === "inr" || dt === "pt inr" || dt === "pt, inr" || dt === "pt/inr") return "COAG";
  if (rc.indexOf("albastru") !== -1 || rc.indexOf("citrat") !== -1 ||
      material.indexOf("citrat") !== -1) return "COAG";
  if (c === "Coagulare și hemostază") return "COAG";

  // ─── VSH ───
  if (d.indexOf("vsh") !== -1 || d.indexOf("sedimentare") !== -1 ||
      d.indexOf("viteza de sedimentare") !== -1) return "VSH";
  if (recipient.indexOf("vsh") !== -1) return "VSH";

  // ─── HLG ───
  if (d.indexOf("hemoleucograma") !== -1 || d.indexOf("hemograma") !== -1 ||
      d.indexOf("reticulocit") !== -1 || d.indexOf("frotiu sanguin") !== -1 ||
      d.indexOf("grup sanguin") !== -1 || d.indexOf("grupul sanguin") !== -1 ||
      d.indexOf("factor rh") !== -1 || d.indexOf("rezistenta osmotica") !== -1 ||
      d.indexOf("aglutinine la rece") !== -1 || d.indexOf("hlg") === 0) return "HLG";
  if (/\b(rh|abo)\b/.test(d)) return "HLG";
  // EDTA / dop mov = hematology (when not COAG)
  if (rc.indexOf("edta") !== -1 || rc.indexOf("mov") !== -1) return "HLG";
  if (material.indexOf("sange total") !== -1 || material.indexOf("sange edta") !== -1 ||
      material.indexOf("sange integral") !== -1) return "HLG";
  if (c === "Hematologie") return "HLG";

  // ─── BCH (Biochimie) — uses recipient signals ───
  if (d.indexOf("biochimi") !== -1) return "BCH";
  if (rc.indexOf("galben") !== -1 || rc.indexOf("biochimie") !== -1 ||
      rc.indexOf("serologie") !== -1 || rc.indexOf("sst") !== -1 ||
      rc.indexOf("gel separator") !== -1 || rc.indexOf("rosu") !== -1) return "BCH";
  if (material.indexOf("ser") === 0 || material.indexOf(" ser ") !== -1 ||
      material === "ser" || material.indexOf("plasma") !== -1 ||
      material.indexOf("sange venos") !== -1) return "BCH";
  if (c === "Biochimie") return "BCH";

  return "ALTELE";
}

// Load all cereri (reuses istoric data if already loaded)
async function loadBorderouri() {
  var listEl = document.getElementById("borderouPreview");
  // If istoric already loaded, just use its data
  if (istoricState.loaded && istoricState.cereri.length > 0) {
    borderouState.cereri = istoricState.cereri;
    borderouState.loaded = true;
    initBorderouDate();
    return;
  }
  // Else load same way as istoric
  listEl.innerHTML = '<div class="istoric-loading">Se incarca cererile...</div>';
  try {
    var res = await sb.from("cc_cereri")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (res.error) {
      listEl.innerHTML = '<div class="istoric-empty">Eroare la incarcarea cererilor: ' + esc(res.error.message) + '</div>';
      return;
    }
    borderouState.cereri = res.data || [];
    borderouState.loaded = true;
    initBorderouDate();
  } catch (e) {
    listEl.innerHTML = '<div class="istoric-empty">Eroare: ' + esc(e.message || e) + '</div>';
  }
}

// Init date input to today if empty, then populate lab dropdown
function initBorderouDate() {
  var dateInput = document.getElementById("borderouFilterDate");
  if (!dateInput.value) {
    var today = new Date();
    var iso = today.getFullYear() + "-" + String(today.getMonth()+1).padStart(2,"0") + "-" + String(today.getDate()).padStart(2,"0");
    dateInput.value = iso;
  }
  borderouState.selectedDate = dateInput.value;
  borderouState.dateField = document.getElementById("borderouFilterDateField").value;
  updateBorderouLabsDropdown();
}

// Get cereri matching the selected date
function getCereriForSelectedDate() {
  var d = borderouState.selectedDate;
  if (!d) return [];
  var fromTs = new Date(d + "T00:00:00").getTime();
  var toTs = new Date(d + "T23:59:59.999").getTime();
  var field = borderouState.dateField;
  return borderouState.cereri.filter(function(c) {
    var v = c[field];
    if (!v) return false;
    var t;
    if (typeof v === "string") {
      // Could be ISO or YYYY-MM-DD
      t = new Date(v.length === 10 ? v + "T12:00:00" : v).getTime();
    } else {
      t = new Date(v).getTime();
    }
    return t >= fromTs && t <= toTs;
  });
}

// Get unique labs that have items in the cereri for this date
function getLabsForSelectedDate() {
  var cereri = getCereriForSelectedDate();
  var labSet = {};
  for (var i = 0; i < cereri.length; i++) {
    var items = cereri[i].items || [];
    for (var j = 0; j < items.length; j++) {
      var lab = items[j].laborator;
      if (lab) labSet[lab] = true;
    }
  }
  return Object.keys(labSet).sort();
}

function updateBorderouLabsDropdown() {
  var labSelect = document.getElementById("borderouFilterLab");
  var labs = getLabsForSelectedDate();
  if (labs.length === 0) {
    labSelect.innerHTML = '<option value="">Nicio cerere in ziua aleasa</option>';
    document.getElementById("borderouStats").innerHTML = "";
    document.getElementById("borderouPreview").innerHTML = '<div class="istoric-empty">Nu sunt cereri inregistrate pentru ' + esc(borderouState.selectedDate) + '.</div>';
    return;
  }
  var html = '<option value="">Selecteaza laboratorul...</option>';
  for (var i = 0; i < labs.length; i++) {
    var hasTemplate = BORDEROU_TEMPLATES.indexOf(labs[i]) !== -1;
    html += '<option value="' + esc(labs[i]) + '">' + esc(labs[i]) + (hasTemplate ? '' : ' (fara template)') + '</option>';
  }
  labSelect.innerHTML = html;
  document.getElementById("borderouStats").innerHTML = "<strong>" + labs.length + "</strong> laboratoare cu cereri in ziua aleasa.";
  // Restore previous selection if still valid
  if (borderouState.selectedLab && labs.indexOf(borderouState.selectedLab) !== -1) {
    labSelect.value = borderouState.selectedLab;
    renderBorderouPreview();
  } else {
    borderouState.selectedLab = "";
    document.getElementById("borderouPreview").innerHTML = '<div class="istoric-loading">Alege laboratorul pentru previzualizare.</div>';
  }
}

// Get rows for the selected lab + date
function buildBorderouRows() {
  var cereri = getCereriForSelectedDate();
  var lab = borderouState.selectedLab;
  if (!lab) return [];
  var rows = [];
  for (var i = 0; i < cereri.length; i++) {
    var c = cereri[i];
    var items = c.items || [];
    var labItems = items.filter(function(it) { return it.laborator === lab; });
    if (labItems.length === 0) continue;
    // Build column flags
    var cols = { HLG:false, COAG:false, VSH:false, BCH:false, URINA:false, FECALE:false, TEXUDA:false, LAME:false, ALTELE:false };
    var altele_names = [];
    for (var j = 0; j < labItems.length; j++) {
      var col = classifyAnaliza(labItems[j].denumire, labItems[j].categorie, labItems[j].laborator);
      cols[col] = true;
      if (col === "ALTELE") altele_names.push(labItems[j].denumire);
    }
    rows.push({
      cerere_id: c.id,
      created_at: c.created_at,
      prenume: c.pacient_prenume || "",
      nume: c.pacient_nume || "",
      cnp: c.cnp_pacient || "",
      cols: cols,
      altele_names: altele_names,
      analize_count: labItems.length
    });
  }
  return rows;
}

function renderBorderouPreview() {
  var lab = borderouState.selectedLab;
  var listEl = document.getElementById("borderouPreview");
  if (!lab) {
    listEl.innerHTML = '<div class="istoric-loading">Alege laboratorul pentru previzualizare.</div>';
    return;
  }
  var rows = buildBorderouRows();
  if (rows.length === 0) {
    listEl.innerHTML = '<div class="istoric-empty">Nicio cerere pentru ' + esc(lab) + ' in ' + esc(borderouState.selectedDate) + '.</div>';
    return;
  }
  var hasTemplate = BORDEROU_TEMPLATES.indexOf(lab) !== -1;
  var html = '';
  html += '<div style="background:var(--cream);padding:14px 18px;border-radius:8px;margin-bottom:14px;border-left:3px solid var(--gold);">';
  html += '<strong>' + rows.length + ' pacienti</strong> cu cereri la <strong>' + esc(lab) + '</strong> pentru data <strong>' + esc(borderouState.selectedDate) + '</strong>.';
  if (!hasTemplate) {
    html += '<div style="margin-top:8px;color:var(--accent);"><strong>⚠ Template indisponibil pentru ' + esc(lab) + '.</strong> Borderourile sunt momentan disponibile doar pentru: ' + BORDEROU_TEMPLATES.join(", ") + '.</div>';
  }
  html += '</div>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  html += '<thead><tr style="background:var(--ink);color:var(--paper);">';
  html += '<th style="padding:8px;text-align:left;">Pacient</th>';
  html += '<th style="padding:8px;">CNP</th>';
  html += '<th style="padding:8px;">HLG</th><th style="padding:8px;">COAG</th><th style="padding:8px;">VSH</th>';
  html += '<th style="padding:8px;">BCH</th><th style="padding:8px;">URINA</th><th style="padding:8px;">FECALE</th>';
  html += '<th style="padding:8px;">EXSUDAT</th><th style="padding:8px;">LAME</th><th style="padding:8px;">ALTELE</th>';
  html += '</tr></thead><tbody>';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    html += '<tr style="border-bottom:1px solid rgba(15,17,23,0.08);">';
    html += '<td style="padding:8px;">' + esc((r.prenume + " " + r.nume).trim() || "—") + '</td>';
    html += '<td style="padding:8px;font-family:monospace;">' + esc(r.cnp) + '</td>';
    var colKeys = ["HLG","COAG","VSH","BCH","URINA","FECALE","TEXUDA","LAME","ALTELE"];
    for (var k = 0; k < colKeys.length; k++) {
      html += '<td style="padding:8px;text-align:center;' + (r.cols[colKeys[k]] ? "color:var(--gold);font-weight:700;" : "color:rgba(15,17,23,0.2);") + '">' + (r.cols[colKeys[k]] ? "✓" : "") + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  listEl.innerHTML = html;
}

// ─── PDF generation ───
// Helper: strip Romanian diacritics for jsPDF (Helvetica fonts handle only Latin1)
function stripDiacritics(s) {
  if (!s) return "";
  return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function generateBorderouPDF() {
  var lab = borderouState.selectedLab;
  if (!lab) { alert("Alege un laborator."); return; }
  if (BORDEROU_TEMPLATES.indexOf(lab) === -1) {
    alert("Template indisponibil pentru " + lab + ".\nMomentan disponibile: " + BORDEROU_TEMPLATES.join(", ") + ".");
    return;
  }
  var rows = buildBorderouRows();
  if (rows.length === 0) {
    alert("Nu sunt cereri pentru " + lab + " in ziua aleasa.");
    return;
  }
  if (lab === "Derzelius") generatePDFDerzelius(rows);
  else if (lab === "Poliana") generatePDFPoliana(rows);
  else if (SANTE_TEMPLATE_LABS.indexOf(lab) !== -1) generatePDFSante(rows, lab);
  else alert("Template indisponibil pentru " + lab + ".");
}

function _dateRO(iso) {
  // Convert YYYY-MM-DD to DD.MM.YYYY
  if (!iso || iso.length < 10) return iso || "";
  var parts = iso.substring(0, 10).split("-");
  return parts[2] + "." + parts[1] + "." + parts[0];
}

function generatePDFDerzelius(rows) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  var dateStr = _dateRO(borderouState.selectedDate);

  // Header
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("FORMULAR RECOLTARE TRANSPORT", 148, 15, { align: "center" });
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("CLINICA CENTRAL", 14, 24);
  doc.text("CENTRU CERCETARE MEDICALA DERZELIUS", 282, 24, { align: "right" });
  doc.text("Data: " + dateStr, 250, 15);

  // Build table
  var head = [["NUME PACIENT", "ID", "HLG", "COAG", "VSH", "BCH", "URINA", "FECALE", "T.EXUDA", "ALTELE", "DATA", "TEMP", "SEMNATURA\nPREDARE", "SEMNATURA\nPRIMIRE"]];
  var body = rows.map(function(r) {
    var name = stripDiacritics(((r.prenume + " " + r.nume).trim()) || "—");
    return [
      name,
      stripDiacritics(r.cnp || ""),
      r.cols.HLG ? "X" : "",
      r.cols.COAG ? "X" : "",
      r.cols.VSH ? "X" : "",
      r.cols.BCH ? "X" : "",
      r.cols.URINA ? "X" : "",
      r.cols.FECALE ? "X" : "",
      r.cols.TEXUDA ? "X" : "",
      r.cols.ALTELE ? "X" : "",
      _dateRO(r.created_at),
      "",  // TEMP — manual
      "",  // Semnatura predare — manual
      ""   // Semnatura primire — manual
    ];
  });

  doc.autoTable({
    head: head, body: body,
    startY: 30,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 2, lineColor: [50,50,50], lineWidth: 0.1 },
    headStyles: { fillColor: [240,240,240], textColor: [0,0,0], fontStyle: "bold", halign: "center" },
    columnStyles: {
      0: { cellWidth: 38 },
      1: { cellWidth: 18, halign: "center" },
      2: { cellWidth: 12, halign: "center" }, 3: { cellWidth: 12, halign: "center" },
      4: { cellWidth: 12, halign: "center" }, 5: { cellWidth: 12, halign: "center" },
      6: { cellWidth: 14, halign: "center" }, 7: { cellWidth: 14, halign: "center" },
      8: { cellWidth: 14, halign: "center" }, 9: { cellWidth: 14, halign: "center" },
      10: { cellWidth: 20, halign: "center" }, 11: { cellWidth: 14, halign: "center" },
      12: { cellWidth: 25 }, 13: { cellWidth: 25 }
    }
  });

  // Add empty rows for any "Altele" details at the bottom (optional)
  var hasAltele = rows.some(function(r){ return r.altele_names.length > 0; });
  if (hasAltele) {
    var y = doc.lastAutoTable.finalY + 6;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("ALTELE (detaliere):", 14, y);
    doc.setFont("helvetica", "normal");
    y += 5;
    rows.forEach(function(r) {
      if (r.altele_names.length > 0) {
        var name = stripDiacritics(((r.prenume + " " + r.nume).trim()) || "—");
        var line = name + " (" + stripDiacritics(r.cnp) + "): " + stripDiacritics(r.altele_names.join(", "));
        var split = doc.splitTextToSize(line, 270);
        doc.text(split, 14, y);
        y += split.length * 4;
      }
    });
  }

  var filename = "borderou_Derzelius_" + borderouState.selectedDate + ".pdf";
  doc.save(filename);
}

function generatePDFSante(rows, labName) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  var dateStr = _dateRO(borderouState.selectedDate);
  // Default to "Clinica Sante" if not provided (backwards compat)
  var displayLabName = labName || "Clinica Sante";

  // Header
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(stripDiacritics(displayLabName).toUpperCase(), 14, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("LAM. Pitesti", 14, 19);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("REGISTRU PREDARE-PRIMIRE PROBE RECOLTATE", 148, 14, { align: "center" });
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("DATA: " + dateStr, 14, 26);
  doc.text("Punct de recoltare: Clinica Central", 80, 26);

  // Table head per Sante template
  var head = [["NUME/PRENUME PACIENT","Ora\nrecoltarii","B","H","V","C","F","CO","U","L","ALTE","Ora\npreluare\ndin\ncabinet","t°\npreluare\ndin\ncabinet","Resp\npredare din\ncabinet\n(nume/sem)","Resp\nprimire\n(nume/sem)","t° predare\n(din lada/\nfrigider\ntransport)\nAUTO NR","Resp. triaj\n(nume/sem)\nORA PRIMIRII","Ora\nsosire\nin lab.","Resp.\npreluare\nin lab\n(nume/sem)","OBS"]];
  // Sante: B=biochimie, H=hemoleucograma, V=VSH, C=coagulare, F=exudat faringian, CO=coprorecolt, U=urina, L=lame
  var body = rows.map(function(r) {
    var name = stripDiacritics(((r.prenume + " " + r.nume).trim()) || "—");
    return [
      name,
      "",  // Ora recoltarii - manual
      r.cols.BCH ? "X" : "",
      r.cols.HLG ? "X" : "",
      r.cols.VSH ? "X" : "",
      r.cols.COAG ? "X" : "",
      r.cols.TEXUDA ? "X" : "",
      r.cols.FECALE ? "X" : "",
      r.cols.URINA ? "X" : "",
      r.cols.LAME ? "X" : "",
      r.cols.ALTELE ? "X" : "",
      "", "", "", "", "", "", "", "", ""  // Manual semnaturi/timpi
    ];
  });

  doc.autoTable({
    head: head, body: body,
    startY: 30,
    theme: "grid",
    styles: { fontSize: 6.5, cellPadding: 1.2, lineColor: [50,50,50], lineWidth: 0.1, valign: "middle" },
    headStyles: { fillColor: [240,240,240], textColor: [0,0,0], fontStyle: "bold", halign: "center", fontSize: 6.5 },
    columnStyles: {
      0: { cellWidth: 30 }, 1: { cellWidth: 12, halign: "center" },
      2: { cellWidth: 7, halign: "center" }, 3: { cellWidth: 7, halign: "center" }, 4: { cellWidth: 7, halign: "center" },
      5: { cellWidth: 7, halign: "center" }, 6: { cellWidth: 7, halign: "center" }, 7: { cellWidth: 9, halign: "center" },
      8: { cellWidth: 7, halign: "center" }, 9: { cellWidth: 7, halign: "center" }, 10: { cellWidth: 11, halign: "center" },
      11: { cellWidth: 14 }, 12: { cellWidth: 12 }, 13: { cellWidth: 18 }, 14: { cellWidth: 18 },
      15: { cellWidth: 16 }, 16: { cellWidth: 18 }, 17: { cellWidth: 12 }, 18: { cellWidth: 16 }, 19: { cellWidth: 14 }
    }
  });

  // Footer with legend
  var y = doc.lastAutoTable.finalY + 6;
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("Nota:", 14, y);
  doc.setFont("helvetica", "normal");
  y += 4;
  var legend = [
    "B - vacutainer biochimie",
    "H - vacutainer hemoleucograma",
    "V - vacutainer VSH",
    "C - vacutainer coagulare",
    "F - exudat faringian",
    "CO - coprorecoltoare",
    "U - recipiente urina",
    "L - lame"
  ];
  legend.forEach(function(line) { doc.text(line, 14, y); y += 3.5; });

  // Altele detalii
  var hasAltele = rows.some(function(r){ return r.altele_names.length > 0; });
  if (hasAltele) {
    y += 3;
    doc.setFont("helvetica", "bold");
    doc.text("ALTELE (detaliere):", 14, y);
    doc.setFont("helvetica", "normal");
    y += 4;
    rows.forEach(function(r) {
      if (r.altele_names.length > 0) {
        var name = stripDiacritics(((r.prenume + " " + r.nume).trim()) || "—");
        var line = name + ": " + stripDiacritics(r.altele_names.join(", "));
        var split = doc.splitTextToSize(line, 270);
        doc.text(split, 14, y);
        y += split.length * 3.5;
      }
    });
  }

  // Filename: normalize lab name (no spaces, no diacritics)
  var safeLabName = stripDiacritics(displayLabName).replace(/\s+/g, "");
  var filename = "borderou_" + safeLabName + "_" + borderouState.selectedDate + ".pdf";
  doc.save(filename);
}

function generatePDFPoliana(rows) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  var dateStr = _dateRO(borderouState.selectedDate);

  // Header
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("CENTRELE MEDICALE POLIANA S.R.L.", 14, 14);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("PG-CMP-7.2 / FG-CMP-7.2-02, Ed. 05.01.2026", 220, 14);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("FORMULAR DE INSOTIRE PROBE BIOLOGICE - CENTRELE MEDICALE POLIANA S.R.L.", 148, 20, { align: "center" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Punct recoltare: Clinica Central", 14, 28);
  doc.text("Recoltat de: _______________________", 80, 28);
  doc.text("Semnatura: _______________________", 160, 28);
  doc.text("Data: " + dateStr, 240, 28);

  // Poliana columns: Nr.Crt | Ora recoltare | ID Pacient | Nume Prenume | HLG | VSH | BIOCHIMIE | COAGULARE | SUMAR/UROCULTURA | Exudate/Tampoane/secretii | Coproparazit/coprocultura | Lame | Babes Lichid/HPV | EDTA dop sidef | Semnatura Asistent
  var head = [[
    "Nr.\nCrt.", "Ora\nrecoltare", "ID Pacient", "Nume Prenume pacient",
    "HLG", "VSH", "BIOCHIMIE", "COAGULARE", "SUMAR/\nUROCULTURA",
    "Exudate/\nTampoane/\nsecretii", "Coproparazit/\ncoprocultura", "Lame",
    "Babes\nLichid/\nHPV", "EDTA\ndop sidef\n(viremii)", "Semnatura\nAsistent\nrecoltare"
  ]];
  var body = rows.map(function(r, idx) {
    var name = stripDiacritics(((r.prenume + " " + r.nume).trim()) || "—");
    return [
      String(idx + 1),
      "",  // Ora - manual
      stripDiacritics(r.cnp || ""),
      name,
      r.cols.HLG ? "X" : "",
      r.cols.VSH ? "X" : "",
      r.cols.BCH ? "X" : "",
      r.cols.COAG ? "X" : "",
      r.cols.URINA ? "X" : "",
      r.cols.TEXUDA ? "X" : "",
      r.cols.FECALE ? "X" : "",
      r.cols.LAME ? "X" : "",
      "",
      r.cols.ALTELE ? "X" : "",
      ""   // Semnatura - manual
    ];
  });

  doc.autoTable({
    head: head, body: body,
    startY: 33,
    theme: "grid",
    styles: { fontSize: 7, cellPadding: 1.5, lineColor: [50,50,50], lineWidth: 0.1, valign: "middle" },
    headStyles: { fillColor: [240,240,240], textColor: [0,0,0], fontStyle: "bold", halign: "center", fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 9, halign: "center" }, 1: { cellWidth: 14, halign: "center" },
      2: { cellWidth: 22, halign: "center" }, 3: { cellWidth: 38 },
      4: { cellWidth: 12, halign: "center" }, 5: { cellWidth: 12, halign: "center" },
      6: { cellWidth: 16, halign: "center" }, 7: { cellWidth: 16, halign: "center" },
      8: { cellWidth: 18, halign: "center" }, 9: { cellWidth: 18, halign: "center" },
      10: { cellWidth: 20, halign: "center" }, 11: { cellWidth: 12, halign: "center" },
      12: { cellWidth: 14, halign: "center" }, 13: { cellWidth: 16, halign: "center" },
      14: { cellWidth: 25 }
    }
  });

  // Footer
  var y = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(9);
  doc.text("Ora predarii probelor catre curier: _______", 14, y);
  doc.text("Temperatura in geanta la predare: _______", 100, y);
  doc.text("Semnatura predare probe catre curier: _______", 190, y);
  y += 6;
  doc.text("Curier: Tudorache Ilie Andrei", 14, y);
  y += 6;
  doc.text("Ora primirii probelor in laborator: _______", 14, y);
  doc.text("Temperatura in geanta la primire: _______", 100, y);
  doc.text("Semnatura primire probe in laborator: _______", 190, y);

  // Altele detalii
  var hasAltele = rows.some(function(r){ return r.altele_names.length > 0; });
  if (hasAltele) {
    y += 10;
    doc.setFont("helvetica", "bold");
    doc.text("ALTELE (detaliere):", 14, y);
    doc.setFont("helvetica", "normal");
    y += 4;
    rows.forEach(function(r) {
      if (r.altele_names.length > 0) {
        var name = stripDiacritics(((r.prenume + " " + r.nume).trim()) || "—");
        var line = name + ": " + stripDiacritics(r.altele_names.join(", "));
        var split = doc.splitTextToSize(line, 270);
        doc.text(split, 14, y);
        y += split.length * 3.5;
      }
    });
  }

  var filename = "borderou_Poliana_" + borderouState.selectedDate + ".pdf";
  doc.save(filename);
}

// Event wiring
document.getElementById("borderouFilterDate").addEventListener("change", function(e) {
  borderouState.selectedDate = e.target.value;
  updateBorderouLabsDropdown();
});
document.getElementById("borderouFilterDateField").addEventListener("change", function(e) {
  borderouState.dateField = e.target.value;
  updateBorderouLabsDropdown();
});
document.getElementById("borderouFilterLab").addEventListener("change", function(e) {
  borderouState.selectedLab = e.target.value;
  renderBorderouPreview();
});
document.getElementById("btnBorderouGenerate").addEventListener("click", generateBorderouPDF);
