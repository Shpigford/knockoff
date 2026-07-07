// ─────────────────────────────────────────────────────────────────────────────
// Knockoff product-detail-page brand extraction
//
// Amazon localizes the visible byline text ("Visit the ... Store",
// "Besuche den ...-Store", "Marca: ..."), but the byline link usually carries
// a stable brand signal. Prefer URL parameters, keep English text as a legacy
// fallback, and use /stores/<brand>/ as a final locale-agnostic fallback.
// ─────────────────────────────────────────────────────────────────────────────

var KnockoffPdp = (function () {
  "use strict";

  function cleanUrlBrand(s) {
    var decoded = (s || "").replace(/\+/g, " ");
    try {
      decoded = decodeURIComponent(decoded);
    } catch (e) {
      // Keep the original text if a marketplace ever emits a literal "%".
    }
    return decoded.replace(/[-_]+/g, " ").trim();
  }

  function bylineUrl(byline, baseHref) {
    var href = byline && byline.getAttribute ? byline.getAttribute("href") : "";
    if (!href) return null;
    try {
      return new URL(href, baseHref || location.href);
    } catch (e) {
      return null;
    }
  }

  function brandFromBylineBrandParam(url) {
    if (!url) return "";
    var brand = url.searchParams.get("field-brandtextbin");
    if (brand) return cleanUrlBrand(brand);
    var rh = url.searchParams.get("rh") || "";
    var m = rh.match(/(?:^|,)p_89:([^,]+)/);
    if (m) return cleanUrlBrand(m[1]);
    brand = url.searchParams.get("field-keywords");
    return brand ? cleanUrlBrand(brand) : "";
  }

  function brandFromBylineText(byline) {
    var text = (byline && byline.textContent || "").trim();
    // Legacy fallback for bylines whose href doesn't expose the brand:
    // "Brand: LATTOOK" or "Visit the LATTOOK Store".
    var m = text.match(/^(?:Brand:\s*|Visit the\s+)(.+?)(?:\s+Store)?$/);
    return m ? m[1].trim() : "";
  }

  function brandFromBylineStoreHref(url) {
    if (!url) return "";
    var parts = url.pathname.split("/").filter(Boolean);
    var stores = parts.indexOf("stores");
    if (stores >= 0 && parts[stores + 1] && !/^(?:page|storefront)$/i.test(parts[stores + 1])) {
      return cleanUrlBrand(parts[stores + 1]); // /stores/CACOE/page/...
    }
    return "";
  }

  function brandFromByline(byline, baseHref) {
    var url = bylineUrl(byline, baseHref);
    return brandFromBylineBrandParam(url) ||
      brandFromBylineText(byline) ||
      brandFromBylineStoreHref(url);
  }

  return {
    brandFromByline: brandFromByline,
    _test: {
      cleanUrlBrand: cleanUrlBrand,
      brandFromBylineBrandParam: brandFromBylineBrandParam,
      brandFromBylineText: brandFromBylineText,
      brandFromBylineStoreHref: brandFromBylineStoreHref
    }
  };
})();
