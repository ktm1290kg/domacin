/* Zajednički runtime za sve landing strane: merenje (PostHog), CTA klikovi, forma za narudžbine (Supabase RPC).
   Strana definiše window.LAB = {cfg:{...}, product:{slug,name,price}} pre učitavanja ovog fajla. */
(function () {
  "use strict";
  var LAB = window.LAB || {}; var CFG = LAB.cfg || {}; var P = LAB.product || {};
  var q = [];
  function track(ev, props) {
    var p = Object.assign({ product: P.slug, product_name: P.name }, props || {});
    if (window.posthog && window.posthog.__loaded) { try { posthog.capture(ev, p); } catch (e) {} } else q.push([ev, p]);
  }
  window.labTrack = track;
  function phReady() {
    if (!window.posthog || !CFG.posthog_token) return;
    try {
      posthog.init(CFG.posthog_token, { api_host: CFG.posthog_host, defaults: "2025-05-24", person_profiles: "identified_only", capture_pageview: true });
      posthog.register({ product: P.slug, product_name: P.name });
      q.forEach(function (x) { posthog.capture(x[0], x[1]); }); q = [];
    } catch (e) {}
  }
  if (CFG.posthog_token && CFG.posthog_host) {
    var s = document.createElement("script"); s.async = true; s.crossOrigin = "anonymous";
    s.src = CFG.posthog_host.replace(".i.posthog.com", "-assets.i.posthog.com") + "/static/array.js";
    s.onload = phReady; document.head.appendChild(s);
  }
  function utm() {
    var out = {}, sp = new URLSearchParams(location.search);
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"].forEach(function (k) { if (sp.get(k)) out[k] = sp.get(k); });
    return out;
  }
  var fmt = function (n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " "); };

  function ready(fn) { if (document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  ready(function () {
    document.querySelectorAll("[data-cta]").forEach(function (a) {
      a.addEventListener("click", function () { track("cta_click", { channel: a.getAttribute("data-cta"), place: a.getAttribute("data-place") || "" }); });
    });
    document.querySelectorAll("[data-faq] details").forEach(function (d) {
      d.addEventListener("toggle", function () { if (d.open) track("faq_open", { q: (d.querySelector("summary") || {}).textContent }); });
    });
    // galerija: klik na sličicu menja glavnu
    var main = document.querySelector("[data-gallery-main]");
    document.querySelectorAll("[data-gallery-thumb]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (main) { main.src = b.getAttribute("data-src"); main.alt = b.getAttribute("data-alt") || ""; }
        document.querySelectorAll("[data-gallery-thumb]").forEach(function (x) { x.setAttribute("aria-current", x === b ? "true" : "false"); });
        var cap = document.querySelector("[data-gallery-caption]"); if (cap) cap.textContent = b.getAttribute("data-alt") || "";
        track("gallery_click", { index: b.getAttribute("data-i") });
      });
    });

    var bar = document.querySelector("[data-bar]"), after = document.querySelector("[data-bar-after]");
    if (bar && after && "IntersectionObserver" in window) {
      bar.hidden = true;
      new IntersectionObserver(function (es) { bar.hidden = es[0].isIntersecting; }, { threshold: 0 }).observe(after);
    }

    var form = document.getElementById("orderForm"); if (!form) return;
    var qty = form.querySelector("[name=qty]"), total = document.getElementById("o_total"), msg = document.getElementById("o_msg"), submitBtn = form.querySelector("[type=submit]");
    if (qty && total) qty.addEventListener("change", function () { total.textContent = fmt(P.price * parseInt(qty.value, 10)) + " RSD"; });
    function show(kind, text) { msg.hidden = false; msg.className = "msg " + kind; msg.textContent = text; }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = function (n) { var el = form.querySelector("[name=" + n + "]"); return el ? el.value.trim() : ""; };
      var name = v("name"), phone = v("phone");
      if (name.length < 2) { show("err", "Upiši ime."); form.querySelector("[name=name]").focus(); return; }
      if (phone.replace(/\D/g, "").length < 6) { show("err", "Upiši telefon na koji možemo da te pozovemo."); form.querySelector("[name=phone]").focus(); return; }
      if (!CFG.supabase_url) { show("err", "Forma još nije uključena — pozovi nas ili piši na Viber."); return; }
      submitBtn.disabled = true; show("ok", "Šaljem…");
      var n = qty ? parseInt(qty.value, 10) : 1;
      var payload = { p: { product_slug: P.slug, product_name: P.name, qty: n, name: name, phone: phone, address: v("address"), note: v("note"), website: v("website"), utm: utm(), page_url: location.href, user_agent: navigator.userAgent } };
      fetch(CFG.supabase_url + "/rest/v1/rpc/lab_submit_order", {
        method: "POST", headers: { "Content-Type": "application/json", "apikey": CFG.supabase_key, "Authorization": "Bearer " + CFG.supabase_key },
        body: JSON.stringify(payload)
      }).then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function () {
        track("order_submitted", { qty: n, value_rsd: P.price * n });
        form.querySelectorAll("input,textarea,select,button").forEach(function (el) { el.disabled = true; });
        show("ok", "Hvala, " + name.split(" ")[0] + "! Narudžbina je stigla. Zovemo te na " + phone + " da potvrdimo, pa šaljemo.");
        if (window.fbq) { try { fbq("track", "Purchase", { value: P.price * n / (CFG.eur_rate || 117.5), currency: "EUR" }); } catch (e) {} }
        if (window.gtag && CFG.google_ads_tag && CFG.google_ads_conversion_label) { try { gtag("event", "conversion", { send_to: CFG.google_ads_tag + "/" + CFG.google_ads_conversion_label }); } catch (e) {} }
      })
      .catch(function (err) {
        submitBtn.disabled = false;
        track("order_failed", { error: String(err && err.message || err) });
        show("err", "Nije prošlo. Pozovi nas na " + (CFG.phone_display || "") + " ili piši na Viber/WhatsApp — rešićemo odmah.");
      });
    });
  });
})();
