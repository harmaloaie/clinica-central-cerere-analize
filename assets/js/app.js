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

function getDetails(lab, denumire) {
  var map = DETAILS[lab];
  if (!map) return null;
  return map[normName(denumire)] || null;
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
  var tabs = document.querySelectorAll(".topbar-tab");
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    var isActive = t.getAttribute("data-view") === name;
    t.classList.toggle("active", isActive);
    t.setAttribute("aria-selected", isActive ? "true" : "false");
  }
  if (name === "cart") {
    // If CNP already valid and search enabled, focus search; else CNP
    if (!cartState.cnpValid) cnpInput.focus();
    else cartSearchInput.focus();
  } else {
    document.getElementById("q").focus();
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

var cartState = { cart: [], cnp: "", cnpValid: false };

var cnpInput = document.getElementById("cnpInput");
var cnpStatus = document.getElementById("cnpStatus");
var cnpError = document.getElementById("cnpError");
var cartSearchInput = document.getElementById("cartSearchInput");
var cartSuggestionsEl = document.getElementById("cartSuggestions");
var cartEmptyHintEl = document.getElementById("cartEmptyHint");
var cartListEl = document.getElementById("cartList");
var cartCountEl = document.getElementById("cartCount");
var cartTotalEl = document.getElementById("cartTotal");
var cartEmptyEl = document.getElementById("cartEmpty");
var btnProcess = document.getElementById("btnProcess");

// ─── CNP ───
function isCnpValid(s) { return /^\d{13}$/.test(s); }

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

  cartState.cnpValid = isCnpValid(digits);
  cartSearchInput.disabled = !cartState.cnpValid;
  if (cartState.cnpValid) {
    cartSearchInput.placeholder = "Ex: TSH, hemoleucograma, vitamina D...";
  } else {
    cartSearchInput.placeholder = "Introdu CNP-ul mai intai...";
    if (cartSearchInput.value) {
      cartSearchInput.value = "";
      cartSuggestionsEl.classList.remove("visible");
      cartEmptyHintEl.style.display = "block";
    }
  }
}
cnpInput.addEventListener("input", updateCnpUi);
cnpInput.addEventListener("blur", updateCnpUi);

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
    html += '<div class="suggestion-price">' + fp + '<small>' + (disc > 0 ? "cu " + disc + "% disc" : "RON") + '</small></div>';
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
    closeReport();
    closeDetailsModal();
  }
});

function buildReport() {
  var items = [], grandTotal = 0, grandListTotal = 0;
  for (var i = 0; i < cartState.cart.length; i++) {
    var c = cartState.cart[i];
    if (!c.offer) continue;
    var fp = finalPrice(c.offer.Pret, c.offer.Laborator);
    grandTotal += fp;
    grandListTotal += c.offer.Pret;
    items.push({
      key: c.key,
      displayName: c.displayName,
      offer: c.offer,
      finalPrice: fp,
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
  statsHtml += '<div class="report-stat"><span class="report-stat-num">' + (r.grandListTotal - r.grandTotal) + '</span><span class="report-stat-label">RON economisiti</span></div>';
  document.getElementById("reportStats").innerHTML = statsHtml;

  document.getElementById("reportPatient").innerHTML =
    '<span class="label">Pacient CNP</span><strong>' + esc(cartState.cnp) + '</strong>';

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
      body += '<div class="lab-group-item-price">' + it.finalPrice + ' RON';
      if (it.discount > 0) {
        body += '<span class="lab-group-item-price-orig">' + it.offer.Pret.toFixed(0) + ' RON</span>';
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
  body += '<button class="report-btn primary" id="btnExportReport">&#11015; Export Excel</button>';
  body += '<button class="report-btn" id="btnExportJson">&#11015; Export JSON</button>';
  body += '<button class="report-btn" id="btnCloseReport">Inchide</button>';
  body += '</div>';

  document.getElementById("reportBody").innerHTML = body;
  document.getElementById("reportOverlay").classList.add("visible");
  document.body.style.overflow = "hidden";

  document.getElementById("btnCloseReport").addEventListener("click", closeReport);
  document.getElementById("btnExportReport").addEventListener("click", function() { exportReportXlsx(r); });
  document.getElementById("btnExportJson").addEventListener("click", function() { exportReportJson(r); });
}
function closeReport() {
  document.getElementById("reportOverlay").classList.remove("visible");
  document.body.style.overflow = "";
}

function exportReportXlsx(r) {
  var rows = [];
  rows.push({ "Laborator": "CERERE ANALIZE" });
  rows.push({ "Laborator": "CNP pacient:", "Denumire Analiza": cartState.cnp });
  rows.push({ "Laborator": "Data generare:", "Denumire Analiza": new Date().toLocaleString("ro-RO") });
  rows.push({});
  for (var g = 0; g < r.groups.length; g++) {
    var grp = r.groups[g];
    for (var i = 0; i < grp.items.length; i++) {
      var it = grp.items[i];
      var d = getDetails(grp.lab, it.displayName);
      rows.push({
        "CNP pacient": cartState.cnp,
        "Laborator": grp.lab,
        "Denumire Analiza": it.displayName,
        "Eprubeta / Recipient": d ? fmtRecipient(d) : "",
        "Material biologic": d && d.MaterialBiologic ? d.MaterialBiologic : "",
        "Cantitate": d && d.CantitateMinima ? d.CantitateMinima : "",
        "Se trimite la": d && d.LaboratorSubcontractant ? d.LaboratorSubcontractant : "",
        "Observatii": d && d.Observatii ? d.Observatii : "",
        "Timp Executie": it.offer.Timp !== "N/A" ? it.offer.Timp : "",
        "Pret Lista (RON)": it.offer.Pret,
        "Discount (%)": it.discount,
        "Pret Final (RON)": it.finalPrice,
        "Economie (RON)": it.offer.Pret - it.finalPrice
      });
    }
    rows.push({ "CNP pacient": "", "Laborator": grp.lab + " — Subtotal", "Denumire Analiza": "", "Eprubeta / Recipient": "", "Material biologic": "", "Cantitate": "", "Se trimite la": "", "Observatii": "", "Timp Executie": "", "Pret Lista (RON)": grp.listTotal, "Discount (%)": "", "Pret Final (RON)": grp.total, "Economie (RON)": grp.listTotal - grp.total });
    rows.push({});
  }
  rows.push({ "CNP pacient": "", "Laborator": "TOTAL GENERAL", "Denumire Analiza": "", "Eprubeta / Recipient": "", "Material biologic": "", "Cantitate": "", "Se trimite la": "", "Observatii": "", "Timp Executie": "", "Pret Lista (RON)": r.grandListTotal, "Discount (%)": "", "Pret Final (RON)": r.grandTotal, "Economie (RON)": r.grandListTotal - r.grandTotal });

  var ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{wch:15},{wch:22},{wch:45},{wch:34},{wch:18},{wch:14},{wch:28},{wch:40},{wch:18},{wch:14},{wch:10},{wch:14},{wch:12}];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cerere analize");

  // ─── Sheet 2: Eprubete summary ───
  var eprubeteForExcel = buildEprubetSummary(r.items);
  if (eprubeteForExcel.length > 0) {
    var eRows = [];
    eRows.push({ "Tip eprubeta": "REZUMAT EPRUBETE NECESARE" });
    eRows.push({ "Tip eprubeta": "CNP pacient:", "Total bucati": cartState.cnp });
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
  var fn = "cerere_analize_" + cartState.cnp + "_" + date.getFullYear() + "-" + String(date.getMonth()+1).padStart(2,"0") + "-" + String(date.getDate()).padStart(2,"0") + ".xlsx";
  XLSX.writeFile(wb, fn);
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
  var out = {
    generatedAt: now.toISOString(),
    cnpPacient: cartState.cnp,
    summary: {
      totalAnalize: r.items.length,
      totalLaboratoare: r.groups.length,
      totalListRON: r.grandListTotal,
      totalFinalRON: r.grandTotal,
      economieRON: r.grandListTotal - r.grandTotal,
      totalEprubete: totalEprubete
    },
    eprubete: eprubeteForJson,
    discountsApplied: Object.assign({}, discounts),
    groups: r.groups.map(function(g) {
      return {
        laborator: g.lab,
        numarAnalize: g.items.length,
        subtotalListRON: g.listTotal,
        subtotalFinalRON: g.total,
        economieRON: g.listTotal - g.total,
        analize: g.items.map(function(it) {
          var d = getDetails(g.lab, it.displayName);
          var entry = {
            denumire: it.displayName,
            pretLista: it.offer.Pret,
            pretFinal: it.finalPrice,
            discountPct: it.discount,
            economieRON: it.offer.Pret - it.finalPrice,
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
  a.download = "cerere_analize_" + cartState.cnp + "_" + now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0") + "-" + String(now.getDate()).padStart(2,"0") + ".json";
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
  h += '<th data-col="Pret" class="price-col">Pret</th>';
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
    h += '<td data-label="Pret" class="price-cell' + (isBest ? " cheapest" : "") + '">';
    h += '<span class="price-final">' + fp.toFixed(0) + ' RON</span>';
    if (discPct(r.Laborator) > 0) h += '<span class="price-orig">' + r.Pret.toFixed(0) + ' RON</span>';
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
    "1. **CNP-ul pacientului** (13 cifre) — cauta in campul 'CID/CNP/CE/PASS'\n" +
    "2. **Lista analizelor medicale** recomandate (coloana 'Investigatii recomandate')\n\n" +
    "Pentru fiecare analiza, returneaza EXACT textul asa cum e scris pe bilet (chiar daca are typo-uri sau abrevieri).\n\n" +
    "Raspunde DOAR cu JSON valid, fara alte comentarii, fara code blocks. Format:\n" +
    "{\n" +
    '  "cnp": "string 13 cifre sau null daca nu e clar",\n' +
    '  "analize": ["denumire analiza 1", "denumire analiza 2", ...]\n' +
    "}\n\n" +
    "Daca biletul nu e lizibil sau nu e un bilet medical, returneaza { \"cnp\": null, \"analize\": [] }.";

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
  // Strip code fences if Claude added them anyway
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
cnpInput.focus();
