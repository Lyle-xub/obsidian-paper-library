// Paper Library Web Importer — page detector
// Runs only in the current web page. It extracts bibliographic metadata and,
// when requested, downloads a same-site PDF with the user's login session.

(function paperLibraryDetector() {
  "use strict";

  const PDF_URL_PATTERNS = [
    /\.pdf(?:$|[?#])/i,
    /\/pdf(?:\/|$)/i,
    /\/doi\/(?:e?pdf)\//i,
    /\/content\/pdf\//i,
    /\/stamp(?:PDF)?\/.*\.jsp/i,
    /pdfft/i,
    /arxiv\.org\/pdf\//i
  ];

  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function absoluteUrl(value) {
    if (!value) return "";
    try { return new URL(value, location.href).href; }
    catch (_) { return ""; }
  }

  function looksLikePdfUrl(value) {
    const url = String(value || "");
    return PDF_URL_PATTERNS.some((pattern) => pattern.test(url));
  }

  function normalizePublisherPdfUrl(value) {
    const resolved = absoluteUrl(value);
    if (!resolved) return "";
    try {
      const url = new URL(resolved);
      if (/^(?:www\.)?ieeexplore\.ieee\.org$/i.test(url.hostname)) {
        const articleNumber = url.searchParams.get("arnumber")
          || url.pathname.match(/\/document\/(\d+)/i)?.[1]
          || location.pathname.match(/\/document\/(\d+)/i)?.[1];
        // `stamp/stamp.jsp` is an HTML viewer shell. A normal click continues
        // to getPDF.jsp, but fetch/download APIs otherwise save the shell and
        // the extension mistakes it for a login page.
        if (articleNumber && (/\/stamp\/stamp\.jsp/i.test(url.pathname)
          || /\/document\/\d+/i.test(url.pathname))) {
          return `https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=${articleNumber}&ref=`;
        }
      }
    } catch (_) { /* return original */ }
    return resolved;
  }

  function meta(name) {
    const escaped = globalThis.CSS?.escape ? CSS.escape(name) : name.replace(/["\\]/g, "\\$&");
    const element = document.querySelector(`meta[name="${escaped}"], meta[property="${escaped}"]`);
    return clean(element?.getAttribute("content"));
  }

  function metaAll(name) {
    const escaped = globalThis.CSS?.escape ? CSS.escape(name) : name.replace(/["\\]/g, "\\$&");
    return [...document.querySelectorAll(`meta[name="${escaped}"], meta[property="${escaped}"]`)]
      .map((element) => clean(element.getAttribute("content")))
      .filter(Boolean);
  }

  function first(...values) {
    return values.flat(Infinity).map(clean).find(Boolean) || "";
  }

  function flattenJsonLd(value, output = []) {
    if (!value) return output;
    if (Array.isArray(value)) {
      value.forEach((entry) => flattenJsonLd(entry, output));
      return output;
    }
    if (typeof value !== "object") return output;
    if (value["@graph"]) flattenJsonLd(value["@graph"], output);
    output.push(value);
    return output;
  }

  function readJsonLd() {
    const records = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((element) => {
      try { flattenJsonLd(JSON.parse(element.textContent || "null"), records); }
      catch (_) { /* malformed publisher JSON-LD */ }
    });
    const scholarlyTypes = /scholarlyarticle|article|techarticle|report|chapter|creativework/i;
    return records.find((record) => scholarlyTypes.test([record?.["@type"]].flat().join(" ")))
      || records.find((record) => record?.headline && record?.author)
      || null;
  }

  function jsonLdAuthors(record) {
    return [record?.author].flat().filter(Boolean).map((author) => (
      clean(typeof author === "string" ? author : author?.name)
    )).filter(Boolean);
  }

  function jsonLdVenue(record) {
    const container = record?.isPartOf;
    return first(
      container?.name,
      container?.isPartOf?.name,
      record?.publisher?.name,
      typeof record?.publisher === "string" ? record.publisher : ""
    );
  }

  function identifierValues(record) {
    return [record?.identifier].flat().filter(Boolean).map((identifier) => (
      typeof identifier === "string"
        ? identifier
        : first(identifier?.value, identifier?.propertyID && identifier?.value)
    ));
  }

  function normalizeDoi(value) {
    const match = clean(value).match(/(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}\/\S+)/i);
    return match ? decodeURIComponent(match[1]).replace(/[).,;]+$/, "") : "";
  }

  function detectDoi(record) {
    const values = [
      meta("citation_doi"), meta("dc.identifier"), meta("dc.identifier.doi"),
      meta("prism.doi"), ...identifierValues(record), record?.sameAs, record?.url,
      location.href
    ].flat();
    return values.map(normalizeDoi).find(Boolean) || "";
  }

  function detectArxiv(record) {
    const values = [location.href, record?.url, record?.sameAs, ...identifierValues(record)];
    for (const value of values) {
      const match = String(value || "").match(/(?:arxiv(?:\.org\/(?:abs|pdf)\/|:)|10\.48550\/arxiv\.)(\d{4}\.\d{4,5}(?:v\d+)?)/i);
      if (match) return match[1];
    }
    return "";
  }

  function parseYear(value) {
    const year = String(value || "").match(/(?:19|20)\d{2}/)?.[0];
    return year ? Number(year) : 0;
  }

  function jsonLdPdfUrl(record) {
    const candidates = [record?.encoding, record?.associatedMedia, record?.distribution].flat().filter(Boolean);
    for (const candidate of candidates) {
      const url = absoluteUrl(typeof candidate === "string"
        ? candidate
        : first(candidate?.contentUrl, candidate?.url));
      const type = clean(candidate?.fileFormat || candidate?.encodingFormat);
      if (url && (looksLikePdfUrl(url) || /application\/pdf/i.test(type))) return url;
    }
    return "";
  }

  function findPdfUrl(record, arxiv) {
    const direct = first(
      meta("citation_pdf_url"),
      meta("wkhealth_pdf_url"),
      jsonLdPdfUrl(record)
    );
    if (direct) return normalizePublisherPdfUrl(direct);
    if (document.contentType === "application/pdf" || looksLikePdfUrl(location.href)) return location.href;
    if (arxiv) return `https://arxiv.org/pdf/${arxiv}`;

    const selectors = [
      'link[type="application/pdf"][href]',
      'link[rel="alternate"][href$=".pdf"]',
      'a[href$=".pdf"]', 'a[href*=".pdf?"]',
      'a[href*="/doi/pdf/"]', 'a[href*="/doi/epdf/"]',
      'a[href*="content/pdf/"]', 'a[href*="stamp.jsp"]',
      'a[href*="stampPDF/getPDF.jsp"]', 'a[href*="pdfft"]',
      'a[data-track-action*="pdf" i]', 'a[data-ga-action*="pdf" i]',
      'iframe[src]', 'embed[src]', 'object[data]'
    ];
    for (const element of document.querySelectorAll(selectors.join(","))) {
      const candidate = absoluteUrl(element.getAttribute("href")
        || element.getAttribute("src") || element.getAttribute("data"));
      if (candidate && looksLikePdfUrl(candidate)) return normalizePublisherPdfUrl(candidate);
    }

    const labelled = [...document.querySelectorAll("a[href], button")].find((element) => (
      /(?:view|read|download|full[ -]?text)?\s*pdf/i.test(clean(element.textContent))
      && looksLikePdfUrl(element.getAttribute("href") || element.dataset?.href || "")
    ));
    const labelledUrl = normalizePublisherPdfUrl(labelled?.getAttribute("href") || labelled?.dataset?.href);
    if (labelledUrl) return labelledUrl;
    const ieeeArticleNumber = location.hostname === "ieeexplore.ieee.org"
      ? location.pathname.match(/\/document\/(\d+)/i)?.[1]
      : "";
    return ieeeArticleNumber
      ? `https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=${ieeeArticleNumber}&ref=`
      : "";
  }

  function collectPaper() {
    const record = readJsonLd();
    const isPdfPage = document.contentType === "application/pdf" || looksLikePdfUrl(location.href);
    const arxiv = detectArxiv(record);
    const rawTitle = first(
      meta("citation_title"), meta("dc.title"), record?.headline, record?.name,
      meta("og:title"), isPdfPage ? "" : document.title
    );
    const title = /^(?:pdf|full[ -]?text pdf|download pdf)$/i.test(rawTitle) ? "" : rawTitle;
    const citationAuthors = metaAll("citation_author");
    const dcAuthors = [...metaAll("dc.creator"), ...metaAll("dc.creator.personalname")];
    const date = first(
      meta("citation_publication_date"), meta("citation_online_date"), meta("citation_date"),
      meta("prism.publicationDate"), meta("dc.date"), record?.datePublished, record?.dateCreated
    );
    const pdfUrl = findPdfUrl(record, arxiv);
    return {
      url: location.href,
      title,
      authors: citationAuthors.length ? citationAuthors : (dcAuthors.length ? dcAuthors : jsonLdAuthors(record)),
      year: parseYear(date),
      venue: first(
        meta("citation_conference_title"), meta("citation_journal_title"),
        meta("prism.publicationName"), jsonLdVenue(record), meta("og:site_name")
      ),
      journalAbbreviation: meta("citation_journal_abbrev"),
      volume: first(meta("citation_volume"), meta("prism.volume")),
      issue: first(meta("citation_issue"), meta("prism.number")),
      pages: first(
        meta("citation_firstpage") && meta("citation_lastpage")
          ? `${meta("citation_firstpage")}-${meta("citation_lastpage")}` : "",
        meta("prism.pageRange"), meta("prism.startingPage")
      ),
      abstract: first(meta("citation_abstract"), meta("dc.description"), record?.abstract, record?.description, meta("description")),
      doi: detectDoi(record),
      arxiv,
      pdfUrl,
      isPdfPage,
      site: location.hostname,
      accessHint: pdfUrl ? "direct" : "unknown"
    };
  }

  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  async function fetchPdf(url) {
    try {
      const response = await fetch(absoluteUrl(url) || url, { credentials: "include", redirect: "follow" });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, reason: "needs-login", status: response.status };
      }
      if (!response.ok) return { ok: false, reason: "http", status: response.status };
      const buffer = await response.arrayBuffer();
      const header = String.fromCharCode(...new Uint8Array(buffer.slice(0, 5)));
      if (header !== "%PDF-") {
        return { ok: false, reason: "needs-login", contentType: response.headers.get("content-type") || "" };
      }
      return { ok: true, base64: bufferToBase64(buffer) };
    } catch (error) {
      return { ok: false, reason: "network", error: String(error?.message || error) };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === "paperlib:detect") {
      respond(collectPaper());
      return false;
    }
    if (message?.type === "paperlib:fetch-pdf") {
      fetchPdf(message.url).then(respond).catch((error) => respond({ ok: false, reason: "error", error: String(error) }));
      return true;
    }
    return false;
  });
})();
