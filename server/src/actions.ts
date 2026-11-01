import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { and, desc, eq, gt, inArray, isNotNull, isNull, like, lte, or, sql, type SQL } from "drizzle-orm";
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
    return { guid, url: url || guid, title, author, excerpt: bodyText ? bodyText.slice(0, 360) : null, body: body || null, published: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null, imageUrl:image.url, imageAlt:image.alt };
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

async function ensureCatalog(ctx: Ctx): Promise<void> {
  const db = ctx.db<typeof schema>();
  const existing = await db.select({ id: schema.themes.id }).from(schema.themes).limit(1);
  if (existing.length) return;
  const names = ["Arts", "Blogs", "Laundry List", "Music", "News", "Tech"];
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

async function runRefresh(ctx: Ctx): Promise<{new_count:number;error_count:number;started_at:string;completed_at:string}> {
  await ensureCatalog(ctx); await autoArchive(ctx); await deleteExpiredArticles(ctx);
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

  getArticle: defineAction({description: "Returns one article with its full body, note, and highlights.", request:z.object({id:z.number().int()}),response:z.object({article:articleSchema.extend({body:z.string().nullable(),note:z.string().nullable(),highlights:z.array(z.object({id:z.number(),text:z.string(),created_at:z.string()}))})}),async handler(ctx,args){const db=ctx.db<typeof schema>();const [row]=await db.select({id:schema.articles.id,title:schema.articles.title,url:schema.articles.url,author:schema.articles.author,excerpt:schema.articles.excerpt,body:schema.articles.body,imageBlobKey:schema.articles.imageBlobKey,imageAlt:schema.articles.imageAlt,publishedAt:schema.articles.publishedAt,ingestedAt:schema.articles.ingestedAt,readAt:schema.articles.readAt,archivedAt:schema.articles.archivedAt,starred:schema.articles.starred,feedId:schema.feeds.id,feed:schema.feeds.title,theme:schema.themes.name}).from(schema.articles).innerJoin(schema.feeds,eq(schema.articles.feedId,schema.feeds.id)).innerJoin(schema.themes,eq(schema.feeds.themeId,schema.themes.id)).where(eq(schema.articles.id,args.id)).limit(1);if(!row) throw new Error("Article not found");const [note]=await db.select().from(schema.notes).where(eq(schema.notes.articleId,args.id)).orderBy(desc(schema.notes.updatedAt)).limit(1);const hs=await db.select().from(schema.highlights).where(eq(schema.highlights.articleId,args.id)).orderBy(desc(schema.highlights.createdAt));const imageUrl=row.imageBlobKey?await ctx.blobs.getUrl(row.imageBlobKey):null;return{article:{...articleOut(row,imageUrl),body:row.body,note:note?.text??null,highlights:hs.map(h=>({id:h.id,text:h.text,created_at:h.createdAt.toISOString()}))}};}}),

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
  deleteFeed: defineAction({description: "Deletes a feed subscription and all of its saved articles and annotations.", request:z.object({id:z.number().int()}),response:z.object({ok:z.boolean()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const articleRows=await db.select({id:schema.articles.id}).from(schema.articles).where(eq(schema.articles.feedId,args.id));const articleIds=articleRows.map(row=>row.id);if(articleIds.length){await db.delete(schema.highlights).where(inArray(schema.highlights.articleId,articleIds));await db.delete(schema.notes).where(inArray(schema.notes.articleId,articleIds));await db.delete(schema.articles).where(eq(schema.articles.feedId,args.id));}await db.delete(schema.articleTombstones).where(eq(schema.articleTombstones.feedId,args.id));await db.delete(schema.feeds).where(eq(schema.feeds.id,args.id));ctx.invalidateQueries();return{ok:true};}}),
  setArchiveDays: defineAction({description: "Sets how many days read articles stay before auto-archiving.", request:z.object({days:z.number().int().min(1).max(365)}),response:z.object({ok:z.boolean()}),async handler(ctx,args){await ctx.db<typeof schema>().insert(schema.settings).values({id:1,archiveDays:args.days}).onConflictDoUpdate({target:schema.settings.id,set:{archiveDays:args.days}});await autoArchive(ctx);ctx.invalidateQueries();return{ok:true};}}),
  setRetentionDays: defineAction({description: "Sets the retention window and deletes expired unprotected articles.", request:z.object({days:z.number().int().min(1).max(365)}),response:z.object({ok:z.boolean(),deleted:z.number()}),async handler(ctx,args){await ctx.db<typeof schema>().insert(schema.settings).values({id:1,retentionDays:args.days}).onConflictDoUpdate({target:schema.settings.id,set:{retentionDays:args.days}});const deleted=await deleteExpiredArticles(ctx);ctx.invalidateQueries();return{ok:true,deleted};}}),

  new_articles: defineAction({description: "Returns articles ingested since a given time, grouped by theme, for digest writing.", request:z.object({since:z.string().datetime()}),response:z.object({groups:z.array(z.object({theme:z.string(),articles:z.array(z.object({title:z.string(),url:z.string(),feed:z.string(),theme:z.string(),published_at:z.string().nullable()}))}))}),async handler(ctx,args){const db=ctx.db<typeof schema>();const rows=await db.select({title:schema.articles.title,url:schema.articles.url,feed:schema.feeds.title,theme:schema.themes.name,publishedAt:schema.articles.publishedAt}).from(schema.articles).innerJoin(schema.feeds,eq(schema.articles.feedId,schema.feeds.id)).innerJoin(schema.themes,eq(schema.feeds.themeId,schema.themes.id)).where(gt(schema.articles.ingestedAt,new Date(args.since))).orderBy(desc(schema.articles.ingestedAt));const map=new Map<string,Array<{title:string;url:string;feed:string;theme:string;published_at:string|null}>>();for(const r of rows){const list=map.get(r.theme)??[];list.push({title:r.title,url:r.url,feed:r.feed,theme:r.theme,published_at:iso(r.publishedAt)});map.set(r.theme,list);}return{groups:[...map.entries()].map(([theme,articles])=>({theme,articles}))};}}),
  save_digest: defineAction({description: "Saves a generated editorial digest for Main or a theme.", request:z.object({theme:z.string().min(1),markdown:z.string().min(1).max(30000)}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const [row]=await db.insert(schema.digests).values({theme:args.theme,markdown:args.markdown.trim()}).returning({id:schema.digests.id});if(!row)throw new Error("Digest could not be saved");ctx.invalidateQueries();return{id:row.id};}}),

  exportOpml: defineAction({description: "Exports all feed subscriptions and categories as an OPML file.", request:z.object({}),response:z.object({filename:z.string(),content:z.string()}),async handler(ctx){await ensureCatalog(ctx);const db=ctx.db<typeof schema>();const rows=await db.select({theme:schema.themes.name,title:schema.feeds.title,url:schema.feeds.url}).from(schema.feeds).innerJoin(schema.themes,eq(schema.feeds.themeId,schema.themes.id)).orderBy(schema.themes.position,schema.feeds.title);const esc=(s:string)=>s.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");const groups=new Map<string,typeof rows>();for(const r of rows){const list=groups.get(r.theme)??[];list.push(r);groups.set(r.theme,list);}const body=[...groups.entries()].map(([theme,items])=>`    <outline text="${esc(theme)}">\n${items.map(i=>`      <outline text="${esc(i.title)}" type="rss" xmlUrl="${esc(i.url)}"/>`).join("\n")}\n    </outline>`).join("\n");return{filename:"news-feeds.opml",content:`<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>News feeds</title></head><body>\n${body}\n</body></opml>`};}}),
  exportMarkdown: defineAction({description: "Exports all notes and highlights as a Markdown document.", request:z.object({}),response:z.object({filename:z.string(),content:z.string()}),async handler(ctx){const items=await loadLibrary(ctx,"");const content=["# News notes and highlights","",...items.flatMap((i:LibraryItem)=>[`## ${i.article_title}`,`_${i.kind} · ${i.feed} · ${i.created_at}_`,``,i.text,``,`[Original article](${i.article_url})`,``])].join("\n");return{filename:"news-notes.md",content};}}),
} satisfies ActionsModule;
