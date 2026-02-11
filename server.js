#!/usr/bin/env node
/**
 * Full-Text RSS Feed Server for SocialBee
 * ─────────────────────────────────────────
 * Fetches Shopify blog articles via the native Atom feed,
 * then outputs a CLEAN RSS 2.0 feed with:
 *   ✅ Full article HTML inside <description> (CDATA-wrapped)
 *   ❌ No <content:encoded>
 *   ❌ No proxy CDN
 *   ❌ No external namespaces
 *
 * Usage:
 *   node server.js                         → starts on port 3456
 *   PORT=8080 node server.js               → starts on port 8080
 *
 * Endpoints:
 *   GET /rss/sustainable-living            → full-text RSS for sustainable-living blog
 *   GET /rss/:blogHandle                   → full-text RSS for any blog handle
 *   GET /health                            → health check
 */

import http from "node:http";
import { URL } from "node:url";

// ─── Config ────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3456", 10);
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN || "therike.com";
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS || "300000", 10); // 5 min default

// ─── In-memory cache ───────────────────────────────────────────
const cache = new Map(); // key: blogHandle → { xml, timestamp }

// ─── Atom → RSS 2.0 converter ──────────────────────────────────

/**
 * Fetch the Shopify Atom feed and convert to clean RSS 2.0
 * with full article content in <description>.
 */
async function buildRSS(blogHandle) {
  const atomUrl = `https://${SHOPIFY_DOMAIN}/blogs/${blogHandle}.atom`;

  const res = await fetch(atomUrl, {
    headers: {
      "User-Agent": "TheRike-RSS-Builder/1.0",
      Accept: "application/atom+xml, application/xml, text/xml",
    },
  });

  if (!res.ok) {
    throw new Error(`Shopify returned ${res.status} for ${atomUrl}`);
  }

  const atomXml = await res.text();

  // ── Parse feed-level metadata ──────────────────────────────
  const feedTitle = extractTag(atomXml, "title") || `${SHOPIFY_DOMAIN} — ${blogHandle}`;
  const feedLink = `https://${SHOPIFY_DOMAIN}/blogs/${blogHandle}`;
  const feedUpdated = extractTag(atomXml, "updated") || new Date().toISOString();

  // ── Parse entries ──────────────────────────────────────────
  const entries = extractEntries(atomXml);

  // ── Build RSS 2.0 items ────────────────────────────────────
  const items = entries
    .map((entry) => {
      const title = escapeXml(extractTag(entry, "title") || "Untitled");
      const link = extractAttr(entry, "link", "href") || feedLink;
      const published = extractTag(entry, "published") || feedUpdated;
      const author = extractTag(entry, "name") || "The Rike";

      // Full content from <content type="html"> (preferred) or <summary>
      let fullHtml = extractCdata(entry, "content") || extractCdata(entry, "summary") || "";

      // Clean up: strip any inline <style> blocks to keep feed lighter
      fullHtml = fullHtml.replace(/<style[\s\S]*?<\/style>/gi, "").trim();

      // RFC 822 date for RSS 2.0
      const pubDate = toRFC822(published);

      return `    <item>
      <title>${title}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${pubDate}</pubDate>
      <author>${escapeXml(author)}</author>
      <description><![CDATA[${fullHtml}]]></description>
    </item>`;
    })
    .join("\n");

  // ── Assemble final RSS 2.0 ─────────────────────────────────
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(feedTitle)}</title>
    <link>${escapeXml(feedLink)}</link>
    <description>Full-text RSS feed for ${escapeXml(feedTitle)}</description>
    <language>en</language>
    <lastBuildDate>${toRFC822(feedUpdated)}</lastBuildDate>
    <generator>TheRike Full-Text RSS Builder</generator>
${items}
  </channel>
</rss>`;

  return rss;
}

// ─── XML helpers (no dependencies) ─────────────────────────────

function extractTag(xml, tag) {
  // Match <tag>text</tag> but NOT <tag ...> with attributes containing "type"
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function extractCdata(xml, tag) {
  // Match <tag ...><![CDATA[ ... ]]></tag>
  const re = new RegExp(
    `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`,
    "i"
  );
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function extractAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i");
  const m = xml.match(re);
  return m ? m[1] : null;
}

function extractEntries(xml) {
  const entries = [];
  const re = /<entry>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    entries.push(m[1]);
  }
  return entries;
}

function escapeXml(str) {
  return str
    .replace(/&(?!amp;|lt;|gt;|apos;|quot;)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toRFC822(isoDate) {
  try {
    return new Date(isoDate).toUTCString();
  } catch {
    return new Date().toUTCString();
  }
}

// ─── HTTP Server ───────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // Health check
  if (path === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
  }

  // RSS route: /rss/:blogHandle
  const rssMatch = path.match(/^\/rss\/([a-z0-9-]+)\/?$/i);
  if (rssMatch) {
    const blogHandle = rssMatch[1];

    try {
      // Check cache
      const cached = cache.get(blogHandle);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        res.writeHead(200, {
          "Content-Type": "application/rss+xml; charset=utf-8",
          "Cache-Control": `public, max-age=${Math.floor(CACHE_TTL_MS / 1000)}`,
          "X-Cache": "HIT",
        });
        return res.end(cached.xml);
      }

      // Build fresh
      const xml = await buildRSS(blogHandle);
      cache.set(blogHandle, { xml, timestamp: Date.now() });

      res.writeHead(200, {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": `public, max-age=${Math.floor(CACHE_TTL_MS / 1000)}`,
        "X-Cache": "MISS",
      });
      return res.end(xml);
    } catch (err) {
      console.error(`[RSS ERROR] ${blogHandle}:`, err.message);
      res.writeHead(502, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({ error: "Failed to fetch blog feed", detail: err.message })
      );
    }
  }

  // Root — show available routes
  if (path === "/" || path === "") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(`<!DOCTYPE html>
<html><head><title>TheRike Full-Text RSS</title></head>
<body>
  <h1>🌿 TheRike Full-Text RSS Server</h1>
  <p>SocialBee-optimized full-text RSS feeds. No <code>content:encoded</code>, no CDN proxy.</p>
  <h2>Available feeds:</h2>
  <ul>
    <li><a href="/rss/sustainable-living">/rss/sustainable-living</a></li>
    <li><a href="/rss/home-stead">/rss/home-stead</a></li>
    <li><a href="/rss/natural-healing-herbal-remedy-insights-and-solutions">/rss/natural-healing-herbal-remedy-insights-and-solutions</a></li>
    <li><a href="/rss/how-to-diy">/rss/how-to-diy</a></li>
    <li><a href="/rss/the-art-of-healing">/rss/the-art-of-healing</a></li>
    <li><a href="/rss/agritourism-adventures-exploring-farm-based-tourism">/rss/agritourism-adventures-exploring-farm-based-tourism</a></li>
    <li><a href="/rss/permaculture">/rss/permaculture</a></li>
    <li><a href="/rss/meditation">/rss/meditation</a></li>
    <li><a href="/rss/farm-destinations-the-beauty-of-rural-escapes">/rss/farm-destinations-the-beauty-of-rural-escapes</a></li>
    <li><a href="/rss/brand-partnerships">/rss/brand-partnerships</a></li>
  </ul>
  <h2>Config</h2>
  <pre>
SHOPIFY_DOMAIN = ${SHOPIFY_DOMAIN}
CACHE_TTL      = ${CACHE_TTL_MS / 1000}s
PORT           = ${PORT}
  </pre>
</body></html>`);
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found", hint: "Try /rss/sustainable-living" }));
});

server.listen(PORT, () => {
  console.log(`\n🌿 TheRike Full-Text RSS Server`);
  console.log(`   Domain:  ${SHOPIFY_DOMAIN}`);
  console.log(`   Port:    ${PORT}`);
  console.log(`   Cache:   ${CACHE_TTL_MS / 1000}s`);
  console.log(`\n   Feed URL: http://localhost:${PORT}/rss/sustainable-living`);
  console.log(`   Health:   http://localhost:${PORT}/health\n`);
});
