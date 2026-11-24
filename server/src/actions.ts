import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { and, desc, eq, gt, inArray, isNotNull, isNull, like, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import * as schema from "./schema";

// Preserve the briefing pipeline and saved data while pausing generation.
const BRIEFING_ENABLED = false;

// Example seed feeds. Replace with your own subscriptions, or import an OPML
// file through the app's add-feed flow after first launch.
const FEEDS = [
  ["Tech", "Hacker News", "https://hnrss.org/newest?points=100", false],
  ["News", "BBC World", "https://feeds.bbci.co.uk/news/world/rss.xml", false],
  ["Blogs", "Stratechery", "https://stratechery.com/feed/", false],
] as const;

const articleSchema = z.object({
  id: z.number(), title: z.string(), url: z.string(), author: z.string().nullable(), excerpt: z.string().nullable(),
  image_url: z.string().nullable(), image_alt: z.string().nullable(),
  published_at: z.string().nullable(), ingested_at: z.string(), read_at: z.string().nullable(), archived_at: z.string().nullable(),
  starred: z.boolean(), feed_id: z.number(), feed: z.string(), theme: z.string(), read_minutes: z.number(),
});

const dashboardResponse = z.object({
  themes: z.array(z.object({ id: z.number(), name: z.string(), unread: z.number() })),
  feeds: z.array(z.object({ id: z.number(), title: z.string(), url: z.string(), theme: z.string(), theme_id: z.number(), muted: z.boolean(), keep_forever: z.boolean(), unread: z.number(), fetch_error: z.string().nullable(), last_fetched_at: z.string().nullable() })),
  articles: z.array(articleSchema),
  digest: z.object({ markdown: z.string(), created_at: z.string() }).nullable(),
  archive_days: z.number(),
  retention_days: z.number(),
  last_pull: z.object({ completed_at: z.string().nullable(), new_count: z.number(), error_count: z.number() }).nullable(),
});

function iso(d: Date | null): string | null { return d ? d.toISOString() : null; }
function decodeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}
function plain(value: string): string {
  return decodeXml(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/p>|<\/div>|<\/li>|<\/h\d>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function articleHtml(value: string, baseUrl: string): string {
  const decoded = decodeXml(value)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|svg|form|template)\b[\s\S]*?<\/\1\s*>/gi, "");
  const allowed = new Set(["p", "div", "br", "hr", "ul", "ol", "li", "blockquote", "pre", "code", "strong", "b", "em", "i", "h1", "h2", "h3", "h4", "h5", "h6"]);
  let result = "";
  let cursor = 0;
  for (const match of decoded.matchAll(/<\/?[a-z][^>]*>/gi)) {
    const token = match[0];
    const index = match.index ?? cursor;
    result += escapeHtml(decoded.slice(cursor, index));
    const closing = /^<\//.test(token);
    const name = token.match(/^<\/?\s*([a-z0-9]+)/i)?.[1]?.toLowerCase() ?? "";
    if (name === "a") {
      if (closing) result += "</a>";
      else {
        const rawHref = token.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
        try {
          const href = new URL(rawHref, baseUrl);
          if (href.protocol === "http:" || href.protocol === "https:") result += `<a href="${escapeHtml(href.href)}" target="_blank" rel="noopener noreferrer">`;
        } catch { /* Invalid or unsafe links are omitted while their text remains. */ }
      }
    } else if (allowed.has(name)) {
      const normalized = name === "b" ? "strong" : name === "i" ? "em" : name;
      result += closing ? `</${normalized}>` : normalized === "br" || normalized === "hr" ? `<${normalized}>` : `<${normalized}>`;
    }
    cursor = index + token.length;
  }
  result += escapeHtml(decoded.slice(cursor));
  const cleaned = result.trim();
  if (!cleaned) return "";
  return /<(?:p|div|ul|ol|blockquote|pre|h[1-6])\b/i.test(cleaned)
    ? cleaned
    : cleaned.split(/\n{2,}/).map((part) => `<p>${part.replace(/\n/g, "<br>")}</p>`).join("");
}
function tag(block: string, names: string[]): string {
  for (const name of names) {
    const escaped = name.replace(":", "\\:");
    const m = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
    if (m?.[1]) return m[1];
  }
  return "";
}
function attrLink(block: string): string {
  const links=[...block.matchAll(/<link\b([^>]*)\/?\s*>/gi)].map(match=>match[1]??"");
  const href=(attrs:string)=>attrs.match(/\bhref=["']([^"']+)["']/i)?.[1]??"";
  const alternate=links.find(attrs=>/\brel=["']alternate["']/i.test(attrs));
  return decodeXml(href(alternate??"")||href(links[0]??"")||plain(tag(block,["link"])));
}
function resolveUrl(value:string,baseUrl:string):string { if(!value)return "";try{return new URL(value,baseUrl).href}catch{return value} }
function parseFeedTitle(xml: string): string {
  const channel = xml.match(/<channel\b[\s\S]*?<\/channel>/i)?.[0];
  if (channel) return plain(tag(channel, ["title"]));
  const feedHeader = xml.replace(/<entry\b[\s\S]*?<\/entry>/gi, "");
  return plain(tag(feedHeader, ["title"]));
}
type ParsedFeedItem = {guid:string;url:string;title:string;author:string|null;excerpt:string|null;body:string|null;published:Date|null;imageUrl:string|null;imageAlt:string|null};
function imageFromBlock(block:string,baseUrl:string,title:string):{url:string|null;alt:string|null}{
  const decoded=decodeXml(block);
  const attribute=(attrs:string,name:string)=>attrs.match(new RegExp(`\\b${name}=["']([^"']+)["']`,"i"))?.[1]??"";
  const candidates=[...decoded.matchAll(/<(media:content|media:thumbnail|enclosure)\b([^>]*)>/gi)];
  for(const match of candidates){
    const kind=(match[1]??"").toLowerCase(); const attrs=match[2]??""; const raw=attribute(attrs,"url")||attribute(attrs,"href");
    const type=attribute(attrs,"type").toLowerCase(); const medium=attribute(attrs,"medium").toLowerCase();
    const appearsImage=kind==="media:thumbnail"||medium==="image"||type.startsWith("image/")||/\.(?:jpe?g|png|gif|webp)(?:$|[?#])/i.test(raw);
    if(!raw||!appearsImage)continue;
    const resolved=resolveUrl(raw,baseUrl);
    if(/^https?:\/\//i.test(resolved))return{url:resolved,alt:plain(tag(block,["media:title"]))||title};
  }
  const image=decoded.match(/<img\b([^>]*)>/i)?.[1]??"";
  const raw=attribute(image,"src")||attribute(image,"data-src"); const resolved=resolveUrl(raw,baseUrl);
  return /^https?:\/\//i.test(resolved)?{url:resolved,alt:plain(attribute(image,"alt"))||title}:{url:null,alt:null};
}
function cleanExcerpt(bodyText: string, title: string): string | null {
  if (!bodyText) return null;
  let text = bodyText.trim();
  // Several feeds (ZeroHedge notably) repeat the headline as the first
  // line(s) of the body, so the excerpt rendered under the headline in the
  // inbox just said the same thing twice. Strip one or two leading repeats
  // of the title before slicing.
  const normTitle = title.trim().toLowerCase().replace(/\s+/g, " ");
  for (let i = 0; i < 2; i += 1) {
    const head = text.slice(0, normTitle.length).toLowerCase().replace(/\s+/g, " ");
    if (normTitle.length > 12 && head === normTitle) {
      text = text.slice(normTitle.length).replace(/^[\s:.\-—–|]+/, "").trim();
    } else break;
  }
  return text ? text.slice(0, 360) : null;
}
function parseFeed(xml: string, baseUrl: string): ParsedFeedItem[] {
  const rss = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const atom = rss.length ? [] : [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  const blocks = rss.length ? rss : atom;
  return blocks.slice(0, 30).map((block) => {
    const rawUrl = rss.length ? plain(tag(block, ["link"])) : attrLink(block);
    const url = resolveUrl(rawUrl, baseUrl);
    const title = plain(tag(block, ["title"])) || "Untitled";
    const rawBody = tag(block, ["content:encoded", "content", "description", "summary"]);
    const bodyText = plain(rawBody);
    const body = articleHtml(rawBody, url || baseUrl);
    const rawDate = plain(tag(block, ["pubDate", "published", "updated", "dc:date"]));
    const parsed = rawDate ? new Date(rawDate) : null;
    const guid = plain(tag(block, ["guid", "id"])) || url || `${title}:${rawDate}`;
    const author = plain(tag(block, ["dc:creator", "author", "name"])) || null;
    const image=imageFromBlock(block,baseUrl,title);
    return { guid, url: url || guid, title, author, excerpt: cleanExcerpt(bodyText, title), body: body || null, published: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null, imageUrl:image.url, imageAlt:image.alt };
  }).filter((x) => x.url && x.guid);
}
function safeError(e: unknown): string {
  if (e instanceof Error && e.name === "TimeoutError") return "Feed request timed out";
  if (e instanceof Error && e.message.startsWith("HTTP ")) return e.message;
  if (e instanceof Error && e.message === "No RSS or Atom entries found") return e.message;
  return "Feed could not be refreshed";
}
function imageFormat(bytes:Uint8Array):{mime:"image/jpeg"|"image/png"|"image/gif"|"image/webp";ext:"jpg"|"png"|"gif"|"webp"}|null{
  if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return{mime:"image/jpeg",ext:"jpg"};
  if(bytes.length>=8&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47)return{mime:"image/png",ext:"png"};
  if(bytes.length>=6&&String.fromCharCode(...bytes.slice(0,6))?.startsWith("GIF8"))return{mime:"image/gif",ext:"gif"};
  if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP")return{mime:"image/webp",ext:"webp"};
  return null;
}
async function ownArticleImage(ctx:Ctx,articleId:number,url:string):Promise<string|null>{
  try{
    const response=await fetch(url,{headers:{"user-agent":"MuseNewsReader/1.0",accept:"image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8,*/*;q=0.1"},signal:AbortSignal.timeout(15000),redirect:"follow"});
    if(!response.ok)return null;
    const declared=Number(response.headers.get("content-length")??"0");
    if(declared>12_000_000)return null;
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(!bytes.length||bytes.length>12_000_000)return null;
    const format=imageFormat(bytes); if(!format)return null;
    const key=`article-images/${articleId}.${format.ext}`;
    await ctx.blobs.put(key,bytes,{contentType:format.mime});
    return key;
  }catch{return null;}
}
function readMinutes(body: string | null, excerpt: string | null): number {
  const words = plain(body ?? excerpt ?? "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 230));
}

// --- Full-text fetching -------------------------------------------------
// Some feeds (CBC notably) carry only a headline/teaser in the RSS item, so
// the stored body is a snippet. fetch_full_text pulls the original page
// server-side with a browser user-agent (the lesson from the Brief pipeline:
// a plain fetch with a browser UA works where dedicated downloaders fail)
// and extracts the main article text readability-style: JSON-LD articleBody
// when present, otherwise the densest run of substantial, low-link-density
// paragraphs/headings, with an <article>/<main> element pass as fallback.
// The result is sanitized through the same articleHtml used for feed bodies,
// so the reader, speed reader, highlights, and article_bodies all see the
// persisted body unchanged in shape.
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FULL_TEXT_MIN_CHARS = 400;

function articleBodyFromJsonLd(html: string): string | null {
  for (const m of html.matchAll(/"articleBody"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    try {
      const text = JSON.parse(`"${m[1] ?? ""}"`) as unknown;
      if (typeof text !== "string") continue;
      const cleaned = text.replace(/[ \t]+\n/g, "\n").trim();
      if (cleaned.length >= 800) return cleaned;
    } catch { /* Not a usable JSON string; keep looking. */ }
  }
  return null;
}

type ExtractedBlock = { tag: string; raw: string; text: string; linkDensity: number };
function extractBlocks(html: string): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  for (const m of html.matchAll(/<(p|h2|h3|h4|blockquote|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tag = (m[1] ?? "p").toLowerCase();
    const raw = m[2] ?? "";
    const text = plain(raw);
    if (!text) continue;
    const linkText = [...raw.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((x) => plain(x[1] ?? "")).join(" ");
    blocks.push({ tag, raw, text, linkDensity: text.length ? linkText.length / text.length : 1 });
  }
  return blocks;
}
const BOILERPLATE_START = /^(sign up|subscribe|share this|follow us|read more|advertisement|©|copyright|all rights reserved|audience relations|closed captioning)/i;
function isArticleBlock(b: ExtractedBlock): boolean {
  if (b.linkDensity >= 0.5) return false;
  if (BOILERPLATE_START.test(b.text)) return false;
  return b.tag === "p" || b.tag === "blockquote" || b.tag === "li" ? b.text.length >= 40 : b.text.length >= 15;
}
// The article body is the densest run of substantial blocks: short or
// link-heavy blocks (captions, "Social Sharing" headings, related-story
// cards) may interrupt it, but a gap of more than 3 ends the run. Nav and
// footer text sits outside the winning run and is dropped with it.
function bestBlockRun(blocks: ExtractedBlock[]): ExtractedBlock[] {
  let best: ExtractedBlock[] = [];
  let bestChars = 0;
  let run: ExtractedBlock[] = [];
  let gap = 0;
  const flush = () => {
    const chars = run.reduce((n, b) => n + b.text.length, 0);
    if (chars > bestChars) { bestChars = chars; best = run; }
  };
  for (const b of blocks) {
    if (isArticleBlock(b)) { run.push(b); gap = 0; }
    else if (run.length) { gap += 1; if (gap > 3) { flush(); run = []; gap = 0; } }
  }
  flush();
  // Drop trailing site furniture that can sit inside the run (CBC appends
  // its accessibility/audience-relations paragraphs after the story).
  while (best.length && BOILERPLATE_START.test(best[best.length - 1]?.text ?? "")) best = best.slice(0, -1);
  const seen = new Set<string>();
  return best.filter((b) => {
    const key = b.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function elementInner(html: string, tagName: string): string | null {
  const open = new RegExp(`<${tagName}\\b[^>]*>`, "i").exec(html);
  if (!open) return null;
  const start = open.index + open[0].length;
  const tokenRe = new RegExp(`</?${tagName}\\b[^>]*>`, "gi");
  tokenRe.lastIndex = start;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html)) !== null) {
    if (/^<\//.test(m[0])) { depth -= 1; if (depth === 0) return html.slice(start, m.index); }
    else if (!/\/>$/.test(m[0])) depth += 1;
  }
  return null;
}
function extractFullTextHtml(pageHtml: string, baseUrl: string): string | null {
  const candidates: Array<{ html: string; len: number; clean: boolean }> = [];
  const add = (html: string, clean: boolean) => { if (html) candidates.push({ html, len: plain(html).length, clean }); };
  const jsonLd = articleBodyFromJsonLd(pageHtml);
  if (jsonLd) add(articleHtml(jsonLd, baseUrl), true);
  const cleaned = pageHtml
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|form|iframe|template|nav|header|footer|aside|button|select|textarea)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const run = bestBlockRun(extractBlocks(cleaned));
  if (run.length) {
    const joined = run.map((b) => {
      const tag = b.tag === "li" ? "p" : b.tag;
      return `<${tag}>${b.raw}</${tag}>`;
    }).join("\n");
    add(articleHtml(joined, baseUrl), true);
  }
  for (const tagName of ["article", "main"]) {
    const inner = elementInner(cleaned, tagName);
    if (inner) add(articleHtml(inner, baseUrl), false);
  }
  if (!candidates.length) return null;
  const longest = Math.max(...candidates.map((c) => c.len));
  // Prefer a clean candidate (JSON-LD or the paragraph run) when it holds
  // at least three quarters of the longest candidate's text: whole-element
  // passes win on raw length by sweeping in bylines, captions, "listen to
  // this article" furniture, and related-story lists around the story.
  const cleanBest = candidates.filter((c) => c.clean && c.len >= FULL_TEXT_MIN_CHARS && c.len >= longest * 0.75).sort((a, b) => b.len - a.len)[0];
  if (cleanBest) return cleanBest.html;
  const best = candidates.slice().sort((a, b) => b.len - a.len)[0];
  return best?.html ?? null;
}

// --- Photo pulling -------------------------------------------------------
// Companion to fetch_full_text: feeds often ship no images (or only a lead
// thumbnail) even when the story page carries captioned photos, maps, and
// renderings. fetch_photos pulls the page server-side with the same browser
// UA, extracts the story's images in story order, validates and stores the
// bytes as owned blobs (article_photos rows), and the reader renders each
// at its caption's position in the body. Sources, in order of trust:
//   1. <figure> elements (img + figcaption), skipping author portraits.
//   2. Embedded image metadata some publishers ship in the page JSON
//      (CBC's polopoly_image entries carry localCaption + credit + the
//      canonical URL for each inline image; its rendered <figure>s have
//      empty figcaptions, so the JSON is the only caption source). Matched
//      to DOM images by the image id in the CDN URL.
//   3. og:image / JSON-LD image as the lead when no figure matches it.
// Lazy-load markup is handled by preferring the largest srcset variant and
// data-src style attributes over the (often tiny or placeholder) src.
type PhotoCandidate = { url: string; identity: string; caption: string | null; credit: string | null; alt: string | null; width: number | null; height: number | null };
const PHOTO_CAP = 10;
const PHOTO_SKIP_URL = /(logo|icon|sprite|avatar|nojs|pixel|track|1x1|placeholder|spinner|blank\.)/i;

function photoIdentity(url: string): string {
  const ais = url.match(/\/ais\/([0-9a-f-]{36})/i)?.[1];
  if (ais) return `ais:${ais.toLowerCase()}`;
  try { const u = new URL(url); return `${u.hostname}${u.pathname}`; } catch { return url.split("?")[0] ?? url; }
}
function decodeJsonish(raw: string): string {
  try { const v = JSON.parse(`"${raw}"`) as unknown; return typeof v === "string" ? v : raw; } catch { return raw.replace(/\\u002f/gi, "/").replace(/\\u002F/g, "/").replace(/\\"/g, '"').replace(/\\n/g, " ").trim(); }
}
function splitCaptionCredit(raw: string | null): { caption: string | null; credit: string | null } {
  if (!raw) return { caption: null, credit: null };
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return { caption: null, credit: null };
  const m = text.match(/^(.*?)\s*\(([^()]{1,90})\)\s*$/);
  if (m?.[1] && m[2]) return { caption: m[1].trim() || null, credit: m[2].trim() || null };
  return { caption: text, credit: null };
}
type EmbeddedImage = { identity: string; url: string; caption: string | null; credit: string | null; alt: string | null; width: number | null; height: number | null };
function embeddedImages(pageHtml: string, baseUrl: string): EmbeddedImage[] {
  // Normalize the page's escaped JSON strings so plain regexes can read the
  // fields; this copy is used only for this metadata pass.
  const jsonish = pageHtml.replace(/\\"/g, '"').replace(/\\u002f/gi, "/");
  const out: EmbeddedImage[] = [];
  const marker = /"type"\s*:\s*"polopoly_image"/g;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(jsonish)) !== null) {
    const next = jsonish.indexOf('"type":"polopoly_image"', m.index + 10);
    const seg = jsonish.slice(m.index, next > m.index ? next : m.index + 4000);
    const grab = (re: RegExp) => seg.match(re)?.[1] ?? "";
    const rawUrl = grab(/"url"\s*:\s*"(https?:\/\/[^"]+)"/);
    if (!rawUrl) continue;
    const url = resolveUrl(rawUrl, baseUrl);
    if (!/^https?:\/\//i.test(url)) continue;
    const localCaption = grab(/"localCaption"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const description = grab(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const creditRaw = grab(/"credit"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const altRaw = grab(/"altText"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const split = splitCaptionCredit(localCaption ? decodeJsonish(localCaption) : description ? decodeJsonish(description) : null);
    out.push({
      identity: photoIdentity(url), url,
      caption: split.caption, credit: (creditRaw ? decodeJsonish(creditRaw) : null) ?? split.credit,
      alt: altRaw ? decodeJsonish(altRaw) : null,
      width: Number(grab(/"width"\s*:\s*(\d+)/)) || null,
      height: Number(grab(/"height"\s*:\s*(\d+)/)) || null,
    });
  }
  return out;
}
function imgUrlFromAttrs(attrs: string, baseUrl: string): string | null {
  const get = (name: string) => attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1] ?? attrs.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i"))?.[1] ?? "";
  const srcset = get("srcset") || get("data-srcset");
  let best = ""; let bestW = -1;
  if (srcset) {
    // Parse entries as <url> <descriptor>: splitting on commas is unsafe
    // because CDN URLs themselves contain commas (CBC's i.cbc.ca/ais/<uuid>,
    // <timestamp>/... form), which shatters the URL into fragments.
    for (const mm of srcset.matchAll(/(https?:\/\/[^\s]+?)\s+(\d+(?:\.\d+)?)(w|x)\b/gi)) {
      const w = mm[3] === "x" ? Number(mm[2]) * 1000 : Number(mm[2]);
      if (mm[1] && w >= bestW) { bestW = w; best = mm[1]; }
    }
    if (!best) {
      const first = srcset.split(/,\s*(?=https?:\/\/)/)[0]?.trim().split(/\s+/)[0];
      if (first) best = first;
    }
  }
  const raw = best || get("data-src") || get("data-original") || get("data-lazy-src") || get("src");
  if (!raw || raw.startsWith("data:")) return null;
  const resolved = resolveUrl(decodeXml(raw), baseUrl);
  return /^https?:\/\//i.test(resolved) ? resolved : null;
}
function imgDimsFromAttrs(attrs: string): { width: number | null; height: number | null } {
  const num = (name: string) => { const v = Number(attrs.match(new RegExp(`\\b${name}\\s*=\\s*"?(\\d+)`, "i"))?.[1] ?? ""); return v > 0 ? v : null; };
  return { width: num("width"), height: num("height") };
}
function extractPhotoCandidates(pageHtml: string, baseUrl: string): PhotoCandidate[] {
  const embedded = embeddedImages(pageHtml, baseUrl);
  const byIdentity = new Map(embedded.map((e) => [e.identity, e]));
  const out: PhotoCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: PhotoCandidate) => {
    if (seen.has(c.identity) || out.length >= PHOTO_CAP) return;
    if (PHOTO_SKIP_URL.test(c.url) || /\.svg(?:$|[?#])/i.test(c.url)) return;
    if (c.width !== null && c.width < 280) return;
    if (c.height !== null && c.height < 120) return;
    seen.add(c.identity);
    out.push(c);
  };
  const enrich = (url: string, caption: string | null, alt: string | null, width: number | null, height: number | null): PhotoCandidate => {
    const identity = photoIdentity(url);
    const meta = byIdentity.get(identity);
    const split = splitCaptionCredit(caption);
    return {
      url, identity,
      caption: meta?.caption ?? split.caption,
      credit: meta?.credit ?? split.credit,
      // The rendered img alt is the page's own accessible text and survives
      // quotes intact; the embedded-JSON alt can truncate at an escaped
      // inner quote, so prefer the DOM alt whenever it is at least as long.
      alt: alt && alt.length >= (meta?.alt?.length ?? 0) ? alt : meta?.alt ?? alt,
      width: meta?.width ?? width, height: meta?.height ?? height,
    };
  };
  // 1. Figures in story order (author portraits excluded by class hook).
  for (const f of pageHtml.matchAll(/<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi)) {
    const attrs = f[1] ?? ""; const inner = f[2] ?? "";
    if (/author[-_ ]?image/i.test(attrs) || /author[-_ ]?image/i.test(inner)) continue;
    const imgTag = inner.match(/<img\b([^>]*)>/i)?.[1] ?? "";
    if (!imgTag || /author[-_ ]?image/i.test(imgTag)) continue;
    const url = imgUrlFromAttrs(imgTag, baseUrl);
    if (!url) continue;
    const captionRaw = f[2] ? plain(f[2].match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] ?? "") : "";
    const alt = plain(imgTag.match(/\balt\s*=\s*"([^"]*)"/i)?.[1] ?? "") || null;
    const dims = imgDimsFromAttrs(imgTag);
    push(enrich(url, captionRaw || null, alt, dims.width, dims.height));
  }
  // 2. Standalone images inside the article/main element (related-story
  // thumbnails and page furniture live outside it on most sites).
  const scope = elementInner(pageHtml, "article") ?? elementInner(pageHtml, "main") ?? "";
  if (scope) {
    for (const im of scope.matchAll(/<img\b([^>]*)>/gi)) {
      const attrs = im[1] ?? "";
      if (/author[-_ ]?image|thumbnail/i.test(attrs)) continue;
      const url = imgUrlFromAttrs(attrs, baseUrl);
      if (!url || seen.has(photoIdentity(url))) continue;
      const alt = plain(attrs.match(/\balt\s*=\s*"([^"]*)"/i)?.[1] ?? "") || null;
      const dims = imgDimsFromAttrs(attrs);
      push(enrich(url, null, alt, dims.width, dims.height));
    }
  }
  // 3. Embedded-metadata images the DOM pass missed (kept in story order).
  for (const e of embedded) push({ url: e.url, identity: e.identity, caption: e.caption, credit: e.credit, alt: e.alt, width: e.width, height: e.height });
  // 4. og:image as the lead when nothing above carried it.
  const ogRaw = pageHtml.match(/<meta\b[^>]*\bproperty\s*=\s*"og:image"[^>]*\bcontent\s*=\s*"([^"]+)"/i)?.[1] ?? pageHtml.match(/<meta\b[^>]*\bcontent\s*=\s*"([^"]+)"[^>]*\bproperty\s*=\s*"og:image"/i)?.[1] ?? "";
  if (ogRaw) {
    const url = resolveUrl(decodeXml(ogRaw), baseUrl);
    if (/^https?:\/\//i.test(url) && !seen.has(photoIdentity(url))) {
      const meta = byIdentity.get(photoIdentity(url));
      const lead: PhotoCandidate = { url, identity: photoIdentity(url), caption: meta?.caption ?? null, credit: meta?.credit ?? null, alt: meta?.alt ?? null, width: meta?.width ?? null, height: meta?.height ?? null };
      if (!PHOTO_SKIP_URL.test(url) && !/\.svg(?:$|[?#])/i.test(url)) out.unshift(lead);
    }
  }
  return out.slice(0, PHOTO_CAP);
}
function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (bytes.length >= 10 && String.fromCharCode(...bytes.slice(0, 6)).startsWith("GIF8")) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1] ?? 0;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
      }
      const len = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
      if (len < 2) break;
      i += 2 + len;
    }
    return null;
  }
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP" && String.fromCharCode(...bytes.slice(12, 16)) === "VP8X") {
    const w = (bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16);
    const h = (bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16);
    return { width: w + 1, height: h + 1 };
  }
  return null;
}
async function ownPulledPhoto(ctx: Ctx, articleId: number, position: number, url: string): Promise<string | null> {
  try {
    // No AVIF in the Accept list: some CDNs (CBC's Akamai image manager)
    // negotiate AVIF when it is offered first, and AVIF bytes are not a
    // storable format here, so every photo would be rejected.
    const response = await fetch(url, { headers: { "user-agent": BROWSER_UA, accept: "image/jpeg,image/png,image/gif,image/webp;q=0.8,*/*;q=0.3" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
    if (!response.ok) return null;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > 12_000_000) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 12_000_000 || bytes.length < 6000) return null;
    const format = imageFormat(bytes);
    if (!format) return null;
    const dims = imageDimensions(bytes);
    if (dims && (dims.width < 280 || dims.height < 120)) return null;
    const key = `article-photos/${articleId}-${position}.${format.ext}`;
    await ctx.blobs.put(key, bytes, { contentType: format.mime });
    return key;
  } catch { return null; }
}
async function deletePhotosForArticles(ctx: Ctx, articleIds: number[]): Promise<void> {
  if (!articleIds.length) return;
  const db = ctx.db<typeof schema>();
  const rows = await db.select({ blobKey: schema.articlePhotos.blobKey }).from(schema.articlePhotos).where(inArray(schema.articlePhotos.articleId, articleIds));
  for (const r of rows) await ctx.blobs.delete(r.blobKey);
  await db.delete(schema.articlePhotos).where(inArray(schema.articlePhotos.articleId, articleIds));
}

async function ensureCatalog(ctx: Ctx): Promise<void> {
  const db = ctx.db<typeof schema>();
  const existing = await db.select({ id: schema.themes.id }).from(schema.themes).limit(1);
  if (existing.length) return;
  const names = ["Tech", "Blogs", "News", "Arts", "Music", "Laundry List"];
  for (let i = 0; i < names.length; i += 1) await db.insert(schema.themes).values({ name: names[i] ?? "Other", position: i });
  const themes = await db.select().from(schema.themes);
  const byName = new Map(themes.map((t) => [t.name, t.id]));
  for (const [theme, title, url, muted] of FEEDS) {
    const themeId = byName.get(theme);
    if (themeId) await db.insert(schema.feeds).values({ themeId, title, url, muted, keepForever: false /* mark specific feeds keep-forever in the app UI instead */ }).onConflictDoNothing();
  }
}

async function autoArchive(ctx: Ctx): Promise<void> {
  const db = ctx.db<typeof schema>();
  await db.update(schema.articles).set({ archivedAt: new Date() }).where(and(isNotNull(schema.articles.readAt),isNull(schema.articles.archivedAt)));
}

async function deleteExpiredArticles(ctx: Ctx): Promise<number> {
  const db = ctx.db<typeof schema>();
  const [prefs] = await db.select().from(schema.settings).limit(1);
  const days = prefs?.retentionDays ?? 30;
  const cutoff = new Date(Date.now() - days * 86400000);
  const olderThanCutoff = or(
    and(isNotNull(schema.articles.publishedAt), lte(schema.articles.publishedAt, cutoff)),
    and(isNull(schema.articles.publishedAt), lte(schema.articles.ingestedAt, cutoff)),
  );
  if (!olderThanCutoff) return 0;
  const rows = await db.select({ id: schema.articles.id, feedId: schema.articles.feedId, guid: schema.articles.guid, imageBlobKey: schema.articles.imageBlobKey })
    .from(schema.articles)
    .innerJoin(schema.feeds, eq(schema.articles.feedId, schema.feeds.id))
    .leftJoin(schema.notes, eq(schema.notes.articleId, schema.articles.id))
    .leftJoin(schema.highlights, eq(schema.highlights.articleId, schema.articles.id))
    .where(and(
      eq(schema.articles.starred, false),
      eq(schema.feeds.keepForever, false),
      isNull(schema.notes.id),
      isNull(schema.highlights.id),
      olderThanCutoff,
    ));
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  for (let index = 0; index < unique.length; index += 200) {
    const tombstones = unique.slice(index, index + 200).map((row) => ({ feedId: row.feedId, guid: row.guid }));
    if (tombstones.length) await db.insert(schema.articleTombstones).values(tombstones).onConflictDoNothing();
  }
  for (const row of unique) {
    if (row.imageBlobKey) await ctx.blobs.delete(row.imageBlobKey);
  }
  await deletePhotosForArticles(ctx, unique.map((row) => row.id));
  for (let index = 0; index < unique.length; index += 200) {
    const ids = unique.slice(index, index + 200).map((row) => row.id);
    if (ids.length) await db.delete(schema.articles).where(inArray(schema.articles.id, ids));
  }
  return unique.length;
}

type Fetched = { feedId:number; ok:true; items:ReturnType<typeof parseFeed> } | { feedId:number; ok:false; error:string };
async function fetchOne(feed: {id:number;url:string}): Promise<Fetched> {
  try {
    const response = await fetch(feed.url, { headers: { "user-agent": "MuseNewsReader/1.0", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" }, signal: AbortSignal.timeout(18000), redirect: "follow" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    const items = parseFeed(xml, response.url || feed.url);
    if (!items.length) throw new Error("No RSS or Atom entries found");
    return { feedId: feed.id, ok: true, items };
  } catch (e) { return { feedId: feed.id, ok: false, error: safeError(e) }; }
}
async function concurrentMap<T, R>(items:T[], worker:(item:T)=>Promise<R>, limit=8):Promise<R[]> {
  const out:R[] = []; let next = 0;
  const runners = Array.from({length:Math.min(limit,items.length)}, async () => { while (next < items.length) { const i=next; next += 1; const item=items[i]; if (item !== undefined) out[i]=await worker(item); } });
  await Promise.all(runners); return out;
}

async function pruneHousekeeping(ctx: Ctx): Promise<void> {
  const db = ctx.db<typeof schema>();
  // Pull history grows one row per refresh (every 30 minutes) forever; the
  // UI and diagnostics only ever read the latest run. Keep the newest 200.
  const keepRuns = await db.select({ id: schema.pullRuns.id }).from(schema.pullRuns).orderBy(desc(schema.pullRuns.id)).limit(200);
  const keepIds = keepRuns.map((r) => r.id);
  if (keepIds.length) await db.delete(schema.pullRuns).where(notInArray(schema.pullRuns.id, keepIds));
  // Tombstones stop a deleted article returning from its feed. Feeds only
  // carry their latest ~30 items, so a tombstone older than 90 days guards
  // against an item no feed will offer again; prune those to bound growth
  // (the table had passed 5,600 rows).
  const tombstoneCutoff = new Date(Date.now() - 90 * 86400000);
  await db.delete(schema.articleTombstones).where(lte(schema.articleTombstones.deletedAt, tombstoneCutoff));
  // Digests are paused (BRIEFING_ENABLED = false) and only the newest per
  // theme is ever read; keep the newest 3 per theme and drop the rest.
  const digestRows = await db.select({ id: schema.digests.id, theme: schema.digests.theme }).from(schema.digests).orderBy(desc(schema.digests.id));
  const perTheme = new Map<string, number>();
  const staleDigestIds: number[] = [];
  for (const row of digestRows) {
    const n = (perTheme.get(row.theme) ?? 0) + 1;
    perTheme.set(row.theme, n);
    if (n > 3) staleDigestIds.push(row.id);
  }
  if (staleDigestIds.length) await db.delete(schema.digests).where(inArray(schema.digests.id, staleDigestIds));
}

async function runRefresh(ctx: Ctx): Promise<{new_count:number;error_count:number;started_at:string;completed_at:string}> {
  await ensureCatalog(ctx); await autoArchive(ctx); await deleteExpiredArticles(ctx); await pruneHousekeeping(ctx);
  const db = ctx.db<typeof schema>(); const started = new Date();
  const [run] = await db.insert(schema.pullRuns).values({ startedAt: started, status: "running" }).returning({id:schema.pullRuns.id});
  const active = await db.select({id:schema.feeds.id,url:schema.feeds.url}).from(schema.feeds).where(eq(schema.feeds.muted,false));
  const fetched = await concurrentMap(active, fetchOne, 8);
  let newCount=0, errorCount=0;
  const newByTheme = new Map<string,Array<{title:string;url:string;feed:string;theme:string;published_at:string|null;excerpt:string|null}>>();
  const imageCandidates:Array<{articleId:number;url:string;alt:string;isNew:boolean}>=[];
  const metadata = await db.select({feedId:schema.feeds.id,feed:schema.feeds.title,theme:schema.themes.name}).from(schema.feeds).innerJoin(schema.themes,eq(schema.feeds.themeId,schema.themes.id));
  const meta = new Map(metadata.map((x)=>[x.feedId,x]));
  for (const result of fetched) {
    if (!result) continue;
    if (!result.ok) { errorCount += 1; await db.update(schema.feeds).set({fetchError:result.error,lastFetchedAt:new Date()}).where(eq(schema.feeds.id,result.feedId)); continue; }
    await db.update(schema.feeds).set({fetchError:null,lastFetchedAt:new Date()}).where(eq(schema.feeds.id,result.feedId));
    const itemGuids = result.items.map((item) => item.guid);
    const deletedRows = itemGuids.length ? await db.select({ guid: schema.articleTombstones.guid })
      .from(schema.articleTombstones)
      .where(and(eq(schema.articleTombstones.feedId, result.feedId), inArray(schema.articleTombstones.guid, itemGuids))) : [];
    const deletedGuids = new Set(deletedRows.map((row) => row.guid));
    for (const item of result.items) {
      if (deletedGuids.has(item.guid)) continue;
      const inserted = await db.insert(schema.articles).values({feedId:result.feedId,guid:item.guid,url:item.url,title:item.title,author:item.author,excerpt:item.excerpt,body:item.body,publishedAt:item.published}).onConflictDoNothing().returning({id:schema.articles.id});
      const created=inserted[0];
      if (created) {
        newCount += 1; const m=meta.get(result.feedId);
        if (m) { const list=newByTheme.get(m.theme) ?? []; list.push({title:item.title,url:item.url,feed:m.feed,theme:m.theme,published_at:iso(item.published),excerpt:item.excerpt}); newByTheme.set(m.theme,list); }
        if(item.imageUrl)imageCandidates.push({articleId:created.id,url:item.imageUrl,alt:item.imageAlt??item.title,isNew:true});
      } else {
        const [existing]=await db.select({id:schema.articles.id,imageBlobKey:schema.articles.imageBlobKey}).from(schema.articles).where(and(eq(schema.articles.feedId,result.feedId),eq(schema.articles.guid,item.guid))).limit(1);
        if(existing){
          await db.update(schema.articles).set({url:item.url,title:item.title,author:item.author,excerpt:item.excerpt,body:item.body,publishedAt:item.published}).where(eq(schema.articles.id,existing.id));
          if(item.imageUrl&&!existing.imageBlobKey)imageCandidates.push({articleId:existing.id,url:item.imageUrl,alt:item.imageAlt??item.title,isNew:false});
        }
      }
    }
  }
  const runId=run?.id??0;
  const selectedImages=imageCandidates.sort((a,b)=>a.isNew===b.isNew?((a.articleId+runId)%997)-((b.articleId+runId)%997):a.isNew?-1:1).slice(0,160);
  await concurrentMap(selectedImages,async candidate=>{
    const key=await ownArticleImage(ctx,candidate.articleId,candidate.url);
    if(key)await db.update(schema.articles).set({imageBlobKey:key,imageAlt:candidate.alt}).where(eq(schema.articles.id,candidate.articleId));
    return key;
  },6);
  const completed=new Date(); const status = errorCount === 0 ? "complete" : newCount > 0 ? "partial" : "failed";
  if (run) await db.update(schema.pullRuns).set({completedAt:completed,newCount,errorCount,status}).where(eq(schema.pullRuns.id,run.id));
  if (BRIEFING_ENABLED && newCount > 0) {
    const mainItems=[...newByTheme.values()].flat().slice(0,120);
    const tasks:[[string,typeof mainItems], ...Array<[string,typeof mainItems]>] = [["Main",mainItems], ...[...newByTheme.entries()].map(([theme,items])=>[theme,items.slice(0,60)] as [string,typeof mainItems])];
    for (const [theme,items] of tasks) {
      const payload=JSON.stringify(items);
      await ctx.agent.spawnTask(`Write a concise editorial digest for the ${theme} RSS view from only these newly ingested articles. Lead with the most important update, cluster related items, use 2-5 short bullets, name sources, and do not invent facts beyond titles and excerpts. Theme: ${theme}. Articles: ${payload}`, {expectsAction:"save_digest",dedupeKey:`digest:${run?.id ?? started.toISOString()}:${theme}`});
    }
  }
  ctx.invalidateQueries(); return {new_count:newCount,error_count:errorCount,started_at:started.toISOString(),completed_at:completed.toISOString()};
}

function articleOut(row: {id:number;title:string;url:string;author:string|null;excerpt:string|null;imageAlt:string|null;publishedAt:Date|null;ingestedAt:Date;readAt:Date|null;archivedAt:Date|null;starred:boolean;feedId:number;feed:string;theme:string;body?:string|null},imageUrl:string|null) {
  return {id:row.id,title:row.title,url:row.url,author:row.author,excerpt:row.excerpt,image_url:imageUrl,image_alt:row.imageAlt,published_at:iso(row.publishedAt),ingested_at:row.ingestedAt.toISOString(),read_at:iso(row.readAt),archived_at:iso(row.archivedAt),starred:row.starred,feed_id:row.feedId,feed:row.feed,theme:row.theme,read_minutes:readMinutes(row.body ?? null,row.excerpt)};
}

type LibraryItem = {id:number;kind:"note"|"highlight";text:string;created_at:string;article_id:number;article_title:string;article_url:string;feed:string;theme:string};

// Brief tab contract, shared by save_brief_edition (write) and get_brief
// (read). The external pipeline identifies articles by URL only, so get_brief
// resolves each URL against the saved articles table at read time.
const briefArticleIn = z.object({ url: z.string().min(1).max(4000), feed: z.string().max(300), title: z.string().max(1000) });
const briefSignals = z.object({ sources: z.number(), consequence: z.number(), relevance: z.number(), novelty: z.number(), outrage: z.boolean() });
const briefStoryIn = z.object({
  key: z.string().min(1).max(300), headline: z.string().min(1).max(600), summary: z.string().min(1).max(6000),
  whyItMatters: z.string().max(1000), topic: z.string().max(200), serendipity: z.boolean(),
  signals: briefSignals, score: z.number(), articles: z.array(briefArticleIn).max(40),
  dossier_id: z.string().max(300).optional(),
});
type BriefStory = z.infer<typeof briefStoryIn>;
const briefStoryOut = briefStoryIn.extend({
  articles: z.array(briefArticleIn.extend({ article_id: z.number().nullable() })),
  clicks: z.number(), stars: z.number(), starred: z.boolean(), dismissed: z.boolean(),
  downvotes: z.number(), downvoted: z.boolean(),
});
const briefResponse = z.object({
  editions: z.array(z.object({
    id: z.number(), generated_at: z.string(), window_start: z.string(), window_end: z.string(),
    stories: z.array(briefStoryOut),
  })),
});
// Brief dossiers: persistent situation objects written by the external
// pipeline. Stored as one JSON document per dossier in brief_dossiers; the
// handlers normalize partial input over stored/default values so callers can
// send incremental updates.
const dossierContestedOut = z.object({ claim: z.string(), status: z.enum(["confirmed", "reported", "single_source", "disputed"]), note: z.string(), sources: z.array(z.string()) });
const dossierWatchOut = z.object({ date: z.string().nullable(), event: z.string() });
const dossierTimelineOut = z.object({ at: z.string(), text: z.string() });
const dossierArticleOut = z.object({ feed: z.string(), title: z.string(), url: z.string(), article_id: z.number().nullable().optional() });
const dossierResearchEvidence = z.object({ source: z.string(), url: z.string(), finding: z.string() });
const dossierResearchClaim = z.object({ claim: z.string(), status: z.string(), evidence: z.array(dossierResearchEvidence), note: z.string() });
const dossierPrimarySource = z.object({ title: z.string(), url: z.string(), what: z.string() });
const dossierResearchOut = z.object({ status: z.enum(["none", "queued", "done"]), at: z.string().nullable(), summary: z.string(), claims: z.array(dossierResearchClaim), primary_sources: z.array(dossierPrimarySource), unverified: z.array(z.string()) });
const dossierEvidenceOut = z.object({ url: z.string(), local_path: z.string(), kind: z.string(), fetched_at: z.string(), bytes: z.number() });
const dossierOut = z.object({
  id: z.string(), title: z.string(), topic: z.string(), status: z.enum(["active", "quiet", "closed"]),
  created_at: z.string(), updated_at: z.string(), state_of_play: z.string(), latest_delta: z.string(), why_it_matters: z.string(),
  contested: z.array(dossierContestedOut), what_to_watch: z.array(dossierWatchOut), timeline: z.array(dossierTimelineOut),
  articles: z.array(dossierArticleOut),
  evidence: z.array(dossierEvidenceOut),
  scores: z.object({ consequence: z.number(), relevance: z.number(), composite: z.number() }),
  contention: z.object({ flag: z.boolean(), reason: z.string() }),
  research: dossierResearchOut,
  // Repair/lifecycle markers written by the app (demote, merge) or the
  // pipeline (closing synthesis). Optional so older stored dossiers and
  // pipeline payloads that omit them keep validating.
  demoted: z.boolean().optional(),
  merged_into: z.string().optional(),
  closing_summary: z.string().optional(),
});
type Dossier = z.infer<typeof dossierOut>;
function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
function strVal(v: unknown, fallback: string): string { return typeof v === "string" ? v : fallback; }
function numVal(v: unknown, fallback: number): number { return typeof v === "number" && Number.isFinite(v) ? v : fallback; }
function boolVal(v: unknown, fallback: boolean): boolean { return typeof v === "boolean" ? v : fallback; }
function strArr(v: unknown, fallback: string[]): string[] { return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : fallback; }
function normalizeDossier(input: unknown, existing: Dossier | null): Dossier | null {
  if (!isRecord(input)) return null;
  const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : existing?.id;
  if (!id) return null;
  const base: Dossier = existing ?? {
    id, title: "", topic: "", status: "active",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    state_of_play: "", latest_delta: "", why_it_matters: "",
    contested: [], what_to_watch: [], timeline: [], articles: [], evidence: [],
    scores: { consequence: 0, relevance: 0, composite: 0 },
    contention: { flag: false, reason: "" },
    research: { status: "none", at: null, summary: "", claims: [], primary_sources: [], unverified: [] },
  };
  const pick = <T,>(key: string, fallback: T): T => (key in input ? (input[key] as T) : fallback);
  const statusRaw = pick("status", base.status);
  const status: Dossier["status"] = statusRaw === "quiet" || statusRaw === "closed" || statusRaw === "active" ? statusRaw : base.status;
  const contestedRaw = pick("contested", base.contested);
  const contested: Dossier["contested"] = Array.isArray(contestedRaw) ? contestedRaw.flatMap((c) => {
    if (!isRecord(c) || typeof c.claim !== "string") return [];
    const st = c.status === "confirmed" || c.status === "reported" || c.status === "single_source" || c.status === "disputed" ? c.status : "reported";
    return [{ claim: c.claim, status: st as Dossier["contested"][number]["status"], note: strVal(c.note, ""), sources: strArr(c.sources, []) }];
  }) : base.contested;
  const watchRaw = pick("what_to_watch", base.what_to_watch);
  const what_to_watch: Dossier["what_to_watch"] = Array.isArray(watchRaw) ? watchRaw.flatMap((w) => isRecord(w) && typeof w.event === "string" ? [{ date: typeof w.date === "string" ? w.date : null, event: w.event }] : []) : base.what_to_watch;
  const timelineRaw = pick("timeline", base.timeline);
  const timeline: Dossier["timeline"] = Array.isArray(timelineRaw) ? timelineRaw.flatMap((t) => isRecord(t) && typeof t.text === "string" ? [{ at: strVal(t.at, ""), text: t.text }] : []) : base.timeline;
  const articlesRaw = pick("articles", base.articles);
  const articles: Dossier["articles"] = Array.isArray(articlesRaw) ? articlesRaw.flatMap((a) => isRecord(a) && typeof a.url === "string" ? [{ feed: strVal(a.feed, ""), title: strVal(a.title, ""), url: a.url }] : []) : base.articles.map((a) => ({ feed: a.feed, title: a.title, url: a.url }));
  const evidenceRaw = pick("evidence", base.evidence);
  const evidence: Dossier["evidence"] = Array.isArray(evidenceRaw) ? evidenceRaw.flatMap((e) => isRecord(e) && typeof e.url === "string" ? [{ url: e.url, local_path: strVal(e.local_path, ""), kind: strVal(e.kind, ""), fetched_at: strVal(e.fetched_at, ""), bytes: numVal(e.bytes, 0) }] : []) : base.evidence.map((e) => ({ url: e.url, local_path: e.local_path, kind: e.kind, fetched_at: e.fetched_at, bytes: e.bytes }));
  const scoresRaw = pick("scores", base.scores);
  const scores: Dossier["scores"] = isRecord(scoresRaw) ? { consequence: numVal(scoresRaw.consequence, base.scores.consequence), relevance: numVal(scoresRaw.relevance, base.scores.relevance), composite: numVal(scoresRaw.composite, base.scores.composite) } : base.scores;
  const contentionRaw = pick("contention", base.contention);
  const contention: Dossier["contention"] = isRecord(contentionRaw) ? { flag: boolVal(contentionRaw.flag, base.contention.flag), reason: strVal(contentionRaw.reason, base.contention.reason) } : base.contention;
  const researchRaw = pick("research", base.research);
  let research: Dossier["research"] = base.research;
  if (isRecord(researchRaw)) {
    const rStatus = researchRaw.status === "queued" || researchRaw.status === "done" || researchRaw.status === "none" ? researchRaw.status : base.research.status;
    const claimsRaw = Array.isArray(researchRaw.claims) ? researchRaw.claims : base.research.claims;
    const claims: Dossier["research"]["claims"] = claimsRaw.flatMap((c: unknown) => {
      if (!isRecord(c) || typeof c.claim !== "string") return [];
      const evRaw = Array.isArray(c.evidence) ? c.evidence : [];
      const evidence = evRaw.flatMap((e: unknown) => isRecord(e) ? [{ source: strVal(e.source, ""), url: strVal(e.url, ""), finding: strVal(e.finding, "") }] : []);
      return [{ claim: c.claim, status: strVal(c.status, ""), evidence, note: strVal(c.note, "") }];
    });
    const psRaw = Array.isArray(researchRaw.primary_sources) ? researchRaw.primary_sources : base.research.primary_sources;
    const primary_sources: Dossier["research"]["primary_sources"] = psRaw.flatMap((p: unknown) => isRecord(p) ? [{ title: strVal(p.title, ""), url: strVal(p.url, ""), what: strVal(p.what, "") }] : []);
    research = {
      status: rStatus as Dossier["research"]["status"],
      at: typeof researchRaw.at === "string" ? researchRaw.at : researchRaw.at === null ? null : base.research.at,
      summary: strVal(researchRaw.summary, base.research.summary),
      claims, primary_sources,
      unverified: strArr(researchRaw.unverified, base.research.unverified),
    };
  }
  const demoted = boolVal(pick("demoted", base.demoted ?? false), false);
  const mergedIntoRaw = pick("merged_into", base.merged_into ?? null);
  const closingSummary = strVal(pick("closing_summary", base.closing_summary ?? ""), "");
  return {
    id,
    title: strVal(pick("title", base.title), base.title),
    topic: strVal(pick("topic", base.topic), base.topic),
    status,
    created_at: strVal(pick("created_at", base.created_at), base.created_at),
    updated_at: strVal(pick("updated_at", base.updated_at), base.updated_at),
    state_of_play: strVal(pick("state_of_play", base.state_of_play), base.state_of_play),
    latest_delta: strVal(pick("latest_delta", base.latest_delta), base.latest_delta),
    why_it_matters: strVal(pick("why_it_matters", base.why_it_matters), base.why_it_matters),
    contested, what_to_watch, timeline, articles, evidence, scores, contention, research,
    ...(demoted ? { demoted: true } : {}),
    ...(typeof mergedIntoRaw === "string" && mergedIntoRaw ? { merged_into: mergedIntoRaw } : {}),
    ...(closingSummary ? { closing_summary: closingSummary } : {}),
  };
}
function parseDossier(raw: string): Dossier | null {
  try { return normalizeDossier(JSON.parse(raw) as unknown, null); } catch { return null; }
}
// Light per-dossier shape for the Brief tab's list load (P1 payload split):
// card data only, no research/timeline/claims/articles. `disputed` is a
// derived boolean (any contested claim with status disputed) so list cards
// can still show the tag without shipping the contested-claims array.
// `source_count` counts DISTINCT feeds in the dossier's articles (not the
// raw article count), and `single_source` is true only when that distinct
// count is exactly 1; per-claim single_source tags live only in the full
// dossier detail view.
const dossierSummaryOut = z.object({
  id: z.string(), title: z.string(), status: z.enum(["active", "quiet", "closed"]),
  latest_delta: z.string(), state_of_play: z.string(), why_it_matters: z.string(),
  updated_at: z.string(), created_at: z.string(),
  scores: z.object({ consequence: z.number(), relevance: z.number(), composite: z.number() }),
  research_status: z.enum(["none", "queued", "done"]),
  source_count: z.number(),
  next_watch: z.object({ date: z.string(), label: z.string() }).nullable(),
  disputed: z.boolean(), single_source: z.boolean(),
});
type DossierSummary = z.infer<typeof dossierSummaryOut>;
function summarizeDossier(d: Dossier): DossierSummary {
  const dated = d.what_to_watch.filter((w) => w.date).slice().sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const first = dated[0];
  const distinctFeeds = new Set(d.articles.map((a) => a.feed.trim()).filter((f) => f.length > 0));
  const sourceCount = distinctFeeds.size;
  return {
    id: d.id, title: d.title, status: d.status,
    latest_delta: d.latest_delta, state_of_play: d.state_of_play, why_it_matters: d.why_it_matters,
    updated_at: d.updated_at, created_at: d.created_at, scores: d.scores,
    research_status: d.research.status,
    source_count: sourceCount,
    next_watch: first?.date ? { date: first.date, label: first.event } : null,
    disputed: d.contested.some((c) => c.status === "disputed"),
    single_source: sourceCount === 1,
  };
}
// Dossiers the pipeline must not recreate (demoted) or must route into a
// surviving dossier (merged). Computed over ALL stored rows, including
// closed ones the main lists exclude.
function suppressedFromRows(rows: Array<{ id: string; data: string }>): Array<{ id: string; merged_into: string | null }> {
  const out: Array<{ id: string; merged_into: string | null }> = [];
  for (const row of rows) {
    let raw: unknown = null;
    try { raw = JSON.parse(row.data) as unknown; } catch { raw = null; }
    if (!isRecord(raw)) continue;
    if (typeof raw.merged_into === "string" && raw.merged_into) out.push({ id: row.id, merged_into: raw.merged_into });
    else if (raw.demoted === true) out.push({ id: row.id, merged_into: null });
  }
  return out;
}
async function withArticleIds(ctx: Ctx, dossiers: Dossier[]): Promise<Dossier[]> {
  const db = ctx.db<typeof schema>();
  const urls = [...new Set(dossiers.flatMap((d) => d.articles.map((a) => a.url)))];
  const idByUrl = new Map<string, number>();
  if (urls.length) {
    const found = await db.select({ id: schema.articles.id, url: schema.articles.url }).from(schema.articles).where(inArray(schema.articles.url, urls));
    for (const r of found) if (!idByUrl.has(r.url)) idByUrl.set(r.url, r.id);
  }
  return dossiers.map((d) => ({ ...d, articles: d.articles.map((a) => ({ ...a, article_id: idByUrl.get(a.url) ?? null })) }));
}
const dossiersResponse = z.object({
  dossiers: z.array(z.union([dossierOut, dossierSummaryOut])),
  suppressed: z.array(z.object({ id: z.string(), merged_into: z.string().nullable() })),
});
const dossierResponse = z.object({ dossier: dossierOut.nullable() });
const markOut = z.object({ dossier_id: z.string(), pinned: z.boolean(), viewed_at: z.string().nullable(), updated_at: z.string() });
const marksResponse = z.object({ marks: z.array(markOut) });
const okResponse = z.object({ ok: z.literal(true) });
function parseBriefStories(raw: string): BriefStory[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => { const r = briefStoryIn.safeParse(item); return r.success ? [r.data] : []; });
  } catch { return []; }
}
async function loadLibrary(ctx:Ctx, search:string):Promise<LibraryItem[]> {
  const db=ctx.db<typeof schema>();
  const noteRows=await db.select({id:schema.notes.id,text:schema.notes.text,createdAt:schema.notes.updatedAt,articleId:schema.articles.id,articleTitle:schema.articles.title,articleUrl:schema.articles.url,feed:schema.feeds.title,theme:schema.themes.name}).from(schema.notes).innerJoin(schema.articles,eq(schema.notes.articleId,schema.articles.id)).innerJoin(schema.feeds,eq(schema.articles.feedId,schema.feeds.id)).innerJoin(schema.themes,eq(schema.feeds.themeId,schema.themes.id));
  const highlightRows=await db.select({id:schema.highlights.id,text:schema.highlights.text,createdAt:schema.highlights.createdAt,articleId:schema.articles.id,articleTitle:schema.articles.title,articleUrl:schema.articles.url,feed:schema.feeds.title,theme:schema.themes.name}).from(schema.highlights).innerJoin(schema.articles,eq(schema.highlights.articleId,schema.articles.id)).innerJoin(schema.feeds,eq(schema.articles.feedId,schema.feeds.id)).innerJoin(schema.themes,eq(schema.feeds.themeId,schema.themes.id));
  const term=search.toLowerCase();
  return [...noteRows.map(n=>({...n,kind:"note" as const})),...highlightRows.map(h=>({...h,kind:"highlight" as const}))].filter(x=>!term||`${x.text} ${x.articleTitle} ${x.feed} ${x.theme}`.toLowerCase().includes(term)).sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()).map(x=>({id:x.id,kind:x.kind,text:x.text,created_at:x.createdAt.toISOString(),article_id:x.articleId,article_title:x.articleTitle,article_url:x.articleUrl,feed:x.feed,theme:x.theme}));
}

export const Actions = {
  initializeAndRefresh: defineAction({ description: "Initializes the feed catalog if needed and refreshes all active feeds.", request:z.object({}), response:z.object({new_count:z.number(),error_count:z.number(),started_at:z.string(),completed_at:z.string()}), handler:runRefresh }),
  refresh_feeds: defineAction({ description: "Refreshes all active, unmuted RSS and Atom feeds and records the pull result.", request:z.object({}), response:z.object({new_count:z.number(),error_count:z.number(),started_at:z.string(),completed_at:z.string()}), handler:runRefresh }),
  repair_marginal_links: defineAction({
    description: "Repairs saved Marginal Revolution article links from the current feed entries.", request:z.object({}),response:z.object({updated:z.number(),error:z.string().nullable()}),
    async handler(ctx){
      const db=ctx.db<typeof schema>();
      const [feed]=await db.select({id:schema.feeds.id,url:schema.feeds.url}).from(schema.feeds).where(eq(schema.feeds.title,"Marginal REVOLUTION")).limit(1);
      if(!feed)return{updated:0,error:"Marginal REVOLUTION feed is not subscribed."};
      const result=await fetchOne(feed);
      if(!result.ok)return{updated:0,error:result.error};
      let updated=0;
      for(const item of result.items){
        const rows=await db.update(schema.articles).set({url:item.url,title:item.title,author:item.author,excerpt:item.excerpt,body:item.body,publishedAt:item.published}).where(and(eq(schema.articles.feedId,feed.id),eq(schema.articles.guid,item.guid))).returning({id:schema.articles.id});
        updated+=rows.length;
      }
      ctx.invalidateQueries();
      return{updated,error:null};
    }
  }),

  dashboard: defineAction({
    description: "Returns themes, feeds, articles, digest, and settings for the requested reader view.", request:z.object({view:z.enum(["Main","Theme","Feed","Starred","Archive"]).default("Main"),theme:z.string().optional(),feed_id:z.number().int().optional(),search:z.string().default(""),limit:z.number().int().min(1).max(250).default(80)}), response:dashboardResponse,
    async handler(ctx,args):Promise<z.infer<typeof dashboardResponse>> {
      // Read-only load path: no maintenance writes here. autoArchive and
      // deleteExpiredArticles (which sequentially deletes expired articles'
      // image blobs) run in runRefresh on the 30-minute schedule instead;
      // doing them on every dashboard load made inbox loads slow and caused
      // intermittent 500s when they collided with a running refresh.
      await ensureCatalog(ctx); const db=ctx.db<typeof schema>();
      const feedRows=await db.select({id:schema.feeds.id,title:schema.feeds.title,url:schema.feeds.url,theme:schema.themes.name,themeId:schema.themes.id,muted:schema.feeds.muted,keepForever:schema.feeds.keepForever,fetchError:schema.feeds.fetchError,lastFetchedAt:schema.feeds.lastFetchedAt}).from(schema.feeds).innerJoin(schema.themes,eq(schema.feeds.themeId,schema.themes.id));
      const countRows=await db.select({feedId:schema.articles.feedId,unread:sql<number>`sum(case when ${schema.articles.readAt} is null and ${schema.articles.archivedAt} is null then 1 else 0 end)`}).from(schema.articles).groupBy(schema.articles.feedId);
      const countMap=new Map(countRows.map((x)=>[x.feedId,Number(x.unread)]));
      const feeds=feedRows.map((f)=>({id:f.id,title:f.title,url:f.url,theme:f.theme,theme_id:f.themeId,muted:f.muted,keep_forever:f.keepForever,unread:countMap.get(f.id)??0,fetch_error:f.fetchError,last_fetched_at:iso(f.lastFetchedAt)}));
      const themeRows=await db.select().from(schema.themes).orderBy(schema.themes.position);
      const themes=themeRows.map((t)=>({id:t.id,name:t.name,unread:feeds.filter((f)=>f.theme_id===t.id&&!f.muted).reduce((n,f)=>n+f.unread,0)}));
      const conditions:SQL<unknown>[]=[];
      if (args.view==="Main") { conditions.push(isNull(schema.articles.readAt),isNull(schema.articles.archivedAt),eq(schema.feeds.muted,false)); }
      if (args.view==="Theme") { conditions.push(isNull(schema.articles.readAt),isNull(schema.articles.archivedAt),eq(schema.feeds.muted,false)); if(args.theme) conditions.push(eq(schema.themes.name,args.theme)); }
      if (args.view==="Feed") { if(args.feed_id) conditions.push(eq(schema.articles.feedId,args.feed_id),isNull(schema.articles.archivedAt)); else conditions.push(sql`0 = 1`); }
      if (args.view==="Starred") conditions.push(eq(schema.articles.starred,true));
      if (args.view==="Archive") conditions.push(isNotNull(schema.articles.archivedAt));
      const q=args.search.trim(); if(q){const p=`%${q}%`; conditions.push(or(like(schema.articles.title,p),like(schema.articles.excerpt,p),like(schema.articles.body,p),like(schema.feeds.title,p))!);}
      const rows=await db.select({id:schema.articles.id,title:schema.articles.title,url:schema.articles.url,author:schema.articles.author,excerpt:schema.articles.excerpt,body:schema.articles.body,imageBlobKey:schema.articles.imageBlobKey,imageAlt:schema.articles.imageAlt,publishedAt:schema.articles.publishedAt,ingestedAt:schema.articles.ingestedAt,readAt:schema.articles.readAt,archivedAt:schema.articles.archivedAt,starred:schema.articles.starred,feedId:schema.feeds.id,feed:schema.feeds.title,theme:schema.themes.name}).from(schema.articles).innerJoin(schema.feeds,eq(schema.articles.feedId,schema.feeds.id)).innerJoin(schema.themes,eq(schema.feeds.themeId,schema.themes.id)).where(conditions.length?and(...conditions):undefined).orderBy(desc(sql`coalesce(${schema.articles.publishedAt}, ${schema.articles.ingestedAt})`)).limit(args.limit);
      const articles=await Promise.all(rows.map(async row=>articleOut(row,row.imageBlobKey?await ctx.blobs.getUrl(row.imageBlobKey):null)));
      const digestKey=args.view==="Theme"&&args.theme?args.theme:"Main";
      const [digest]=await db.select().from(schema.digests).where(eq(schema.digests.theme,digestKey)).orderBy(desc(schema.digests.createdAt)).limit(1);
      const [prefs]=await db.select().from(schema.settings).limit(1); const [pull]=await db.select().from(schema.pullRuns).orderBy(desc(schema.pullRuns.id)).limit(1);
      return {themes,feeds,articles,digest:digest?{markdown:digest.markdown,created_at:digest.createdAt.toISOString()}:null,archive_days:prefs?.archiveDays??7,retention_days:prefs?.retentionDays??30,last_pull:pull?{completed_at:iso(pull.completedAt),new_count:pull.newCount,error_count:pull.errorCount}:null};
    }
  }),

  board: defineAction({
    description: "Returns the kanban board: for each theme, its unread count and the most recent unread articles in that theme, so quieter themes are not buried under high-volume ones.",
    request: z.object({ search: z.string().default(""), per_theme: z.number().int().min(1).max(30).default(12) }),
    response: z.object({
      columns: z.array(z.object({ id: z.number(), name: z.string(), unread: z.number(), articles: z.array(articleSchema) })),
      last_pull: z.object({ completed_at: z.string().nullable(), new_count: z.number(), error_count: z.number() }).nullable(),
    }),
    async handler(ctx, args) {
      await ensureCatalog(ctx);
      const db = ctx.db<typeof schema>();
      const themeRows = await db.select().from(schema.themes).orderBy(schema.themes.position);
      const countRows = await db.select({ themeId: schema.feeds.themeId, feedId: schema.articles.feedId, unread: sql<number>`sum(case when ${schema.articles.readAt} is null and ${schema.articles.archivedAt} is null then 1 else 0 end)` }).from(schema.articles).innerJoin(schema.feeds, eq(schema.articles.feedId, schema.feeds.id)).where(eq(schema.feeds.muted, false)).groupBy(schema.feeds.themeId, schema.articles.feedId);
      // unread per theme (only unmuted feeds, matching dashboard)
      const unreadByTheme = new Map<number, number>();
      for (const r of countRows) unreadByTheme.set(r.themeId, (unreadByTheme.get(r.themeId) ?? 0) + Number(r.unread ?? 0));
      const q = args.search.trim();
      // Query each theme separately for its newest per_theme articles. The
      // old shape fetched one global window of the 800 newest unread rows
      // and bucketed them, which defeats the board's purpose: a high-volume
      // theme (News, 1,000+ unread) fills the window with its own newest
      // items and a quiet theme whose latest article is older than the
      // window's tail renders empty or stale even though it has unread
      // articles. Per-theme queries also cut the rows read from ~800 full
      // bodies to at most themes x per_theme.
      const columns = await Promise.all(themeRows.map(async (t) => {
        const conditions: SQL<unknown>[] = [isNull(schema.articles.readAt), isNull(schema.articles.archivedAt), eq(schema.feeds.muted, false), eq(schema.themes.id, t.id)];
        if (q) { const p = `%${q}%`; const searchCond = or(like(schema.articles.title, p), like(schema.articles.excerpt, p), like(schema.articles.body, p), like(schema.feeds.title, p)); if (searchCond) conditions.push(searchCond); }
        const list = await db.select({ id: schema.articles.id, title: schema.articles.title, url: schema.articles.url, author: schema.articles.author, excerpt: schema.articles.excerpt, body: schema.articles.body, imageBlobKey: schema.articles.imageBlobKey, imageAlt: schema.articles.imageAlt, publishedAt: schema.articles.publishedAt, ingestedAt: schema.articles.ingestedAt, readAt: schema.articles.readAt, archivedAt: schema.articles.archivedAt, starred: schema.articles.starred, feedId: schema.feeds.id, feed: schema.feeds.title, theme: schema.themes.name, themeId: schema.themes.id }).from(schema.articles).innerJoin(schema.feeds, eq(schema.articles.feedId, schema.feeds.id)).innerJoin(schema.themes, eq(schema.feeds.themeId, schema.themes.id)).where(and(...conditions)).orderBy(desc(sql`coalesce(${schema.articles.publishedAt}, ${schema.articles.ingestedAt})`)).limit(args.per_theme);
        const articles = await Promise.all(list.map(async (row) => articleOut(row, row.imageBlobKey ? await ctx.blobs.getUrl(row.imageBlobKey) : null)));
        return { id: t.id, name: t.name, unread: unreadByTheme.get(t.id) ?? 0, articles };
      }));
      const [pull] = await db.select().from(schema.pullRuns).orderBy(desc(schema.pullRuns.id)).limit(1);
      return { columns, last_pull: pull ? { completed_at: iso(pull.completedAt), new_count: pull.newCount, error_count: pull.errorCount } : null };
    }
  }),

  getArticle: defineAction({description: "Returns one article with its full body, note, and highlights.", request:z.object({id:z.number().int()}),response:z.object({article:articleSchema.extend({body:z.string().nullable(),note:z.string().nullable(),highlights:z.array(z.object({id:z.number(),text:z.string(),created_at:z.string()})),photos:z.array(z.object({id:z.number(),url:z.string(),caption:z.string().nullable(),credit:z.string().nullable(),alt:z.string().nullable(),position:z.number()}))})}),async handler(ctx,args){const db=ctx.db<typeof schema>();const [row]=await db.select({id:schema.articles.id,title:schema.articles.title,url:schema.articles.url,author:schema.articles.author,excerpt:schema.articles.excerpt,body:schema.articles.body,imageBlobKey:schema.articles.imageBlobKey,imageAlt:schema.articles.imageAlt,publishedAt:schema.articles.publishedAt,ingestedAt:schema.articles.ingestedAt,readAt:schema.articles.readAt,archivedAt:schema.articles.archivedAt,starred:schema.articles.starred,feedId:schema.feeds.id,feed:schema.feeds.title,theme:schema.themes.name}).from(schema.articles).innerJoin(schema.feeds,eq(schema.articles.feedId,schema.feeds.id)).innerJoin(schema.themes,eq(schema.feeds.themeId,schema.themes.id)).where(eq(schema.articles.id,args.id)).limit(1);if(!row) throw new Error("Article not found");const [note]=await db.select().from(schema.notes).where(eq(schema.notes.articleId,args.id)).orderBy(desc(schema.notes.updatedAt)).limit(1);const hs=await db.select().from(schema.highlights).where(eq(schema.highlights.articleId,args.id)).orderBy(desc(schema.highlights.createdAt));const imageUrl=row.imageBlobKey?await ctx.blobs.getUrl(row.imageBlobKey):null;const photoRows=await db.select().from(schema.articlePhotos).where(eq(schema.articlePhotos.articleId,args.id)).orderBy(schema.articlePhotos.position);const photos=await Promise.all(photoRows.map(async p=>({id:p.id,url:await ctx.blobs.getUrl(p.blobKey),caption:p.caption,credit:p.credit,alt:p.alt,position:p.position})));return{article:{...articleOut(row,imageUrl),body:row.body,note:note?.text??null,highlights:hs.map(h=>({id:h.id,text:h.text,created_at:h.createdAt.toISOString()})),photos}};}}),

  fetch_full_text: defineAction({
    description: "Fetches an article's original page server-side, extracts the main article text, and saves it as the article body when it is longer than the stored snippet.",
    request: z.object({ id: z.number().int() }),
    response: z.object({ ok: z.boolean(), body_chars: z.number(), error: z.string().nullable() }),
    async handler(ctx, args): Promise<{ ok: boolean; body_chars: number; error: string | null }> {
      const db = ctx.db<typeof schema>();
      const [row] = await db.select({ id: schema.articles.id, url: schema.articles.url, body: schema.articles.body }).from(schema.articles).where(eq(schema.articles.id, args.id)).limit(1);
      if (!row) return { ok: false, body_chars: 0, error: "That article is no longer available." };
      const existingChars = plain(row.body ?? "").length;
      let pageUrl: URL;
      try { pageUrl = new URL(row.url); } catch { return { ok: false, body_chars: existingChars, error: "This article does not have a readable source link." }; }
      if (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:") return { ok: false, body_chars: existingChars, error: "This article does not have a readable source link." };
      let pageHtml = "";
      try {
        const response = await fetch(pageUrl.href, { headers: { "user-agent": BROWSER_UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "en-CA,en;q=0.9" }, signal: AbortSignal.timeout(20000), redirect: "follow" });
        if (!response.ok) return { ok: false, body_chars: existingChars, error: `The source site returned HTTP ${response.status}.` };
        pageHtml = await response.text();
      } catch { return { ok: false, body_chars: existingChars, error: "The source page could not be reached." }; }
      if (!pageHtml) return { ok: false, body_chars: existingChars, error: "Couldn't fetch the full text for this article." };
      if (pageHtml.length > 8_000_000) pageHtml = pageHtml.slice(0, 8_000_000);
      const extracted = extractFullTextHtml(pageHtml, pageUrl.href);
      const extractedChars = extracted ? plain(extracted).length : 0;
      if (!extracted || extractedChars < FULL_TEXT_MIN_CHARS) return { ok: false, body_chars: existingChars, error: "Couldn't fetch the full text for this article." };
      if (extractedChars <= existingChars) return { ok: false, body_chars: existingChars, error: "The source page didn't return more text than the feed already provided." };
      await db.update(schema.articles).set({ body: extracted }).where(eq(schema.articles.id, row.id));
      ctx.invalidateQueries();
      return { ok: true, body_chars: extractedChars, error: null };
    },
  }),

  fetch_photos: defineAction({
    description: "Fetches an article's original page server-side, extracts the story's photos in story order with captions and credits, stores them as owned blobs with the article, and sets the lead photo as the article image when it has none.",
    request: z.object({ id: z.number().int() }),
    response: z.object({ ok: z.boolean(), count: z.number(), error: z.string().nullable() }),
    async handler(ctx, args): Promise<{ ok: boolean; count: number; error: string | null }> {
      const db = ctx.db<typeof schema>();
      const [row] = await db.select({ id: schema.articles.id, url: schema.articles.url, imageBlobKey: schema.articles.imageBlobKey, imageAlt: schema.articles.imageAlt }).from(schema.articles).where(eq(schema.articles.id, args.id)).limit(1);
      if (!row) return { ok: false, count: 0, error: "That article is no longer available." };
      // Pulled once, persisted with the article: a second pull is a no-op
      // that reports what is already stored.
      const existing = await db.select({ id: schema.articlePhotos.id }).from(schema.articlePhotos).where(eq(schema.articlePhotos.articleId, row.id));
      if (existing.length) return { ok: true, count: existing.length, error: null };
      let pageUrl: URL;
      try { pageUrl = new URL(row.url); } catch { return { ok: false, count: 0, error: "This article does not have a readable source link." }; }
      if (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:") return { ok: false, count: 0, error: "This article does not have a readable source link." };
      let pageHtml = "";
      try {
        const response = await fetch(pageUrl.href, { headers: { "user-agent": BROWSER_UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "en-CA,en;q=0.9" }, signal: AbortSignal.timeout(20000), redirect: "follow" });
        if (!response.ok) return { ok: false, count: 0, error: `The source site returned HTTP ${response.status}.` };
        pageHtml = await response.text();
      } catch { return { ok: false, count: 0, error: "The source page could not be reached." }; }
      if (!pageHtml) return { ok: false, count: 0, error: "Couldn't pull photos for this article." };
      if (pageHtml.length > 8_000_000) pageHtml = pageHtml.slice(0, 8_000_000);
      const candidates = extractPhotoCandidates(pageHtml, pageUrl.href);
      if (!candidates.length) return { ok: false, count: 0, error: "No photos found on the source page." };
      const saved: Array<{ candidate: PhotoCandidate; key: string }> = [];
      for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        if (!candidate) continue;
        const key = await ownPulledPhoto(ctx, row.id, i, candidate.url);
        if (key) saved.push({ candidate, key });
      }
      if (!saved.length) return { ok: false, count: 0, error: "No usable photos could be saved from the source page." };
      for (let i = 0; i < saved.length; i += 1) {
        const s = saved[i];
        if (!s) continue;
        await db.insert(schema.articlePhotos).values({ articleId: row.id, blobKey: s.key, sourceUrl: s.candidate.url, caption: s.candidate.caption, credit: s.candidate.credit, alt: s.candidate.alt, position: i });
      }
      // The lead photo doubles as the article's thumbnail/reader image when
      // the feed supplied none; an existing feed image is never overwritten.
      const lead = saved[0];
      if (!row.imageBlobKey && lead) {
        await db.update(schema.articles).set({ imageBlobKey: lead.key, imageAlt: lead.candidate.alt ?? lead.candidate.caption ?? row.imageAlt }).where(eq(schema.articles.id, row.id));
      }
      ctx.invalidateQueries();
      return { ok: true, count: saved.length, error: null };
    },
  }),

  finishReading: defineAction({description: "Marks the given articles as read and archived when the reader closes.", request:z.object({ids:z.array(z.number().int()).min(1).max(120)}),response:z.object({updated:z.number()}),async handler(ctx,args){const ids=[...new Set(args.ids)];const changedAt=new Date();const updated=await ctx.db<typeof schema>().update(schema.articles).set({readAt:changedAt,archivedAt:changedAt}).where(and(inArray(schema.articles.id,ids),isNull(schema.articles.readAt))).returning({id:schema.articles.id});ctx.invalidateQueries();return{updated:updated.length};}}),

  setArticleState: defineAction({description: "Updates an article's read, starred, or archived state.", request:z.object({id:z.number().int(),read:z.boolean().optional(),starred:z.boolean().optional(),archived:z.boolean().optional()}),response:z.object({ok:z.boolean()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const values:{readAt?:Date|null;starred?:boolean;archivedAt?:Date|null}={};if(args.read!==undefined){const changedAt=args.read?new Date():null;values.readAt=changedAt;values.archivedAt=changedAt;}if(args.starred!==undefined) values.starred=args.starred;if(args.archived!==undefined){const changedAt=args.archived?new Date():null;values.archivedAt=changedAt;if(args.read===undefined)values.readAt=changedAt;}await db.update(schema.articles).set(values).where(eq(schema.articles.id,args.id));ctx.invalidateQueries();return{ok:true};}}),

  deleteArticle: defineAction({
    description: "Deletes one article along with its note and highlights and prevents its return on refresh.", request:z.object({id:z.number().int()}),
    response:z.object({ok:z.boolean(),deleted:z.boolean()}),
    async handler(ctx,args){
      const db=ctx.db<typeof schema>();
      const [article]=await db.select({id:schema.articles.id,feedId:schema.articles.feedId,guid:schema.articles.guid,imageBlobKey:schema.articles.imageBlobKey}).from(schema.articles).where(eq(schema.articles.id,args.id)).limit(1);
      if(!article)return{ok:true,deleted:false};
      await db.insert(schema.articleTombstones).values({feedId:article.feedId,guid:article.guid}).onConflictDoNothing();
      await db.delete(schema.highlights).where(eq(schema.highlights.articleId,article.id));
      await db.delete(schema.notes).where(eq(schema.notes.articleId,article.id));
      await deletePhotosForArticles(ctx,[article.id]);
      await db.delete(schema.articles).where(eq(schema.articles.id,article.id));
      if(article.imageBlobKey)await ctx.blobs.delete(article.imageBlobKey);
      ctx.invalidateQueries();
      return{ok:true,deleted:true};
    }
  }),

  markAllRead: defineAction({description: "Marks every unread article in the current view, theme, or feed as read.", request:z.object({view:z.enum(["Main","Theme","Feed"]),theme:z.string().optional(),feed_id:z.number().int().optional()}),response:z.object({updated:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();let ids:number[]=[];if(args.view==="Feed"){if(!args.feed_id)return{updated:0};ids=[args.feed_id];}else {const rows=await db.select({id:schema.feeds.id}).from(schema.feeds).innerJoin(schema.themes,eq(schema.feeds.themeId,schema.themes.id)).where(args.view==="Theme"&&args.theme?and(eq(schema.themes.name,args.theme),eq(schema.feeds.muted,false)):eq(schema.feeds.muted,false));ids=rows.map(r=>r.id);}if(!ids.length)return{updated:0};const changedAt=new Date();const updated=await db.update(schema.articles).set({readAt:changedAt,archivedAt:changedAt}).where(and(inArray(schema.articles.feedId,ids),isNull(schema.articles.readAt),isNull(schema.articles.archivedAt))).returning({id:schema.articles.id});ctx.invalidateQueries();return{updated:updated.length};}}),

  saveNote: defineAction({description: "Saves or clears the note attached to an article.", request:z.object({article_id:z.number().int(),text:z.string().max(20000)}),response:z.object({ok:z.boolean()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const text=args.text.trim();const [existing]=await db.select().from(schema.notes).where(eq(schema.notes.articleId,args.article_id)).limit(1);if(existing&&text)await db.update(schema.notes).set({text,updatedAt:new Date()}).where(eq(schema.notes.id,existing.id));else if(existing)await db.delete(schema.notes).where(eq(schema.notes.id,existing.id));else if(text)await db.insert(schema.notes).values({articleId:args.article_id,text});ctx.invalidateQueries();return{ok:true};}}),
  saveHighlight: defineAction({description: "Saves a highlighted passage from an article.", request:z.object({article_id:z.number().int(),text:z.string().min(1).max(5000)}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const [row]=await db.insert(schema.highlights).values({articleId:args.article_id,text:args.text.trim()}).returning({id:schema.highlights.id});if(!row)throw new Error("Highlight could not be saved");ctx.invalidateQueries();return{id:row.id};}}),
  deleteHighlight: defineAction({description: "Deletes one saved highlight.", request:z.object({id:z.number().int()}),response:z.object({ok:z.boolean()}),async handler(ctx,args){await ctx.db<typeof schema>().delete(schema.highlights).where(eq(schema.highlights.id,args.id));ctx.invalidateQueries();return{ok:true};}}),

  library: defineAction({description: "Lists saved notes and highlights, optionally filtered by a search term.", request:z.object({search:z.string().default("")}),response:z.object({items:z.array(z.object({id:z.number(),kind:z.enum(["note","highlight"]),text:z.string(),created_at:z.string(),article_id:z.number(),article_title:z.string(),article_url:z.string(),feed:z.string(),theme:z.string()}))}),async handler(ctx,args){return{items:await loadLibrary(ctx,args.search)};}}),

  addFeed: defineAction({
    description: "Validates and adds a new RSS or Atom feed subscription to a category.", request:z.object({url:z.string().min(1).max(2000),title:z.string().max(200).optional(),theme_id:z.number().int()}),
    response:z.object({ok:z.boolean(),id:z.number().nullable(),title:z.string().nullable(),added_count:z.number(),error:z.string().nullable()}),
    async handler(ctx,args){
      const db=ctx.db<typeof schema>();
      let url:URL;
      try { url=new URL(args.url.trim()); } catch { return {ok:false,id:null,title:null,added_count:0,error:"Enter a valid feed URL."}; }
      if(url.protocol!=="https:"&&url.protocol!=="http:") return {ok:false,id:null,title:null,added_count:0,error:"Feed URLs must start with http:// or https://."};
      const [theme]=await db.select({id:schema.themes.id}).from(schema.themes).where(eq(schema.themes.id,args.theme_id)).limit(1);
      if(!theme) return {ok:false,id:null,title:null,added_count:0,error:"Choose an available category."};
      const [existing]=await db.select({id:schema.feeds.id,title:schema.feeds.title}).from(schema.feeds).where(eq(schema.feeds.url,url.href)).limit(1);
      if(existing) return {ok:false,id:existing.id,title:existing.title,added_count:0,error:"That feed is already in your subscriptions."};
      try {
        const response=await fetch(url.href,{headers:{"user-agent":"MuseNewsReader/1.0",accept:"application/rss+xml, application/atom+xml, application/xml, text/xml, */*"},signal:AbortSignal.timeout(18000),redirect:"follow"});
        if(!response.ok) throw new Error(`HTTP ${response.status}`);
        const xml=await response.text();
        const items=parseFeed(xml,response.url||url.href);
        if(!items.length) throw new Error("No RSS or Atom entries found");
        const suppliedTitle=args.title?.trim();
        const title=suppliedTitle||parseFeedTitle(xml)||url.hostname;
        const [feed]=await db.insert(schema.feeds).values({themeId:args.theme_id,title,url:url.href,lastFetchedAt:new Date()}).returning({id:schema.feeds.id});
        if(!feed) return {ok:false,id:null,title:null,added_count:0,error:"The feed could not be added."};
        let addedCount=0;
        const imageCandidates:Array<{articleId:number;url:string;alt:string}>=[];
        for(const item of items){
          const inserted=await db.insert(schema.articles).values({feedId:feed.id,guid:item.guid,url:item.url,title:item.title,author:item.author,excerpt:item.excerpt,body:item.body,publishedAt:item.published}).onConflictDoNothing().returning({id:schema.articles.id});
          addedCount+=inserted.length;
          const created=inserted[0];
          if(created&&item.imageUrl)imageCandidates.push({articleId:created.id,url:item.imageUrl,alt:item.imageAlt??item.title});
        }
        await concurrentMap(imageCandidates,async candidate=>{const key=await ownArticleImage(ctx,candidate.articleId,candidate.url);if(key)await db.update(schema.articles).set({imageBlobKey:key,imageAlt:candidate.alt}).where(eq(schema.articles.id,candidate.articleId));return key;},6);
        ctx.invalidateQueries();
        return {ok:true,id:feed.id,title,added_count:addedCount,error:null};
      } catch(e) { return {ok:false,id:null,title:null,added_count:0,error:safeError(e)}; }
    }
  }),
  updateFeed: defineAction({description: "Updates a feed's muted state, keep-forever flag, or category.", request:z.object({id:z.number().int(),muted:z.boolean().optional(),keep_forever:z.boolean().optional(),theme_id:z.number().int().optional()}),response:z.object({ok:z.boolean()}),async handler(ctx,args){const values:{muted?:boolean;keepForever?:boolean;themeId?:number}={};if(args.muted!==undefined)values.muted=args.muted;if(args.keep_forever!==undefined)values.keepForever=args.keep_forever;if(args.theme_id!==undefined)values.themeId=args.theme_id;await ctx.db<typeof schema>().update(schema.feeds).set(values).where(eq(schema.feeds.id,args.id));ctx.invalidateQueries();return{ok:true};}}),
  renameTheme: defineAction({
    description: "Renames a feed category.", request:z.object({id:z.number().int(),name:z.string().min(1).max(80)}),
    response:z.object({ok:z.boolean(),name:z.string().nullable(),error:z.string().nullable()}),
    async handler(ctx,args){
      const db=ctx.db<typeof schema>();
      const name=args.name.trim();
      if(!name)return{ok:false,name:null,error:"Enter a category name."};
      const [theme]=await db.select({id:schema.themes.id}).from(schema.themes).where(eq(schema.themes.id,args.id)).limit(1);
      if(!theme)return{ok:false,name:null,error:"That category is no longer available."};
      const [duplicate]=await db.select({id:schema.themes.id}).from(schema.themes).where(eq(schema.themes.name,name)).limit(1);
      if(duplicate&&duplicate.id!==args.id)return{ok:false,name:null,error:"A category with that name already exists."};
      await db.update(schema.themes).set({name}).where(eq(schema.themes.id,args.id));
      ctx.invalidateQueries();
      return{ok:true,name,error:null};
    }
  }),
  reorderThemes: defineAction({
    description: "Saves a new theme order (board column order and sidebar theme order) from an ordered list of theme ids.",
    request: z.object({ order: z.array(z.number().int()).min(1).max(50) }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const unique = [...new Set(args.order)];
      const existing = await db.select({ id: schema.themes.id }).from(schema.themes);
      const existingIds = new Set(existing.map((t) => t.id));
      for (let i = 0; i < unique.length; i += 1) {
        const id = unique[i];
        if (id !== undefined && existingIds.has(id)) await db.update(schema.themes).set({ position: i }).where(eq(schema.themes.id, id));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  deleteFeed: defineAction({description: "Deletes a feed subscription and all of its saved articles and annotations.", request:z.object({id:z.number().int()}),response:z.object({ok:z.boolean()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const articleRows=await db.select({id:schema.articles.id,imageBlobKey:schema.articles.imageBlobKey}).from(schema.articles).where(eq(schema.articles.feedId,args.id));const articleIds=articleRows.map(row=>row.id);if(articleIds.length){await db.delete(schema.highlights).where(inArray(schema.highlights.articleId,articleIds));await db.delete(schema.notes).where(inArray(schema.notes.articleId,articleIds));await deletePhotosForArticles(ctx,articleIds);await db.delete(schema.articles).where(eq(schema.articles.feedId,args.id));for(const row of articleRows){if(row.imageBlobKey)await ctx.blobs.delete(row.imageBlobKey);}}await db.delete(schema.articleTombstones).where(eq(schema.articleTombstones.feedId,args.id));await db.delete(schema.feeds).where(eq(schema.feeds.id,args.id));ctx.invalidateQueries();return{ok:true};}}),
  setArchiveDays: defineAction({description: "Sets how many days read articles stay before auto-archiving.", request:z.object({days:z.number().int().min(1).max(365)}),response:z.object({ok:z.boolean()}),async handler(ctx,args){await ctx.db<typeof schema>().insert(schema.settings).values({id:1,archiveDays:args.days}).onConflictDoUpdate({target:schema.settings.id,set:{archiveDays:args.days}});await autoArchive(ctx);ctx.invalidateQueries();return{ok:true};}}),
  setRetentionDays: defineAction({description: "Sets the retention window and deletes expired unprotected articles.", request:z.object({days:z.number().int().min(1).max(365)}),response:z.object({ok:z.boolean(),deleted:z.number()}),async handler(ctx,args){await ctx.db<typeof schema>().insert(schema.settings).values({id:1,retentionDays:args.days}).onConflictDoUpdate({target:schema.settings.id,set:{retentionDays:args.days}});const deleted=await deleteExpiredArticles(ctx);ctx.invalidateQueries();return{ok:true,deleted};}}),

  new_articles: defineAction({description: "Returns articles ingested since a given time, grouped by theme, for digest writing.", request:z.object({since:z.string().datetime()}),response:z.object({groups:z.array(z.object({theme:z.string(),articles:z.array(z.object({title:z.string(),url:z.string(),feed:z.string(),theme:z.string(),published_at:z.string().nullable()}))}))}),async handler(ctx,args){const db=ctx.db<typeof schema>();const rows=await db.select({title:schema.articles.title,url:schema.articles.url,feed:schema.feeds.title,theme:schema.themes.name,publishedAt:schema.articles.publishedAt}).from(schema.articles).innerJoin(schema.feeds,eq(schema.articles.feedId,schema.feeds.id)).innerJoin(schema.themes,eq(schema.feeds.themeId,schema.themes.id)).where(gt(schema.articles.ingestedAt,new Date(args.since))).orderBy(desc(schema.articles.ingestedAt));const map=new Map<string,Array<{title:string;url:string;feed:string;theme:string;published_at:string|null}>>();for(const r of rows){const list=map.get(r.theme)??[];list.push({title:r.title,url:r.url,feed:r.feed,theme:r.theme,published_at:iso(r.publishedAt)});map.set(r.theme,list);}return{groups:[...map.entries()].map(([theme,articles])=>({theme,articles}))};}}),
  save_digest: defineAction({description: "Saves a generated editorial digest for Main or a theme.", request:z.object({theme:z.string().min(1),markdown:z.string().min(1).max(30000)}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const [row]=await db.insert(schema.digests).values({theme:args.theme,markdown:args.markdown.trim()}).returning({id:schema.digests.id});if(!row)throw new Error("Digest could not be saved");ctx.invalidateQueries();return{id:row.id};}}),

  save_brief_edition: defineAction({
    description: "Stores one Brief edition (story clusters for a 3-hour window) produced by the external pipeline and prunes editions beyond the last 8.", request:z.object({generatedAt:z.string().datetime(),windowStart:z.string().datetime(),windowEnd:z.string().datetime(),stories:z.array(briefStoryIn).max(60)}), response:z.object({id:z.number()}),
    async handler(ctx,args){
      const db=ctx.db<typeof schema>();
      const [row]=await db.insert(schema.briefEditions).values({generatedAt:new Date(args.generatedAt),windowStart:new Date(args.windowStart),windowEnd:new Date(args.windowEnd),stories:JSON.stringify(args.stories)}).returning({id:schema.briefEditions.id});
      if(!row)throw new Error("Brief edition could not be saved");
      const keep=await db.select({id:schema.briefEditions.id}).from(schema.briefEditions).orderBy(desc(schema.briefEditions.generatedAt),desc(schema.briefEditions.id)).limit(8);
      const keepIds=keep.map(k=>k.id);
      if(keepIds.length)await db.delete(schema.briefEditions).where(notInArray(schema.briefEditions.id,keepIds));
      ctx.invalidateQueries();
      return{id:row.id};
    }
  }),

  get_brief: defineAction({
    description: "Returns stored Brief editions newest first, with each story's articles resolved to saved article ids and its feedback counts, downvotes, and dismissed flag.", request:z.object({}), response:briefResponse,
    async handler(ctx):Promise<z.infer<typeof briefResponse>> {
      const db=ctx.db<typeof schema>();
      const editions=await db.select().from(schema.briefEditions).orderBy(desc(schema.briefEditions.generatedAt),desc(schema.briefEditions.id)).limit(8);
      if(!editions.length)return{editions:[]};
      const editionIds=editions.map(e=>e.id);
      const feedbackRows=await db.select({editionId:schema.briefFeedback.editionId,storyKey:schema.briefFeedback.storyKey,type:schema.briefFeedback.type}).from(schema.briefFeedback).where(inArray(schema.briefFeedback.editionId,editionIds));
      type Agg={clicks:number;stars:number;dismissed:boolean;downvotes:number};
      const agg=new Map<string,Agg>();
      for(const f of feedbackRows){
        const k=`${f.editionId}:${f.storyKey}`;
        const a=agg.get(k)??{clicks:0,stars:0,dismissed:false,downvotes:0};
        if(f.type==="click")a.clicks+=1;
        else if(f.type==="star")a.stars+=1;
        else if(f.type==="unstar")a.stars=Math.max(0,a.stars-1);
        else if(f.type==="dismiss")a.dismissed=true;
        else if(f.type==="downvote")a.downvotes+=1;
        else if(f.type==="undownvote")a.downvotes=Math.max(0,a.downvotes-1);
        agg.set(k,a);
      }
      const parsed=editions.map(e=>({edition:e,stories:parseBriefStories(e.stories)}));
      const urls=[...new Set(parsed.flatMap(p=>p.stories.flatMap(s=>s.articles.map(a=>a.url))))];
      const idByUrl=new Map<string,number>();
      if(urls.length){
        const rows=await db.select({id:schema.articles.id,url:schema.articles.url}).from(schema.articles).where(inArray(schema.articles.url,urls));
        for(const r of rows)if(!idByUrl.has(r.url))idByUrl.set(r.url,r.id);
      }
      return{editions:parsed.map(({edition,stories})=>({
        id:edition.id,generated_at:edition.generatedAt.toISOString(),window_start:edition.windowStart.toISOString(),window_end:edition.windowEnd.toISOString(),
        stories:stories.map(s=>{
          const a=agg.get(`${edition.id}:${s.key}`)??{clicks:0,stars:0,dismissed:false,downvotes:0};
          return{...s,articles:s.articles.map(x=>({...x,article_id:idByUrl.get(x.url)??null})),clicks:a.clicks,stars:a.stars,starred:a.stars>0,dismissed:a.dismissed,downvotes:a.downvotes,downvoted:a.downvotes>0};
        }),
      }))};
    }
  }),

  article_bodies: defineAction({
    description: "Returns stored article bodies as plain text for the given URLs, for the external Brief pipeline to summarize full story content.",
    request: z.object({ urls: z.array(z.string().min(1).max(4000)).max(200) }),
    response: z.object({
      results: z.array(z.object({
        url: z.string(),
        found: z.boolean(),
        feed: z.string(),
        bodyChars: z.number(),
        body: z.string(),
      })),
    }),
    async handler(ctx, args): Promise<{ results: Array<{ url: string; found: boolean; feed: string; bodyChars: number; body: string }> }> {
      const db = ctx.db<typeof schema>();
      const uniqueUrls = [...new Set(args.urls)];
      const byUrl = new Map<string, { feed: string; body: string | null }>();
      if (uniqueUrls.length) {
        const rows = await db.select({ url: schema.articles.url, body: schema.articles.body, feed: schema.feeds.title })
          .from(schema.articles)
          .innerJoin(schema.feeds, eq(schema.articles.feedId, schema.feeds.id))
          .where(inArray(schema.articles.url, uniqueUrls));
        for (const row of rows) {
          if (!byUrl.has(row.url)) byUrl.set(row.url, { feed: row.feed, body: row.body });
        }
      }
      const results = args.urls.map((url) => {
        const match = byUrl.get(url);
        if (!match) return { url, found: false, feed: "", bodyChars: 0, body: "" };
        const stored = match.body ?? "";
        const text = stored ? plain(stored) : "";
        return { url, found: true, feed: match.feed, bodyChars: stored.length, body: text.slice(0, 12000) };
      });
      return { results };
    },
  }),

  log_brief_feedback: defineAction({
    description: "Records one timestamped Brief feedback event (click, star, unstar, dismiss, downvote, or undownvote) with the story's topic and lead feed for ranking stats.", request:z.object({editionId:z.number().int(),storyKey:z.string().min(1).max(300),type:z.enum(["click","star","unstar","dismiss","downvote","undownvote"]),topic:z.string().max(200).optional(),feed:z.string().max(300).optional()}), response:z.object({ok:z.boolean()}),
    async handler(ctx,args){
      const db=ctx.db<typeof schema>();
      let topic=args.topic?.trim() ? args.topic.trim() : null;
      let feed=args.feed?.trim() ? args.feed.trim() : null;
      if(topic===null||feed===null){
        const [edition]=await db.select({stories:schema.briefEditions.stories}).from(schema.briefEditions).where(eq(schema.briefEditions.id,args.editionId)).limit(1);
        if(edition){
          const stories=parseBriefStories(edition.stories);
          const story=stories.find(s=>s.key===args.storyKey);
          if(story){
            if(topic===null)topic=story.topic||null;
            if(feed===null)feed=story.articles[0]?.feed||null;
          }
        }
      }
      await db.insert(schema.briefFeedback).values({editionId:args.editionId,storyKey:args.storyKey,type:args.type,topic,feed});
      ctx.invalidateQueries();
      return{ok:true};
    }
  }),

  get_brief_feedback_stats: defineAction({
    description: "Returns Brief feedback aggregates for the trailing 30 days grouped by lead feed and by topic, for the external pipeline to downrank or boost stories.", request:z.object({}), response:z.object({byFeed:z.record(z.string(),z.object({downvotes:z.number(),stars:z.number(),clicks:z.number()})),byTopic:z.record(z.string(),z.object({downvotes:z.number(),stars:z.number(),clicks:z.number()}))}),
    async handler(ctx){
      const db=ctx.db<typeof schema>();
      const cutoff=new Date(Date.now()-30*86400000);
      const rows=await db.select({editionId:schema.briefFeedback.editionId,storyKey:schema.briefFeedback.storyKey,type:schema.briefFeedback.type,topic:schema.briefFeedback.topic,feed:schema.briefFeedback.feed,createdAt:schema.briefFeedback.createdAt}).from(schema.briefFeedback).where(gt(schema.briefFeedback.createdAt,cutoff));
      // Resolve topic/feed for legacy rows that predate those columns.
      const missingEditionIds=[...new Set(rows.filter(r=>!r.topic||!r.feed).map(r=>r.editionId))];
      const storyMeta=new Map<string,{topic:string|null;feed:string|null}>();
      if(missingEditionIds.length){
        const editions=await db.select({id:schema.briefEditions.id,stories:schema.briefEditions.stories}).from(schema.briefEditions).where(inArray(schema.briefEditions.id,missingEditionIds));
        for(const ed of editions){
          const stories=parseBriefStories(ed.stories);
          for(const s of stories)storyMeta.set(`${ed.id}:${s.key}`,{topic:s.topic||null,feed:s.articles[0]?.feed||null});
        }
      }
      type Stat={downvotes:number;stars:number;clicks:number};
      const byFeedMap=new Map<string,Stat>();
      const byTopicMap=new Map<string,Stat>();
      const ensure=(map:Map<string,Stat>,key:string):Stat=>{const existing=map.get(key);if(existing)return existing;const created:Stat={downvotes:0,stars:0,clicks:0};map.set(key,created);return created;};
      for(const r of rows){
        const fallback=storyMeta.get(`${r.editionId}:${r.storyKey}`);
        const feed=r.feed||fallback?.feed||"";
        const topic=r.topic||fallback?.topic||"";
        const apply=(map:Map<string,Stat>,key:string)=>{
          if(!key)return;
          const s=ensure(map,key);
          if(r.type==="click")s.clicks+=1;
          else if(r.type==="star")s.stars+=1;
          else if(r.type==="unstar")s.stars-=1;
          else if(r.type==="downvote")s.downvotes+=1;
          else if(r.type==="undownvote")s.downvotes-=1;
        };
        apply(byFeedMap,feed);
        apply(byTopicMap,topic);
      }
      const toRecord=(map:Map<string,Stat>):Record<string,Stat>=>{
        const out:Record<string,Stat>={};
        for(const [k,v] of map)out[k]={downvotes:Math.max(0,v.downvotes),stars:Math.max(0,v.stars),clicks:Math.max(0,v.clicks)};
        return out;
      };
      return{byFeed:toRecord(byFeedMap),byTopic:toRecord(byTopicMap)};
    }
  }),

  get_dossiers: defineAction({
    description: "Returns Brief dossiers plus the suppressed list (demoted/merged ids). Default: full objects for non-closed dossiers. With summary:true, light card objects instead; with closed:true, full objects for closed dossiers only (the archive view).",
    request: z.object({ summary: z.boolean().optional(), closed: z.boolean().optional() }), response: dossiersResponse,
    async handler(ctx, args): Promise<z.infer<typeof dossiersResponse>> {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.briefDossiers);
      const suppressed = suppressedFromRows(rows);
      const parsed = rows.flatMap((r) => { const d = parseDossier(r.data); return d ? [d] : []; });
      const byUpdatedDesc = (a: Dossier, b: Dossier) => (b.updated_at || "").localeCompare(a.updated_at || "");
      if (args.closed) {
        const closed = parsed.filter((d) => d.status === "closed").sort(byUpdatedDesc);
        return { dossiers: await withArticleIds(ctx, closed), suppressed };
      }
      const open = parsed.filter((d) => d.status !== "closed").sort(byUpdatedDesc);
      if (args.summary) return { dossiers: open.map(summarizeDossier), suppressed };
      return { dossiers: await withArticleIds(ctx, open), suppressed };
    },
  }),

  get_dossier: defineAction({
    description: "Returns one full Brief dossier by id (any status, including closed), with source articles resolved to saved article ids, or null when it does not exist.",
    request: z.object({ id: z.string().min(1).max(300) }), response: dossierResponse,
    async handler(ctx, args): Promise<z.infer<typeof dossierResponse>> {
      const db = ctx.db<typeof schema>();
      const [row] = await db.select().from(schema.briefDossiers).where(eq(schema.briefDossiers.id, args.id)).limit(1);
      if (!row) return { dossier: null };
      const d = parseDossier(row.data);
      if (!d) return { dossier: null };
      const [withIds] = await withArticleIds(ctx, [d]);
      return { dossier: withIds ?? d };
    },
  }),

  get_marks: defineAction({
    description: "Returns all Brief dossier marks (pinned flag and last-viewed time per dossier id).",
    request: z.object({}), response: marksResponse,
    async handler(ctx): Promise<z.infer<typeof marksResponse>> {
      const rows = await ctx.db<typeof schema>().select().from(schema.briefMarks);
      return { marks: rows.map((r) => ({ dossier_id: r.dossierId, pinned: r.pinned, viewed_at: r.viewedAt, updated_at: r.updatedAt.toISOString() })) };
    },
  }),

  set_mark: defineAction({
    description: "Partially upserts one Brief dossier mark by dossier id: sets pinned and/or viewed_at (ISO string, or null to clear) when provided.",
    request: z.object({ dossier_id: z.string().min(1).max(300), pinned: z.boolean().optional(), viewed_at: z.string().datetime().nullable().optional() }), response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const [existing] = await db.select().from(schema.briefMarks).where(eq(schema.briefMarks.dossierId, args.dossier_id)).limit(1);
      if (existing) {
        const values: { pinned?: boolean; viewedAt?: string | null; updatedAt: Date } = { updatedAt: new Date() };
        if (args.pinned !== undefined) values.pinned = args.pinned;
        if (args.viewed_at !== undefined) values.viewedAt = args.viewed_at;
        await db.update(schema.briefMarks).set(values).where(eq(schema.briefMarks.dossierId, args.dossier_id));
      } else {
        await db.insert(schema.briefMarks).values({ dossierId: args.dossier_id, pinned: args.pinned ?? false, viewedAt: args.viewed_at ?? null });
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  delete_mark: defineAction({
    description: "Deletes one Brief dossier mark by dossier id.",
    request: z.object({ dossier_id: z.string().min(1).max(300) }), response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      await ctx.db<typeof schema>().delete(schema.briefMarks).where(eq(schema.briefMarks.dossierId, args.dossier_id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  upsert_dossiers: defineAction({
    description: "Upserts Brief dossiers by id (merging partial objects over stored values with defaults) and closes the dossiers listed in close.",
    request: z.object({ dossiers: z.array(z.record(z.string(), z.unknown())).max(100).default([]), close: z.array(z.string().min(1).max(300)).max(100).default([]) }),
    response: z.object({ saved: z.array(z.string()) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const saved: string[] = [];
      for (const raw of args.dossiers) {
        const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : null;
        if (!id) continue;
        const [existingRow] = await db.select().from(schema.briefDossiers).where(eq(schema.briefDossiers.id, id)).limit(1);
        const existing = existingRow ? parseDossier(existingRow.data) : null;
        const normalized = normalizeDossier(raw, existing);
        if (!normalized) continue;
        const updatedAt = new Date(normalized.updated_at);
        const updated = Number.isNaN(updatedAt.getTime()) ? new Date() : updatedAt;
        const createdAt = existingRow?.createdAt ?? new Date(normalized.created_at);
        if (existingRow) {
          await db.update(schema.briefDossiers).set({ data: JSON.stringify(normalized), status: normalized.status, updatedAt: updated }).where(eq(schema.briefDossiers.id, id));
        } else {
          await db.insert(schema.briefDossiers).values({ id, data: JSON.stringify(normalized), status: normalized.status, updatedAt: updated, createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt });
        }
        saved.push(id);
      }
      for (const id of args.close) {
        const [existingRow] = await db.select().from(schema.briefDossiers).where(eq(schema.briefDossiers.id, id)).limit(1);
        if (existingRow) {
          const existing = parseDossier(existingRow.data);
          if (existing) {
            const closed: Dossier = { ...existing, status: "closed", updated_at: new Date().toISOString() };
            await db.update(schema.briefDossiers).set({ data: JSON.stringify(closed), status: "closed", updatedAt: new Date() }).where(eq(schema.briefDossiers.id, id));
          } else {
            await db.update(schema.briefDossiers).set({ status: "closed", updatedAt: new Date() }).where(eq(schema.briefDossiers.id, id));
          }
        } else {
          const now = new Date();
          const placeholder = normalizeDossier({ id, status: "closed", created_at: now.toISOString(), updated_at: now.toISOString() }, null);
          if (placeholder) await db.insert(schema.briefDossiers).values({ id, data: JSON.stringify(placeholder), status: "closed", updatedAt: now, createdAt: now });
        }
        if (!saved.includes(id)) saved.push(id);
      }
      ctx.invalidateQueries();
      return { saved };
    },
  }),

  exportOpml: defineAction({description: "Exports all feed subscriptions and categories as an OPML file.", request:z.object({}),response:z.object({filename:z.string(),content:z.string()}),async handler(ctx){await ensureCatalog(ctx);const db=ctx.db<typeof schema>();const rows=await db.select({theme:schema.themes.name,title:schema.feeds.title,url:schema.feeds.url}).from(schema.feeds).innerJoin(schema.themes,eq(schema.feeds.themeId,schema.themes.id)).orderBy(schema.themes.position,schema.feeds.title);const esc=(s:string)=>s.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");const groups=new Map<string,typeof rows>();for(const r of rows){const list=groups.get(r.theme)??[];list.push(r);groups.set(r.theme,list);}const body=[...groups.entries()].map(([theme,items])=>`    <outline text="${esc(theme)}">\n${items.map(i=>`      <outline text="${esc(i.title)}" type="rss" xmlUrl="${esc(i.url)}"/>`).join("\n")}\n    </outline>`).join("\n");return{filename:"news-feeds.opml",content:`<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>News feeds</title></head><body>\n${body}\n</body></opml>`};}}),
  exportMarkdown: defineAction({description: "Exports all notes and highlights as a Markdown document.", request:z.object({}),response:z.object({filename:z.string(),content:z.string()}),async handler(ctx){const items=await loadLibrary(ctx,"");const content=["# News notes and highlights","",...items.flatMap((i:LibraryItem)=>[`## ${i.article_title}`,`_${i.kind} · ${i.feed} · ${i.created_at}_`,``,i.text,``,`[Original article](${i.article_url})`,``])].join("\n");return{filename:"news-notes.md",content};}}),
} satisfies ActionsModule;
