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
// CC discount (cartState.ccDiscountPct) is applied when source="cc" — adminul vede
// pretul cu discountul CC al pacientului (din card) aplicat.
function effectivePrice(denumire, laborator, pretLista) {
  // Cerere CAS (decontată) → preț 0 pentru toate analizele
  if (cartState && cartState.is_cas) {
    return { price: 0, source: "cas", listPrice: 0, ccDiscount: 0 };
  }
  var cc = getCCPrice(denumire);
  if (cc !== null) {
    // CC pricing path - apply CC discount if active (from pacient card)
    var ccDiscPct = (cartState && Number(cartState.ccDiscountPct)) || 0;
    if (ccDiscPct > 0) {
      var ccDiscounted = Math.round(cc * (1 - ccDiscPct / 100) * 100) / 100;
      return { price: ccDiscounted, source: "cc", listPrice: cc, ccDiscount: ccDiscPct };
    }
    return { price: cc, source: "cc", listPrice: cc, ccDiscount: 0 };
  }
  // Fallback: discounted lab price + 5%
  var discounted = finalPrice(pretLista, laborator);
  return { price: Math.round(discounted * 1.05 * 100) / 100, source: "lab+5%", listPrice: pretLista, ccDiscount: 0 };
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

// ────────────────────────────────────────────────────────────────
// CNP helpers — derive sex, varsta, dataNasterii from CNP
// ────────────────────────────────────────────────────────────────

// Romanian CNP first digit indicates century + sex:
// 1=M 1900s, 2=F 1900s, 3=M 1800s, 4=F 1800s,
// 5=M 2000s, 6=F 2000s, 7=M resident, 8=F resident, 9=foreign
function sexFromCnp(cnp) {
  if (!cnp || !/^\d{13}$/.test(cnp)) return "";
  var first = parseInt(cnp.charAt(0), 10);
  if (first === 1 || first === 3 || first === 5 || first === 7) return "M";
  if (first === 2 || first === 4 || first === 6 || first === 8) return "F";
  return "";
}

function dataNasteriiFromCnp(cnp) {
  if (!cnp || !/^\d{13}$/.test(cnp)) return "";
  var first = parseInt(cnp.charAt(0), 10);
  var century;
  if (first === 1 || first === 2) century = 1900;
  else if (first === 3 || first === 4) century = 1800;
  else if (first === 5 || first === 6) century = 2000;
  else if (first === 7 || first === 8) {
    // resident — assume 1900 unless year>current year, then 2000
    var yy0 = parseInt(cnp.substr(1, 2), 10);
    var nowYY = new Date().getFullYear() % 100;
    century = yy0 > nowYY ? 1900 : 2000;
  } else return "";
  var yy = cnp.substr(1, 2);
  var mm = cnp.substr(3, 2);
  var dd = cnp.substr(5, 2);
  return dd + "." + mm + "." + (century + parseInt(yy, 10));
}

// Calculate age in years from "DD.MM.YYYY"
function varstaFromDataNasterii(dn) {
  if (!dn) return "";
  var parts = dn.split(/[.\-\/]/);
  if (parts.length !== 3) return "";
  var day, month, year;
  // DD.MM.YYYY or YYYY-MM-DD
  if (parts[0].length === 4) {
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else {
    day = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);
  }
  if (!year || !month || !day) return "";
  var now = new Date();
  var age = now.getFullYear() - year;
  var m = now.getMonth() + 1 - month;
  if (m < 0 || (m === 0 && now.getDate() < day)) age--;
  return age > 0 && age < 130 ? age : "";
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
  var progEl = document.getElementById("viewProgramari");
  if (progEl) progEl.style.display = (name === "programari") ? "block" : "none";
  var adminEl = document.getElementById("viewAdmin");
  if (adminEl) adminEl.style.display = (name === "admin") ? "block" : "none";
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
  } else if (name === "programari") {
    if (typeof loadProgramari === "function") loadProgramari();
  } else if (name === "admin") {
    if (typeof loadAdminPreturi === "function") loadAdminPreturi();
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
  // Optional: from OCR (bilet de trimitere)
  numeMedic: "",       // populated from OCR if available
  sex: "",             // M or F, derived from CNP or OCR
  dataNasterii: "",    // DD.MM.YYYY, from OCR or CNP
  // CC discount (from pacient card, applied to CC prices in cart total)
  ccDiscountPct: 0,    // 0 = no CC discount (no card or non-matching card discount)
  // CAS: cerere decontată → preț 0 la toate analizele
  is_cas: false,
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
    var fp = cartState.is_cas ? 0 : finalPrice(offer.Pret, offer.Laborator);
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
  // Build CC discount banner HTML if active
  var ccBannerHtml = '';
  if (cartState.ccDiscountPct > 0) {
    ccBannerHtml = '<div id="ccDiscountBanner" style="padding:10px 14px;background:rgba(26,107,60,0.1);border:1px solid rgba(26,107,60,0.3);border-radius:4px;margin-bottom:10px;font-size:12px;color:#155a32;display:flex;justify-content:space-between;align-items:center">' +
      '<span><strong>🏷️ Discount CC activ: ' + cartState.ccDiscountPct + '%</strong> (din card pacient)</span>' +
      '<button type="button" id="btnClearCcDisc" style="background:transparent;border:1px solid rgba(26,107,60,0.4);padding:3px 8px;font-size:10px;cursor:pointer;color:#155a32;border-radius:3px">Elimina</button>' +
      '</div>';
  }

  var casBannerHtml = '';
  if (cartState.is_cas) {
    casBannerHtml = '<div style="padding:10px 14px;background:rgba(21,90,50,0.1);border:1px solid rgba(21,90,50,0.3);border-radius:4px;margin-bottom:10px;font-size:12px;color:#155a32">' +
      '<strong>🏥 Cerere CAS (decontată)</strong> — toate analizele au preț 0 pentru pacient.</div>';
  }
  var casCbSync = document.getElementById("casCheckbox");
  if (casCbSync) casCbSync.checked = !!cartState.is_cas;

  cartListEl.innerHTML = casBannerHtml + ccBannerHtml + html;
  cartTotalEl.textContent = fmtRon(total);

  // Wire CC discount clear button (if rendered)
  var clearBtn = document.getElementById("btnClearCcDisc");
  if (clearBtn) {
    clearBtn.addEventListener("click", function() {
      cartState.ccDiscountPct = 0;
      renderCart();
    });
  }

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

(function(){
  var casCbWire = document.getElementById("casCheckbox");
  if (casCbWire) casCbWire.addEventListener("change", function(){
    cartState.is_cas = casCbWire.checked;
    renderCart();
  });
})();

document.getElementById("btnClearCart").addEventListener("click", function() {
  if (cartState.cart.length === 0) return;
  if (confirm("Vrei sa golesti cererea de analize?")) {
    cartState.cart = [];
    cartState.ccDiscountPct = 0;  // reset CC discount
    cartState.is_cas = false;     // reset CAS
    window.__loadedPendingCerereId = null;
    window.__loadedPendingProgId = null;
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
      finalPrice: eff.price,            // Pret CC cu discount CC aplicat (sau lab+5% fallback)
      ccListPrice: eff.listPrice || null,  // Pret CC INAINTE de discount CC (pentru afisaj)
      ccDiscountApplied: eff.ccDiscount || 0,  // % discount CC aplicat la acest item
      labFinalPrice: labFinal,          // Kept for reference if needed
      priceSource: eff.source,          // "cc" or "lab+5%"
      discount: discPct(c.offer.Laborator)
    });
  }
  var groups = {};
  var grandCcListTotal = 0;
  for (var i = 0; i < items.length; i++) {
    var lab = items[i].offer.Laborator;
    if (!groups[lab]) groups[lab] = { lab: lab, items: [], total: 0, listTotal: 0, ccListTotal: 0 };
    groups[lab].items.push(items[i]);
    groups[lab].total += items[i].finalPrice;
    groups[lab].listTotal += items[i].offer.Pret;
    var ccListPrice = (items[i].ccListPrice != null) ? items[i].ccListPrice : items[i].finalPrice;
    groups[lab].ccListTotal += ccListPrice;
    grandCcListTotal += ccListPrice;
  }
  var groupsList = Object.keys(groups).map(function(l){ return groups[l]; });
  groupsList.sort(function(a, b){ return b.total - a.total; });
  return {
    items: items,
    groups: groupsList,
    grandTotal: grandTotal,
    grandListTotal: grandListTotal,
    grandCcListTotal: grandCcListTotal  // Suma preturilor CC fara discount CC aplicat
  };
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
      body += '<div class="lab-group-item-price">';
      // If CC discount was applied, show original CC list price (struck) + final price
      if (it.ccDiscountApplied > 0 && it.ccListPrice && it.ccListPrice > it.finalPrice) {
        body += '<s style="opacity:0.5;font-weight:400;font-size:12px;margin-right:6px">' + Math.round(it.ccListPrice) + ' RON</s>';
      }
      body += Math.round(it.finalPrice) + ' RON';
      if (it.priceSource === "lab+5%") {
        body += '<span class="lab-group-item-price-src" title="Nu exista pret in catalogul Clinica Central; folosit pret laborator cu discount +5%">lab + 5%</span>';
      } else if (it.ccDiscountApplied > 0) {
        body += '<span class="lab-group-item-price-src" title="Pret CC cu discount card -' + it.ccDiscountApplied + '% aplicat">CC -' + it.ccDiscountApplied + '%</span>';
      } else {
        body += '<span class="lab-group-item-price-src" title="Pret din catalogul Clinica Central">CC</span>';
      }
      body += '</div></div>';
    }
    body += '</div></div>';
  }

  body += '<div class="report-grand-total">';
  body += '<span class="report-grand-total-label">Total de plata</span>';
  // If CC discount was applied, show original total (struck) + savings
  var ccDiscActive = cartState.ccDiscountPct > 0;
  if (ccDiscActive && r.grandCcListTotal && r.grandCcListTotal > r.grandTotal + 0.01) {
    var economie = r.grandCcListTotal - r.grandTotal;
    body += '<div style="text-align:right">';
    body += '<div style="font-size:14px;text-decoration:line-through;opacity:0.5;font-weight:400">' + fmtRon(r.grandCcListTotal) + '</div>';
    body += '<span class="report-grand-total-value">' + fmtRon(r.grandTotal) + '</span>';
    body += '<div style="font-size:11px;color:#1a6b3c;font-weight:600;margin-top:2px">Economie: ' + fmtRon(economie) + ' (-' + cartState.ccDiscountPct + '% CC)</div>';
    body += '</div>';
  } else {
    body += '<span class="report-grand-total-value">' + fmtRon(r.grandTotal) + '</span>';
  }
  body += '</div>';

  body += '<div class="report-actions">';
  body += '<button class="report-btn primary" id="btnExportPdf">&#11015; Genereaza document</button>';
  body += '<button class="report-btn" id="btnExportReport">&#11015; Export Excel</button>';
  body += '<button class="report-btn" id="btnExportJson">&#11015; Export JSON</button>';
  body += '<button class="report-btn" id="btnCloseReport">Inchide</button>';
  body += '</div>';

  document.getElementById("reportBody").innerHTML = body;
  document.getElementById("reportOverlay").classList.add("visible");
  document.body.style.overflow = "hidden";

  document.getElementById("btnCloseReport").addEventListener("click", closeReport);
  document.getElementById("btnExportPdf").addEventListener("click", function() { openDocPickerModal(r); });
  document.getElementById("btnExportReport").addEventListener("click", function() { exportReportXlsx(r); });
  document.getElementById("btnExportJson").addEventListener("click", function() { exportReportJson(r); });

  // Auto-save the cerere to Supabase (non-blocking, but show status)
  // Save returned saveCerere promise so PDF generators can await numar_ordine
  window.__currentCerereSavePromise = saveCerere(r);
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

// ─── CC Discount Map admin UI ───
var ccDiscMapState = {
  rows: [],   // [{ id, card_discount_pct, cc_discount_pct }]
  loaded: false,
  dirty: false
};

async function loadCcDiscountMapAdmin() {
  try {
    var res = await window.sb.from("cc_discount_map")
      .select("id, card_discount_pct, cc_discount_pct")
      .order("card_discount_pct", { ascending: true });
    if (res.error) {
      console.warn("[ccDiscMap] load error:", res.error);
      document.getElementById("ccDiscMapStatus").textContent = "Eroare la incarcare";
      document.getElementById("ccDiscMapStatus").style.color = "#c8392b";
      return;
    }
    ccDiscMapState.rows = res.data || [];
    ccDiscMapState.loaded = true;
    ccDiscMapState.dirty = false;
    renderCcDiscMap();
    console.log("[ccDiscMap] loaded:", ccDiscMapState.rows);
  } catch (e) {
    console.warn("[ccDiscMap] exception:", e);
  }
}

function renderCcDiscMap() {
  var grid = document.getElementById("ccDiscMap");
  if (!grid) return;
  if (!ccDiscMapState.rows.length) {
    grid.innerHTML = '<div style="font-size:12px;color:rgba(15,17,23,0.5);font-style:italic">Nicio mapare definita. Ruleaza migratia SQL pentru a o crea.</div>';
    return;
  }
  var html = "";
  for (var i = 0; i < ccDiscMapState.rows.length; i++) {
    var r = ccDiscMapState.rows[i];
    var cardLabel = Number(r.card_discount_pct) % 1 === 0
      ? r.card_discount_pct + "%"
      : Number(r.card_discount_pct).toFixed(1) + "%";
    html += '<div class="disc-row">';
    html += '<label><span class="dot" style="background:#b8973a"></span>Card ' + esc(cardLabel) + ' &rarr; CC</label>';
    html += '<div class="disc-input-wrap"><input type="number" min="0" max="100" step="1" data-cc-row="' + r.id + '" value="' + r.cc_discount_pct + '"><span class="pct">%</span></div>';
    html += '</div>';
  }
  grid.innerHTML = html;
  var inputs = grid.querySelectorAll("input[data-cc-row]");
  for (var j = 0; j < inputs.length; j++) {
    (function(inp) {
      inp.addEventListener("input", function() {
        var v = parseFloat(inp.value);
        if (isNaN(v)) v = 0;
        v = Math.max(0, Math.min(100, v));
        var id = parseInt(inp.getAttribute("data-cc-row"), 10);
        var row = ccDiscMapState.rows.find(function(x) { return x.id === id; });
        if (row) {
          row.cc_discount_pct = v;
          ccDiscMapState.dirty = true;
          var status = document.getElementById("ccDiscMapStatus");
          if (status) {
            status.textContent = "Modificari nesalvate";
            status.style.color = "#92400e";
          }
        }
      });
    })(inputs[j]);
  }
  var status = document.getElementById("ccDiscMapStatus");
  if (status && !ccDiscMapState.dirty) {
    status.textContent = "Incarcat";
    status.style.color = "rgba(15,17,23,0.5)";
  }
}

async function saveCcDiscountMap() {
  var btn = document.getElementById("btnSaveCcDiscMap");
  var status = document.getElementById("ccDiscMapStatus");
  if (btn) { btn.disabled = true; btn.textContent = "Se salveaza..."; }
  try {
    // Update each row individually
    for (var i = 0; i < ccDiscMapState.rows.length; i++) {
      var r = ccDiscMapState.rows[i];
      var res = await window.sb.from("cc_discount_map")
        .update({ cc_discount_pct: Number(r.cc_discount_pct) || 0, updated_at: new Date().toISOString() })
        .eq("id", r.id);
      if (res.error) {
        throw new Error(res.error.message || "Update esuat");
      }
    }
    ccDiscMapState.dirty = false;
    if (status) {
      status.textContent = "Salvat";
      status.style.color = "#1a6b3c";
    }
    console.log("[ccDiscMap] saved successfully");
  } catch (e) {
    console.error("[ccDiscMap] save error:", e);
    if (status) {
      status.textContent = "Eroare: " + (e.message || e);
      status.style.color = "#c8392b";
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "\u2713 Salveaza modificarile"; }
  }
}

// Wire save button
var btnSaveCcDiscMap = document.getElementById("btnSaveCcDiscMap");
if (btnSaveCcDiscMap) {
  btnSaveCcDiscMap.addEventListener("click", saveCcDiscountMap);
}

// Load CC discount map on init (after window.sb is available)
if (window.sb) {
  loadCcDiscountMapAdmin();
} else {
  // Wait for sb to be ready
  setTimeout(function() {
    if (window.sb) loadCcDiscountMapAdmin();
  }, 800);
}

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
document.getElementById("scanRetryBtn").addEventListener("click", retryOcr);
document.getElementById("scanManualBtn").addEventListener("click", goManualFromScan);
document.getElementById("scanAltFotoBtn").addEventListener("click", resetScanModal);
document.getElementById("biletPinClose").addEventListener("click", closeBiletPin);
document.getElementById("biletPinImg").addEventListener("click", function() {
  document.getElementById("biletPin").classList.toggle("enlarged");
});

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
    window.__lastScan = { base64: base64Data, mediaType: mediaType };
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
  // Nu aratam eroarea tehnica utilizatorului; o logam doar in consola.
  console.warn("[scan] OCR fallback:", msg);
  scanProcessingArea.style.display = "none";
  scanPickerArea.style.display = "none";
  scanErrorArea.style.display = "block";

  // Arata poza biletului (din preview) ca sa poata fi citita pentru introducerea manuala
  var prevSrc = document.getElementById("scanPreviewImg").src;
  var errImg = document.getElementById("scanErrorImg");
  var errPrev = document.getElementById("scanErrorPreview");
  if (prevSrc && prevSrc.indexOf("data:") === 0) {
    errImg.src = prevSrc;
    errPrev.style.display = "block";
  } else {
    errPrev.style.display = "none";
  }

  document.getElementById("scanErrorText").textContent =
    "Nu am putut citi biletul automat. Poți reîncerca sau introduce datele manual citind biletul de mai sus.";
}

async function retryOcr() {
  var last = window.__lastScan;
  if (!last || !last.base64) { resetScanModal(); return; }
  scanErrorArea.style.display = "none";
  scanPickerArea.style.display = "none";
  scanProcessingArea.style.display = "block";
  document.getElementById("scanPreviewImg").src =
    "data:" + (last.mediaType || "image/jpeg") + ";base64," + last.base64;
  document.getElementById("scanStatusText").textContent = "Reîncerc procesarea...";
  document.getElementById("scanStatusSub").textContent = "AI-ul citește biletul din nou";
  try {
    var extracted = await extractFromImage(last.base64, last.mediaType || "image/jpeg");
    showScanResults(extracted);
  } catch (e) {
    showScanError("retry: " + (e.message || e));
  }
}

function goManualFromScan() {
  // Inchide modalul de scanare, lasa biletul vizibil intr-o miniatura fixa
  var last = window.__lastScan;
  var src = (last && last.base64)
    ? "data:" + (last.mediaType || "image/jpeg") + ";base64," + last.base64
    : (document.getElementById("scanPreviewImg").src || "");
  scanModal.classList.remove("visible");
  if (typeof switchView === "function") switchView("cart");
  if (src && src.indexOf("data:") === 0) showBiletPin(src);
}

function showBiletPin(src) {
  var pin = document.getElementById("biletPin");
  if (!pin) return;
  document.getElementById("biletPinImg").src = src;
  pin.classList.remove("enlarged");
  pin.style.display = "block";
}
function closeBiletPin() {
  var pin = document.getElementById("biletPin");
  if (!pin) return;
  pin.style.display = "none";
  pin.classList.remove("enlarged");
}

async function extractFromImage(base64Data, mediaType) {
  // Call Supabase Edge Function 'ocr-bilet' which proxies to Gemini.
  // Gemini API key is stored as a Supabase Secret, NOT in the browser.
  if (!window.sb || !window.sb.functions) {
    throw new Error("Supabase client nu e initializat");
  }

  var res = await window.sb.functions.invoke("ocr-bilet", {
    body: {
      imageBase64: base64Data,
      mediaType: mediaType || "image/jpeg"
    }
  });

  if (res.error) {
    var msg = res.error.message || String(res.error);
    // Try to extract the inner error from the Edge Function response
    if (res.error.context && typeof res.error.context.text === "function") {
      try {
        var errText = await res.error.context.text();
        msg = errText.substring(0, 250);
      } catch (e) {}
    }
    throw new Error("Edge Function: " + msg);
  }

  var parsed = res.data;
  if (!parsed) {
    throw new Error("Raspuns gol de la Edge Function");
  }
  if (parsed.error) {
    throw new Error(parsed.error);
  }
  if (!parsed.analize || !Array.isArray(parsed.analize)) {
    throw new Error("Format neasteptat (lipseste lista de analize)");
  }

  return {
    nume: parsed.nume || null,
    prenume: parsed.prenume || null,
    cnp: parsed.cnp || null,
    dataNasterii: parsed.dataNasterii || null,
    telefon: parsed.telefon || null,
    email: parsed.email || null,
    numeMedic: parsed.numeMedic || null,
    sex: parsed.sex || null,
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
  window.__scanEmail = extracted.email;
  window.__scanTelefon = extracted.telefon;
  window.__scanNumeMedic = extracted.numeMedic;
  window.__scanSex = extracted.sex;
  window.__scanDataNasterii = extracted.dataNasterii;

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
      // Pre-populate email if detected and currently empty
      if (window.__scanEmail && !emailInput.value.trim()) {
        emailInput.value = window.__scanEmail;
        cartState.email = window.__scanEmail;
      }
      // Pre-populate telefon if detected and currently empty
      if (window.__scanTelefon && !telefonNumarInput.value.trim()) {
        // Normalize: strip leading "+40" or "0"
        var tel = String(window.__scanTelefon).replace(/[\s\-\.]/g, "");
        if (tel.indexOf("+40") === 0) tel = tel.slice(3);
        else if (tel.indexOf("0040") === 0) tel = tel.slice(4);
        else if (tel.charAt(0) === "0") tel = tel.slice(1);
        telefonNumarInput.value = tel;
        cartState.telefonNumar = tel;
      }
      // Save medic, sex, dataNasterii (from OCR) onto cartState for use in PDFs
      if (window.__scanNumeMedic) cartState.numeMedic = window.__scanNumeMedic;
      if (window.__scanSex) cartState.sex = window.__scanSex;
      if (window.__scanDataNasterii) cartState.dataNasterii = window.__scanDataNasterii;
      // Add selected analize to cart (cheapest offer per analiza)
      var added = 0;
      for (var i = 0; i < window.__scanMatched.length; i++) {
        if (window.__scanMatched[i].checked) {
          var entry = window.__scanMatched[i].entry;
          var ch = cheapestOffer(entry);
          if (ch && ch.offer && ch.offer.Laborator) {
            addToCart(entry.key, ch.offer.Laborator);
            added++;
          }
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
// EPRUBETE TOGGLE (collapse/expand)
// ════════════════════════════════════════════════════════════════
(function() {
  var eprubeteToggleBtn = document.getElementById("eprubeteToggle");
  var eprubeteSummaryEl2 = document.getElementById("eprubeteSummary");
  if (eprubeteToggleBtn && eprubeteSummaryEl2) {
    eprubeteToggleBtn.addEventListener("click", function() {
      var collapsed = eprubeteSummaryEl2.classList.toggle("collapsed");
      eprubeteToggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
  }
})();

// ════════════════════════════════════════════════════════════════
// PHONE PAIRING (Etapa 1: QR card Paun scanning)
// ════════════════════════════════════════════════════════════════

var PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // same as Paun cards (no I/O/0/1)
function generatePairSessionId() {
  var id = "";
  for (var i = 0; i < 8; i++) {
    id += PAIR_ALPHABET[Math.floor(Math.random() * PAIR_ALPHABET.length)];
  }
  return id;
}

var pairState = {
  sessionId: null,
  channel: null,
  channelSessionId: null,
  realtimeSub: null
};

var pairModal = document.getElementById("pairModal");
var pairLoading = document.getElementById("pairLoading");
var pairContent = document.getElementById("pairContent");
var pairSessionIdEl = document.getElementById("pairSessionId");
var pairQrCanvas = document.getElementById("pairQrCanvas");
var pairStatusDot = document.getElementById("pairStatusDot");
var pairStatusText = document.getElementById("pairStatusText");

document.getElementById("btnPairPhone").addEventListener("click", openPairModal);
document.getElementById("pairModalClose").addEventListener("click", closePairModal);
pairModal.addEventListener("click", function(e) {
  if (e.target === pairModal) closePairModal();
});

async function openPairModal() {
  if (!window.__CURRENT_USER__ || !window.sb) {
    alert("Trebuie sa fii logat pentru a folosi aceasta functie.");
    return;
  }
  pairModal.classList.add("visible");

  // If we already have an active session + channel, just show the existing QR
  if (pairState.sessionId && pairState.channel) {
    console.log("[pair] reusing existing session:", pairState.sessionId);
    pairLoading.style.display = "none";
    pairContent.style.display = "block";
    pairSessionIdEl.textContent = pairState.sessionId;
    // Regenerate QR display (in case DOM was cleared)
    var scanUrl = window.location.origin + "/scan.html?s=" + pairState.sessionId;
    generatePairQR(scanUrl);
    return;
  }

  pairLoading.style.display = "flex";
  pairContent.style.display = "none";
  pairStatusDot.classList.remove("connected");
  pairStatusText.textContent = "Astept telefon...";

  // 1. Generate session ID
  var sid = generatePairSessionId();
  pairState.sessionId = sid;

  // 2. Insert into cc_pairing_sessions
  try {
    var insertRes = await window.sb.from("cc_pairing_sessions").insert([{
      session_id: sid,
      user_id: window.__CURRENT_USER__.id,
      user_email: window.__CURRENT_USER__.email
    }]).select();
    if (insertRes.error) {
      console.error("[pair] insert failed:", insertRes.error);
      alert("Nu am putut crea sesiunea. Verifica conexiunea.");
      pairState.sessionId = null;
      closePairModal();
      return;
    }
  } catch (e) {
    console.error("[pair] insert exception:", e);
    alert("Eroare la creare sesiune: " + e.message);
    pairState.sessionId = null;
    closePairModal();
    return;
  }

  // 3. Generate QR code (URL that opens scan page on phone)
  var scanUrl = window.location.origin + "/scan.html?s=" + sid;
  generatePairQR(scanUrl);
  pairSessionIdEl.textContent = sid;

  // 4. Subscribe to Realtime broadcast channel
  subscribeToPairingChannel(sid);

  pairLoading.style.display = "none";
  pairContent.style.display = "block";
}

function generatePairQR(text) {
  pairQrCanvas.innerHTML = "";
  try {
    var qr = qrcode(0, "M"); // type 0 = auto-size, error correction M
    qr.addData(text);
    qr.make();
    // 8px per cell, 4 cell border
    var size = 280;
    pairQrCanvas.innerHTML = qr.createSvgTag(8, 4);
    var svg = pairQrCanvas.querySelector("svg");
    if (svg) {
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));
    }
  } catch (e) {
    console.error("[pair] QR generation failed:", e);
    pairQrCanvas.innerHTML = '<div style="color:red">Nu am putut genera codul QR</div>';
  }
}

function subscribeToPairingChannel(sessionId) {
  if (!window.sb || !window.sb.channel) {
    console.warn("[pair] Supabase Realtime not available");
    return;
  }
  // If we already have an active channel for THIS session, don't recreate.
  // Re-subscribing closes the old channel, losing in-flight messages.
  if (pairState.channel && pairState.channelSessionId === sessionId) {
    console.log("[pair] channel already exists for session:", sessionId);
    return;
  }
  // Clean up any previous subscription (different session)
  if (pairState.channel) {
    try { window.sb.removeChannel(pairState.channel); } catch (e) {}
    pairState.channel = null;
    pairState.channelSessionId = null;
  }

  var ch = window.sb.channel("pairing:" + sessionId, {
    config: { broadcast: { ack: false, self: false } }
  });

  // Phone connected event
  ch.on("broadcast", { event: "phone_connected" }, function(payload) {
    console.log("[pair] phone connected:", payload);
    pairStatusDot.classList.add("connected");
    pairStatusText.textContent = "Telefon conectat";
    showPairToast("Telefon conectat", "Acum poti scana QR cardul Paun sau bilete de trimitere");
  });

  // Patient scanned via Paun card
  ch.on("broadcast", { event: "scan_patient" }, function(payload) {
    console.log("[pair] scan_patient:", payload);
    handleScannedPatient(payload.payload || payload);
  });

  // Bilet de trimitere photographed on phone, sent here for OCR
  ch.on("broadcast", { event: "scan_bilet" }, function(payload) {
    console.log("[pair] scan_bilet received");
    var data = payload.payload || payload;
    if (!data || !data.imageBase64) {
      console.warn("[pair] scan_bilet missing imageBase64");
      return;
    }
    handleBiletFromPhone(data);
  });

  ch.subscribe(function(status) {
    console.log("[pair] channel status:", status, "session:", sessionId);
  });

  pairState.channel = ch;
  pairState.channelSessionId = sessionId;
}

function showPairToast(title, sub) {
  var existing = document.querySelector(".pair-toast");
  if (existing) existing.remove();
  var t = document.createElement("div");
  t.className = "pair-toast";
  t.innerHTML = '<strong>' + esc(title) + '</strong>' +
                (sub ? '<span class="toast-sub">' + esc(sub) + '</span>' : '');
  document.body.appendChild(t);
  setTimeout(function() { t.classList.add("visible"); }, 10);
  setTimeout(function() {
    t.classList.remove("visible");
    setTimeout(function() { t.remove(); }, 400);
  }, 4500);
}

// Handle data received from phone when it scans a Paun QR card
function handleScannedPatient(data) {
  // data: { codPaun, prenume, nume, cnp, email, telefon, telefonPrefix, discountPct }
  if (!data) return;

  // Switch to cart view if not already
  switchView("cart");

  // Auto-populate patient fields
  if (data.prenume) {
    cartState.prenume = data.prenume;
    prenumeInput.value = data.prenume;
    cartState.prenumeValid = true;
  }
  if (data.nume) {
    cartState.nume = data.nume;
    numeInput.value = data.nume;
    cartState.numeValid = true;
  }
  if (data.cnp) {
    cartState.cnp = data.cnp;
    cnpInput.value = data.cnp;
    cartState.cnpValid = isCnpValid(data.cnp);
  }
  if (data.email) {
    cartState.email = data.email;
    emailInput.value = data.email;
  }
  if (data.telefon) {
    cartState.telefonNumar = data.telefon;
    telefonNumarInput.value = data.telefon;
    if (data.telefonPrefix) {
      cartState.telefonPrefix = data.telefonPrefix;
      telefonPrefixSelect.value = data.telefonPrefix;
    }
  }

  // Apply Paun discount if present
  if (typeof data.discountPct === "number" && data.discountPct > 0) {
    cartState.paunDiscountPct = data.discountPct;
    cartState.paunCodCard = data.codPaun || null;
    showPairToast(
      "Card Paun: " + data.discountPct + "%",
      "Discount aplicat automat la analize: " + [data.prenume, data.nume].filter(Boolean).join(" ")
    );
  } else {
    cartState.paunDiscountPct = 0;
    cartState.paunCodCard = data.codPaun || null;
    showPairToast(
      "Client identificat",
      (data.prenume && data.nume) ? (data.prenume + " " + data.nume) : "Date precompletate"
    );
  }

  updateCnpUi();
  updatePacientValidation();
  renderCart(); // re-render to apply discount if any
  closePairModal();
}

function closePairModal() {
  pairModal.classList.remove("visible");
  // Keep the session alive in DB; just close the channel locally
  // (laptop may reopen pairing later in same session window)
}

// Handle a bilet image sent from phone via Realtime broadcast.
// Pipeline: receive base64 -> show modal "processing" -> call existing
// extractFromImage -> showScanResults (which already wires Add-to-cart).
async function handleBiletFromPhone(data) {
  // Switch to cart view if not already
  switchView("cart");

  // Show the existing scan modal in "processing" state
  scanModal.classList.add("visible");
  scanPickerArea.style.display = "none";
  scanErrorArea.style.display = "none";
  scanProcessingArea.style.display = "block";
  document.getElementById("scanStatusText").textContent = "Bilet primit de pe telefon";
  document.getElementById("scanStatusSub").textContent = "Claude analizeaza biletul...";

  // Show preview
  try {
    document.getElementById("scanPreviewImg").src = "data:" + (data.mediaType || "image/jpeg") + ";base64," + data.imageBase64;
  } catch (e) {}

  showPairToast("Bilet primit de pe telefon", "Se analizeaza imaginea cu AI...");

  try {
    window.__lastScan = { base64: data.imageBase64, mediaType: data.mediaType || "image/jpeg" };
    var extracted = await extractFromImage(data.imageBase64, data.mediaType || "image/jpeg");
    showScanResults(extracted);
  } catch (e) {
    console.error("[bilet] OCR error:", e);
    showScanError("Eroare la procesare bilet: " + (e.message || e));
  }
}

// Apply Paun discount when computing effective price
// (override of effectivePrice to consider Paun discount)
var __origEffectivePrice = effectivePrice;
effectivePrice = function(denumire, laborator, pretLista) {
  var base = __origEffectivePrice(denumire, laborator, pretLista);
  if (cartState.paunDiscountPct && cartState.paunDiscountPct > 0) {
    var discounted = base.price * (1 - cartState.paunDiscountPct / 100);
    return {
      price: Math.round(discounted * 100) / 100,
      source: base.source + "+paun" + cartState.paunDiscountPct + "%"
    };
  }
  return base;
};

// Initialize Paun fields in cartState
cartState.paunDiscountPct = 0;
cartState.paunCodCard = null;

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
    total_lista_ron: (cartState.ccDiscountPct > 0 && r.grandCcListTotal) ? r.grandCcListTotal : r.grandListTotal,
    total_final_ron: r.grandTotal,
    is_cas: !!cartState.is_cas,
    economie_ron: ((cartState.ccDiscountPct > 0 && r.grandCcListTotal) ? r.grandCcListTotal : r.grandListTotal) - r.grandTotal,
    items: r.items.map(function(it) {
      var d = getDetails(it.offer.Laborator, it.displayName);
      return {
        denumire: it.displayName,
        laborator: it.offer.Laborator,
        pret_lista: (it.ccListPrice != null && it.priceSource === "cc") ? it.ccListPrice : it.offer.Pret,
        pret_final: Math.round(it.finalPrice * 100) / 100,
        pret_sursa: it.priceSource,
        discount: (it.ccDiscountApplied > 0) ? it.ccDiscountApplied : it.discount,
        cc_discount_applied: it.ccDiscountApplied || 0,
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
      var listForGroup = (cartState.ccDiscountPct > 0 && g.ccListTotal) ? g.ccListTotal : g.listTotal;
      return {
        laborator: g.lab,
        numar_analize: g.items.length,
        subtotal_lista: listForGroup,
        subtotal_final: g.total,
        economie: listForGroup - g.total
      };
    }),
    eprubete: eprubete,
    discounts: Object.assign({}, discounts, cartState.ccDiscountPct > 0 ? { cc_discount_pct: cartState.ccDiscountPct } : {})
  };

  try {
    var result;
    // If we loaded a pending cerere (from a programare), UPDATE it instead of inserting new
    if (window.__loadedPendingCerereId) {
      payload.status = "processed";  // Mark as processed when user clicks Proceseaza
      result = await window.sb.from("cc_cereri")
        .update(payload)
        .eq("id", window.__loadedPendingCerereId)
        .select().single();

      // Also update the linked programare to 'completed'
      if (!result.error && window.__loadedPendingProgId) {
        try {
          await window.sb.from("cc_programari")
            .update({ status: "completed" })
            .eq("id", window.__loadedPendingProgId);
        } catch (e) { console.warn("[saveCerere] Failed to update programare status:", e); }
      }

      // Clear pending flags
      window.__loadedPendingCerereId = null;
      window.__loadedPendingProgId = null;
    } else {
      // Normal flow: insert new cerere with default status='processed'
      result = await window.sb.from("cc_cereri").insert([payload]).select().single();
    }
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
    var isPending = c.status === "pending";
    var pendingBadge = isPending ? ' <span class="istoric-status-pending">PENDING</span>' : '';
    var casBadge = c.is_cas ? ' <span class="istoric-status-cas">🏥 CAS</span>' : '';
    html += '<div class="istoric-row" data-id="' + esc(c.id) + '">';
    html += '<div class="istoric-row-main">';
    if (fullName) {
      html += '<div class="istoric-row-cnp">' + esc(fullName) + ' <small style="font-family:monospace;font-weight:400;color:rgba(15,17,23,0.5)">(' + esc(c.cnp_pacient) + ')</small>' + pendingBadge + casBadge + '</div>';
    } else {
      html += '<div class="istoric-row-cnp">' + esc(c.cnp_pacient) + pendingBadge + casBadge + '</div>';
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
    if (isPending) {
      html += '<button class="istoric-row-btn istoric-btn-pdf" data-act="open-pending" data-id="' + esc(c.id) + '">Deschide in cos</button>';
    }
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
        else if (act === "open-pending") openPendingCerereInCart(id);
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

  // Snapshot current cartState so we can restore after the user closes the picker.
  // PDF helpers read patient info from cartState directly.
  window.__istoricCartSnapshot = {
    prenume: cartState.prenume, nume: cartState.nume, cnp: cartState.cnp,
    email: cartState.email, telefonPrefix: cartState.telefonPrefix, telefonNumar: cartState.telefonNumar,
    numeMedic: cartState.numeMedic, sex: cartState.sex, dataNasterii: cartState.dataNasterii
  };
  // Inject istoric patient data into cartState
  cartState.prenume = c.pacient_prenume || "";
  cartState.nume = c.pacient_nume || "";
  cartState.cnp = c.cnp_pacient || "";
  cartState.email = c.pacient_email || "";
  cartState.telefonPrefix = c.pacient_telefon_prefix || "+40";
  cartState.telefonNumar = c.pacient_telefon_numar || "";
  // numeMedic isn't saved in cc_cereri; sex + dataNasterii get derived from CNP automatically
  cartState.numeMedic = "";
  cartState.sex = "";
  cartState.dataNasterii = "";

  var r = rebuildReportFromCerere(c);

  // For istoric, numar_ordine is already known — short-circuit the saveCerere promise.
  window.__currentCerereSavePromise = Promise.resolve({ numar_ordine: c.numar_ordine || null });

  // Open doc picker — user chooses Recoltare / Servicii / GDPR.
  // closeDocPickerModal will detect the snapshot and restore cartState.
  openDocPickerModal(r);
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
  cartState.is_cas = !!c.is_cas;
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
  cartState.is_cas = !!c.is_cas;
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
    html += '</ul>';
    html += '<div class="rez-lab-row" data-lab="' + esc(grp.laborator) + '">' +
      '<button type="button" class="rez-add-btn">+ Adaugă rezultat</button>' +
      '<input type="file" accept="application/pdf,image/*" style="display:none">' +
      '<span class="rez-slot"></span>' +
    '</div>';
    html += '</div>';
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

  // Sectiune Rezultate (procesare) — adaugata dupa eprubete, nu inlocuieste nimic
  html += '<div class="istoric-detail-section-title">Rezultate</div>';
  html += '<div class="rez-process-bar">' +
    '<span class="rez-process-info" id="rezProcessInfo">Adaugă un rezultat de la cel puțin un laborator.</span>' +
    '<div class="rez-btn-group">' +
      '<button type="button" class="rez-view-btn" id="rezViewBtn" disabled>Rezultat</button>' +
      '<button type="button" class="rez-process-btn" id="rezProcessBtn" disabled>Procesează rezultat</button>' +
    '</div>' +
    '</div>';
  html += '<div class="rez-status" id="rezStatus"></div>';

  body.innerHTML = html;
  initRezultateUI(c);
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

// ═══════════════════════════════════════════════════════════════
// REZULTATE — upload per laborator + template CC + Anexa 1
// ═══════════════════════════════════════════════════════════════
var rezCurrentCerere = null;
var rezState = {}; // { laborator: { row } | { loading:true } }

function rezLabSlug(lab) {
  return String(lab || "lab").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "lab";
}
function rezExt(name, mime) {
  var m = /\.([a-z0-9]+)$/i.exec(name || "");
  if (m) return m[1].toLowerCase();
  if ((mime || "").indexOf("pdf") >= 0) return "pdf";
  if ((mime || "").indexOf("png") >= 0) return "png";
  return "jpg";
}
function rezFileToBase64(file) {
  return new Promise(function(resolve, reject) {
    var r = new FileReader();
    r.onload = function() { resolve(String(r.result).split(",")[1]); };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function initRezultateUI(c) {
  rezCurrentCerere = c;
  rezState = {};
  try {
    var res = await window.sb.from("cc_rezultate").select("*").eq("cerere_id", c.id);
    if (!res.error && res.data) res.data.forEach(function(row){ rezState[row.laborator] = { row: row }; });
  } catch (e) { console.warn("[rez] load", e); }

  document.querySelectorAll("#istoricDetailBody .rez-lab-row").forEach(function(rowEl) {
    var lab = rowEl.dataset.lab;
    var btn = rowEl.querySelector(".rez-add-btn");
    var input = rowEl.querySelector("input[type=file]");
    btn.addEventListener("click", function() { input.click(); });
    input.addEventListener("change", function() {
      var f = input.files[0];
      if (f) uploadRezultat(lab, f, rowEl);
      input.value = "";
    });
    renderRezSlot(lab, rowEl);
  });

  var pbtn = document.getElementById("rezProcessBtn");
  if (pbtn) pbtn.onclick = function(){ openRezPreview(rezCurrentCerere); };
  var vbtn = document.getElementById("rezViewBtn");
  if (vbtn) vbtn.onclick = function(){ openRezPreview(rezCurrentCerere); };
  refreshRezProcess();
}

function rezHasResults() {
  return Object.keys(rezState).some(function(lab){
    var r = rezState[lab].row;
    return r && Array.isArray(r.rezultate_json) && r.rezultate_json.length > 0;
  });
}

function renderRezSlot(lab, rowEl) {
  var slot = rowEl.querySelector(".rez-slot");
  var addBtn = rowEl.querySelector(".rez-add-btn");
  var st = rezState[lab];
  if (st && st.loading) {
    slot.innerHTML = '<span class="rez-spinner"></span><span class="rez-loading-txt">Se procesează...</span>';
    addBtn.disabled = true;
    return;
  }
  addBtn.disabled = false;
  if (st && st.row) {
    var n = Array.isArray(st.row.rezultate_json) ? st.row.rezultate_json.length : 0;
    var dr = st.row.doctor_nume ? (' · ' + esc(st.row.doctor_nume)) : '';
    var cnt = n ? (' · ' + n + ' valori') : ' · fără valori citite';
    slot.innerHTML = '<span class="rez-tag">✓ ' + esc(st.row.file_name || "rezultat") + cnt + dr +
      ' <span class="rez-rm" role="button">șterge</span></span>';
    slot.querySelector(".rez-rm").addEventListener("click", function() { deleteRezultat(lab, rowEl); });
    addBtn.textContent = "Înlocuiește";
  } else {
    slot.innerHTML = '';
    addBtn.textContent = "+ Adaugă rezultat";
  }
}

async function uploadRezultat(lab, file, rowEl) {
  var status = document.getElementById("rezStatus");
  var c = rezCurrentCerere;
  if (!c || !window.sb) return;

  rezState[lab] = { loading: true };
  renderRezSlot(lab, rowEl);
  status.textContent = "Se încarcă și se citește rezultatul pentru " + lab + "...";

  try {
    var ext = rezExt(file.name, file.type);
    var path = c.id + "/" + rezLabSlug(lab) + "." + ext;
    var up = await window.sb.storage.from("rezultate-lab").upload(path, file, {
      upsert: true, contentType: file.type || "application/octet-stream"
    });
    if (up.error) throw up.error;

    var doctor_nume = null, parafa = null, rezultate = [], ocrMsg = "";
    try {
      var b64 = await rezFileToBase64(file);
      var ocr = await window.sb.functions.invoke("ocr-rezultat", {
        body: { fileBase64: b64, mediaType: file.type || "application/pdf" }
      });
      console.log("[rez] ocr response", ocr);
      if (ocr && ocr.error) {
        ocrMsg = "functie: " + (ocr.error.message || ocr.error);
      } else if (ocr && ocr.data) {
        doctor_nume = ocr.data.doctor_nume || null;
        parafa = ocr.data.parafa || null;
        rezultate = Array.isArray(ocr.data.rezultate) ? ocr.data.rezultate : [];
        ocrMsg = ocr.data.error || ocr.data.warn || (ocr.data.overloaded ? "AI supraincarcat" : "");
      }
    } catch (e) { console.warn("[rez] ocr", e); ocrMsg = String(e && e.message || e); }

    var userId = (window.__CURRENT_USER__ && window.__CURRENT_USER__.id) || null;
    var upsert = await window.sb.from("cc_rezultate").upsert({
      cerere_id: c.id, laborator: lab, file_path: path,
      file_name: file.name, mime: file.type || null,
      doctor_nume: doctor_nume, parafa: parafa, rezultate_json: rezultate, uploaded_by: userId
    }, { onConflict: "cerere_id,laborator" }).select().single();
    if (upsert.error) throw upsert.error;

    rezState[lab] = { row: upsert.data };
    renderRezSlot(lab, rowEl);
    refreshRezProcess();
    if (rezultate.length === 0) {
      status.textContent = "⚠ " + lab + ": 0 valori citite" + (ocrMsg ? (" — " + ocrMsg) : " (verifica documentul / Logs).");
    } else {
      status.textContent = "✓ Rezultat citit pentru " + lab + " (" + rezultate.length + " valori" + (doctor_nume ? (", medic: " + doctor_nume) : "") + ").";
    }
  } catch (e) {
    console.error("[rez] upload", e);
    delete rezState[lab];
    renderRezSlot(lab, rowEl);
    refreshRezProcess();
    status.textContent = "Eroare la încărcare: " + (e.message || e);
  }
}

async function deleteRezultat(lab, rowEl) {
  var st = rezState[lab];
  if (!st || !st.row) return;
  if (!confirm("Ștergi rezultatul de la " + lab + "?")) return;
  var status = document.getElementById("rezStatus");
  try {
    await window.sb.storage.from("rezultate-lab").remove([st.row.file_path]);
    await window.sb.from("cc_rezultate").delete().eq("id", st.row.id);
    delete rezState[lab];
    renderRezSlot(lab, rowEl);
    refreshRezProcess();
    status.textContent = "Rezultat șters de la " + lab + ".";
  } catch (e) {
    status.textContent = "Eroare la ștergere: " + (e.message || e);
  }
}

function refreshRezProcess() {
  var n = Object.keys(rezState).filter(function(l){ return rezState[l].row; }).length;
  var btn = document.getElementById("rezProcessBtn");
  var info = document.getElementById("rezProcessInfo");
  var vbtn = document.getElementById("rezViewBtn");
  if (btn) btn.disabled = n === 0;
  if (vbtn) vbtn.disabled = !rezHasResults();
  if (info) info.textContent = n === 0
    ? "Adaugă un rezultat de la cel puțin un laborator."
    : n + " laborator" + (n === 1 ? "" : "e") + " cu rezultat. Apasa Proceseaza pentru raportul final.";
}

// Combină toate valorile extrase din toate laboratoarele (flat, fără laboratoare)
function rezAllRezultate() {
  var out = [];
  Object.keys(rezState).forEach(function(lab){
    var r = rezState[lab].row;
    if (r && Array.isArray(r.rezultate_json)) r.rezultate_json.forEach(function(x){ out.push(x); });
  });
  return out;
}

function rezBuildCoverHtml(c) {
  var fullName = [c.pacient_prenume, c.pacient_nume].filter(Boolean).join(" ").trim() || ("CNP " + c.cnp_pacient);
  var tel = c.pacient_telefon_numar ? ((c.pacient_telefon_prefix || "") + " " + c.pacient_telefon_numar).trim() : "—";
  var dateStr = new Date().toLocaleDateString("ro-RO");

  var rez = rezAllRezultate();
  var rowsHtml = rez.length
    ? rez.map(function(x){
        var flagCls = x.flag === "ridicat" ? " rez-hi" : (x.flag === "scazut" ? " rez-lo" : "");
        var mark = x.flag === "ridicat" ? " ↑" : (x.flag === "scazut" ? " ↓" : "");
        return '<tr>' +
          '<td class="rez-td-den">' + esc(x.denumire || "") + '</td>' +
          '<td class="rez-td-val' + flagCls + '">' + esc(x.rezultat || "") + mark + '</td>' +
          '<td class="rez-td-um">' + esc(x.um || "") + '</td>' +
          '<td class="rez-td-int">' + esc(x.interval || "") + '</td>' +
        '</tr>';
      }).join("")
    : '<tr><td colspan="4" style="text-align:center;color:rgba(15,17,23,0.5);padding:16px">Nu s-au putut citi valori din documentele încărcate.</td></tr>';

  var labMedText = Object.keys(rezState).map(function(lab){
    var r = rezState[lab].row;
    var dr = r && r.doctor_nume ? (" (" + esc(r.doctor_nume) + ")") : "";
    return esc(lab) + dr;
  }).join(", ");

  // Analizele solicitate în cerere (context, deasupra rezultatelor)
  var cerute = (c.items || []).map(function(it){ return it.denumire; });
  var rezCeruteHtml = cerute.length
    ? cerute.map(function(d){ return '<span class="rez-cerut-chip">' + esc(d) + '</span>'; }).join("")
    : '<span style="color:rgba(15,17,23,0.5)">—</span>';

  return '' +
  '<div class="rez-cover">' +
    '<div class="rez-cover-band">' +
      '<img src="assets/img/logo.jpg" alt="logo" crossorigin="anonymous">' +
      '<div><div class="t1">Clinica Central</div><div class="t2">Buletin de rezultate analize</div></div>' +
    '</div>' +
    '<div class="rez-cover-in">' +
      '<div class="rez-cover-h">Rezultatele analizelor</div>' +
      '<div class="rez-cover-sub">Document generat: ' + esc(dateStr) + '</div>' +
      '<div class="rez-cover-pat">' +
        '<div><div class="k">Pacient</div><div class="v">' + esc(fullName) + '</div></div>' +
        '<div><div class="k">CNP</div><div class="v">' + esc(c.cnp_pacient) + '</div></div>' +
        '<div><div class="k">Telefon</div><div class="v">' + esc(tel) + '</div></div>' +
        '<div><div class="k">Email</div><div class="v">' + esc(c.pacient_email || "—") + '</div></div>' +
      '</div>' +
      '<div class="rez-cover-antet">Vă transmitem rezultatele analizelor efectuate prin Clinica Central.</div>' +
      '<div class="rez-cover-st">Analize solicitate</div>' +
      '<div class="rez-cover-cerute">' + rezCeruteHtml + '</div>' +
      '<div class="rez-cover-st">Rezultate</div>' +
      '<table class="rez-cover-table"><thead><tr>' +
        '<th>Analiză</th><th>Rezultat</th><th>UM</th><th>Interval referință</th>' +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table>' +
      '<div class="rez-cover-foot">' +
        '<strong>Prelucrat în laboratoarele:</strong> ' + labMedText + '.' +
        '<div class="rez-note">Rezultatele se interpretează în context clinic de către medicul curant. Rezultatele brute originale pot fi furnizate la cerere.</div>' +
        '<div class="rez-cover-sign"><span>Clinica Central · Pitești</span><span>Semnătură / parafă: ______________________</span></div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// Deschide preview-ul (verificare înainte de PDF / trimitere)
function openRezPreview(c) {
  if (!c) return;
  document.getElementById("rezPreviewDoc").innerHTML = rezBuildCoverHtml(c);
  var emailEl = document.getElementById("rezSendEmail");
  if (emailEl) emailEl.value = c.pacient_email || "";
  document.getElementById("rezPreviewModal").classList.add("visible");
  document.body.style.overflow = "hidden";
}
function closeRezPreview() {
  document.getElementById("rezPreviewModal").classList.remove("visible");
  document.body.style.overflow = "";
}

// Generează PDF din preview (html2canvas → pdf-lib)
async function downloadRezultatPdf() {
  var c = rezCurrentCerere;
  var coverEl = document.querySelector("#rezPreviewDoc .rez-cover");
  var btn = document.getElementById("rezBtnPdf");
  if (!coverEl || !c) return;
  var orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Se generează...";
  try {
    var canvas = await html2canvas(coverEl, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    var srcCtx = canvas.getContext("2d");
    var PDFDocument = PDFLib.PDFDocument;
    var A4 = [595.28, 841.89];
    var out = await PDFDocument.create();
    var pageW = canvas.width;
    var pageH = Math.round(pageW * (297 / 210));

    // Detectează un rând (aproape) alb — pentru a tăia paginile în spațiul dintre rânduri
    function rowIsWhite(yy) {
      try {
        var d = srcCtx.getImageData(0, yy, pageW, 1).data;
        for (var i = 0; i < d.length; i += 32) {
          if (d[i] < 244 || d[i + 1] < 244 || d[i + 2] < 244) return false;
        }
        return true;
      } catch (e) { return true; }
    }
    // Caută în sus de la limita paginii o linie albă unde e sigur să tăiem
    function safeCut(target, minY) {
      for (var yy = target; yy > minY; yy--) { if (rowIsWhite(yy)) return yy; }
      return target; // dacă nu găsim spațiu alb, taie la limită (rar)
    }

    var y = 0;
    while (y < canvas.height) {
      var target = Math.min(y + pageH, canvas.height);
      var cut = (target >= canvas.height) ? canvas.height : safeCut(target, y + Math.floor(pageH * 0.5));
      var sliceH = cut - y;
      var tmp = document.createElement("canvas");
      tmp.width = pageW; tmp.height = pageH;
      var ctx = tmp.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, pageW, pageH);
      ctx.drawImage(canvas, 0, y, pageW, sliceH, 0, 0, pageW, sliceH);
      var png = await out.embedPng(tmp.toDataURL("image/png"));
      out.addPage(A4).drawImage(png, { x: 0, y: 0, width: A4[0], height: A4[1] });
      y = cut;
    }
    var bytes = await out.save();
    var blob = new Blob([bytes], { type: "application/pdf" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "Rezultate-CC-" + (c.cnp_pacient || "pacient") + ".pdf"; a.click();
    setTimeout(function() { URL.revokeObjectURL(url); }, 4000);
  } catch (e) {
    console.error("[rez] pdf", e);
    alert("Eroare la generarea PDF: " + (e.message || e));
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

// Wiring preview modal (elementele există în index.html)
(function(){
  var closeBtn = document.getElementById("rezPreviewClose");
  if (closeBtn) closeBtn.addEventListener("click", closeRezPreview);
  var ov = document.getElementById("rezPreviewModal");
  if (ov) ov.addEventListener("click", function(e){ if (e.target === this) closeRezPreview(); });
  var pdfBtn = document.getElementById("rezBtnPdf");
  if (pdfBtn) pdfBtn.addEventListener("click", downloadRezultatPdf);
  var sendBtn = document.getElementById("rezBtnSend");
  if (sendBtn) sendBtn.addEventListener("click", async function(){
    var c = rezCurrentCerere;
    if (!c) return;
    var emailEl = document.getElementById("rezSendEmail");
    var email = (emailEl && emailEl.value || "").trim();
    if (!email || email.indexOf("@") < 1) {
      alert("Introdu emailul pacientului pentru a trimite rezultatul.");
      if (emailEl) emailEl.focus();
      return;
    }
    var orig = sendBtn.textContent;
    sendBtn.disabled = true; sendBtn.textContent = "Se trimite...";
    try {
      // 1. asigură contul pacientului (creează dacă nu există, activ, fără aprobare)
      var ens = await window.sb.rpc("ensure_pacient_from_cerere", { p_cerere_id: c.id, p_email: email });
      if (ens.error) throw ens.error;
      // 2. trimite emailul cu link către Cardul Păun
      var nume = [c.pacient_prenume, c.pacient_nume].filter(Boolean).join(" ").trim();
      var snd = await window.sb.functions.invoke("send-rezultat-email", {
        body: { email: email, nume: nume, loginUrl: "https://carduri.clinicacentral.ro/pacient.html#rezultate" }
      });
      if (snd.error) throw snd.error;
      if (snd.data && snd.data.error) throw new Error(typeof snd.data.error === "string" ? snd.data.error : "trimitere esuata");
      var created = ens.data && ens.data.created;
      alert("✓ Rezultat trimis pe email la " + email + (created ? "\n(Cont nou creat automat pentru pacient.)" : ""));
    } catch (e) {
      console.error("[rez] trimite", e);
      alert("Eroare la trimitere: " + (e.message || e));
    } finally {
      sendBtn.disabled = false; sendBtn.textContent = orig;
    }
  });
})();

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

// ════════════════════════════════════════════════════════════════
// ADMIN PRETURI CC
// ════════════════════════════════════════════════════════════════

var adminState = {
  loaded: false,
  list: [],
  filter: "",
  editingId: null  // null = add new, else = id of pret being edited
};

// Show/hide admin tab based on is_admin flag
function setupAdminTabVisibility() {
  var info = window.__CURRENT_USER_INFO__;
  var isAdmin = !!(info && info.is_admin === true);
  var tab = document.getElementById("tabAdmin");
  if (tab) tab.style.display = isAdmin ? "" : "none";
}

// Normalize text the same way the DB function does
function normForDb(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[ăâîșțĂÂÎȘȚ]/g, function(c) {
      return { "ă": "a", "â": "a", "î": "i", "ș": "s", "ț": "t", "Ă": "a", "Â": "a", "Î": "i", "Ș": "s", "Ț": "t" }[c];
    })
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadAdminPreturi() {
  var tbody = document.getElementById("adminTableBody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="admin-loading">Se incarca preturile...</td></tr>';
  try {
    // Supabase has a default 1000-row cap; paginate to fetch all.
    var all = [];
    var pageSize = 1000;
    var page = 0;
    while (true) {
      var from = page * pageSize;
      var to = from + pageSize - 1;
      var res = await window.sb.from("cc_preturi")
        .select("id, denumire, denumire_norm, pret, activ, updated_at, updated_by")
        .order("denumire", { ascending: true })
        .range(from, to);
      if (res.error) {
        tbody.innerHTML = '<tr><td colspan="5" class="admin-loading">Eroare: ' + esc(res.error.message) + '</td></tr>';
        return;
      }
      if (!Array.isArray(res.data) || res.data.length === 0) break;
      all = all.concat(res.data);
      if (res.data.length < pageSize) break;
      page++;
      if (page > 50) break;  // safety
    }
    adminState.list = all;
    adminState.loaded = true;
    renderAdminTable();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="5" class="admin-loading">Eroare: ' + esc(String(e)) + '</td></tr>';
  }
}

function renderAdminTable() {
  var tbody = document.getElementById("adminTableBody");
  var countEl = document.getElementById("adminCount");
  if (!tbody) return;
  var filter = (adminState.filter || "").toLowerCase().trim();
  var filtered = adminState.list;
  if (filter) {
    filtered = filtered.filter(function(p) {
      return (p.denumire || "").toLowerCase().indexOf(filter) !== -1
        || (p.denumire_norm || "").toLowerCase().indexOf(filter) !== -1;
    });
  }
  if (countEl) {
    countEl.textContent = filtered.length + " / " + adminState.list.length + " preturi";
  }
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="admin-loading">Niciun pret gasit.</td></tr>';
    return;
  }
  var html = "";
  for (var i = 0; i < filtered.length; i++) {
    var p = filtered[i];
    var updatedAt = p.updated_at ? new Date(p.updated_at).toLocaleString("ro-RO", { dateStyle: "short", timeStyle: "short" }) : "—";
    html += '<tr' + (p.activ ? '' : ' class="inactive"') + ' data-id="' + p.id + '">' +
      '<td>' + esc(p.denumire) + '</td>' +
      '<td class="pret-val">' + Number(p.pret).toFixed(2) + '</td>' +
      '<td>' + (p.activ ? '✓' : '—') + '</td>' +
      '<td class="meta-small">' + updatedAt + '</td>' +
      '<td class="row-actions"><button type="button" class="row-edit-btn" data-edit-id="' + p.id + '">Editeaza</button></td>' +
      '</tr>';
  }
  tbody.innerHTML = html;
  // Wire up edit buttons
  var btns = tbody.querySelectorAll(".row-edit-btn");
  for (var j = 0; j < btns.length; j++) {
    btns[j].addEventListener("click", function(e) {
      var id = parseInt(e.target.getAttribute("data-edit-id"), 10);
      openAdminEditModal(id);
    });
  }
}

function openAdminEditModal(id) {
  var modal = document.getElementById("adminEditModal");
  var title = document.getElementById("adminEditTitle");
  var dInput = document.getElementById("adminEditDenumire");
  var pInput = document.getElementById("adminEditPret");
  var aInput = document.getElementById("adminEditActiv");
  var delBtn = document.getElementById("adminEditDelete");
  var errEl = document.getElementById("adminEditError");

  errEl.classList.remove("visible");
  errEl.textContent = "";

  if (id) {
    var item = adminState.list.find(function(x) { return x.id === id; });
    if (!item) return;
    adminState.editingId = id;
    title.textContent = "Editeaza pret";
    dInput.value = item.denumire || "";
    pInput.value = Number(item.pret).toFixed(2);
    aInput.checked = !!item.activ;
    delBtn.style.display = "";
  } else {
    adminState.editingId = null;
    title.textContent = "Adauga pret nou";
    dInput.value = "";
    pInput.value = "";
    aInput.checked = true;
    delBtn.style.display = "none";
  }
  modal.classList.add("visible");
  setTimeout(function() { dInput.focus(); }, 50);
}

function closeAdminEditModal() {
  document.getElementById("adminEditModal").classList.remove("visible");
  adminState.editingId = null;
}

async function saveAdminEdit() {
  var dInput = document.getElementById("adminEditDenumire");
  var pInput = document.getElementById("adminEditPret");
  var aInput = document.getElementById("adminEditActiv");
  var errEl = document.getElementById("adminEditError");
  var saveBtn = document.getElementById("adminEditSave");

  var denumire = dInput.value.trim();
  var pret = parseFloat(pInput.value);
  var activ = !!aInput.checked;

  if (!denumire) {
    errEl.textContent = "Denumirea e obligatorie.";
    errEl.classList.add("visible");
    return;
  }
  if (isNaN(pret) || pret < 0) {
    errEl.textContent = "Pretul e invalid.";
    errEl.classList.add("visible");
    return;
  }

  errEl.classList.remove("visible");
  saveBtn.disabled = true;
  saveBtn.textContent = "Se salveaza...";

  var denumireNorm = normForDb(denumire);
  var userId = window.__CURRENT_USER__ ? window.__CURRENT_USER__.id : null;

  try {
    var res;
    if (adminState.editingId) {
      res = await window.sb.from("cc_preturi")
        .update({ denumire: denumire, denumire_norm: denumireNorm, pret: pret, activ: activ, updated_by: userId })
        .eq("id", adminState.editingId)
        .select();
    } else {
      res = await window.sb.from("cc_preturi")
        .insert([{ denumire: denumire, denumire_norm: denumireNorm, pret: pret, activ: activ, updated_by: userId }])
        .select();
    }
    if (res.error) {
      errEl.textContent = "Eroare: " + (res.error.message || res.error);
      errEl.classList.add("visible");
      saveBtn.disabled = false;
      saveBtn.textContent = "Salveaza";
      return;
    }
    closeAdminEditModal();
    // Update in-memory cache
    if (activ) {
      PRETURI_CC[denumireNorm] = pret;
    } else {
      delete PRETURI_CC[denumireNorm];
    }
    await loadAdminPreturi();
  } catch (e) {
    errEl.textContent = "Eroare: " + String(e.message || e);
    errEl.classList.add("visible");
  }
  saveBtn.disabled = false;
  saveBtn.textContent = "Salveaza";
}

async function deleteAdminEdit() {
  if (!adminState.editingId) return;
  if (!confirm("Esti sigur ca vrei sa stergi acest pret? Actiunea nu poate fi anulata.")) return;
  var item = adminState.list.find(function(x) { return x.id === adminState.editingId; });
  try {
    var res = await window.sb.from("cc_preturi")
      .delete()
      .eq("id", adminState.editingId);
    if (res.error) {
      alert("Eroare la stergere: " + res.error.message);
      return;
    }
    if (item) delete PRETURI_CC[item.denumire_norm];
    closeAdminEditModal();
    await loadAdminPreturi();
  } catch (e) {
    alert("Eroare: " + String(e.message || e));
  }
}

// Wire up admin events
(function() {
  setupAdminTabVisibility();

  var searchEl = document.getElementById("adminSearch");
  if (searchEl) {
    searchEl.addEventListener("input", function(e) {
      adminState.filter = e.target.value;
      renderAdminTable();
    });
  }
  var addBtn = document.getElementById("adminBtnAdd");
  if (addBtn) addBtn.addEventListener("click", function() { openAdminEditModal(null); });
  var closeBtn = document.getElementById("adminEditClose");
  if (closeBtn) closeBtn.addEventListener("click", closeAdminEditModal);
  var cancelBtn = document.getElementById("adminEditCancel");
  if (cancelBtn) cancelBtn.addEventListener("click", closeAdminEditModal);
  var saveBtn = document.getElementById("adminEditSave");
  if (saveBtn) saveBtn.addEventListener("click", saveAdminEdit);
  var delBtn = document.getElementById("adminEditDelete");
  if (delBtn) delBtn.addEventListener("click", deleteAdminEdit);
  var modal = document.getElementById("adminEditModal");
  if (modal) modal.addEventListener("click", function(e) {
    if (e.target === modal) closeAdminEditModal();
  });

  // Export buttons
  var exportPdfBtn = document.getElementById("adminBtnExportPdf");
  if (exportPdfBtn) exportPdfBtn.addEventListener("click", exportAdminPreturiPdf);
  var exportXlsxBtn = document.getElementById("adminBtnExportXlsx");
  if (exportXlsxBtn) exportXlsxBtn.addEventListener("click", exportAdminPreturiXlsx);
})();

// Returns the items that should be exported: respects current search filter
function getAdminItemsForExport() {
  var filter = (adminState.filter || "").toLowerCase().trim();
  var list = adminState.list;
  if (filter) {
    list = list.filter(function(p) {
      return (p.denumire || "").toLowerCase().indexOf(filter) !== -1
        || (p.denumire_norm || "").toLowerCase().indexOf(filter) !== -1;
    });
  }
  return list;
}

function exportAdminPreturiXlsx() {
  var items = getAdminItemsForExport();
  if (!items.length) { alert("Nu sunt preturi de exportat."); return; }

  var rows = items.map(function(p) {
    return {
      "Denumire": p.denumire || "",
      "Pret (RON)": Number(p.pret),
      "Activ": p.activ ? "DA" : "NU",
      "Ultima modificare": p.updated_at ? new Date(p.updated_at).toLocaleString("ro-RO") : ""
    };
  });

  var ws = XLSX.utils.json_to_sheet(rows);
  // Column widths
  ws['!cols'] = [
    { wch: 60 }, // Denumire
    { wch: 12 }, // Pret
    { wch: 8 },  // Activ
    { wch: 20 }  // Ultima modificare
  ];

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Preturi CC");

  var d = new Date();
  var fname = "Preturi_Clinica_Central_" + d.getFullYear() +
              "-" + String(d.getMonth() + 1).padStart(2, "0") +
              "-" + String(d.getDate()).padStart(2, "0") + ".xlsx";
  XLSX.writeFile(wb, fname);
}

function exportAdminPreturiPdf() {
  var items = getAdminItemsForExport();
  if (!items.length) { alert("Nu sunt preturi de exportat."); return; }

  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  var pageW = doc.internal.pageSize.getWidth();
  var pageH = doc.internal.pageSize.getHeight();
  var margin = 14;

  // Header: small black square with logo + title
  var logoSize = 18;
  doc.setFillColor(15, 17, 23);
  doc.roundedRect(margin, margin, logoSize, logoSize, 2, 2, "F");
  try {
    var logo = getLogoForPdf();
    if (logo && logo.dataUrl) {
      doc.addImage(logo.dataUrl, "JPEG", margin + 2, margin + 2, logoSize - 4, logoSize - 4);
    }
  } catch (e) {}

  // Title
  doc.setTextColor(15, 17, 23);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("CLINICA CENTRAL", margin + logoSize + 6, margin + 7);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(184, 151, 58);
  doc.text("Preturi catalog Clinica Central", margin + logoSize + 6, margin + 13);

  // Meta line (date + total)
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  var d = new Date();
  var dateStr = d.toLocaleDateString("ro-RO") + " " + d.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
  var metaText = "Generat: " + dateStr + "  -  Total preturi: " + items.length;
  doc.text(metaText, pageW - margin, margin + 7, { align: "right" });
  if (adminState.filter) {
    doc.text("Filtru: \"" + adminState.filter + "\"", pageW - margin, margin + 11, { align: "right" });
  }

  // Gold rule under header
  doc.setDrawColor(184, 151, 58);
  doc.setLineWidth(0.5);
  doc.line(margin, margin + logoSize + 4, pageW - margin, margin + logoSize + 4);

  // Build table data
  var head = [["#", "Denumire", "Pret (RON)", "Activ"]];
  var body = items.map(function(p, i) {
    return [
      String(i + 1),
      p.denumire || "",
      Number(p.pret).toFixed(2),
      p.activ ? "DA" : "NU"
    ];
  });

  doc.autoTable({
    head: head,
    body: body,
    startY: margin + logoSize + 10,
    margin: { left: margin, right: margin },
    theme: "plain",
    styles: {
      font: "helvetica",
      fontSize: 9,
      cellPadding: { top: 2.5, right: 4, bottom: 2.5, left: 4 },
      textColor: [15, 17, 23],
      lineColor: [220, 215, 200],
      lineWidth: 0.1
    },
    headStyles: {
      fillColor: [15, 17, 23],
      textColor: [184, 151, 58],
      fontStyle: "bold",
      fontSize: 8.5
    },
    columnStyles: {
      0: { cellWidth: 12, halign: "right", textColor: [120, 120, 120] },
      1: { cellWidth: "auto" },
      2: { cellWidth: 28, halign: "right", fontStyle: "bold" },
      3: { cellWidth: 16, halign: "center" }
    },
    alternateRowStyles: { fillColor: [248, 246, 241] },
    didDrawCell: function(data) {
      // Hairline borders under each row
      if (data.section === "body" && data.column.index === 0) {
        // already styled via lineWidth
      }
    },
    didDrawPage: function(data) {
      // Footer page number
      var pageCount = doc.internal.getNumberOfPages();
      var current = data.pageNumber;
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text("Pagina " + current + " din " + pageCount, pageW - margin, pageH - 8, { align: "right" });
      doc.text("Clinica Central - Pitesti", margin, pageH - 8);
    }
  });

  var fname = "Preturi_Clinica_Central_" + d.getFullYear() +
              "-" + String(d.getMonth() + 1).padStart(2, "0") +
              "-" + String(d.getDate()).padStart(2, "0") + ".pdf";
  doc.save(fname);
}

// ════════════════════════════════════════════════════════════════
// DOCUMENT PICKER — 3 PDF types (Buletin servicii / recoltare / GDPR)
// ════════════════════════════════════════════════════════════════

function openDocPickerModal(r) {
  // Build modal markup if not present yet
  var existing = document.getElementById("docPickerModal");
  if (existing) existing.remove();

  var today = new Date();
  var todayISO = today.getFullYear() + "-" +
                 String(today.getMonth() + 1).padStart(2, "0") + "-" +
                 String(today.getDate()).padStart(2, "0");

  var overlay = document.createElement("div");
  overlay.id = "docPickerModal";
  overlay.className = "modal-overlay visible";
  overlay.innerHTML =
    '<div class="modal-box doc-picker-box">' +
      '<button class="modal-close" id="docPickerClose" type="button">&times;</button>' +
      '<div class="modal-header">' +
        '<div class="modal-tag">Documente</div>' +
        '<h2 class="modal-title">Genereaza document PDF</h2>' +
        '<p class="modal-sub">Alege ce vrei sa generezi. Documentele se salveaza local.</p>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="doc-options">' +
          '<button class="doc-option" data-doc="recoltare">' +
            '<div class="doc-option-icon">&#128203;</div>' +
            '<div class="doc-option-info">' +
              '<div class="doc-option-title">Buletin recoltare</div>' +
              '<div class="doc-option-sub">Cerere analize cu detalii eprubete si laboratoare (pentru personalul medical)</div>' +
            '</div>' +
          '</button>' +
          '<button class="doc-option" data-doc="servicii">' +
            '<div class="doc-option-icon">&#128179;</div>' +
            '<div class="doc-option-info">' +
              '<div class="doc-option-title">Buletin servicii</div>' +
              '<div class="doc-option-sub">Bonul pentru client - analize si preturi, fara detalii tehnice</div>' +
            '</div>' +
          '</button>' +
          '<button class="doc-option" data-doc="gdpr">' +
            '<div class="doc-option-icon">&#9989;</div>' +
            '<div class="doc-option-info">' +
              '<div class="doc-option-title">Consimtamant GDPR</div>' +
              '<div class="doc-option-sub">Formular GDPR pre-completat cu datele pacientului, pentru semnatura</div>' +
            '</div>' +
          '</button>' +
        '</div>' +
        '<div class="doc-meta">' +
          '<label class="doc-meta-row">' +
            '<span>Data recoltare</span>' +
            '<input type="date" id="docDataRecoltare" value="' + todayISO + '">' +
          '</label>' +
          '<div class="doc-meta-hint">Data recoltare se foloseste pe buletinul de recoltare.</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  document.getElementById("docPickerClose").addEventListener("click", closeDocPickerModal);
  overlay.addEventListener("click", function(e) {
    if (e.target === overlay) closeDocPickerModal();
  });
  var opts = overlay.querySelectorAll(".doc-option");
  for (var i = 0; i < opts.length; i++) {
    opts[i].addEventListener("click", function() {
      var type = this.getAttribute("data-doc");
      var dataRecoltareInput = document.getElementById("docDataRecoltare");
      var dataRecoltare = dataRecoltareInput ? dataRecoltareInput.value : todayISO;
      pickDoc(r, type, dataRecoltare);
    });
  }
}

function closeDocPickerModal() {
  var m = document.getElementById("docPickerModal");
  if (m) m.remove();

  // If we were opened from istoric view, restore the original cartState
  // so the active cerere being built isn't polluted.
  if (window.__istoricCartSnapshot) {
    var snap = window.__istoricCartSnapshot;
    cartState.prenume = snap.prenume;
    cartState.nume = snap.nume;
    cartState.cnp = snap.cnp;
    cartState.email = snap.email;
    cartState.telefonPrefix = snap.telefonPrefix;
    cartState.telefonNumar = snap.telefonNumar;
    cartState.numeMedic = snap.numeMedic;
    cartState.sex = snap.sex;
    cartState.dataNasterii = snap.dataNasterii;
    window.__istoricCartSnapshot = null;
  }
}

async function pickDoc(r, type, dataRecoltareISO) {
  // Get numar_ordine — wait for saveCerere to resolve (max 5s)
  var savedCerere = null;
  if (window.__currentCerereSavePromise) {
    try {
      savedCerere = await Promise.race([
        window.__currentCerereSavePromise,
        new Promise(function(resolve) { setTimeout(function() { resolve(null); }, 5000); })
      ]);
    } catch (e) {
      console.warn("[pickDoc] saveCerere failed:", e);
    }
  }
  var numarOrdine = savedCerere && savedCerere.numar_ordine ? savedCerere.numar_ordine : null;

  // IMPORTANT: Generate the PDF BEFORE closing the modal — closing the modal
  // restores any istoric cartState snapshot, which would wipe the patient data
  // that the PDF functions read from cartState.
  if (type === "recoltare") {
    exportBuletinRecoltare(r, numarOrdine, dataRecoltareISO);
  } else if (type === "servicii") {
    exportBuletinServicii(r, numarOrdine, dataRecoltareISO);
  } else if (type === "gdpr") {
    exportGdprConsent(r);
  }

  closeDocPickerModal();
}

// Common helpers for new PDFs
function pdfStripDiacritics(text) {
  if (!text) return "";
  return String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function pdfFormatDateISO(iso) {
  // iso = "2026-06-06" → "06/06/2026"
  if (!iso) return "";
  var parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}

function pdfTodayDDMMYYYY() {
  var d = new Date();
  return String(d.getDate()).padStart(2, "0") + "/" +
         String(d.getMonth() + 1).padStart(2, "0") + "/" +
         d.getFullYear();
}

// Add execution-date computed from "now" + days
function pdfExecutionDate(timpText) {
  if (!timpText) return "";
  // Parse "2 zile lucratoare", "o zi lucratoare", "24h", etc.
  var t = String(timpText).toLowerCase();
  var days = 0;
  var match = t.match(/(\d+)\s*zil/);
  if (match) days = parseInt(match[1], 10);
  else if (/o\s+zi/.test(t)) days = 1;
  else if (/24\s*h/.test(t)) days = 1;
  if (!days) return "";
  // Add business days (skip Sat/Sun)
  var d = new Date();
  var added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    var wd = d.getDay();
    if (wd !== 0 && wd !== 6) added++;
  }
  return String(d.getDate()).padStart(2, "0") + "/" +
         String(d.getMonth() + 1).padStart(2, "0") + "/" +
         d.getFullYear();
}

function pdfClinicHeader(doc, pageWidth, margin) {
  var s = pdfStripDiacritics;
  var logo = getLogoForPdf();
  var y = margin;
  var logoBoxSize = 20;
  var textX = margin;
  if (logo) {
    doc.setFillColor(15, 17, 23);
    doc.roundedRect(margin, margin - 2, logoBoxSize, logoBoxSize, 2, 2, "F");
    try { doc.addImage(logo.dataUrl, "JPEG", margin + 2, margin, logoBoxSize - 4, logoBoxSize - 4); } catch (e) {}
    textX = margin + logoBoxSize + 6;
  }
  doc.setTextColor(15, 17, 23);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("CLINICA CENTRAL SRL", textX, margin + 4);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(80, 80, 80);
  doc.text(s("Bulevardul Republicii 48, Pitesti Arges"), textX, margin + 9);
  doc.text("0772148148 / 0775148148  -  clinicacentralpitesti@gmail.com", textX, margin + 13);
  doc.text("www.clinicacentral.ro", textX, margin + 17);

  // gold underline
  doc.setDrawColor(184, 151, 58);
  doc.setLineWidth(0.5);
  doc.line(margin, margin + 22, pageWidth - margin, margin + 22);

  return margin + 28; // y position after header
}

function pdfPatientBlock(doc, r, opts, startY, pageWidth, margin) {
  // opts: { showSex, showVarsta, showAdresa, fullCnp }
  var s = pdfStripDiacritics;
  var fullName = [cartState.prenume.trim(), cartState.nume.trim()].filter(Boolean).join(" ");
  var sex = cartState.sex || sexFromCnp(cartState.cnp);
  var dn = cartState.dataNasterii || dataNasteriiFromCnp(cartState.cnp);
  var varsta = dn ? varstaFromDataNasterii(dn) : "";

  // Table-style patient row (label header above, value below)
  var y = startY;
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(120, 120, 120);

  // Columns: Nume / Email / Telefon / Sex / Varsta / CNP — but only show what we have
  // Weights tuned so email (usually longest) gets enough room.
  var cols = [];
  cols.push({ label: "PACIENT", value: fullName || "—", weight: 2.6, fontSize: 10 });
  if (cartState.email) cols.push({ label: "EMAIL", value: cartState.email, weight: 3.4, fontSize: 9 });
  if (cartState.telefonNumar) cols.push({ label: "TELEFON", value: cartState.telefonPrefix + " " + cartState.telefonNumar, weight: 1.8, fontSize: 9 });
  if (opts.showSex && sex) cols.push({ label: "SEX", value: sex, weight: 0.5, fontSize: 10 });
  if (opts.showVarsta && varsta) cols.push({ label: "VARSTA", value: String(varsta), weight: 0.7, fontSize: 10 });
  cols.push({ label: "CNP", value: cartState.cnp || "—", weight: 1.9, fontSize: 9 });

  // Compute column widths proportionally
  var contentWidth = pageWidth - 2 * margin;
  var totalWeight = cols.reduce(function(a, c) { return a + c.weight; }, 0);
  var colWidths = cols.map(function(c) { return (c.weight / totalWeight) * contentWidth; });

  // Headers row
  var x = margin;
  for (var i = 0; i < cols.length; i++) {
    doc.text(cols[i].label, x, y);
    x += colWidths[i];
  }
  y += 4;

  // Values row
  doc.setFont("helvetica", "normal");
  doc.setTextColor(15, 17, 23);
  x = margin;
  for (var j = 0; j < cols.length; j++) {
    var val = s(cols[j].value);
    doc.setFontSize(cols[j].fontSize || 10);
    // Width-aware truncation: measure text and shrink-with-ellipsis if needed
    var maxWidth = colWidths[j] - 2;  // small gap between cols
    var textWidth = doc.getTextWidth(val);
    if (textWidth > maxWidth && val.length > 4) {
      // Trim chars from end until it fits with "…"
      while (val.length > 4 && doc.getTextWidth(val + "…") > maxWidth) {
        val = val.slice(0, -1);
      }
      val = val + "…";
    }
    doc.text(val, x, y);
    x += colWidths[j];
  }
  y += 6;

  // Faint separator
  doc.setDrawColor(220, 215, 200);
  doc.setLineWidth(0.2);
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;

  return y;
}

// ────────────────────────────────────────────────────────────────
// PDF 1: Buletin RECOLTARE (internal, with tubes + lab routing)
// ────────────────────────────────────────────────────────────────

function exportBuletinRecoltare(r, numarOrdine, dataRecoltareISO) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  var pageWidth = doc.internal.pageSize.getWidth();
  var pageHeight = doc.internal.pageSize.getHeight();
  var margin = 15;
  var contentWidth = pageWidth - 2 * margin;
  var s = pdfStripDiacritics;
  var SAFE_BOTTOM = pageHeight - 12;  // reserve 12mm for page-number footer

  var y = pdfClinicHeader(doc, pageWidth, margin);

  // ---- Title + cod cerere ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(15, 17, 23);
  doc.text("CERERE ANALIZE", margin, y);
  if (numarOrdine) {
    doc.setFontSize(11);
    doc.setTextColor(184, 151, 58);
    doc.text("COD CERERE: #" + numarOrdine, pageWidth - margin, y, { align: "right" });
  }
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  var dataCerere = pdfTodayDDMMYYYY();
  var ora = new Date().toTimeString().substr(0, 5);
  doc.text("Data cerere: " + dataCerere + " " + ora, margin, y);
  doc.text("Data recoltare: " + pdfFormatDateISO(dataRecoltareISO), pageWidth - margin, y, { align: "right" });
  y += 5;
  if (cartState.numeMedic) {
    doc.text("Medic: " + s(cartState.numeMedic), margin, y);
    y += 5;
  }
  y += 2;

  // ---- Patient block ----
  y = pdfPatientBlock(doc, r, { showSex: true, showVarsta: true }, y, pageWidth, margin);

  // ---- Analize table ----
  // Use TOP-OF-ROW paradigm: `y` is the top of the next row to draw.
  // Text baseline is placed at (y + rowBL) so first row's ascenders never
  // overlap the dark header strip (otherwise text top can intrude).
  var rowH = 6;       // height of each row
  var rowBL = 4.2;    // baseline offset from row top
  var headerGap = 2.5;  // extra gap between header strip and first row

  function drawTableHeader() {
    doc.setFillColor(15, 17, 23);
    doc.rect(margin, y, contentWidth, 6, "F");
    doc.setTextColor(184, 151, 58);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("Denumire", margin + 2, y + rowBL);
    doc.text("Laborator", margin + 95, y + rowBL);
    doc.text("Cant.", margin + 130, y + rowBL);
    doc.text("Termen", margin + 145, y + rowBL);
    doc.text("Pret", pageWidth - margin - 2, y + rowBL, { align: "right" });
    y += 6 + headerGap;
  }

  // Section title "ANALIZE"
  function ensureSpace(needed) {
    if (y + needed > SAFE_BOTTOM) {
      doc.addPage();
      y = margin;
      return true;
    }
    return false;
  }

  ensureSpace(16);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(184, 151, 58);
  doc.text("ANALIZE", margin, y);
  y += 4;

  drawTableHeader();

  // Iterate rows: y is TOP of current row; text baselines are at y + rowBL
  for (var i = 0; i < r.items.length; i++) {
    if (y + rowH > SAFE_BOTTOM) {
      doc.addPage();
      y = margin;
      drawTableHeader();
    }
    var it = r.items[i];
    // Alternating row background — full row height covers from top
    if (i % 2 === 1) {
      doc.setFillColor(248, 246, 241);
      doc.rect(margin, y, contentWidth, rowH, "F");
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(15, 17, 23);
    doc.text(s(it.displayName), margin + 2, y + rowBL);
    doc.setFontSize(8);
    doc.text(s(it.offer.Laborator), margin + 95, y + rowBL);
    doc.text("1", margin + 130, y + rowBL);
    var timp = (it.offer.Timp && it.offer.Timp !== "N/A") ? it.offer.Timp : "";
    doc.text(s(timp), margin + 145, y + rowBL);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(Number(it.finalPrice).toFixed(0), pageWidth - margin - 2, y + rowBL, { align: "right" });
    y += rowH;
  }

  // ---- Total row ----
  ensureSpace(14);
  y += 1;
  doc.setDrawColor(15, 17, 23);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Total", margin, y);
  doc.text(Number(r.grandTotal).toFixed(0) + " RON", pageWidth - margin, y, { align: "right" });
  y += 10;

  // ---- Eprubete necesare ----
  var eprubete = buildEprubetSummary(r.items);
  if (eprubete.length > 0) {
    ensureSpace(12);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(184, 151, 58);
    doc.text("EPRUBETE NECESARE", margin, y);
    y += 5;
    doc.setTextColor(15, 17, 23);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");

    for (var k = 0; k < eprubete.length; k++) {
      var e = eprubete[k];
      var locs = Object.keys(e.breakdown || {});
      // Estimate height of this group: title (4.5mm) + each breakdown line (4mm) + gap (2mm)
      var groupHeight = 4.5 + locs.length * 4 + 2;
      // Try to keep the whole group on one page
      if (y + groupHeight > SAFE_BOTTOM) {
        doc.addPage();
        y = margin;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(15, 17, 23);
      doc.text(e.count + "x  " + s(e.tip), margin + 2, y);
      y += 4.5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 80);
      for (var li = 0; li < locs.length; li++) {
        // Per-line safety: if it really doesn't fit, page break (rare case)
        if (y + 4 > SAFE_BOTTOM) {
          doc.addPage();
          y = margin;
        }
        var locname = locs[li];
        var cnt = e.breakdown[locname];
        doc.text("    " + cnt + "x  -  " + s(locname), margin + 4, y);
        y += 4;
      }
      y += 2;
    }
  }

  // Footer page numbers
  var pageCount = doc.internal.getNumberOfPages();
  for (var p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text("Pagina " + p + " din " + pageCount, pageWidth - margin, pageHeight - 6, { align: "right" });
  }

  // Save
  var fullName = (cartState.prenume.trim() + "_" + cartState.nume.trim())
    .replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
  var codStr = numarOrdine ? "_" + numarOrdine : "";
  doc.save("Buletin_recoltare_" + fullName + codStr + ".pdf");
}

// ────────────────────────────────────────────────────────────────
// PDF 2: Buletin SERVICII (for client — no tubes/labs detail)
// ────────────────────────────────────────────────────────────────

function exportBuletinServicii(r, numarOrdine, dataRecoltareISO) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  var pageWidth = doc.internal.pageSize.getWidth();
  var pageHeight = doc.internal.pageSize.getHeight();
  var margin = 15;
  var contentWidth = pageWidth - 2 * margin;
  var s = pdfStripDiacritics;

  var y = pdfClinicHeader(doc, pageWidth, margin);

  // Title + cod cerere
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(15, 17, 23);
  doc.text("BULETIN SERVICII", margin, y);
  if (numarOrdine) {
    doc.setFontSize(11);
    doc.setTextColor(184, 151, 58);
    doc.text("COD CERERE: #" + numarOrdine, pageWidth - margin, y, { align: "right" });
  }
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text("Data cerere: " + pdfTodayDDMMYYYY(), margin, y);
  var medicTxt = "Medic: " + (cartState.numeMedic ? s(cartState.numeMedic) : "FARA TRIMITERE");
  doc.text(medicTxt, pageWidth - margin, y, { align: "right" });
  y += 7;

  // Patient block
  y = pdfPatientBlock(doc, r, { showSex: true, showVarsta: true }, y, pageWidth, margin);

  // ---- Helpers for pagination + table layout (top-of-row paradigm) ----
  var SAFE_BOTTOM = pageHeight - 12;
  var rowH = 6;
  var rowBL = 4.2;
  var headerGap = 2.5;

  function drawServiciiHeader() {
    doc.setFillColor(15, 17, 23);
    doc.rect(margin, y, contentWidth, 6, "F");
    doc.setTextColor(184, 151, 58);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("Denumire analiza", margin + 2, y + rowBL);
    doc.text("Termen executie", margin + 110, y + rowBL);
    doc.text("Pret (RON)", pageWidth - margin - 2, y + rowBL, { align: "right" });
    y += 6 + headerGap;
  }

  drawServiciiHeader();

  for (var i = 0; i < r.items.length; i++) {
    if (y + rowH > SAFE_BOTTOM) {
      doc.addPage();
      y = margin;
      drawServiciiHeader();
    }
    var it = r.items[i];
    if (i % 2 === 1) {
      doc.setFillColor(248, 246, 241);
      doc.rect(margin, y, contentWidth, rowH, "F");
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(15, 17, 23);
    doc.text(s(it.displayName), margin + 2, y + rowBL);
    doc.setFontSize(8);
    var timp = (it.offer.Timp && it.offer.Timp !== "N/A") ? it.offer.Timp : "";
    var execDate = pdfExecutionDate(timp);
    var timpFull = timp + (execDate ? " (" + execDate + ")" : "");
    doc.text(s(timpFull), margin + 110, y + rowBL);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(Number(it.finalPrice).toFixed(0), pageWidth - margin - 2, y + rowBL, { align: "right" });
    y += rowH;
  }

  // Total — needs ~20mm for total + 2 footer lines
  if (y + 20 > SAFE_BOTTOM) { doc.addPage(); y = margin; }
  y += 2;
  doc.setDrawColor(15, 17, 23);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Total de plata", margin, y);
  doc.text(Number(r.grandTotal).toFixed(0) + " RON", pageWidth - margin, y, { align: "right" });
  y += 6;

  // Footer note: bon fiscal + verificati datele
  if (y + 10 > SAFE_BOTTOM) { doc.addPage(); y = margin; }
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(120, 120, 120);
  y += 4;
  doc.text(s("Va rugam solicitati bonul fiscal pentru suma achitata."), margin, y);
  y += 4;
  doc.text(s("Verificati datele inscrise pe acest buletin la receptie."), margin, y);

  var pageCount = doc.internal.getNumberOfPages();
  for (var p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text("Pagina " + p + " din " + pageCount, pageWidth - margin, pageHeight - 6, { align: "right" });
  }

  var fullName = (cartState.prenume.trim() + "_" + cartState.nume.trim())
    .replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
  var codStr = numarOrdine ? "_" + numarOrdine : "";
  doc.save("Buletin_servicii_" + fullName + codStr + ".pdf");
}

// ────────────────────────────────────────────────────────────────
// PDF 3: GDPR consent (pre-filled patient details + ticked DA boxes)
// ────────────────────────────────────────────────────────────────

function exportGdprConsent(r) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  var pageWidth = doc.internal.pageSize.getWidth();
  var pageHeight = doc.internal.pageSize.getHeight();
  var margin = 15;
  var contentWidth = pageWidth - 2 * margin;
  var s = pdfStripDiacritics;

  var y = pdfClinicHeader(doc, pageWidth, margin);

  // Title — purple band like in sample
  doc.setFillColor(232, 230, 252);
  doc.rect(margin, y, contentWidth, 16, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 17, 23);
  doc.text("CONSIMTAMANT INFORMAT PRIVIND ACORDUL", pageWidth / 2, y + 6, { align: "center" });
  doc.text("PRELUCRARII DATELOR CU CARACTER PERSONAL", pageWidth / 2, y + 11, { align: "center" });
  y += 21;

  // Patient pre-fill block
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(120, 120, 120);
  var fullName = [cartState.prenume.trim(), cartState.nume.trim()].filter(Boolean).join(" ");
  var dn = cartState.dataNasterii || dataNasteriiFromCnp(cartState.cnp);

  // Box around patient info
  doc.setDrawColor(184, 151, 58);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, contentWidth, 18, 1, 1);

  doc.text("NUME / PRENUME", margin + 3, y + 4);
  doc.text("CNP", margin + 90, y + 4);
  doc.text("DATA NASTERII", margin + 130, y + 4);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(15, 17, 23);
  doc.text(s(fullName) || "—", margin + 3, y + 10);
  doc.text(cartState.cnp || "—", margin + 90, y + 10);
  doc.text(dn || "—", margin + 130, y + 10);

  if (cartState.email || cartState.telefonNumar) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(120, 120, 120);
    doc.text("EMAIL", margin + 3, y + 14);
    doc.text("TELEFON", margin + 90, y + 14);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(15, 17, 23);
    if (cartState.email) doc.text(s(cartState.email), margin + 17, y + 14);
    if (cartState.telefonNumar) doc.text(cartState.telefonPrefix + " " + cartState.telefonNumar, margin + 105, y + 14);
  }
  y += 22;

  // Body text
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(15, 17, 23);

  var SAFE_BOTTOM = pageHeight - 12;

  var paragraphs = [
    "Conform cerintelor Regulamentului European 2016/679 privind protectia persoanelor fizice referitor la prelucrarea datelor cu caracter personal si libera circulatie a acestor date (\"GDPR\"), Clinica Central SRL are obligatia de a administra in conditii de siguranta si numai pentru scopurile specificate, datele personale pe care ni le furnizati despre dumneavoastra, un membru al familiei dumneavoastra, ori o alta persoana.",
    "Aplicam masurile tehnice si organizatorice adecvate pentru protejarea datelor cu caracter personal impotriva distrugerii accidentale sau ilegale, pierderii, modificarii, dezvaluirii sau accesului neautorizat. Clinica Central SRL a luat masurile de securitate conform Ordinului nr. 52/2002 privind aprobarea Cerintelor minime de securitate a prelucrarilor de date cu caracter personal.",
    "Se recomanda sa furnizati si sa ne acordati datele solicitate, scopul inregistrarii si prelucrarii lor este necesar, in conformitate cu prevederile legale in vigoare, pentru diagnosticare, interpretare si tratament, istoric medical, acordarea de servicii medicale, la generarea de referinte medicale, scop statistic si informativ catre medicul curant, raportari la Casele de Asigurari de Sanatate locala, sau alte organisme autorizate prin lege.",
    "Refuzul dvs. determina imposibilitatea acordarii de servicii medicale, de diagnosticare sau interpretare rezultate, de a beneficia de investigatii decontate de Casele de Sanatate, starea dvs. de sanatate putand avea de suferit.",
    "Conform Regulamentului beneficiati de dreptul de acces, de interventie asupra datelor, dreptul de a nu fi supus unei decizii individuale si dreptul de a va adresa justitiei. Totodata, aveti dreptul sa va opuneti prelucrarii datelor personale care va privesc si sa solicitati stergerea acestora. Pentru exercitarea acestor drepturi, va puteti adresa cu o cerere scrisa, datata si semnata catre Clinica Central SRL. Datele dvs. nu vor fi transferate in alte state.",
    "Date cu caracter personal: nume si prenume, CNP, data nasterii, sexul, cetatenia, date din actele de identitate, adresa, profesia, situatie familiala, date privind starea de sanatate."
  ];

  for (var i = 0; i < paragraphs.length; i++) {
    var lines = doc.splitTextToSize(s(paragraphs[i]), contentWidth);
    var blockHeight = lines.length * 4 + 2;
    if (y + blockHeight > SAFE_BOTTOM) { doc.addPage(); y = margin; }
    doc.text(lines, margin, y);
    y += blockHeight;
  }

  y += 3;

  // 5 consent rows with pre-ticked DA — each row needs ~9mm (separator + label + box)
  var consents = [
    "Accept prelucrarea datelor cu caracter personal in vederea efectuarii serviciilor medicale",
    "Accept colectarea adresei de email pentru trimiterea rezultatelor pe email",
    "Accept colectarea adresei de email pentru trimiterea de oferte si materiale promotionale",
    "Accept colectarea numarului de telefon pentru notificare prin SMS",
    "Accept trimiterea informatiilor medicale catre medicul curant (e-mail sau on-line)"
  ];

  doc.setDrawColor(150, 150, 150);
  doc.setLineWidth(0.2);

  for (var c = 0; c < consents.length; c++) {
    // Each row needs 9mm; reserve also signature block (~32mm) to stay on same page if possible
    var needed = (c === 0 ? 9 + 32 : 9);
    if (y + needed > SAFE_BOTTOM) { doc.addPage(); y = margin; }
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(s(consents[c]) + ":", margin, y);

    // DA checkbox (ticked) + NU checkbox (empty)
    var boxSize = 4;
    var daX = pageWidth - margin - 26;
    var nuX = pageWidth - margin - 12;

    doc.setFont("helvetica", "normal");
    doc.text("DA", daX - 4, y);
    // Ticked box
    doc.setDrawColor(15, 17, 23);
    doc.setLineWidth(0.3);
    doc.rect(daX, y - 3, boxSize, boxSize);
    // Tick mark
    doc.setLineWidth(0.5);
    doc.line(daX + 0.7, y - 1, daX + 1.6, y - 0.2);
    doc.line(daX + 1.6, y - 0.2, daX + 3.3, y - 2.5);

    doc.text("NU", nuX - 4, y);
    doc.rect(nuX, y - 3, boxSize, boxSize);

    y += 4;
  }
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // Signature block (~32mm needed: data + 4 rows of 6mm)
  if (y + 32 > SAFE_BOTTOM) { doc.addPage(); y = margin; }
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(15, 17, 23);
  doc.text("Data: " + pdfTodayDDMMYYYY(), margin, y);

  var rightX = pageWidth - margin - 80;
  doc.text("Nume / Prenume: " + s(fullName), rightX, y);
  y += 6;
  doc.text("Imputernicit: ___________________________", rightX, y);
  y += 6;
  doc.text("Apartinator: ____________________________", rightX, y);
  y += 6;
  doc.text("Semnatura: ______________________________", rightX, y);

  var fullN = (cartState.prenume.trim() + "_" + cartState.nume.trim())
    .replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
  doc.save("Consimtamant_GDPR_" + fullN + ".pdf");
}

// ════════════════════════════════════════════════════════════════
// PROGRAMARI MODULE
// ════════════════════════════════════════════════════════════════

var programariState = {
  loaded: false,
  list: [],
  filter: "all",          // all / scheduled / bilet_uploaded / ocr_processed / completed / upcoming
  selectedId: null,
  ocrInProgress: false
};

function progEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function progFormatDate(iso) {
  if (!iso) return "—";
  var d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ro-RO", { day: "2-digit", month: "long", year: "numeric" });
}

function progFormatTime(iso) {
  if (!iso) return "";
  var d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
}

function progDayBoxParts(iso) {
  if (!iso) return { day: "—", month: "", time: "" };
  var d = new Date(iso);
  if (isNaN(d.getTime())) return { day: "—", month: "", time: "" };
  return {
    day: String(d.getDate()).padStart(2, "0"),
    month: d.toLocaleDateString("ro-RO", { month: "short" }).toUpperCase().replace(".", ""),
    time: d.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })
  };
}

function progStatusInfo(status) {
  switch (status) {
    case "scheduled": return { label: "Programat", cls: "prog-status-scheduled" };
    case "bilet_uploaded": return { label: "Bilet urcat", cls: "prog-status-bilet" };
    case "ocr_processed": return { label: "OCR procesat", cls: "prog-status-ocr" };
    case "completed": return { label: "Completat", cls: "prog-status-completed" };
    case "cancelled": return { label: "Anulat", cls: "prog-status-cancelled" };
    default: return { label: status || "—", cls: "prog-status-scheduled" };
  }
}

// Load programari from DB
async function loadProgramari() {
  var listEl = document.getElementById("programariList");
  if (!listEl) return;
  listEl.innerHTML = '<div class="istoric-loading">Se incarca programarile...</div>';
  try {
    var res = await window.sb.from("cc_programari")
      .select("id, pacient_id, email_pacient, nume_pacient, telefon_pacient, data_programare, tip_serviciu, nume_doctor, note, bilet_url, bilet_filename, bilet_mime_type, bilet_uploaded_at, status, cerere_id, created_at, updated_at")
      .order("data_programare", { ascending: false });
    if (res.error) {
      listEl.innerHTML = '<div class="istoric-loading">Eroare: ' + progEsc(res.error.message) + '</div>';
      return;
    }
    programariState.list = res.data || [];
    programariState.loaded = true;
    renderProgramari();
  } catch (e) {
    listEl.innerHTML = '<div class="istoric-loading">Eroare: ' + progEsc(String(e.message || e)) + '</div>';
  }
}

function renderProgramari() {
  var listEl = document.getElementById("programariList");
  if (!listEl) return;
  var filter = programariState.filter || "all";
  var now = new Date();
  var items = programariState.list.filter(function(p) {
    if (filter === "all") return true;
    if (filter === "upcoming") {
      return new Date(p.data_programare) >= now && p.status !== "cancelled";
    }
    return p.status === filter;
  });

  if (!items.length) {
    listEl.innerHTML = '<div class="istoric-loading">Nicio programare pentru filtrul selectat.</div>';
    return;
  }

  var html = "";
  for (var i = 0; i < items.length; i++) {
    var p = items[i];
    var box = progDayBoxParts(p.data_programare);
    var info = progStatusInfo(p.status);
    var name = p.nume_pacient || p.email_pacient || "Pacient necunoscut";
    var cardClasses = ["programare-card"];
    if (p.bilet_url) cardClasses.push("has-bilet");
    if (p.status === "ocr_processed") cardClasses.push("ocr-processed");
    if (p.status === "cancelled") cardClasses.push("cancelled");

    var metaParts = [];
    if (p.tip_serviciu) metaParts.push('<span>&#128203; ' + progEsc(p.tip_serviciu) + '</span>');
    if (p.bilet_url) metaParts.push('<span>&#128206; Bilet urcat</span>');
    if (p.cerere_id) metaParts.push('<span>&#128221; Cerere #' + p.cerere_id + '</span>');
    if (p.telefon_pacient) metaParts.push('<span>&#128241; ' + progEsc(p.telefon_pacient) + '</span>');
    if (p.is_cas) metaParts.push('<span style="color:#155a32;font-weight:700">&#127973; CAS</span>');

    html += '<div class="' + cardClasses.join(" ") + '" data-prog-id="' + p.id + '">';
    html += '<div class="prog-date-box">';
    html += '<div class="prog-date-day">' + box.day + '</div>';
    html += '<div class="prog-date-month">' + progEsc(box.month) + '</div>';
    html += '<div class="prog-date-time">' + box.time + '</div>';
    html += '</div>';
    html += '<div class="prog-info">';
    html += '<div class="prog-info-name">' + progEsc(name) + '</div>';
    html += '<div class="prog-info-email">' + progEsc(p.email_pacient) + '</div>';
    if (metaParts.length) html += '<div class="prog-info-meta">' + metaParts.join("") + '</div>';
    html += '</div>';
    html += '<div class="prog-status">';
    html += '<span class="prog-status-badge ' + info.cls + '">' + info.label + '</span>';
    html += '</div>';
    html += '</div>';
  }
  listEl.innerHTML = html;

  // Wire up click on cards
  var cards = listEl.querySelectorAll(".programare-card");
  for (var k = 0; k < cards.length; k++) {
    cards[k].addEventListener("click", function() {
      var id = parseInt(this.getAttribute("data-prog-id"), 10);
      openProgramareModal(id);
    });
  }
}

// Open detail modal for a programare
async function openProgramareModal(id) {
  var p = programariState.list.find(function(x) { return x.id === id; });
  if (!p) return;
  programariState.selectedId = id;

  var modal = document.getElementById("programareModal");
  var title = document.getElementById("programareModalTitle");
  var tag = document.getElementById("programareModalTag");
  var body = document.getElementById("programareModalBody");

  var info = progStatusInfo(p.status);
  tag.textContent = info.label;
  title.textContent = p.nume_pacient || p.email_pacient || "Pacient necunoscut";

  var html = "";

  // Section: Detalii pacient
  html += '<div class="prog-detail-section">';
  html += '<h3>Pacient</h3>';
  html += '<div class="prog-detail-row"><span class="prog-detail-label">Nume</span><span class="prog-detail-val">' + progEsc(p.nume_pacient || "—") + '</span></div>';
  html += '<div class="prog-detail-row"><span class="prog-detail-label">Email</span><span class="prog-detail-val">' + progEsc(p.email_pacient) + '</span></div>';
  if (p.telefon_pacient) html += '<div class="prog-detail-row"><span class="prog-detail-label">Telefon</span><span class="prog-detail-val">' + progEsc(p.telefon_pacient) + '</span></div>';
  html += '</div>';

  // Section: Detalii programare
  html += '<div class="prog-detail-section">';
  html += '<h3>Programare</h3>';
  html += '<div class="prog-detail-row"><span class="prog-detail-label">Data</span><span class="prog-detail-val">' + progFormatDate(p.data_programare) + ' ' + progFormatTime(p.data_programare) + '</span></div>';
  if (p.tip_serviciu) html += '<div class="prog-detail-row"><span class="prog-detail-label">Tip serviciu</span><span class="prog-detail-val">' + progEsc(p.tip_serviciu) + '</span></div>';
  if (p.nume_doctor) html += '<div class="prog-detail-row"><span class="prog-detail-label">Doctor</span><span class="prog-detail-val">' + progEsc(p.nume_doctor) + '</span></div>';
  if (p.note) html += '<div class="prog-detail-row"><span class="prog-detail-label">Note</span><span class="prog-detail-val">' + progEsc(p.note) + '</span></div>';
  html += '</div>';

  // Section: Bilet de trimitere (preview)
  html += '<div class="prog-detail-section">';
  html += '<h3>Bilet de trimitere</h3>';
  if (p.bilet_url) {
    // Get signed URL for the bilet
    html += '<div class="bilet-preview" id="biletPreviewContainer">';
    html += '<div class="istoric-loading">Se incarca biletul...</div>';
    html += '</div>';
  } else {
    html += '<div class="bilet-no-file">Pacientul nu a urcat inca biletul de trimitere.</div>';
  }
  html += '</div>';

  // Section: Cerere asociata
  if (p.cerere_id) {
    html += '<div class="prog-detail-section">';
    html += '<h3>Cerere asociata</h3>';
    html += '<div class="prog-detail-row"><span class="prog-detail-label">Numar cerere</span><span class="prog-detail-val">#' + p.cerere_id + '</span></div>';
    html += '</div>';
  }

  // Actions
  html += '<div class="prog-actions">';
  if (p.bilet_url && !p.cerere_id && p.status !== "cancelled") {
    html += '<button type="button" class="prog-btn-primary" id="btnProgOcr">&#10024; Proceseaza OCR si creeaza cerere</button>';
  } else if (p.cerere_id) {
    html += '<button type="button" class="prog-btn-primary" id="btnProgOpenCerere">&#128203; Deschide cererea in cos</button>';
  }
  html += '<button type="button" class="prog-btn-secondary" id="btnProgEdit">Editeaza programare</button>';
  if (p.status !== "cancelled") {
    html += '<button type="button" class="prog-btn-danger" id="btnProgCancel">Anuleaza programare</button>';
  }
  html += '</div>';

  body.innerHTML = html;
  modal.classList.add("visible");

  // Load bilet preview asynchronously
  if (p.bilet_url) {
    loadBiletPreview(p);
  }

  // Wire up action buttons
  var ocrBtn = document.getElementById("btnProgOcr");
  if (ocrBtn) ocrBtn.addEventListener("click", function() { processProgramareOcr(p); });

  var openCerereBtn = document.getElementById("btnProgOpenCerere");
  if (openCerereBtn) openCerereBtn.addEventListener("click", function() { openCerereFromProgramare(p.cerere_id); });

  var editBtn = document.getElementById("btnProgEdit");
  if (editBtn) editBtn.addEventListener("click", function() { editProgramare(p); });

  var cancelBtn = document.getElementById("btnProgCancel");
  if (cancelBtn) cancelBtn.addEventListener("click", function() { cancelProgramare(p); });
}

function closeProgramareModal() {
  var m = document.getElementById("programareModal");
  if (m) m.classList.remove("visible");
  programariState.selectedId = null;
}

// Load bilet preview from Supabase Storage using signed URL
async function loadBiletPreview(p) {
  var container = document.getElementById("biletPreviewContainer");
  if (!container) return;
  try {
    // Create signed URL (60 seconds) for the bilet
    var signedRes = await window.sb.storage
      .from("bilete-programari")
      .createSignedUrl(p.bilet_url, 60);
    if (signedRes.error || !signedRes.data) {
      container.innerHTML = '<div class="bilet-no-file">Eroare la incarcare bilet: ' + progEsc(signedRes.error ? signedRes.error.message : "necunoscuta") + '</div>';
      return;
    }
    var url = signedRes.data.signedUrl;
    var mime = p.bilet_mime_type || "";
    var html = "";
    if (mime.indexOf("image/") === 0) {
      html += '<img src="' + progEsc(url) + '" alt="Bilet de trimitere">';
    } else if (mime === "application/pdf") {
      html += '<div style="font-size:32px;margin-bottom:8px">&#128196;</div>';
      html += '<div style="font-size:13px;color:rgba(15,17,23,0.6);margin-bottom:8px">' + progEsc(p.bilet_filename || "Bilet PDF") + '</div>';
    }
    html += '<a class="bilet-preview-link" href="' + progEsc(url) + '" target="_blank" rel="noopener">Deschide intr-un tab nou &#8599;</a>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="bilet-no-file">Eroare: ' + progEsc(String(e.message || e)) + '</div>';
  }
}

// Process OCR on bilet, create pending cerere
async function processProgramareOcr(p) {
  if (programariState.ocrInProgress) return;
  if (!p.bilet_url) { alert("Nu exista bilet urcat."); return; }

  programariState.ocrInProgress = true;
  var ocrBtn = document.getElementById("btnProgOcr");
  if (ocrBtn) {
    ocrBtn.disabled = true;
    ocrBtn.textContent = "Se descarca biletul...";
  }

  try {
    // 1. Download bilet from Storage
    var dlRes = await window.sb.storage.from("bilete-programari").download(p.bilet_url);
    if (dlRes.error) throw new Error("Eroare descarcare: " + dlRes.error.message);
    var blob = dlRes.data;

    // 2. Convert to base64
    if (ocrBtn) ocrBtn.textContent = "Se proceseaza imaginea...";
    var base64 = await blobToBase64(blob);
    var mime = p.bilet_mime_type || blob.type || "image/jpeg";

    // For PDFs, OCR doesn't work — we'd need to convert PDF→image first.
    // For now, alert if PDF.
    if (mime === "application/pdf") {
      alert("OCR pe PDF nu e suportat momentan. Te rugam sa converti biletul intr-o imagine (JPG/PNG) si sa-l re-urci.");
      if (ocrBtn) { ocrBtn.disabled = false; ocrBtn.textContent = "✨ Proceseaza OCR si creeaza cerere"; }
      programariState.ocrInProgress = false;
      return;
    }

    // 3. Call Edge Function ocr-bilet
    if (ocrBtn) ocrBtn.textContent = "Se ruleaza OCR...";
    var ocrRes = await window.sb.functions.invoke("ocr-bilet", {
      body: { imageBase64: base64, mediaType: mime }
    });
    if (ocrRes.error) throw new Error("OCR error: " + (ocrRes.error.message || ocrRes.error));
    var data = ocrRes.data;
    if (!data || data.error) throw new Error("OCR returned error: " + (data && data.error ? data.error : "unknown"));

    console.log("[programari OCR] Gemini response:", data);

    // 4. Match analize to catalog (reuse existing fuzzy-matching logic)
    if (ocrBtn) ocrBtn.textContent = "Se asociaza analizele...";
    var matched = [];
    var notMatched = [];
    var analizeArr = Array.isArray(data.analize) ? data.analize : [];
    console.log("[programari OCR] Analize extrase:", analizeArr.length, analizeArr);

    for (var i = 0; i < analizeArr.length; i++) {
      var rawText = analizeArr[i];
      var match = (typeof findBestMatch === "function") ? findBestMatch(rawText) : null;
      // findBestMatch returns { entry: {key, displayName, offers}, score } or null
      if (!match || !match.entry) {
        console.warn("[programari OCR] Negăsit:", rawText);
        notMatched.push(rawText);
        continue;
      }
      var entry = match.entry;
      if (!entry.offers || !entry.offers.length) {
        console.warn("[programari OCR] Entry fără oferte:", entry.displayName);
        notMatched.push(rawText);
        continue;
      }
      var best = (typeof cheapestOffer === "function") ? cheapestOffer(entry) : { offer: entry.offers[0], finalPrice: entry.offers[0].Pret };
      if (!best.offer) {
        console.warn("[programari OCR] Nu am cheapest offer pentru:", entry.displayName);
        notMatched.push(rawText);
        continue;
      }
      console.log("[programari OCR] Match:", rawText, "→", entry.displayName, "(score:", match.score.toFixed(2) + ")");
      matched.push({
        displayName: entry.displayName,
        cnpKey: rawText,
        offer: best.offer,
        finalPriceComputed: best.finalPrice
      });
    }

    console.log("[programari OCR] Matched:", matched.length, "of", analizeArr.length);
    if (matched.length === 0) {
      // Show user what was extracted vs what we couldn't match
      var msg = "OCR a procesat biletul dar nu am putut asocia nicio analiza cu catalogul.\n\n";
      if (analizeArr.length === 0) {
        msg += "Gemini nu a extras nicio analiza din imagine. Verifica daca imaginea e clara si contine un bilet cu lista de analize.";
      } else {
        msg += "Analize extrase din bilet: " + analizeArr.length + "\n";
        msg += "Nu am putut asocia: " + notMatched.join(", ");
      }
      alert(msg);
      if (ocrBtn) {
        ocrBtn.disabled = false;
        ocrBtn.textContent = "✨ Proceseaza OCR si creeaza cerere";
      }
      programariState.ocrInProgress = false;
      return;
    }

    // 5. Build patient + items payload, save cerere with status='pending'
    if (ocrBtn) ocrBtn.textContent = "Se salveaza cererea...";
    var prenume = data.prenume || (p.nume_pacient || "").split(" ")[0] || "";
    var nume = data.nume || (p.nume_pacient || "").split(" ").slice(1).join(" ") || "";

    // Use same column names as saveCerere() — schema: total_lista_ron / total_final_ron / etc.
    var itemsForDb = matched.map(function(m) {
      var detalii = (typeof getDetails === "function") ? getDetails(m.offer.Laborator, m.displayName) : null;
      var finalP = (m.finalPriceComputed != null) ? m.finalPriceComputed : m.offer.Pret;
      return {
        denumire: m.displayName,
        laborator: m.offer.Laborator,
        pret_lista: m.offer.Pret,
        pret_final: Math.round(finalP * 100) / 100,
        discount: m.offer.Pret > 0 ? Math.round((1 - finalP / m.offer.Pret) * 100) : 0,
        timp: (m.offer.Timp && m.offer.Timp !== "N/A") ? m.offer.Timp : null,
        categorie: (m.offer.Categorie && m.offer.Categorie !== "N/A") ? m.offer.Categorie : null,
        detalii: detalii ? {
          recipient: detalii.Recipient || null,
          culoareDop: detalii.CuloareDop || null,
          materialBiologic: detalii.MaterialBiologic || null,
          cantitateMinima: detalii.CantitateMinima || null,
          laboratorSubcontractant: detalii.LaboratorSubcontractant || null,
          observatii: detalii.Observatii || null
        } : null
      };
    });

    // Compute totals + group by laborator
    var totalLista = 0, totalFinal = 0;
    var labMap = {};
    for (var ix = 0; ix < itemsForDb.length; ix++) {
      var it = itemsForDb[ix];
      totalLista += Number(it.pret_lista) || 0;
      totalFinal += Number(it.pret_final) || 0;
      var lab = it.laborator || "Necunoscut";
      if (!labMap[lab]) labMap[lab] = { laborator: lab, numar_analize: 0, subtotal_lista: 0, subtotal_final: 0 };
      labMap[lab].numar_analize++;
      labMap[lab].subtotal_lista += Number(it.pret_lista) || 0;
      labMap[lab].subtotal_final += Number(it.pret_final) || 0;
    }
    var groupsForDb = Object.keys(labMap).map(function(k) {
      var g = labMap[k];
      g.economie = g.subtotal_lista - g.subtotal_final;
      return g;
    });

    // Build a fake "report" obj for buildEprubetSummary (it expects items[].offer.Laborator + displayName)
    var reportItems = matched.map(function(m) {
      return { offer: m.offer, displayName: m.displayName };
    });
    var eprubeteSummary = (typeof buildEprubetSummary === "function") ? buildEprubetSummary(reportItems) : [];
    var totalEprubete = 0;
    var eprubeteDb = eprubeteSummary.map(function(e) {
      totalEprubete += e.count;
      return { tip: e.tip, bucati: e.count, pentruLocatii: e.breakdown };
    });

    var payload = {
      pacient_prenume: prenume,
      pacient_nume: nume,
      cnp_pacient: data.cnp || null,
      pacient_email: data.email || p.email_pacient || null,
      pacient_telefon_prefix: (data.telefon || p.telefon_pacient) ? "+40" : null,
      pacient_telefon_numar: data.telefon ? String(data.telefon).replace(/[\s\-\.]/g, "").replace(/^(\+40|0040|0)/, "") : (p.telefon_pacient || null),
      user_id: window.__CURRENT_USER__ ? window.__CURRENT_USER__.id : null,
      user_email: window.__CURRENT_USER__ ? window.__CURRENT_USER__.email : null,
      numar_analize: itemsForDb.length,
      numar_laboratoare: groupsForDb.length,
      numar_eprubete: totalEprubete,
      total_lista_ron: Math.round(totalLista * 100) / 100,
      total_final_ron: Math.round(totalFinal * 100) / 100,
      economie_ron: Math.round((totalLista - totalFinal) * 100) / 100,
      items: itemsForDb,
      groups: groupsForDb,
      eprubete: eprubeteDb,
      discounts: (typeof discounts !== "undefined") ? Object.assign({}, discounts) : {},
      status: "pending",
      programare_id: p.id
    };

    var insertRes = await window.sb.from("cc_cereri").insert([payload]).select().single();
    if (insertRes.error) throw new Error("Eroare salvare cerere: " + insertRes.error.message);

    var newCerereId = insertRes.data.id;

    // 6. Update programare with cerere_id + status
    var updRes = await window.sb.from("cc_programari")
      .update({ status: "ocr_processed", cerere_id: newCerereId })
      .eq("id", p.id);
    if (updRes.error) console.warn("[programari] Update status failed:", updRes.error);

    // Refresh & close
    alert("OCR procesat cu succes!\n\nAnalize gasite: " + matched.length + "\nCerere creata: #" + newCerereId + " (status: pending)\n\nCererea apare acum si in tab-ul Istoric. Cand pacientul vine, deschide cererea, verifica datele, si apasa Proceseaza cererea.");
    closeProgramareModal();
    await loadProgramari();
  } catch (e) {
    console.error("[programari] OCR error:", e);
    alert("Eroare la procesarea OCR: " + (e.message || e));
    if (ocrBtn) {
      ocrBtn.disabled = false;
      ocrBtn.textContent = "✨ Proceseaza OCR si creeaza cerere";
    }
  } finally {
    programariState.ocrInProgress = false;
  }
}

function blobToBase64(blob) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() {
      // data:image/jpeg;base64,XXXXX → strip prefix
      var result = reader.result;
      var base64 = result.indexOf(",") >= 0 ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = function() { reject(new Error("Read error")); };
    reader.readAsDataURL(blob);
  });
}

// Open the saved pending cerere in the cart
async function openCerereFromProgramare(cerereId) {
  if (!cerereId) return;
  try {
    var res = await window.sb.from("cc_cereri").select("*").eq("id", cerereId).single();
    if (res.error) throw new Error(res.error.message);
    var c = res.data;
    // Reuse the same loader used from Istoric — handles normName/addToCart correctly
    _loadPendingIntoCart(c);
    closeProgramareModal();
    // _loadPendingIntoCart already calls switchView("cart")
  } catch (e) {
    alert("Eroare la incarcare cerere: " + (e.message || e));
  }
}

async function cancelProgramare(p) {
  if (!confirm("Sigur vrei sa anulezi aceasta programare?")) return;
  try {
    var res = await window.sb.from("cc_programari")
      .update({ status: "cancelled" })
      .eq("id", p.id);
    if (res.error) throw new Error(res.error.message);
    closeProgramareModal();
    await loadProgramari();
  } catch (e) {
    alert("Eroare: " + (e.message || e));
  }
}

function editProgramare(p) {
  closeProgramareModal();
  // Open Add modal in edit mode
  openAddProgramareModal(p);
}

// Modal: Add (or edit) programare manually
function openAddProgramareModal(existing) {
  var modal = document.getElementById("addProgramareModal");
  var emailEl = document.getElementById("addProgEmail");
  var numeEl = document.getElementById("addProgNume");
  var telEl = document.getElementById("addProgTelefon");
  var dataEl = document.getElementById("addProgData");
  var servEl = document.getElementById("addProgServiciu");
  var docEl = document.getElementById("addProgDoctor");
  var noteEl = document.getElementById("addProgNote");
  var errEl = document.getElementById("addProgError");
  var saveBtn = document.getElementById("addProgSave");

  errEl.classList.remove("visible");
  errEl.textContent = "";

  if (existing) {
    window.__editingProgramareId = existing.id;
    document.querySelector("#addProgramareModal .modal-title").textContent = "Editeaza programare";
    saveBtn.textContent = "Salveaza modificari";
    emailEl.value = existing.email_pacient || "";
    numeEl.value = existing.nume_pacient || "";
    telEl.value = existing.telefon_pacient || "";
    // Convert ISO to local datetime-local format
    if (existing.data_programare) {
      var d = new Date(existing.data_programare);
      var pad = function(n) { return String(n).padStart(2, "0"); };
      dataEl.value = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
    } else {
      dataEl.value = "";
    }
    servEl.value = existing.tip_serviciu || "Recoltare analize";
    docEl.value = existing.nume_doctor || "";
    noteEl.value = existing.note || "";
  } else {
    window.__editingProgramareId = null;
    document.querySelector("#addProgramareModal .modal-title").textContent = "Adauga programare";
    saveBtn.textContent = "Adauga programare";
    emailEl.value = "";
    numeEl.value = "";
    telEl.value = "";
    dataEl.value = "";
    servEl.value = "Recoltare analize";
    docEl.value = "";
    noteEl.value = "";
  }

  modal.classList.add("visible");
}

function closeAddProgramareModal() {
  document.getElementById("addProgramareModal").classList.remove("visible");
  window.__editingProgramareId = null;
}

async function saveProgramareManual() {
  var emailEl = document.getElementById("addProgEmail");
  var numeEl = document.getElementById("addProgNume");
  var telEl = document.getElementById("addProgTelefon");
  var dataEl = document.getElementById("addProgData");
  var servEl = document.getElementById("addProgServiciu");
  var docEl = document.getElementById("addProgDoctor");
  var noteEl = document.getElementById("addProgNote");
  var errEl = document.getElementById("addProgError");
  var saveBtn = document.getElementById("addProgSave");

  var email = emailEl.value.trim();
  var data = dataEl.value;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEl.textContent = "Email valid e obligatoriu.";
    errEl.classList.add("visible");
    return;
  }
  if (!data) {
    errEl.textContent = "Data programarii e obligatorie.";
    errEl.classList.add("visible");
    return;
  }

  errEl.classList.remove("visible");
  saveBtn.disabled = true;
  var origText = saveBtn.textContent;
  saveBtn.textContent = "Se salveaza...";

  try {
    // Try to link to existing pacient by email
    var pacient_id = null;
    try {
      var pacRes = await window.sb.from("pacienti").select("id").eq("email", email).maybeSingle();
      if (pacRes.data) pacient_id = pacRes.data.id;
    } catch (e) { /* ignore */ }

    var payload = {
      email_pacient: email,
      nume_pacient: numeEl.value.trim() || null,
      telefon_pacient: telEl.value.trim() || null,
      data_programare: new Date(data).toISOString(),
      tip_serviciu: servEl.value.trim() || "Recoltare analize",
      nume_doctor: docEl.value.trim() || null,
      note: noteEl.value.trim() || null,
      pacient_id: pacient_id
    };

    var res;
    if (window.__editingProgramareId) {
      res = await window.sb.from("cc_programari")
        .update(payload)
        .eq("id", window.__editingProgramareId)
        .select();
    } else {
      res = await window.sb.from("cc_programari").insert([payload]).select();
    }
    if (res.error) throw new Error(res.error.message);

    closeAddProgramareModal();
    await loadProgramari();
  } catch (e) {
    errEl.textContent = "Eroare: " + (e.message || e);
    errEl.classList.add("visible");
  }
  saveBtn.disabled = false;
  saveBtn.textContent = origText;
}

// Wire up programari module
(function() {
  // Filter buttons
  var filterBtns = document.querySelectorAll(".prog-filter-btn");
  for (var i = 0; i < filterBtns.length; i++) {
    (function(btn) {
      btn.addEventListener("click", function() {
        programariState.filter = btn.getAttribute("data-prog-filter");
        // Update active state
        for (var k = 0; k < filterBtns.length; k++) filterBtns[k].classList.remove("active");
        btn.classList.add("active");
        renderProgramari();
      });
    })(filterBtns[i]);
  }

  // Modal close
  var modalClose = document.getElementById("programareModalClose");
  if (modalClose) modalClose.addEventListener("click", closeProgramareModal);
  var modal = document.getElementById("programareModal");
  if (modal) modal.addEventListener("click", function(e) {
    if (e.target === modal) closeProgramareModal();
  });

  // Add programare manual
  var btnAdd = document.getElementById("btnAddProgramare");
  if (btnAdd) btnAdd.addEventListener("click", function() { openAddProgramareModal(null); });
  var addClose = document.getElementById("addProgramareClose");
  if (addClose) addClose.addEventListener("click", closeAddProgramareModal);
  var addCancel = document.getElementById("addProgCancel");
  if (addCancel) addCancel.addEventListener("click", closeAddProgramareModal);
  var addSave = document.getElementById("addProgSave");
  if (addSave) addSave.addEventListener("click", saveProgramareManual);
  var addModal = document.getElementById("addProgramareModal");
  if (addModal) addModal.addEventListener("click", function(e) {
    if (e.target === addModal) closeAddProgramareModal();
  });
})();

// ════════════════════════════════════════════════════════════════
// Open a PENDING cerere from istoric/programari directly in cart
// ════════════════════════════════════════════════════════════════
function openPendingCerereInCart(cerereId) {
  var c = istoricState.cereri.find(function(x){ return x.id === cerereId; });
  if (!c) {
    // Maybe it was just created via programari - fetch fresh
    window.sb.from("cc_cereri").select("*").eq("id", cerereId).single().then(function(res) {
      if (res.error || !res.data) {
        alert("Cerere negasita: " + (res.error ? res.error.message : "necunoscuta"));
        return;
      }
      _loadPendingIntoCart(res.data);
    });
    return;
  }
  _loadPendingIntoCart(c);
}

function _loadPendingIntoCart(c) {
  // Mark this cerere as the pending one to update on save
  window.__loadedPendingCerereId = c.id;
  window.__loadedPendingProgId = c.programare_id || null;

  // Extract CC discount from cerere.discounts (saved by pacient when creating pending)
  var ccDisc = 0;
  if (c.discounts && typeof c.discounts === "object") {
    ccDisc = Number(c.discounts.cc_discount_pct) || 0;
  }
  cartState.ccDiscountPct = ccDisc;
  console.log("[loadPending] CC discount from cerere:", ccDisc, "%");
  // Pre-bifează CAS din cererea clientului (adminul poate debifa)
  cartState.is_cas = !!c.is_cas;

  // Fill patient
  prenumeInput.value = c.pacient_prenume || "";
  numeInput.value = c.pacient_nume || "";
  cnpInput.value = c.cnp_pacient || "";
  emailInput.value = c.pacient_email || "";
  if (telefonPrefixSelect) telefonPrefixSelect.value = c.pacient_telefon_prefix || "+40";
  telefonNumarInput.value = c.pacient_telefon_numar || "";

  cartState.prenume = c.pacient_prenume || "";
  cartState.nume = c.pacient_nume || "";
  cartState.cnp = c.cnp_pacient || "";
  cartState.email = c.pacient_email || "";
  cartState.telefonPrefix = c.pacient_telefon_prefix || "+40";
  cartState.telefonNumar = c.pacient_telefon_numar || "";

  // Rebuild cart
  cartState.cart = [];
  var notFound = [];
  var items = c.items || [];
  for (var i = 0; i < items.length; i++) {
    var den = items[i].denumire;
    var lab = items[i].laborator;
    var key = normName(den);
    var entry = ANALIZE_INDEX[key];
    if (entry) {
      // Try to find exact lab match, else cheapest
      var offers = entry.offers || [];
      var match = null;
      for (var k = 0; k < offers.length; k++) {
        if (offers[k].Laborator === lab) { match = offers[k]; break; }
      }
      if (match) {
        addToCart(key, match.Laborator);
      } else {
        var best = cheapestOffer(entry);
        if (best.offer) addToCart(key, best.offer.Laborator);
        else notFound.push(den);
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
    alert("Atentie: " + notFound.length + " analize din cererea pending nu au fost gasite in catalog: " + notFound.join(", "));
  }
}
