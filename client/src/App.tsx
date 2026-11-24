import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { SpeedReader, htmlToPlainText } from "./SpeedReader";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";

const FIELDS = actionFields<typeof Actions>();

type Dashboard = ApiResponse<typeof api, "dashboard">;
type Article = Dashboard["articles"][number];
type View = "Main" | "Board" | "Brief" | "Theme" | "Feed" | "Library" | "Organize" | "Settings";

// Keep the briefing implementation available without exposing the experience.
const BRIEFING_ENABLED = false;

type IconName = "inbox" | "board" | "brief" | "star" | "thumbDown" | "archive" | "library" | "organize" | "settings" | "refresh" | "search" | "back" | "external" | "chevron" | "up" | "down" | "trash" | "help" | "close" | "pin" | "more" | "grip";
function Icon({name,size=18}:{name:IconName;size?:number}) {
  const paths:Record<IconName,ReactNode>={
    inbox:<><path d="M4 4h16v12H4z"/><path d="M4 13h5l2 3h2l2-3h5"/></>,
    board:<><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="4" height="8" rx="1"/></>,
    brief:<><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.2 2.2M16.2 16.2l2.2 2.2M18.4 5.6l-2.2 2.2M7.8 16.2l-2.2 2.2"/><circle cx="12" cy="12" r="3.2"/></>,
    star:<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2-4.5-4.4 6.2-.9z"/>,
    thumbDown:<><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></>,
    archive:<><path d="M4 7h16v13H4z"/><path d="M3 4h18v3H3zM9 11h6"/></>,
    library:<><path d="M5 4h4v16H5zM11 4h4v16h-4zM17 5l3-1 3 15-3 1z"/></>,
    organize:<><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></>,
    settings:<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    refresh:<><path d="M20 6v5h-5"/><path d="M19 11a7 7 0 1 0 1 4"/></>,
    search:<><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    back:<path d="m15 18-6-6 6-6"/>, external:<><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v7H4V6h7"/></>,chevron:<path d="m9 18 6-6-6-6"/>,up:<path d="m6 15 6-6 6 6"/>,down:<path d="m6 9 6 6 6-6"/>,trash:<><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/><path d="M10 11v5M14 11v5"/></>,help:<><circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1.2.9-1.2 1.7M12 17h.01"/></>,close:<path d="m7 7 10 10M17 7 7 17"/>,
    pin:<><path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.7l-1.8-.9A2 2 0 0 1 15 10.8V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></>,
    more:<><circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/></>,
    grip:<><circle cx="9" cy="6" r="1.6" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.6" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.6" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.6" fill="currentColor" stroke="none"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function relativeTime(value:string|null){if(!value)return "Unknown time";const d=new Date(value);const diff=Date.now()-d.getTime();const mins=Math.max(0,Math.round(diff/60000));if(mins<1)return "now";if(mins<60)return `${mins}m`;const hrs=Math.round(mins/60);if(hrs<24)return `${hrs}h`;const days=Math.round(hrs/24);if(days<14)return `${days}d`;return new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric"}).format(d);}
// Full "… ago" phrasing for prose contexts: "just now", "5m ago", or
// "on Nov 10" for older items, where appending "ago" to the bare date
// relativeTime returns would read as "Nov 10 ago".
function agoText(value:string|null){const r=relativeTime(value);if(r==="now")return "just now";if(r==="Unknown time")return r;if(/^\d+[mhd]$/.test(r))return `${r} ago`;return `on ${r}`;}
type BriefData=ApiResponse<typeof api,"get_brief">;
type BriefEdition=BriefData["editions"][number];
type BriefStory=BriefEdition["stories"][number];
type BriefFeedbackType="click"|"star"|"unstar"|"dismiss"|"downvote"|"undownvote";
type Dossier=NonNullable<ApiResponse<typeof api,"get_dossier">["dossier"]>;
// Light list shape returned by get_dossiers {summary:true}; full dossier
// objects are fetched lazily via get_dossier only when a detail is shown.
type DossierSummary={
  id:string;title:string;status:"active"|"quiet"|"closed";latest_delta:string;state_of_play:string;why_it_matters:string;
  updated_at:string;created_at:string;scores:{consequence:number;relevance:number;composite:number};
  research_status:"none"|"queued"|"done";source_count:number;next_watch:{date:string;label:string}|null;
  disputed:boolean;single_source:boolean;
};
type DossierMark=ApiResponse<typeof api,"get_marks">["marks"][number];
type DossierRef={id:string;title:string};
type DossierActions={
  onPinToggle:(d:DossierRef)=>void;
  onCloseDossier:(d:DossierRef)=>void;
  onDemote:(d:DossierRef)=>void;
  onMerge:(d:DossierRef)=>void;
};
function contestedLabel(status:string){return status==="confirmed"?"Confirmed":status==="reported"?"Reported":status==="single_source"?"Single source":status==="disputed"?"Disputed":status;}
function watchDateLabel(value:string){try{return new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric"}).format(new Date(`${value}T00:00:00`));}catch{return value;}}
function watchDayLabel(value:string){try{return new Intl.DateTimeFormat(undefined,{weekday:"short",month:"short",day:"numeric"}).format(new Date(`${value}T00:00:00`));}catch{return value;}}
function evidenceHost(url:string){try{return new URL(url).hostname.replace(/^www\./,"");}catch{return url;}}
function evidenceDateLabel(value:string){if(!value)return "";try{const d=new Date(value);if(Number.isNaN(d.getTime()))return value;return new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",year:"numeric"}).format(d);}catch{return value;}}
function formatEvidenceBytes(bytes:number){if(!Number.isFinite(bytes)||bytes<0)return "";if(bytes<1024)return `${bytes} B`;if(bytes<1024*1024)return `${(bytes/1024).toFixed(1).replace(/\.0$/,"")} KB`;return `${(bytes/(1024*1024)).toFixed(1).replace(/\.0$/,"")} MB`;}
// Blended ranking (Brief P1): a dossier's last update counts as fresher by
// consequence x 6h + relevance x 3h, so major stories decay down the list
// slowly instead of falling below trivial newer ones.
function effectiveRankTime(d:DossierSummary){const base=new Date(d.updated_at).getTime();return (Number.isNaN(base)?0:base)+(d.scores.consequence||0)*6*3600000+(d.scores.relevance||0)*3*3600000;}
function watchWithin48h(date:string){const t=new Date(`${date}T00:00:00`).getTime();if(Number.isNaN(t))return false;const startOfToday=new Date();startOfToday.setHours(0,0,0,0);return t>=startOfToday.getTime()&&t<=Date.now()+48*3600000;}
function useMedia(query:string):boolean{
  const [matches,setMatches]=useState(()=>typeof window!=="undefined"&&typeof window.matchMedia==="function"&&window.matchMedia(query).matches);
  useEffect(()=>{const mq=window.matchMedia(query);const on=()=>setMatches(mq.matches);on();mq.addEventListener("change",on);return()=>mq.removeEventListener("change",on);},[query]);
  return matches;
}
function clockTime(value:string){return new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit"}).format(new Date(value));}
function editionTime(value:string){return new Intl.DateTimeFormat(undefined,{weekday:"short",hour:"numeric",minute:"2-digit"}).format(new Date(value));}
function DossierMenu({id,title,pinned,actions}:{id:string;title:string;pinned:boolean;actions:DossierActions}){
  const [open,setOpen]=useState(false);
  const ref:DossierRef={id,title};
  const run=(fn:(d:DossierRef)=>void)=>()=>{setOpen(false);fn(ref);};
  return <span className="dossier-menu-wrap">
    <button type="button" className="dossier-menu-button" aria-label={`Actions for dossier: ${title}`} aria-haspopup="menu" aria-expanded={open} onClick={(e)=>{e.stopPropagation();setOpen(o=>!o);}}><Icon name="more" size={18}/></button>
    {open&&<>
      <span className="dossier-menu-backdrop" aria-hidden="true" onClick={(e)=>{e.stopPropagation();setOpen(false);}}/>
      <span className="dossier-menu" role="menu">
        <button type="button" role="menuitem" onClick={run(actions.onPinToggle)}>{pinned?"Unpin":"Pin to top"}</button>
        <button type="button" role="menuitem" onClick={run(actions.onCloseDossier)}>Close dossier</button>
        <button type="button" role="menuitem" onClick={run(actions.onMerge)}>Merge into…</button>
        <button type="button" role="menuitem" className="danger" onClick={run(actions.onDemote)}>Not a developing story</button>
      </span>
    </>}
  </span>;
}
function SummaryDossierCard({dossier,index,cursor,isNew,pinned,expanded,isDesktop,actions,onToggle,onSelect,onFull}:{dossier:DossierSummary;index:number;cursor:number;isNew:boolean;pinned:boolean;expanded:boolean;isDesktop:boolean;actions:DossierActions;onToggle:(d:DossierSummary)=>void;onSelect:(d:DossierSummary)=>void;onFull:(d:DossierSummary)=>void}){
  const watch=dossier.next_watch;
  return <article className={`dossier-card ${cursor===index?"keyboard-focus":""}`} data-dossier-index={index}>
    <button type="button" className="dossier-card-main" onClick={()=>isDesktop?onSelect(dossier):onToggle(dossier)} aria-label={isDesktop?`Show dossier: ${dossier.title}`:`${expanded?"Collapse":"Expand"} dossier: ${dossier.title}`} aria-expanded={isDesktop?undefined:expanded}>
      <div className="dossier-card-top"><span className="dossier-updated">{agoText(dossier.updated_at)}</span>{isNew&&<span className="brief-chip dossier-new">New</span>}{pinned&&<span className="dossier-pin" role="img" aria-label="Pinned"><Icon name="pin" size={13}/></span>}</div>
      <h3>{dossier.title}</h3>
      {dossier.latest_delta&&<p className="dossier-delta">{dossier.latest_delta}</p>}
      <div className="brief-chips dossier-chips">
        <span className="brief-chip">{dossier.source_count===1?"1 source":`${dossier.source_count} sources`}</span>
        {dossier.disputed&&<span className="brief-chip dossier-chip-disputed">Disputed</span>}
        {dossier.single_source&&<span className="brief-chip dossier-chip-single">Single source</span>}
        {watch&&<span className="brief-chip">Watch {watchDateLabel(watch.date)}</span>}
      </div>
    </button>
    {expanded&&<div className="dossier-expanded">
      {dossier.state_of_play&&<p className="brief-why"><span>State of play</span>{dossier.state_of_play}</p>}
      {dossier.why_it_matters&&<p className="brief-why"><span>Why it matters</span>{dossier.why_it_matters}</p>}
      {watch&&<p className="dossier-expanded-watch">Next watch: {watchDayLabel(watch.date)} — {watch.label}</p>}
      <div className="dossier-expanded-actions">
        <button type="button" className="text-button" onClick={()=>onFull(dossier)}>Full dossier</button>
        <DossierMenu id={dossier.id} title={dossier.title} pinned={pinned} actions={actions}/>
      </div>
    </div>}
  </article>;
}
function DossierSections({dossier,moved,onOpenArticle}:{dossier:Dossier;moved:boolean;onOpenArticle:(dossier:Dossier,articleId:number)=>void}){
  const timeline=[...dossier.timeline].sort((a,b)=>(b.at||"").localeCompare(a.at||""));
  const researchDone=dossier.research.status==="done";
  const stateSection=dossier.state_of_play?<section className="dossier-section"><h2>State of play</h2><p>{dossier.state_of_play}</p></section>:null;
  const whySection=dossier.why_it_matters?<section className="dossier-section"><h2>Why it matters</h2><p>{dossier.why_it_matters}</p></section>:null;
  const changedSection=timeline.length>0?<section className="dossier-section"><h2>What changed</h2><ul className="dossier-timeline">{timeline.map((t,i)=><li key={`${t.at}-${i}`}><time>{t.at?new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(t.at)) : ""}</time><span>{t.text}</span></li>)}</ul></section>:null;
  return <>
    <div className="reader-heading dossier-heading"><div>{dossier.topic||"Developing"}</div><h1 tabIndex={-1}>{dossier.title}</h1>{dossier.latest_delta&&<p className="dossier-detail-delta">{dossier.latest_delta}</p>}</div>
    {moved?<>{changedSection}{stateSection}{whySection}</>:<>{stateSection}{whySection}{changedSection}</>}
    {dossier.contested.length>0&&<section className="dossier-section"><h2>Contested claims</h2><div className="dossier-claims">{dossier.contested.map((c,i)=><div className="dossier-claim" key={i}><div className="dossier-claim-top"><span className={`claim-tag claim-${c.status}`}>{contestedLabel(c.status)}</span></div><p className="dossier-claim-text">{c.claim}</p>{c.note&&<p className="dossier-claim-note">{c.note}</p>}{c.sources.length>0&&<p className="dossier-claim-sources">{c.sources.map((source,si)=>{
      // A claim's attribution is tappable when it names the feed of one of
      // the dossier's own saved articles: it opens that article (the first
      // saved article from the feed, with the rest of the dossier's
      // articles one tap away in the reader) in the overlay on top of this
      // dossier. Attributions with no matching saved article stay text.
      const match=dossier.articles.find(a=>a.article_id!==null&&a.article_id!==undefined&&a.feed.trim().toLowerCase()===source.trim().toLowerCase());
      return <span key={si}>{si>0&&<span aria-hidden="true"> · </span>}{match?<button type="button" className="dossier-claim-source" aria-label={`Open article from ${source}: ${match.title}`} onClick={()=>onOpenArticle(dossier,match.article_id as number)}>{source}<Icon name="chevron" size={12}/></button>:source}</span>;
    })}</p>}</div>)}</div></section>}
    {dossier.what_to_watch.length>0&&<section className="dossier-section"><h2>What to watch</h2><ul className="dossier-watch">{dossier.what_to_watch.map((w,i)=><li key={i}>{w.date&&<time>{watchDateLabel(w.date)}</time>}<span>{w.event}</span></li>)}</ul></section>}
    {researchDone&&<section className="dossier-section dossier-research"><h2>Research</h2>
      {dossier.research.summary&&<p>{dossier.research.summary}</p>}
      {dossier.research.claims.map((claim,i)=><div className="dossier-research-claim" key={i}><p className="dossier-claim-text"><strong>{claim.claim}</strong>{claim.status&&<span className="claim-tag">{claim.status}</span>}</p>{claim.note&&<p className="dossier-claim-note">{claim.note}</p>}{claim.evidence.length>0&&<ul className="dossier-evidence">{claim.evidence.map((ev,j)=>ev.url?<li key={j}><a href={ev.url} target="_blank" rel="noopener noreferrer">{ev.source||ev.url}</a>{ev.finding&&<span> — {ev.finding}</span>}</li>:<li key={j}><span>{ev.source}</span>{ev.finding&&<span> — {ev.finding}</span>}</li>)}</ul>}</div>)}
      {dossier.research.primary_sources.length>0&&<div className="dossier-primary"><h3>Primary sources</h3><ul>{dossier.research.primary_sources.map((p,i)=><li key={i}>{p.url?<a href={p.url} target="_blank" rel="noopener noreferrer">{p.title||p.url}</a>:<span>{p.title}</span>}{p.what&&<span> — {p.what}</span>}</li>)}</ul></div>}
      {dossier.research.unverified.length>0&&<div className="dossier-unverified"><h3>Could not verify</h3><ul>{dossier.research.unverified.map((u,i)=><li key={i}>{u}</li>)}</ul></div>}
    </section>}
    {dossier.evidence&&dossier.evidence.length>0&&<section className="dossier-section dossier-evidence-file"><h2>Evidence on file</h2><p className="dossier-evidence-note">Copies stored on the server</p><ul className="dossier-evidence-list">{dossier.evidence.map((ev,i)=>{const host=evidenceHost(ev.url);const dateLabel=evidenceDateLabel(ev.fetched_at);const sizeLabel=formatEvidenceBytes(ev.bytes);const meta=[ev.kind,host,dateLabel?`Fetched ${dateLabel}`:"",sizeLabel].filter(Boolean).join(" · ");return <li key={`${ev.url}-${i}`} className="dossier-evidence-item">{ev.url?<a href={ev.url} target="_blank" rel="noopener noreferrer" aria-label={`Open original evidence from ${host||ev.url}`}>{host||ev.url}</a>:<span>{host}</span>}{meta&&<span className="dossier-evidence-meta">{meta}</span>}</li>;})}</ul></section>}
    {dossier.articles.length>0&&<section className="dossier-section"><h2>Sources</h2><div className="brief-sources dossier-sources">{dossier.articles.map((a,i)=>a.article_id!==null&&a.article_id!==undefined
      ?<button type="button" className="brief-source" key={`${a.url}-${i}`} onClick={()=>onOpenArticle(dossier,a.article_id as number)}><b>{a.feed}</b><span>{a.title}</span><Icon name="chevron" size={14}/></button>
      :<a className="brief-source" key={`${a.url}-${i}`} href={a.url} target="_blank" rel="noopener noreferrer"><b>{a.feed}</b><span>{a.title}</span><Icon name="external" size={13}/></a>)}</div></section>}
  </>;
}
function DossierDetail({dossier,moved,pinned,actions,articleOpen=false,onClose,onOpenArticle}:{dossier:Dossier;moved:boolean;pinned:boolean;actions:DossierActions;articleOpen?:boolean;onClose:()=>void;onOpenArticle:(dossier:Dossier,articleId:number)=>void}){
  // While an article reader is stacked on top of the dossier, Escape belongs
  // to the reader (it closes the overlay and returns here); the dossier's own
  // Escape-to-close only applies when the dossier is the top layer.
  useEffect(()=>{if(articleOpen)return;const onKey=(e:globalThis.KeyboardEvent)=>{if(e.key==="Escape"){e.preventDefault();onClose();}};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey)},[onClose,articleOpen]);
  return <div className="reader-backdrop dossier-backdrop"><section className="reader dossier-detail" aria-label={`Dossier: ${dossier.title}`}>
    <header className="reader-bar"><button className="icon-button" aria-label="Close dossier" onClick={onClose}><Icon name="back"/></button><span className="dossier-detail-updated">Updated {agoText(dossier.updated_at)}</span><DossierMenu id={dossier.id} title={dossier.title} pinned={pinned} actions={actions}/></header>
    <div className="reader-scroll dossier-scroll"><DossierSections dossier={dossier} moved={moved} onOpenArticle={onOpenArticle}/></div>
  </section></div>;
}
function DossierPane({dossier,loading,moved,pinned,actions,onOpenArticle}:{dossier:Dossier|undefined;loading:boolean;moved:boolean;pinned:boolean;actions:DossierActions;onOpenArticle:(dossier:Dossier,articleId:number)=>void}){
  if(!dossier)return <div className="brief-pane-empty">{loading?"Loading dossier…":"No active dossiers to show."}</div>;
  return <div className="brief-pane-inner">
    <div className="brief-pane-head"><span>Updated {agoText(dossier.updated_at)}</span><DossierMenu id={dossier.id} title={dossier.title} pinned={pinned} actions={actions}/></div>
    <div className="brief-pane-scroll"><DossierSections dossier={dossier} moved={moved} onOpenArticle={onOpenArticle}/></div>
  </div>;
}
function StoryCard({edition,story,onOpen,onFeedback,onOpenDossier}:{edition:BriefEdition;story:BriefStory;onOpen:(story:BriefStory,articleId:number)=>void;onFeedback:(editionId:number,storyKey:string,type:BriefFeedbackType,topic?:string,feed?:string)=>void;onOpenDossier:(id:string)=>void}){
  return <article className="brief-card">
    <div className="brief-card-top">
      <div className="brief-chips"><span className="brief-chip">{story.signals.sources===1?"1 source":`${story.signals.sources} sources`}</span>{story.topic&&<span className="brief-chip">{story.topic}</span>}{story.serendipity&&<span className="brief-chip serendipity">Serendipity</span>}</div>
      <div className="brief-card-actions"><button type="button" className={story.starred?"brief-star starred":"brief-star"} aria-label={story.starred?`Unstar: ${story.headline}`:`Star: ${story.headline}`} aria-pressed={story.starred} onClick={()=>onFeedback(edition.id,story.key,story.starred?"unstar":"star",story.topic,story.articles[0]?.feed)}><Icon name="star" size={17}/></button><button type="button" className={story.downvoted?"brief-downvote downvoted":"brief-downvote"} aria-label={story.downvoted?`Remove thumbs down: ${story.headline}`:`Thumbs down: ${story.headline}`} aria-pressed={story.downvoted} title="Show less like this" onClick={()=>onFeedback(edition.id,story.key,story.downvoted?"undownvote":"downvote",story.topic,story.articles[0]?.feed)}><Icon name="thumbDown" size={16}/></button><button type="button" className="brief-dismiss" aria-label={`Dismiss: ${story.headline}`} onClick={()=>onFeedback(edition.id,story.key,"dismiss",story.topic,story.articles[0]?.feed)}><Icon name="close" size={15}/></button></div>
    </div>
    <h3>{story.headline}</h3>
    <p className="brief-summary">{story.summary}</p>
    {story.whyItMatters&&<p className="brief-why"><span>Why it matters</span>{story.whyItMatters}</p>}
    <div className="brief-sources">{story.articles.map((a,i)=>a.article_id!==null
      ?<button type="button" className="brief-source" key={`${a.url}-${i}`} onClick={()=>onOpen(story,a.article_id as number)}><b>{a.feed}</b><span>{a.title}</span><Icon name="chevron" size={14}/></button>
      :<a className="brief-source" key={`${a.url}-${i}`} href={a.url} target="_blank" rel="noopener noreferrer" onClick={()=>onFeedback(edition.id,story.key,"click",story.topic,story.articles[0]?.feed)}><b>{a.feed}</b><span>{a.title}</span><Icon name="external" size={13}/></a>)}
    </div>
    {story.dossier_id&&<button type="button" className="brief-dossier-link" onClick={()=>onOpenDossier(story.dossier_id as string)}>Developing story<Icon name="chevron" size={13}/></button>}
  </article>;
}
function EditionSection({edition,title,prelabel,onOpen,onFeedback,onOpenDossier}:{edition:BriefEdition;title:string;prelabel?:string;onOpen:(story:BriefStory,articleId:number)=>void;onFeedback:(editionId:number,storyKey:string,type:BriefFeedbackType,topic?:string,feed?:string)=>void;onOpenDossier:(id:string)=>void}){
  const visible=edition.stories.filter(s=>!s.dismissed);
  return <div className="brief-edition">
    {prelabel&&<div className="brief-earlier">{prelabel}</div>}
    <header className="brief-edition-head"><div><h2>{title}</h2><p>Covering {clockTime(edition.window_start)} – {clockTime(edition.window_end)}</p></div><span>{visible.length} {visible.length===1?"story":"stories"}</span></header>
    {visible.length===0?<p className="brief-all-dismissed">Every story in this edition was dismissed.</p>:visible.map(story=><StoryCard key={story.key} edition={edition} story={story} onOpen={onOpen} onFeedback={onFeedback} onOpenDossier={onOpenDossier}/>)}
  </div>;
}
type BriefViewProps={
  data:BriefData|undefined;loading:boolean;error:unknown;
  summaries:DossierSummary[];summariesLoading:boolean;
  activeRanked:DossierSummary[];quietList:DossierSummary[];
  movedIds:Set<string>;pinnedIds:Set<string>;marksReady:boolean;
  cursor:number;isDesktop:boolean;
  paneDossier:Dossier|undefined;paneLoading:boolean;
  actions:DossierActions;
  onOpen:(story:BriefStory,articleId:number)=>void;
  onFeedback:(editionId:number,storyKey:string,type:BriefFeedbackType,topic?:string,feed?:string)=>void;
  onShowDossier:(id:string)=>void;
  onFullDossier:(id:string)=>void;
  onSelectDossier:(d:DossierSummary)=>void;
  onToggleCard:(d:DossierSummary)=>void;
  onOpenArticle:(dossier:Dossier,articleId:number)=>void;
};
function BriefView(props:BriefViewProps){
  const {data,loading,error,summaries,summariesLoading,activeRanked,quietList,movedIds,pinnedIds,marksReady,cursor,isDesktop,paneDossier,paneLoading,actions}=props;
  const [expandedId,setExpandedId]=useState<string>();
  const [showAllActive,setShowAllActive]=useState(false);
  const [quietOpen,setQuietOpen]=useState(false);
  const [showArchive,setShowArchive]=useState(false);
  const closedQuery=useQuery({queryKey:["dossiers-closed"],queryFn:()=>api.get_dossiers({closed:true}),enabled:showArchive});
  const closedDossiers=(closedQuery.data?.dossiers??[]) as unknown as Dossier[];
  const editions=data?.editions??[];
  const latest=editions[0];
  if(showArchive){
    return <section className="brief-view brief-archive-view" aria-label="Brief archive">
      <header className="brief-archive-head"><button className="icon-button" aria-label="Back to the brief" onClick={()=>setShowArchive(false)}><Icon name="back"/></button><h2>Archive</h2></header>
      <h3 className="brief-archive-sub">Closed dossiers</h3>
      {closedQuery.isPending?<p className="library-empty">Loading closed dossiers…</p>:closedDossiers.length===0?<p className="library-empty">No closed dossiers yet.</p>:closedDossiers.map(d=><button type="button" className="brief-closed-row" key={d.id} onClick={()=>props.onFullDossier(d.id)}><span className="brief-closed-top"><span className="brief-closed-title">{d.title}</span><time>{agoText(d.updated_at)}</time></span>{d.closing_summary&&<span className="brief-closed-summary">{d.closing_summary}</span>}</button>)}
      {editions.slice(1).map(edition=><EditionSection key={edition.id} edition={edition} title={editionTime(edition.generated_at)} prelabel="Earlier" onOpen={props.onOpen} onFeedback={props.onFeedback} onOpenDossier={props.onShowDossier}/>)}
    </section>;
  }
  if((loading||summariesLoading)&&!summaries.length&&!editions.length)return <div className="state-page">Loading the brief…</div>;
  if(error&&!summaries.length&&!editions.length)return <div className="state-page"><strong>Could not load the brief.</strong><span>Try again in a moment.</span></div>;
  if(!editions.length&&!summaries.length)return <div className="state-page"><strong>No brief yet.</strong><span>The first edition arrives with the next scheduled run.</span></div>;
  const movedList=activeRanked.filter(d=>movedIds.has(d.id));
  const watchItems=activeRanked.filter(d=>d.next_watch&&watchWithin48h(d.next_watch.date)).slice().sort((a,b)=>(a.next_watch?.date??"").localeCompare(b.next_watch?.date??""));
  const visibleActive=showAllActive?activeRanked:activeRanked.slice(0,10);
  const hiddenActiveCount=activeRanked.length-visibleActive.length;
  const toggleCard=(d:DossierSummary)=>{const next=expandedId===d.id?undefined:d.id;setExpandedId(next);if(next)props.onToggleCard(d);};
  return <section className="brief-view" aria-label="Top things to know">
    <div className="brief-main-col">
      {marksReady&&(movedList.length>0
        ?<div className="brief-since">
          <div className="brief-since-top"><span>Since you last looked</span><strong>{movedList.length} {movedList.length===1?"dossier":"dossiers"} moved</strong></div>
          {movedList.slice(0,2).map(d=><button type="button" className="brief-since-line" key={d.id} onClick={()=>props.onShowDossier(d.id)}><b>{d.title}</b><span>{d.latest_delta}</span><Icon name="chevron" size={14}/></button>)}
        </div>
        :<p className="brief-caught-up">All caught up</p>)}
      {watchItems.length>0&&<div className="brief-watch-strip" aria-label="Coming up">
        {watchItems.slice(0,2).map(d=>d.next_watch&&<button type="button" className="brief-watch-line" key={d.id} onClick={()=>props.onShowDossier(d.id)}><time>{watchDayLabel(d.next_watch.date)}</time><span>{d.next_watch.label}</span></button>)}
        {watchItems.length>2&&<p className="brief-watch-more">+{watchItems.length-2} more</p>}
      </div>}
      {activeRanked.length>0&&<section className="developing-section" aria-label="Developing">
        <header className="developing-head"><h2>Developing</h2><span>{activeRanked.length} {activeRanked.length===1?"situation":"situations"}</span></header>
        {visibleActive.map((dossier,i)=><SummaryDossierCard key={dossier.id} dossier={dossier} index={i} cursor={cursor} isNew={movedIds.has(dossier.id)} pinned={pinnedIds.has(dossier.id)} expanded={expandedId===dossier.id} isDesktop={isDesktop} actions={actions} onToggle={toggleCard} onSelect={props.onSelectDossier} onFull={d=>props.onFullDossier(d.id)}/>)}
        {hiddenActiveCount>0&&<button type="button" className="brief-more-row" onClick={()=>setShowAllActive(true)}>+{hiddenActiveCount} more active</button>}
        {showAllActive&&activeRanked.length>10&&<button type="button" className="brief-more-row" onClick={()=>setShowAllActive(false)}>Show less</button>}
      </section>}
      {quietList.length>0&&<div className="brief-quiet">
        <button type="button" className="brief-quiet-toggle" aria-expanded={quietOpen} onClick={()=>setQuietOpen(o=>!o)}><span>Quiet · {quietList.length}</span><span className={`library-chevron ${quietOpen?"open":""}`}><Icon name="chevron" size={15}/></span></button>
        {quietOpen&&<div className="brief-quiet-list">{quietList.map(d=><button type="button" className="brief-quiet-row" key={d.id} onClick={()=>props.onShowDossier(d.id)}><span>{d.title}</span><time>{agoText(d.updated_at)}</time></button>)}</div>}
      </div>}
      {latest&&<div className="brief-edition">
        <header className="brief-edition-head"><div><h2>Latest window</h2><p>{editionTime(latest.generated_at)} · Covering {clockTime(latest.window_start)} – {clockTime(latest.window_end)}</p></div><span>{latest.stories.filter(s=>!s.dismissed).length} {latest.stories.filter(s=>!s.dismissed).length===1?"story":"stories"}</span></header>
        {latest.stories.filter(s=>!s.dismissed).length===0?<p className="brief-all-dismissed">Every story in this edition was dismissed.</p>:latest.stories.filter(s=>!s.dismissed).map(story=><StoryCard key={story.key} edition={latest} story={story} onOpen={props.onOpen} onFeedback={props.onFeedback} onOpenDossier={props.onShowDossier}/>)}
      </div>}
      <button type="button" className="brief-archive-row" onClick={()=>setShowArchive(true)}><Icon name="archive" size={16}/><span className="brief-archive-label">Archive</span><span className="brief-archive-hint">Closed dossiers and earlier editions</span><Icon name="chevron" size={15}/></button>
    </div>
    {isDesktop&&<aside className="brief-pane" aria-label="Selected dossier"><DossierPane dossier={paneDossier} loading={paneLoading} moved={paneDossier?movedIds.has(paneDossier.id):false} pinned={paneDossier?pinnedIds.has(paneDossier.id):false} actions={actions} onOpenArticle={props.onOpenArticle}/></aside>}
  </section>;
}
function InlineMarkdown({text}:{text:string}){
  const nodes:ReactNode[]=[];
  const pattern=/(\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let cursor=0;
  let match:RegExpExecArray|null;
  while((match=pattern.exec(text))!==null){
    const full=match[0];
    if(match.index>cursor)nodes.push(text.slice(cursor,match.index));
    const bold=match[2];
    const label=match[3];
    const href=match[4];
    if(bold!==undefined)nodes.push(<strong key={`bold-${match.index}`}>{bold}</strong>);
    else if(label!==undefined&&href!==undefined)nodes.push(<a key={`link-${match.index}`} href={href} target="_blank" rel="noopener noreferrer">{label}</a>);
    else nodes.push(full);
    cursor=match.index+full.length;
  }
  if(cursor<text.length)nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}
function Digest({digest}:{digest:Dashboard["digest"]}){if(!digest)return <section className="digest digest-empty"><div><span className="digest-label">Briefing</span><p>Your first briefing will appear after newly ingested stories are reviewed.</p></div></section>;const lines=digest.markdown.split("\n").map(x=>x.trim()).filter(Boolean);return <section className="digest"><div className="digest-top"><span className="digest-label">Briefing</span><time>{agoText(digest.created_at)}</time></div><div className="digest-copy">{lines.map((line,i)=>line.startsWith("#")?<h2 key={i}><InlineMarkdown text={line.replace(/^#+\s*/,"")}/></h2>:line.match(/^[-*]\s/)?<p className="digest-bullet" key={i}><InlineMarkdown text={line.replace(/^[-*]\s/,"")}/></p>:<p key={i}><InlineMarkdown text={line}/></p>)}</div></section>}
function downloadFile(filename:string,content:string,type:string){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function isTypingTarget(target:EventTarget|null):boolean{const element=target instanceof HTMLElement?target:null;return Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));}
// Memoized so a Reader re-render (e.g. the "Save selected text" affordance
// appearing) never re-creates the article body subtree: replacing or touching
// those DOM nodes mid-gesture collapses the user's in-progress text selection.
const ArticleContent=memo(function ArticleContent({html}:{html:string}){return <div className="reader-body-content" dangerouslySetInnerHTML={{__html:html}}/>;});
function HighlightText({text,query}:{text:string;query:string}){
  const terms=[...new Set(query.trim().split(/\s+/).filter(term=>term.length>0))];
  if(!terms.length)return <>{text}</>;
  const escaped=terms.map(term=>term.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
  const pattern=new RegExp(`(${escaped.join("|")})`,"gi");
  return <>{text.split(pattern).map((part,index)=>terms.some(term=>term.toLowerCase()===part.toLowerCase())?<mark key={index}>{part}</mark>:part)}</>;
}
function ConfirmDialog({title,body,confirmLabel="Delete",busyLabel="Deleting…",danger=true,busy=false,onCancel,onConfirm}:{title:string;body:string;confirmLabel?:string;busyLabel?:string;danger?:boolean;busy?:boolean;onCancel:()=>void;onConfirm:()=>void}){
  useEffect(()=>{const onKey=(event:globalThis.KeyboardEvent)=>{if(event.key==="Escape"&&!busy){event.preventDefault();onCancel();}};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey)},[busy,onCancel]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onCancel()}}><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{title}</h2><p>{body}</p><div className="confirm-actions"><button onClick={onCancel} disabled={busy}>Cancel</button><button className={danger?"destructive":"confirm-primary"} onClick={onConfirm} disabled={busy}>{busy?busyLabel:confirmLabel}</button></div></section></div>;
}
function ShortcutSheet({onClose}:{onClose:()=>void}){
  const rows:Array<[string,string]>=[["J / K","Move through articles"],["O","Open selected article"],["M","Toggle read or unread"],["S","Star or unstar"],["Shift + A","Mark the current list read"],["J / K, ← / →, [ / ]","Previous or next in reader"],["Space (in speed reader)","Play or pause speed reading"],["← / → (in speed reader)","Skip 10 words in speed reader"],["Esc","Close reader or this guide"],["?","Show or hide shortcuts"]];
  return <div className="modal-backdrop shortcut-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><section className="shortcut-sheet" role="dialog" aria-modal="true" aria-labelledby="shortcut-title"><header><div><h2 id="shortcut-title">Keyboard shortcuts</h2><p>Keys stay inactive while you type.</p></div><button className="icon-button" aria-label="Close keyboard shortcuts" onClick={onClose}><Icon name="close"/></button></header><dl>{rows.map(([keys,label])=><div key={keys}><dt>{keys.split(" / ").map((key,index)=><span key={key}>{index>0&&<i>/</i>}<kbd>{key}</kbd></span>)}</dt><dd>{label}</dd></div>)}</dl></section></div>;
}

export function App(){
  const qc=useQueryClient();
  const [view,setView]=useState<View>("Main"); const [theme,setTheme]=useState<string>(); const [feedId,setFeedId]=useState<number>();
  const [search,setSearch]=useState(""); const [debouncedSearch,setDebouncedSearch]=useState(""); const [listLimit,setListLimit]=useState(120); const [selectedId,setSelectedId]=useState<number>(); const [readerQueue,setReaderQueue]=useState<Article[]>([]); const [openedIds,setOpenedIds]=useState<number[]>([]); const [cursor,setCursor]=useState(0); const [notice,setNotice]=useState<string>();
  const [showShortcuts,setShowShortcuts]=useState(false); const [deleteTarget,setDeleteTarget]=useState<{id:number;title:string;fromReader:boolean}>();
  const [undoArchive,setUndoArchive]=useState<{id:number;title:string}>();
  const [archiveOpen,setArchiveOpen]=useState(false);
  const [selectedDossierId,setSelectedDossierId]=useState<string>(); const [briefCursor,setBriefCursor]=useState(0);
  const [paneDossierId,setPaneDossierId]=useState<string>();
  const [marksBase,setMarksBase]=useState<DossierMark[]|null>(null);
  const [demoteTarget,setDemoteTarget]=useState<DossierRef>();
  const [mergeSource,setMergeSource]=useState<DossierRef>();
  const [mergeTarget,setMergeTarget]=useState<DossierRef>();
  const [merging,setMerging]=useState(false);
  // History-stack bookkeeping for the Brief dossier layers (see the popstate
  // effect below): whether the dossier layer and the article-overlay layer
  // each currently own a pushed history entry.
  const dossierLayerPushed=useRef(false); const articleLayerPushed=useRef(false);
  const mutationError=()=>setNotice("That change could not be saved. Please try again.");
  // Search queries run on a debounced copy of the input: the dashboard,
  // board, and library actions each scan article bodies, so firing one per
  // keystroke wasted a full scan per character typed.
  useEffect(()=>{const t=window.setTimeout(()=>setDebouncedSearch(search),250);return()=>window.clearTimeout(t);},[search]);
  useEffect(()=>{setListLimit(120)},[view,theme,feedId,debouncedSearch]);
  const dash=useQuery({queryKey:["dashboard",view,theme,feedId,debouncedSearch,listLimit],queryFn:()=>api.dashboard({view:view==="Library"||view==="Organize"||view==="Settings"||view==="Brief"||view==="Board"?"Main":view,theme,feed_id:feedId,search:debouncedSearch,limit:listLimit})});
  const board=useQuery({queryKey:["board",debouncedSearch],queryFn:()=>api.board({search:debouncedSearch,per_theme:12}),enabled:view==="Board"});
  const brief=useQuery({queryKey:["brief"],queryFn:()=>api.get_brief({}),enabled:view==="Brief"});
  // Brief P1 initial load: light dossier summaries + marks + editions only.
  // Full dossier objects load lazily through get_dossier (detail overlay,
  // desktop pane, merge).
  const summaryQuery=useQuery({queryKey:["dossiers-summary"],queryFn:()=>api.get_dossiers({summary:true}),enabled:view==="Brief"});
  const summaries=useMemo(()=>((summaryQuery.data?.dossiers??[]) as unknown as DossierSummary[]),[summaryQuery.data]);
  const marksQuery=useQuery({queryKey:["marks"],queryFn:()=>api.get_marks({}),enabled:view==="Brief"});
  const liveMarks=marksQuery.data?.marks??[];
  const pinnedIds=useMemo(()=>new Set(liveMarks.filter(m=>m.pinned).map(m=>m.dossier_id)),[liveMarks]);
  // Snapshot of the marks as loaded when the Brief tab opened: the moved /
  // NEW computation for this visit reads the snapshot, so views recorded
  // during the visit do not reshuffle what counts as new mid-render.
  useEffect(()=>{if(view!=="Brief"){if(marksBase!==null)setMarksBase(null);return;}if(marksBase===null&&marksQuery.data)setMarksBase(marksQuery.data.marks);},[view,marksQuery.data,marksBase]);
  const movedIds=useMemo(()=>{
    const set=new Set<string>();
    if(!marksBase)return set;
    const byId=new Map(marksBase.map(m=>[m.dossier_id,m]));
    for(const d of summaries){
      if(d.status!=="active")continue;
      const mark=byId.get(d.id);
      if(!mark||mark.viewed_at===null||new Date(d.updated_at).getTime()>new Date(mark.viewed_at).getTime())set.add(d.id);
    }
    return set;
  },[marksBase,summaries]);
  const activeRanked=useMemo(()=>{
    const act=summaries.filter(d=>d.status==="active");
    act.sort((a,b)=>{const pa=pinnedIds.has(a.id)?0:1;const pb=pinnedIds.has(b.id)?0:1;if(pa!==pb)return pa-pb;return effectiveRankTime(b)-effectiveRankTime(a);});
    return act;
  },[summaries,pinnedIds]);
  const quietList=useMemo(()=>summaries.filter(d=>d.status==="quiet").slice().sort((a,b)=>(b.updated_at||"").localeCompare(a.updated_at||"")),[summaries]);
  const isDesktop=useMedia("(min-width: 1024px)");
  const paneId=paneDossierId&&activeRanked.some(d=>d.id===paneDossierId)?paneDossierId:activeRanked[0]?.id;
  const paneQuery=useQuery({queryKey:["dossier",paneId],queryFn:()=>api.get_dossier({id:paneId??""}),enabled:view==="Brief"&&isDesktop&&paneId!==undefined});
  const paneDossier=paneQuery.data?.dossier??undefined;
  const detailQuery=useQuery({queryKey:["dossier",selectedDossierId],queryFn:()=>api.get_dossier({id:selectedDossierId??""}),enabled:selectedDossierId!==undefined});
  const selectedDossier=detailQuery.data?.dossier??undefined;
  const library=useQuery({queryKey:["library",debouncedSearch],queryFn:()=>api.library({search:debouncedSearch}),enabled:view==="Library"});
  const starredDash=useQuery({queryKey:["dashboard","Starred","library",debouncedSearch],queryFn:()=>api.dashboard({view:"Starred",search:debouncedSearch,limit:120}),enabled:view==="Library"});
  const archivedDash=useQuery({queryKey:["dashboard","Archive","library",debouncedSearch],queryFn:()=>api.dashboard({view:"Archive",search:debouncedSearch,limit:120}),enabled:view==="Library"&&archiveOpen});
  const article=useQuery({queryKey:["article",selectedId],queryFn:()=>api.getArticle({id:selectedId ?? 0}),enabled:selectedId!==undefined});
  const refresh=useMutation({mutationFn:()=>api.refresh_feeds({}),onSuccess:r=>{setNotice(`${r.new_count} new · ${r.error_count} feed errors`);void qc.invalidateQueries();},onError:mutationError});
  const state=useMutation({mutationFn:(args:{id:number;read?:boolean;starred?:boolean;archived?:boolean})=>api.setArticleState(args),onSuccess:(_result,args)=>{if(args.read===false)setOpenedIds(ids=>ids.filter(id=>id!==args.id));void qc.invalidateQueries({queryKey:["dashboard"]});if(args.starred!==undefined||args.archived===false||args.read===false)void qc.invalidateQueries({queryKey:["article",args.id]});},onError:mutationError});
  const finishReading=useMutation({mutationFn:(ids:number[])=>api.finishReading({ids}),onSuccess:()=>{setSelectedId(undefined);setReaderQueue([]);setOpenedIds([]);void qc.invalidateQueries({queryKey:["dashboard"]});},onError:mutationError});
  const markAll=useMutation({mutationFn:()=>api.markAllRead({view:view==="Theme"?"Theme":view==="Feed"?"Feed":"Main",theme,feed_id:feedId}),onSuccess:r=>{setNotice(`${r.updated} marked read`);void qc.invalidateQueries();},onError:mutationError});
  const markThemeRead=useMutation({mutationFn:(themeName:string)=>api.markAllRead({view:"Theme",theme:themeName}),onSuccess:r=>{setNotice(`${r.updated} marked read`);void qc.invalidateQueries();},onError:mutationError});
  const reorderThemes=useMutation({mutationFn:(order:number[])=>api.reorderThemes({order}),onSuccess:()=>{setNotice("Board order saved");void qc.invalidateQueries({queryKey:["board"]});void qc.invalidateQueries({queryKey:["dashboard"]});},onError:mutationError});
  const addFeed=useMutation({mutationFn:(args:{url:string;title?:string;theme_id:number})=>api.addFeed(args),onSuccess:r=>{if(!r.ok){setNotice(r.error??"The feed could not be added.");return;}setNotice(`${r.title??"Feed"} added · ${r.added_count} stories`);void qc.invalidateQueries();},onError:mutationError});
  const updateFeed=useMutation({mutationFn:(args:{id:number;muted?:boolean;keep_forever?:boolean;theme_id?:number})=>api.updateFeed(args),onSuccess:()=>{setNotice("Feed settings saved");void qc.invalidateQueries();},onError:mutationError});
  const deleteFeed=useMutation({mutationFn:(id:number)=>api.deleteFeed({id}),onSuccess:()=>{setNotice("Feed deleted");void qc.invalidateQueries();},onError:mutationError});
  const setRetention=useMutation({mutationFn:(days:number)=>api.setRetentionDays({days}),onSuccess:r=>{setNotice(r.deleted?`Retention saved · ${r.deleted} old articles deleted`:"Retention saved");void qc.invalidateQueries();},onError:mutationError});
  const saveNote=useMutation({mutationFn:(args:{article_id:number;text:string})=>api.saveNote(args),onSuccess:()=>{setNotice("Note saved");void qc.invalidateQueries({queryKey:["library"]});void qc.invalidateQueries({queryKey:["article",selectedId]});},onError:mutationError});
  const saveHighlight=useMutation({mutationFn:(args:{article_id:number;text:string})=>api.saveHighlight(args),onSuccess:()=>{setNotice("Highlight saved");void qc.invalidateQueries({queryKey:["article",selectedId]});void qc.invalidateQueries({queryKey:["library"]});},onError:mutationError});
  const deleteHighlight=useMutation({mutationFn:(id:number)=>api.deleteHighlight({id}),onSuccess:()=>{setNotice("Highlight deleted");void qc.invalidateQueries({queryKey:["article",selectedId]});void qc.invalidateQueries({queryKey:["library"]});},onError:mutationError});
  const deleteArticle=useMutation({mutationFn:(id:number)=>api.deleteArticle({id}),onSuccess:(_result,id)=>{setNotice("Article deleted");setDeleteTarget(undefined);setReaderQueue(items=>items.filter(item=>item.id!==id));if(selectedId===id){const remainingOpened=openedIds.filter(itemId=>itemId!==id);if(remainingOpened.length)finishReading.mutate(remainingOpened);else{setSelectedId(undefined);setOpenedIds([]);}}else setOpenedIds(ids=>ids.filter(itemId=>itemId!==id));void qc.invalidateQueries({queryKey:["dashboard"]});void qc.invalidateQueries({queryKey:["library"]});},onError:mutationError});
  const renameTheme=useMutation({mutationFn:(args:{id:number;name:string})=>api.renameTheme(args),onSuccess:(r,args)=>{if(!r.ok){setNotice(r.error??"The category could not be renamed.");return;}setNotice(`Category renamed to ${r.name??"new name"}`);if(view==="Theme"&&dash.data?.themes.find(item=>item.id===args.id)?.name===theme)setTheme(r.name??undefined);void qc.invalidateQueries();},onError:mutationError});
  const briefFeedback=useMutation({mutationFn:(args:{editionId:number;storyKey:string;type:BriefFeedbackType;topic?:string;feed?:string})=>api.log_brief_feedback(args),onSuccess:()=>{void qc.invalidateQueries({queryKey:["brief"]});},onError:mutationError});
  const setMark=useMutation({mutationFn:(args:{dossier_id:string;pinned?:boolean;viewed_at?:string|null})=>api.set_mark(args),onSuccess:()=>{void qc.invalidateQueries({queryKey:["marks"]});},onError:mutationError});
  const recordView=(id:string)=>{setMark.mutate({dossier_id:id,viewed_at:new Date().toISOString()});};
  const invalidateDossiers=()=>{void qc.invalidateQueries({queryKey:["dossiers-summary"]});void qc.invalidateQueries({queryKey:["dossiers-closed"]});void qc.invalidateQueries({queryKey:["dossier"]});};
  const upsertDossiers=useMutation({mutationFn:(args:{dossiers:Array<Record<string,unknown>>;close?:string[]})=>api.upsert_dossiers(args),onSuccess:()=>{invalidateDossiers();},onError:mutationError});
  const dossierActions:DossierActions={
    onPinToggle:(d)=>{setMark.mutate({dossier_id:d.id,pinned:!pinnedIds.has(d.id)});},
    onCloseDossier:(d)=>{upsertDossiers.mutate({dossiers:[{id:d.id,status:"closed"}]});if(selectedDossierId===d.id)closeDossier();if(paneDossierId===d.id)setPaneDossierId(undefined);setNotice(`Closed “${d.title}”`);},
    onDemote:(d)=>{setDemoteTarget(d);},
    onMerge:(d)=>{setMergeSource(d);},
  };
  const runMerge=async(source:DossierRef,target:DossierRef)=>{
    setMerging(true);
    try{
      const [s,t]=await Promise.all([api.get_dossier({id:source.id}),api.get_dossier({id:target.id})]);
      const sourceFull=s.dossier; const targetFull=t.dossier;
      if(!sourceFull||!targetFull){setNotice("That merge could not be completed.");return;}
      const byKey=new Map<string,{feed:string;title:string;url:string}>();
      for(const a of [...targetFull.articles,...sourceFull.articles]){
        const key=a.article_id!==null&&a.article_id!==undefined?`id:${a.article_id}`:`url:${a.url}`;
        if(!byKey.has(key))byKey.set(key,{feed:a.feed,title:a.title,url:a.url});
      }
      const watchSeen=new Set<string>();
      const watch=[...targetFull.what_to_watch,...sourceFull.what_to_watch].filter(w=>{const k=`${w.date??""}|${w.event}`;if(watchSeen.has(k))return false;watchSeen.add(k);return true;});
      const psSeen=new Set<string>();
      const primarySources=[...targetFull.research.primary_sources,...sourceFull.research.primary_sources].filter(p=>{const k=p.url||p.title;if(psSeen.has(k))return false;psSeen.add(k);return true;});
      const evSeen=new Set<string>();
      const evidence=[...(targetFull.evidence??[]),...(sourceFull.evidence??[])].filter(e=>{const k=`${e.url}|${e.local_path}`;if(evSeen.has(k))return false;evSeen.add(k);return true;});
      const merged={
        ...targetFull,
        timeline:[...targetFull.timeline,...sourceFull.timeline].sort((a,b)=>(a.at||"").localeCompare(b.at||"")),
        what_to_watch:watch,
        contested:[...targetFull.contested,...sourceFull.contested],
        articles:[...byKey.values()],
        evidence,
        research:{...targetFull.research,claims:[...targetFull.research.claims,...sourceFull.research.claims],primary_sources:primarySources,unverified:[...new Set([...targetFull.research.unverified,...sourceFull.research.unverified])]},
        updated_at:new Date().toISOString(),
      };
      await api.upsert_dossiers({dossiers:[merged as unknown as Record<string,unknown>]});
      await api.upsert_dossiers({dossiers:[{id:source.id,status:"closed",merged_into:target.id}]});
      invalidateDossiers();
      if(selectedDossierId===source.id)closeDossier();
      if(paneDossierId===source.id)setPaneDossierId(target.id);
      setNotice(`Merged into “${targetFull.title}”`);
    }catch{setNotice("That merge could not be completed.");}
    finally{setMerging(false);setMergeSource(undefined);setMergeTarget(undefined);}
  };
  // Show a dossier: on desktop it swaps the reading pane, on phone it opens
  // the detail overlay. Either way the view is recorded.
  const showDossier=(id:string)=>{recordView(id);if(isDesktop)setPaneDossierId(id);else setSelectedDossierId(id);};
  const openFullDossier=(id:string)=>{recordView(id);setSelectedDossierId(id);};
  const openBriefArticle=(story:BriefStory,articleId:number)=>{
    const edition=brief.data?.editions.find(e=>e.stories.some(s=>s.key===story.key));
    if(edition)briefFeedback.mutate({editionId:edition.id,storyKey:story.key,type:"click",topic:story.topic,feed:story.articles[0]?.feed});
    const queue:Article[]=story.articles.flatMap(a=>a.article_id===null?[]:[{id:a.article_id,title:a.title,url:a.url,author:null,excerpt:story.summary,image_url:null,image_alt:null,published_at:null,ingested_at:new Date().toISOString(),read_at:null,archived_at:null,starred:false,feed_id:0,feed:a.feed,theme:story.topic,read_minutes:1}]);
    setReaderQueue(queue.length?queue:[{id:articleId,title:story.headline,url:"",author:null,excerpt:story.summary,image_url:null,image_alt:null,published_at:null,ingested_at:new Date().toISOString(),read_at:null,archived_at:null,starred:false,feed_id:0,feed:"",theme:story.topic,read_minutes:1}]);
    setOpenedIds([articleId]);
    setSelectedId(articleId);
  };
  const openDossierArticle=(dossier:Dossier,articleId:number)=>{
    const queue:Article[]=dossier.articles.flatMap(a=>a.article_id===null||a.article_id===undefined?[]:[{id:a.article_id,title:a.title,url:a.url,author:null,excerpt:dossier.latest_delta||dossier.state_of_play,image_url:null,image_alt:null,published_at:null,ingested_at:new Date().toISOString(),read_at:null,archived_at:null,starred:false,feed_id:0,feed:a.feed,theme:dossier.topic,read_minutes:1}]);
    setReaderQueue(queue.length?queue:[{id:articleId,title:dossier.title,url:"",author:null,excerpt:dossier.latest_delta,image_url:null,image_alt:null,published_at:null,ingested_at:new Date().toISOString(),read_at:null,archived_at:null,starred:false,feed_id:0,feed:"",theme:dossier.topic,read_minutes:1}]);
    setOpenedIds([articleId]);
    setSelectedId(articleId);
    // The article opens as a stacked layer over the dossier: push one history
    // entry for the overlay so the phone/browser back action closes the
    // article first and returns to the dossier underneath.
    if(!articleLayerPushed.current){try{window.history.pushState({newsLayer:"dossier-article"},"");articleLayerPushed.current=true;}catch{/* history unavailable: the close button still returns to the dossier */}}
  };
  const articles=dash.data?.articles ?? [];
  const readerIndex=selectedId===undefined?-1:readerQueue.findIndex(item=>item.id===selectedId);
  const activeLabel=view==="Main"?"Inbox":view==="Board"?"Board":view==="Theme"?theme??"Theme":view==="Feed"?dash.data?.feeds.find(f=>f.id===feedId)?.title??"Feed":view;
  useEffect(()=>{setCursor(0)},[view,theme,feedId,debouncedSearch]);
  useEffect(()=>{setCursor(current=>Math.min(current,Math.max(articles.length-1,0)))},[articles.length]);
  useEffect(()=>{
    if(!notice)return;
    // Dismiss on timeout or by tapping the notice itself only. Dismissing on
    // any pointerdown/wheel (the old behavior) forced a full re-render at the
    // very start of a text-selection drag whenever a notice was showing,
    // which collapsed the selection the user was trying to make.
    const timeout=window.setTimeout(()=>setNotice(undefined),5000);
    return()=>window.clearTimeout(timeout);
  },[notice]);
  useEffect(()=>{if(selectedId===undefined){const active=document.querySelector<HTMLElement>(`[data-article-index="${cursor}"]`);active?.scrollIntoView({block:"nearest"});}},[cursor,selectedId]);
  useEffect(()=>{setBriefCursor(0)},[view]);
  useEffect(()=>{setBriefCursor(current=>Math.min(current,Math.max(activeRanked.length-1,0)))},[activeRanked.length]);
  // Desktop invariant: the card carrying the selection bar must be the
  // dossier shown in the reading pane. The pane is id-driven (paneId) while
  // the bar is index-driven (briefCursor), and the two drifted apart whenever
  // the list changed without an explicit selection: closing, demoting, or
  // merging away the pane dossier resets paneDossierId so the pane falls
  // back to the top-ranked dossier, but briefCursor kept its old index,
  // which by then pointed at a different dossier's card. Re-derive the
  // cursor from the pane dossier's current index whenever either changes.
  useEffect(()=>{
    if(!isDesktop||view!=="Brief"||paneId===undefined)return;
    const idx=activeRanked.findIndex(d=>d.id===paneId);
    if(idx>=0)setBriefCursor(current=>current===idx?current:idx);
  },[isDesktop,view,paneId,activeRanked]);
  useEffect(()=>{if(view==="Brief"&&selectedId===undefined&&selectedDossierId===undefined){const active=document.querySelector<HTMLElement>(`[data-dossier-index="${briefCursor}"]`);active?.scrollIntoView({block:"nearest"});}},[briefCursor,view,selectedId,selectedDossierId]);
  useEffect(()=>{const onKey=(e:globalThis.KeyboardEvent)=>{if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey||selectedId!==undefined||selectedDossierId!==undefined||showShortcuts||isTypingTarget(e.target))return;if(view!=="Brief"||!activeRanked.length)return;const key=e.key.toLowerCase();if(key==="j"||key==="k"){e.preventDefault();const next=key==="j"?Math.min(briefCursor+1,activeRanked.length-1):Math.max(briefCursor-1,0);setBriefCursor(next);const target=activeRanked[next];if(isDesktop&&target){setPaneDossierId(target.id);recordView(target.id);}}if((key==="o"||key==="enter")){const current=activeRanked[briefCursor];if(current){e.preventDefault();showDossier(current.id);}}};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey)},[activeRanked,briefCursor,selectedId,selectedDossierId,view,showShortcuts,isDesktop]);
  useEffect(()=>{const onKey=(e:globalThis.KeyboardEvent)=>{if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey||isTypingTarget(e.target))return;if(e.key==="?"){e.preventDefault();setShowShortcuts(value=>!value);return;}if(e.key==="Escape"&&showShortcuts){e.preventDefault();setShowShortcuts(false);}};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey)},[showShortcuts]);
  useEffect(()=>{const onKey=(e:globalThis.KeyboardEvent)=>{if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey||selectedId!==undefined||showShortcuts||isTypingTarget(e.target))return;const list=articles;const key=e.key.toLowerCase();const articleView=["Main","Theme","Feed"].includes(view);if(!articleView)return;const current=list[cursor];if(key==="j"&&list.length){e.preventDefault();setCursor(c=>Math.min(c+1,list.length-1));}if(key==="k"&&list.length){e.preventDefault();setCursor(c=>Math.max(c-1,0));}if(key==="o"&&current){e.preventDefault();setReaderQueue(list);setOpenedIds([current.id]);setSelectedId(current.id);}if(key==="m"&&current){e.preventDefault();state.mutate({id:current.id,read:!current.read_at});}if(key==="s"&&current){e.preventDefault();state.mutate({id:current.id,starred:!current.starred});}if(key==="a"&&e.shiftKey&&["Main","Theme","Feed"].includes(view)){e.preventDefault();markAll.mutate();}};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey)},[articles,cursor,selectedId,view,state,markAll,showShortcuts]);
  // Swipe-to-archive from the list views: archives through the existing
  // state action and offers Undo in a notice that auto-clears on the same
  // 5-second timing as the other status notices. Undo restores the article
  // (un-archives and marks it unread again, matching setArticleState).
  useEffect(()=>{if(!undoArchive)return;const timeout=window.setTimeout(()=>setUndoArchive(undefined),5000);return()=>window.clearTimeout(timeout);},[undoArchive]);
  const archiveFromList=(a:Article)=>{state.mutate({id:a.id,archived:true});setUndoArchive({id:a.id,title:a.title});};
  const undoArchived=()=>{if(!undoArchive)return;state.mutate({id:undoArchive.id,archived:false});setUndoArchive(undefined);};
  const rememberOpened=(id:number)=>setOpenedIds(ids=>ids.includes(id)?ids:[...ids,id]);
  const leaveReader=()=>{if(finishReading.isPending)return;if(openedIds.length){finishReading.mutate(openedIds);return;}setSelectedId(undefined);setReaderQueue([]);};
  // Stacked history for the Brief dossier layers. Opening a dossier pushes
  // one history entry; opening an article on top of it pushes another. The
  // back action therefore closes the article overlay first, then the
  // dossier, instead of leaving the Brief tab. The UI close buttons route
  // through history.back() while their entry is on the stack, so both paths
  // converge on the popstate handler. The dossier itself stays mounted the
  // whole time an article is open, which is what preserves its scroll
  // position when the overlay closes.
  const selectedIdRef=useRef<number|undefined>(undefined);
  const leaveReaderRef=useRef<()=>void>(()=>{});
  useEffect(()=>{selectedIdRef.current=selectedId},[selectedId]);
  useEffect(()=>{leaveReaderRef.current=leaveReader});
  useEffect(()=>{
    if(selectedDossierId!==undefined&&!dossierLayerPushed.current){try{window.history.pushState({newsLayer:"dossier"},"");dossierLayerPushed.current=true;}catch{/* history unavailable */}}
    if(selectedDossierId===undefined)dossierLayerPushed.current=false;
  },[selectedDossierId]);
  useEffect(()=>{if(selectedId===undefined)articleLayerPushed.current=false;},[selectedId]);
  useEffect(()=>{
    const onPopState=()=>{
      if(articleLayerPushed.current){
        articleLayerPushed.current=false;
        if(selectedIdRef.current!==undefined)leaveReaderRef.current();
        return;
      }
      if(dossierLayerPushed.current){
        dossierLayerPushed.current=false;
        setSelectedDossierId(undefined);
      }
    };
    window.addEventListener("popstate",onPopState);
    return()=>window.removeEventListener("popstate",onPopState);
  },[]);
  const closeDossier=()=>{if(dossierLayerPushed.current){try{window.history.back();return;}catch{/* fall through to a direct close */}}setSelectedDossierId(undefined);};
  const closeReader=()=>{if(articleLayerPushed.current){try{window.history.back();return;}catch{/* fall through to a direct close */}}leaveReader();};
  const choose=(next:View,nextTheme?:string,nextFeed?:number)=>{setCursor(0);setView(next);setTheme(nextTheme);setFeedId(nextFeed);setSelectedId(undefined);setReaderQueue([]);setOpenedIds([]);setSelectedDossierId(undefined)};
  const inboxCount=dash.data?.themes.reduce((n,t)=>n+t.unread,0)??0;
  type NavItem={v:View;label:string;icon:IconName;count?:number};
  const bottomNav:NavItem[]=[{v:"Main",label:"Inbox",icon:"inbox",count:inboxCount},{v:"Board",label:"Board",icon:"board"},{v:"Brief",label:"Brief",icon:"brief"},{v:"Library",label:"Library",icon:"library"}];
  const sideNav:NavItem[]=[...bottomNav,{v:"Organize",label:"Organize",icon:"organize"}];
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="side-primary">{sideNav.map(n=><button key={n.v} className={view===n.v?"nav-row active":"nav-row"} onClick={()=>choose(n.v)}><Icon name={n.icon}/><span>{n.label}</span>{n.count!==undefined&&<b>{n.count}</b>}</button>)}</div>
      <div className="side-rule"/><div className="side-section-title">Themes</div>
      <div className="theme-list">{dash.data?.themes.map(t=><button key={t.id} className={view==="Theme"&&theme===t.name?"theme-row active":"theme-row"} onClick={()=>choose("Theme",t.name)}><span>{t.name}</span><b>{t.unread}</b></button>)}</div>
      <div className="sidebar-foot"><button className={view==="Settings"?"nav-row active":"nav-row"} onClick={()=>choose("Settings")}><Icon name="settings"/><span>Settings</span></button></div>
    </aside>
    <main className="main-column">
      <header className="toolbar">
        <div className="mobile-view-select"><select aria-label="Choose view" value={view==="Theme"?`theme:${theme}`:view==="Feed"?`feed:${feedId}`:view} onChange={e=>{const val=e.target.value;if(val.startsWith("theme:"))choose("Theme",val.slice(6));else if(val.startsWith("feed:")){const id=Number(val.slice(5));const feed=dash.data?.feeds.find(f=>f.id===id);if(feed)choose("Feed",feed.theme,id)}else choose(val as View)}}><option value="Main">Inbox</option><option value="Board">Board</option><option value="Brief">Brief</option>{dash.data?.themes.map(t=><option key={t.id} value={`theme:${t.name}`}>{t.name} ({t.unread})</option>)}{view==="Feed"&&feedId!==undefined&&<option value={`feed:${feedId}`}>{activeLabel}</option>}<option value="Library">Library</option><option value="Organize">Organize</option><option value="Settings">Settings</option></select></div>
        <div className="heading-block"><h1>{activeLabel}</h1>{!['Library','Organize','Settings','Brief','Board'].includes(view)&&<span>{articles.length} shown</span>}{view==="Board"&&<span>{board.data?.columns.reduce((n,c)=>n+c.unread,0)??0} unread across {board.data?.columns.length??0} themes</span>}</div>
        <label className="search-box"><Icon name="search" size={16}/><input aria-label={view==="Organize"?"Search feeds":view==="Library"?"Search your library":"Search articles"} value={search} onChange={e=>setSearch(e.target.value)} placeholder={view==="Organize"?"Search feeds":view==="Library"?"Search your library":"Search"}/>{search&&<button type="button" className="search-clear" aria-label="Clear search" onClick={()=>setSearch("")}><Icon name="close" size={15}/></button>}</label>
        <button className="icon-button help-button" aria-label="Show keyboard shortcuts" onClick={()=>setShowShortcuts(true)}><Icon name="help"/></button>
        <button className={refresh.isPending?"icon-button refresh-button is-spinning":"icon-button refresh-button"} aria-label={refresh.isPending?"Refreshing feeds":"Refresh feeds"} aria-busy={refresh.isPending} onClick={()=>refresh.mutate()} disabled={refresh.isPending}><Icon name="refresh"/></button>
      </header>
      {notice&&<button className="notice" onClick={()=>setNotice(undefined)} aria-label="Dismiss status">{notice}</button>}
      {undoArchive&&<div className="notice undo-notice" role="status"><span>Archived</span><button type="button" onClick={undoArchived}>Undo</button></div>}
      {view==="Board"?<BoardView data={board.data} loading={board.isPending} error={board.error} query={debouncedSearch} onOpen={(queue,id)=>{setReaderQueue(queue);setOpenedIds([id]);setSelectedId(id)}} onToggleStar={a=>state.mutate({id:a.id,starred:!a.starred})} onViewTheme={name=>choose("Theme",name)} onMarkThemeRead={name=>markThemeRead.mutate(name)} marking={markThemeRead.isPending} onReorder={order=>reorderThemes.mutate(order)} reordering={reorderThemes.isPending}/>:view==="Brief"?<BriefView data={brief.data} loading={brief.isPending} error={brief.error} summaries={summaries} summariesLoading={summaryQuery.isPending} activeRanked={activeRanked} quietList={quietList} movedIds={movedIds} pinnedIds={pinnedIds} marksReady={marksBase!==null} cursor={briefCursor} isDesktop={isDesktop} paneDossier={paneDossier} paneLoading={paneQuery.isPending} actions={dossierActions} onOpen={openBriefArticle} onFeedback={(editionId,storyKey,type,topic,feed)=>briefFeedback.mutate({editionId,storyKey,type,topic,feed})} onShowDossier={showDossier} onFullDossier={openFullDossier} onSelectDossier={d=>{setBriefCursor(activeRanked.findIndex(x=>x.id===d.id));setPaneDossierId(d.id);recordView(d.id);}} onToggleCard={d=>{setBriefCursor(activeRanked.findIndex(x=>x.id===d.id));recordView(d.id);}} onOpenArticle={openDossierArticle}/>:view==="Library"?<LibraryView items={library.data?.items??[]} loading={library.isPending} query={debouncedSearch} saving={saveNote.isPending||deleteHighlight.isPending} starred={starredDash.data?.articles??[]} starredLoading={starredDash.isPending} starredError={starredDash.error} archived={archivedDash.data?.articles??[]} archivedLoading={archivedDash.isPending} archivedError={archivedDash.error} archiveOpen={archiveOpen} onToggleArchive={()=>setArchiveOpen(open=>!open)} onOpenStarred={(id,index)=>{const list=starredDash.data?.articles??[];setCursor(index);setReaderQueue(list);setOpenedIds([id]);setSelectedId(id)}} onOpenArchived={(id,index)=>{const list=archivedDash.data?.articles??[];setCursor(index);setReaderQueue(list);setOpenedIds([id]);setSelectedId(id)}} onToggleStar={a=>state.mutate({id:a.id,starred:!a.starred})} onToggleRead={a=>state.mutate({id:a.id,read:!a.read_at})} onDeleteArticle={a=>setDeleteTarget({id:a.id,title:a.title,fromReader:false})} onArchive={archiveFromList} onNavigate={next=>choose(next)} onSaveNote={(articleId,text)=>saveNote.mutate({article_id:articleId,text})} onDeleteHighlight={id=>deleteHighlight.mutate(id)} onExport={async()=>{try{const r=await api.exportMarkdown({});downloadFile(r.filename,r.content,"text/markdown")}catch{mutationError()}}}/>:view==="Organize"?<OrganizeFeeds data={dash.data} search={search} adding={addFeed.isPending} renaming={renameTheme.isPending} onAdd={(url,title,themeId)=>addFeed.mutate({url,title:title||undefined,theme_id:themeId})} onFeed={args=>updateFeed.mutate(args)} onRename={(id,name)=>renameTheme.mutate({id,name})} onDelete={id=>deleteFeed.mutate(id)}/>:view==="Settings"?<Settings data={dash.data} onRetention={d=>setRetention.mutate(d)} onExport={async()=>{try{const r=await api.exportOpml({});downloadFile(r.filename,r.content,"text/xml")}catch{mutationError()}}}/>:<>
        <div className="main-actions">{["Main","Theme","Feed"].includes(view)&&<button className="text-button" onClick={()=>markAll.mutate()} disabled={markAll.isPending}>Mark all read</button>}{(view==="Theme"||view==="Feed")&&<select aria-label={`Choose a feed in ${theme??"theme"}`} value={feedId??""} onChange={e=>{const id=Number(e.target.value);if(id)choose("Feed",theme,id);else choose("Theme",theme)}}><option value="">All feeds</option>{dash.data?.feeds.filter(f=>f.theme===theme).map(f=><option key={f.id} value={f.id}>{f.title} ({f.unread})</option>)}</select>}{dash.data?.last_pull?.error_count?<button type="button" className="pull-error" onClick={()=>choose("Organize")} aria-label={`${dash.data.last_pull.error_count} feeds failed on the last refresh. Open Organize to see which.`}>{dash.data.last_pull.error_count} feed {dash.data.last_pull.error_count===1?"error":"errors"}</button>:null}<span className="pull-state">{dash.data?.last_pull?.completed_at?`Pulled ${agoText(dash.data.last_pull.completed_at)}`:"Not pulled yet"}</span></div>
        {BRIEFING_ENABLED&&(view==="Main"||view==="Theme")&&<Digest digest={dash.data?.digest??null}/>}<ArticleList articles={articles} loading={dash.isPending} error={dash.error} cursor={cursor} query={debouncedSearch} onOpen={(id,index)=>{setCursor(index);setReaderQueue(articles);setOpenedIds([id]);setSelectedId(id)}} onToggleStar={a=>state.mutate({id:a.id,starred:!a.starred})} onToggleRead={a=>state.mutate({id:a.id,read:!a.read_at})} onDelete={a=>setDeleteTarget({id:a.id,title:a.title,fromReader:false})} onArchive={archiveFromList} hasMore={articles.length>=listLimit&&listLimit<250} onLoadMore={()=>setListLimit(n=>Math.min(250,n+120))}/>
      </>}
    </main>
    <nav className="bottom-nav">{bottomNav.map(n=><button key={n.v} className={view===n.v?"active":""} onClick={()=>choose(n.v)}><Icon name={n.icon}/><span>{n.label}</span>{n.count!==undefined&&<b>{n.count}</b>}</button>)}</nav>
    {selectedDossier&&<DossierDetail dossier={selectedDossier} moved={movedIds.has(selectedDossier.id)} pinned={pinnedIds.has(selectedDossier.id)} actions={dossierActions} articleOpen={selectedId!==undefined} onClose={closeDossier} onOpenArticle={openDossierArticle}/>}
    {selectedDossierId!==undefined&&!selectedDossier&&<div className="reader-backdrop dossier-backdrop"><section className="reader dossier-detail" aria-label="Loading dossier"><div className="state-page">Loading dossier…</div></section></div>}
    {demoteTarget&&<ConfirmDialog title="Not a developing story?" body={`“${demoteTarget.title}” will be closed and the brief pipeline will not recreate it as a dossier.`} confirmLabel="Not a developing story" busyLabel="Saving…" busy={upsertDossiers.isPending} onCancel={()=>setDemoteTarget(undefined)} onConfirm={()=>{const target=demoteTarget;setDemoteTarget(undefined);upsertDossiers.mutate({dossiers:[{id:target.id,status:"closed",demoted:true}]});if(selectedDossierId===target.id)closeDossier();if(paneDossierId===target.id)setPaneDossierId(undefined);}}/>}
    {mergeSource&&!mergeTarget&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setMergeSource(undefined)}}><section className="confirm-dialog merge-picker" role="dialog" aria-modal="true" aria-labelledby="merge-picker-title"><h2 id="merge-picker-title">Merge into…</h2><p>“{mergeSource.title}” will be folded into the dossier you pick and closed.</p><div className="merge-picker-list">{activeRanked.filter(d=>d.id!==mergeSource.id).map(d=><button type="button" key={d.id} className="merge-picker-row" onClick={()=>setMergeTarget({id:d.id,title:d.title})}><span>{d.title}</span><Icon name="chevron" size={14}/></button>)}{activeRanked.filter(d=>d.id!==mergeSource.id).length===0&&<p className="library-empty">No other active dossiers.</p>}</div><div className="confirm-actions"><button onClick={()=>setMergeSource(undefined)}>Cancel</button></div></section></div>}
    {mergeSource&&mergeTarget&&<ConfirmDialog title="Merge dossiers?" body={`“${mergeSource.title}” will be merged into “${mergeTarget.title}”: timelines, sources, and contested claims combine, and the source dossier closes.`} confirmLabel="Merge" busyLabel="Merging…" danger={false} busy={merging} onCancel={()=>setMergeTarget(undefined)} onConfirm={()=>{void runMerge(mergeSource,mergeTarget);}}/>}
    {selectedId!==undefined&&<Reader data={article.data?.article} loading={article.isPending} error={article.error} closing={finishReading.isPending||state.isPending||deleteArticle.isPending} position={readerIndex>=0?readerIndex+1:undefined} total={readerQueue.length} shortcutsOpen={showShortcuts||deleteTarget!==undefined} stacked={selectedDossier!==undefined} onPrevious={readerIndex>0?()=>{const previous=readerQueue[readerIndex-1];if(previous){setCursor(readerIndex-1);rememberOpened(previous.id);setSelectedId(previous.id)}}:undefined} onNext={readerIndex>=0&&readerIndex<readerQueue.length-1?()=>{const next=readerQueue[readerIndex+1];if(next){setCursor(readerIndex+1);rememberOpened(next.id);setSelectedId(next.id)}}:undefined} onClose={closeReader} onStar={a=>state.mutate({id:a.id,starred:!a.starred})} onUnread={a=>state.mutate({id:a.id,read:false})} onArchive={a=>{if(a.archived_at){setOpenedIds(ids=>ids.filter(id=>id!==a.id));state.mutate({id:a.id,archived:false});}else closeReader()}} onDeleteArticle={a=>setDeleteTarget({id:a.id,title:a.title,fromReader:true})} onNote={(id,text)=>saveNote.mutate({article_id:id,text})} onHighlight={(id,text)=>saveHighlight.mutate({article_id:id,text})} onDeleteHighlight={id=>deleteHighlight.mutate(id)}/>}
    {showShortcuts&&<ShortcutSheet onClose={()=>setShowShortcuts(false)}/>} 
    {deleteTarget&&<ConfirmDialog title="Delete article?" body={`“${deleteTarget.title}” will be removed from the reader, along with its note and highlights. It will not return on the next feed refresh.`} busy={deleteArticle.isPending} onCancel={()=>setDeleteTarget(undefined)} onConfirm={()=>deleteArticle.mutate(deleteTarget.id)}/>} 
  </div>
}

type BoardData=ApiResponse<typeof api,"board">;
function BoardCard({article,query,onOpen,onToggleStar}:{article:Article;query:string;onOpen:()=>void;onToggleStar:(a:Article)=>void}){
  const downPos=useRef<{x:number;y:number}|null>(null);
  return <article className="board-card">
    <div className="board-card-main" role="button" tabIndex={0} onPointerDown={e=>{downPos.current={x:e.clientX,y:e.clientY}}} onClick={e=>{const start=downPos.current;downPos.current=null;if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>6)return;const sel=window.getSelection();if(sel&&!sel.isCollapsed)return;onOpen();}} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onOpen();}}}>
      {article.image_url&&<img className="board-card-thumb" src={article.image_url} alt={article.image_alt&&article.image_alt!==article.title?article.image_alt:""} loading="lazy"/>}
      <div className="board-card-source"><b><HighlightText text={article.feed} query={query}/></b><time>{agoText(article.published_at??article.ingested_at)}</time></div>
      <h3><HighlightText text={article.title} query={query}/></h3>
      {article.excerpt&&<p><HighlightText text={article.excerpt} query={query}/></p>}
      <div className="board-card-meta"><span>{article.read_minutes} min read</span>{article.author&&<span className="board-card-author"><HighlightText text={article.author} query={query}/></span>}</div>
    </div>
    <button type="button" className={article.starred?"board-star starred":"board-star"} aria-label={article.starred?`Unstar ${article.title}`:`Star ${article.title}`} aria-pressed={article.starred} onClick={()=>onToggleStar(article)}><Icon name="star" size={16}/></button>
  </article>;
}
function BoardView({data,loading,error,query,onOpen,onToggleStar,onViewTheme,onMarkThemeRead,marking,onReorder,reordering}:{data:BoardData|undefined;loading:boolean;error:unknown;query:string;onOpen:(queue:Article[],id:number)=>void;onToggleStar:(a:Article)=>void;onViewTheme:(name:string)=>void;onMarkThemeRead:(name:string)=>void;marking:boolean;onReorder:(order:number[])=>void;reordering:boolean}){
  const [dragId,setDragId]=useState<number|null>(null);
  const [dragOverId,setDragOverId]=useState<number|null>(null);
  if(loading&&!data)return <div className="state-page">Loading the board…</div>;
  if(error&&!data)return <div className="state-page"><strong>Could not load the board.</strong><span>Try again in a moment.</span></div>;
  const columns=data?.columns??[];
  const totalUnread=columns.reduce((n,c)=>n+c.unread,0);
  const moveColumn=(id:number,dir:-1|1)=>{
    const ids=columns.map(c=>c.id);
    const idx=ids.indexOf(id);
    const swap=idx+dir;
    if(idx<0||swap<0||swap>=ids.length)return;
    const next=[...ids];
    const a=next[idx] as number; const b=next[swap] as number;
    next[idx]=b; next[swap]=a;
    onReorder(next);
  };
  const dropOnColumn=(targetId:number)=>{
    if(dragId===null||dragId===targetId){setDragId(null);setDragOverId(null);return;}
    const ids=columns.map(c=>c.id);
    const from=ids.indexOf(dragId);
    const to=ids.indexOf(targetId);
    if(from<0||to<0){setDragId(null);setDragOverId(null);return;}
    const next=[...ids];
    next.splice(from,1);
    next.splice(to,0,dragId);
    setDragId(null);setDragOverId(null);
    onReorder(next);
  };
  return <section className="board-view" aria-label="Board by theme">
    <div className="board-intro"><p>Latest unread by theme, newest first.</p><span>{totalUnread} unread · showing up to 12 per theme</span></div>
    {columns.length===0?<div className="state-page"><strong>No themes yet.</strong><span>Your themes will appear here once feeds load.</span></div>:<div className="board-grid">{columns.map((col,colIndex)=><section key={col.id} className={`board-column${dragId===col.id?" dragging":""}${dragOverId===col.id&&dragId!==null&&dragId!==col.id?" drag-over":""}`} aria-label={`${col.name} column`}
      onDragOver={e=>{if(dragId!==null){e.preventDefault();e.dataTransfer.dropEffect="move";if(dragOverId!==col.id)setDragOverId(col.id);}}}
      onDragLeave={()=>{if(dragOverId===col.id)setDragOverId(null);}}
      onDrop={e=>{e.preventDefault();dropOnColumn(col.id);}}>
      <header className="board-column-head">
        <div className="board-column-title">
          <span className="board-drag-handle" draggable={!reordering} role="button" tabIndex={0} aria-label={`Drag ${col.name} column to reorder`} title={`Drag to reorder ${col.name}`}
            onDragStart={e=>{setDragId(col.id);e.dataTransfer.effectAllowed="move";try{e.dataTransfer.setData("text/plain",String(col.id));}catch{/* dataTransfer payload is optional */}}}
            onDragEnd={()=>{setDragId(null);setDragOverId(null);}}
            onKeyDown={e=>{if(e.key==="ArrowLeft"||e.key==="ArrowUp"){e.preventDefault();moveColumn(col.id,-1);}else if(e.key==="ArrowRight"||e.key==="ArrowDown"){e.preventDefault();moveColumn(col.id,1);}}}><Icon name="grip" size={16}/></span>
          <h2>{col.name}</h2><span className="board-count">{col.unread}</span>
          <span className="board-column-moves">
            <button type="button" className="board-move-btn" disabled={reordering||colIndex===0} onClick={()=>moveColumn(col.id,-1)} aria-label={`Move ${col.name} earlier`} title={`Move ${col.name} earlier`}><Icon name="back" size={14}/></button>
            <button type="button" className="board-move-btn" disabled={reordering||colIndex===columns.length-1} onClick={()=>moveColumn(col.id,1)} aria-label={`Move ${col.name} later`} title={`Move ${col.name} later`}><Icon name="chevron" size={14}/></button>
          </span>
        </div>
        <div className="board-column-actions">
          {col.unread>0&&<button type="button" className="board-head-btn" disabled={marking} onClick={()=>onMarkThemeRead(col.name)}>Mark read</button>}
          <button type="button" className="board-head-btn board-view-all" onClick={()=>onViewTheme(col.name)} aria-label={`View all articles in ${col.name}`}>View all <Icon name="chevron" size={13}/></button>
        </div>
      </header>
      <div className="board-column-body">
        {col.articles.length===0?<p className="board-empty">{query?`No unread in ${col.name} match your search.`:`All caught up in ${col.name}.`}</p>:col.articles.map(a=><BoardCard key={a.id} article={a} query={query} onOpen={()=>onOpen(col.articles,a.id)} onToggleStar={onToggleStar}/>)}
      </div>
      {col.unread>col.articles.length&&<button type="button" className="board-more" onClick={()=>onViewTheme(col.name)}>+{col.unread-col.articles.length} more in {col.name} →</button>}
    </section>)}</div>}
  </section>;
}
function ArticleRow({article,index,cursor,query,onOpen,onToggleStar,onToggleRead,onDelete,onArchive}:{article:Article;index:number;cursor:number;query:string;onOpen:(id:number,index:number)=>void;onToggleStar:(a:Article)=>void;onToggleRead:(a:Article)=>void;onDelete:(a:Article)=>void;onArchive?:(a:Article)=>void}){
  const downPos=useRef<{x:number;y:number}|null>(null);
  // Swipe-to-archive (touch only): a left swipe that is clearly horizontal
  // (locks only past 12px with |dx| > 1.4x|dy|, so vertical scrolling and
  // taps are never mistaken for it) slides the row over an Archive reveal;
  // past the 84px threshold the row animates out and archives via the
  // existing article-state action, otherwise it snaps back. touch-action
  // pan-y keeps vertical scrolling native; the browser fires pointercancel
  // when a scroll takes over, which also snaps back.
  const [offset,setOffset]=useState(0);
  const [dragging,setDragging]=useState(false);
  const gesture=useRef<{startX:number;startY:number;locked:boolean;pointerId:number}|null>(null);
  const suppressClick=useRef(false);
  const swipeEnabled=onArchive!==undefined;
  const endGesture=(commit:boolean)=>{
    const g=gesture.current; gesture.current=null; setDragging(false);
    if(!g||!g.locked)return;
    if(commit&&offset<=-84){
      suppressClick.current=true;
      setOffset(-420);
      window.setTimeout(()=>{onArchive?.(article);setOffset(0);},190);
    } else setOffset(0);
  };
  const row=<article data-article-index={index} className={`${article.read_at?"article-row read":"article-row unread"} ${cursor===index?"keyboard-focus":""}`}><div className="article-main" role="button" tabIndex={0} onPointerDown={e=>{downPos.current={x:e.clientX,y:e.clientY}}} onClick={e=>{if(suppressClick.current){suppressClick.current=false;return;}const start=downPos.current;downPos.current=null;if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>6)return;const sel=window.getSelection();if(sel&&!sel.isCollapsed)return;onOpen(article.id,index)}} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onOpen(article.id,index)}}}><div className="article-copy"><div className="article-source"><span><HighlightText text={article.theme} query={query}/></span><b><HighlightText text={article.feed} query={query}/></b><time>{relativeTime(article.published_at??article.ingested_at)}</time></div><h2><HighlightText text={article.title} query={query}/></h2>{article.excerpt&&<p><HighlightText text={article.excerpt} query={query}/></p>}<div className="article-meta">{article.author&&<span><HighlightText text={article.author} query={query}/></span>}<span>{article.read_minutes} min read</span></div></div>{article.image_url&&<img className="article-thumbnail" src={article.image_url} alt={article.image_alt&&article.image_alt!==article.title?article.image_alt:""} loading="lazy"/>}</div><div className="row-actions"><button aria-label={article.starred?`Unstar ${article.title}`:`Star ${article.title}`} className={article.starred?"starred":""} onClick={()=>onToggleStar(article)}><Icon name="star" size={17}/></button><button aria-label={article.read_at?`Mark ${article.title} unread`:`Mark ${article.title} read`} onClick={()=>onToggleRead(article)}>{article.read_at?"Unread":"Read"}</button><button className="delete-row" aria-label={`Delete ${article.title}`} onClick={()=>onDelete(article)}><Icon name="trash" size={16}/></button></div></article>;
  if(!swipeEnabled)return row;
  return <div className="swipe-row">
    <div className="swipe-reveal" aria-hidden="true" style={{opacity:offset<-10?1:0}}><Icon name="archive" size={17}/><span>Archive</span></div>
    <div className="swipe-inner" style={{transform:`translateX(${offset}px)`,transition:dragging?"none":"transform .19s ease",touchAction:"pan-y"}}
      onPointerDown={e=>{if(e.pointerType!=="touch")return;gesture.current={startX:e.clientX,startY:e.clientY,locked:false,pointerId:e.pointerId};}}
      onPointerMove={e=>{const g=gesture.current;if(!g||e.pointerId!==g.pointerId)return;const dx=e.clientX-g.startX;const dy=e.clientY-g.startY;
        if(!g.locked){if(Math.abs(dy)>10&&Math.abs(dy)>=Math.abs(dx)){gesture.current=null;return;}if(dx<-12&&Math.abs(dx)>Math.abs(dy)*1.4){g.locked=true;setDragging(true);}else return;}
        setOffset(Math.max(-128,Math.min(0,dx)));}}
      onPointerUp={e=>{if(e.pointerId===gesture.current?.pointerId)endGesture(true);}}
      onPointerCancel={()=>endGesture(false)}>{row}</div>
  </div>;
}
function ArticleList({articles,loading,error,cursor,query,onOpen,onToggleStar,onToggleRead,onDelete,onArchive,hasMore,onLoadMore}:{articles:Article[];loading:boolean;error:unknown;cursor:number;query:string;onOpen:(id:number,index:number)=>void;onToggleStar:(a:Article)=>void;onToggleRead:(a:Article)=>void;onDelete:(a:Article)=>void;onArchive?:(a:Article)=>void;hasMore?:boolean;onLoadMore?:()=>void}){if(loading)return <div className="state-page">Loading your feeds…</div>;if(error)return <div className="state-page"><strong>Could not load the inbox.</strong><span>Try again in a moment.</span></div>;if(!articles.length)return <div className="state-page">{query?<><strong>No matches for “{query}”.</strong><span>Try a different search, or clear it to see everything.</span></>:<><strong>Nothing here.</strong><span>Refresh feeds or choose another view.</span></>}</div>;return <section className="article-list" aria-label="Articles">{articles.map((a,i)=><ArticleRow key={a.id} article={a} index={i} cursor={cursor} query={query} onOpen={onOpen} onToggleStar={onToggleStar} onToggleRead={onToggleRead} onDelete={onDelete} onArchive={onArchive}/>)}{hasMore&&onLoadMore&&<button type="button" className="list-load-more" onClick={onLoadMore}>Show more articles</button>}</section>}
type ReaderPhoto=ApiResponse<typeof api,"getArticle">["article"]["photos"][number];
function normalizeCaptionText(value:string):string{return value.toLowerCase().replace(/\s+/g," ").replace(/^[“"']+|[”"']+$/g,"").trim();}
// Places pulled photos into the article body at their story positions.
// The full-text fetch leaves each photo's caption behind as a standalone
// paragraph; a photo whose caption matches one of those paragraphs
// replaces it, so the caption renders once, as the figure's caption.
// Photos with no matching paragraph (the lead image, or pages whose
// captions never entered the text) are distributed through the body in
// story order, the first at the top.
function buildBodyWithPhotos(html:string,photos:ReaderPhoto[]):string{
  if(!photos.length||!html||typeof DOMParser==="undefined")return html;
  try{
    const doc=new DOMParser().parseFromString(`<div>${html}</div>`,"text/html");
    const root=doc.body.firstElementChild;
    if(!root)return html;
    const makeFigure=(photo:ReaderPhoto)=>{
      const figure=doc.createElement("figure");
      figure.className="pulled-photo";
      const img=doc.createElement("img");
      img.src=photo.url;
      img.alt=photo.alt??photo.caption??"";
      img.loading="lazy";
      figure.appendChild(img);
      const captionText=photo.caption?.trim()??"";
      if(captionText||photo.credit){
        const cap=doc.createElement("figcaption");
        if(captionText)cap.appendChild(doc.createTextNode(captionText));
        if(photo.credit){const span=doc.createElement("span");span.className="photo-credit";span.textContent=captionText?` (${photo.credit})`:`(${photo.credit})`;cap.appendChild(span);}
        figure.appendChild(cap);
      }
      return figure;
    };
    const children=Array.from(root.children);
    const used=new Set<Element>();
    const unmatched:ReaderPhoto[]=[];
    for(const photo of photos){
      const caption=photo.caption?.trim()??"";
      let matched:Element|undefined;
      if(caption.length>=12){
        const capNorm=normalizeCaptionText(caption);
        const fullNorm=normalizeCaptionText(photo.credit?`${caption} (${photo.credit})`:caption);
        matched=children.find(el=>{if(used.has(el))return false;const t=normalizeCaptionText(el.textContent??"");return t===capNorm||t===fullNorm||(t.startsWith(capNorm)&&t.length<=fullNorm.length+4);});
      }
      if(matched){used.add(matched);matched.replaceWith(makeFigure(photo));}
      else unmatched.push(photo);
    }
    if(unmatched.length){
      const totalSlots=root.children.length+unmatched.length;
      unmatched.forEach((photo,index)=>{
        const figure=makeFigure(photo);
        if(index===0){root.insertBefore(figure,root.firstChild);}
        else{
          const pos=Math.min(root.children.length,Math.round(((index+1)*totalSlots)/(unmatched.length+1)));
          root.insertBefore(figure,root.children[pos]??null);
        }
      });
    }
    return root.innerHTML;
  }catch{return html;}
}
function Reader({data,loading,error,closing,position,total,shortcutsOpen,stacked=false,onPrevious,onNext,onClose,onStar,onUnread,onArchive,onDeleteArticle,onNote,onHighlight,onDeleteHighlight}:{data:ApiResponse<typeof api,"getArticle">["article"]|undefined;loading:boolean;error:unknown;closing:boolean;position?:number;total:number;shortcutsOpen:boolean;stacked?:boolean;onPrevious?:()=>void;onNext?:()=>void;onClose:()=>void;onStar:(a:ApiResponse<typeof api,"getArticle">["article"])=>void;onUnread:(a:ApiResponse<typeof api,"getArticle">["article"])=>void;onArchive:(a:ApiResponse<typeof api,"getArticle">["article"])=>void;onDeleteArticle:(a:ApiResponse<typeof api,"getArticle">["article"])=>void;onNote:(id:number,text:string)=>void;onHighlight:(id:number,text:string)=>void;onDeleteHighlight:(id:number)=>void}){
  const [note,setNote]=useState("");
  const [selection,setSelection]=useState("");
  const [confirmNoteDelete,setConfirmNoteDelete]=useState(false);
  const [speedOpen,setSpeedOpen]=useState(false);
  const [fetchError,setFetchError]=useState<string|null>(null);
  const [photoError,setPhotoError]=useState<string|null>(null);
  const qcReader=useQueryClient();
  const fetchFullText=useMutation({mutationFn:(id:number)=>api.fetch_full_text({id}),onSuccess:(r,vars)=>{if(r.ok){setFetchError(null);void qcReader.invalidateQueries({queryKey:["article",vars]});void qcReader.invalidateQueries({queryKey:["dashboard"]});void qcReader.invalidateQueries({queryKey:["board"]});}else setFetchError(r.error??"Couldn't fetch the full text for this article.");},onError:()=>setFetchError("Couldn't fetch the full text for this article.")});
  const scrollRef=useRef<HTMLDivElement>(null);
  const bodyRef=useRef<HTMLDivElement>(null);
  const headingRef=useRef<HTMLHeadingElement>(null);
  const selectionRef=useRef("");
  useEffect(()=>{setNote(data?.note??"")},[data?.id,data?.note]);
  const fetchPhotos=useMutation({mutationFn:(id:number)=>api.fetch_photos({id}),onSuccess:(r,vars)=>{if(r.ok){setPhotoError(null);void qcReader.invalidateQueries({queryKey:["article",vars]});void qcReader.invalidateQueries({queryKey:["dashboard"]});void qcReader.invalidateQueries({queryKey:["board"]});}else setPhotoError(r.error??"Couldn't pull photos for this article.");},onError:()=>setPhotoError("Couldn't pull photos for this article.")});
  useEffect(()=>{setSpeedOpen(false);setFetchError(null);setPhotoError(null)},[data?.id]);
  useEffect(()=>{selectionRef.current="";setSelection("");headingRef.current?.focus({preventScroll:true});scrollRef.current?.scrollTo({top:0,behavior:"auto"})},[data?.id]);
  useEffect(()=>{
    // Selection tracking must never update React state while a selection
    // gesture is in progress: the old debounced handler called setSelection
    // 160ms after any pause (and on every pointerup/touchend, which fire
    // repeatedly while dragging selection handles on touch), re-rendering
    // the reader mid-drag. That re-render is the flicker users saw, and on
    // touch WebKit it cancels the in-progress selection outright. So: while
    // a pointer/touch is down, only remember that a read is pending; publish
    // the selection once the gesture ends. Keyboard selection (no pointer)
    // publishes on the next animation frame.
    let frame=0;
    let pointerDown=false;
    const readSelection=()=>{
      const selected=window.getSelection();
      const anchor=selected?.anchorNode;
      const focus=selected?.focusNode;
      const body=bodyRef.current;
      const text=selected?.toString().trim()??"";
      const next=!selected?.isCollapsed&&anchor&&focus&&body?.contains(anchor)&&body.contains(focus)&&text.length>2?text:"";
      selectionRef.current=next;
      setSelection(current=>current===next?current:next);
    };
    const scheduleRead=()=>{
      if(pointerDown)return;
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(readSelection);
    };
    const onPointerDown=()=>{pointerDown=true;};
    const onPointerUp=()=>{pointerDown=false;scheduleRead();};
    document.addEventListener("selectionchange",scheduleRead);
    document.addEventListener("pointerdown",onPointerDown,true);
    document.addEventListener("pointerup",onPointerUp,true);
    document.addEventListener("touchend",onPointerUp,true);
    return()=>{cancelAnimationFrame(frame);document.removeEventListener("selectionchange",scheduleRead);document.removeEventListener("pointerdown",onPointerDown,true);document.removeEventListener("pointerup",onPointerUp,true);document.removeEventListener("touchend",onPointerUp,true)};
  },[]);
  useEffect(()=>{const onKey=(e:globalThis.KeyboardEvent)=>{if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey||closing||shortcutsOpen||confirmNoteDelete||speedOpen||isTypingTarget(e.target))return;const key=e.key.toLowerCase();if(key==="escape"&&!e.shiftKey){e.preventDefault();onClose();return;}// Shift+Arrow is how a keyboard user extends a text selection, and arrow
      // keys with an active selection just adjust it: never steal either for
      // article navigation (the old handler preventDefaulted Shift+ArrowLeft
      // into "previous article", instantly destroying the selection).
      if(e.shiftKey)return;const activeSelection=window.getSelection();if((key==="arrowleft"||key==="arrowright")&&activeSelection&&!activeSelection.isCollapsed)return;if((key==="k"||key==="arrowleft"||key==="[")&&onPrevious){e.preventDefault();onPrevious();}else if((key==="j"||key==="arrowright"||key==="]")&&onNext){e.preventDefault();onNext();}};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey)},[onPrevious,onNext,onClose,closing,shortcutsOpen,confirmNoteDelete,speedOpen]);
  // Snippet detection: the feed supplied only a teaser when the stored
  // body's plain text is short (CBC items arrive at ~150-240 chars). Those
  // articles get the "Fetch full text" affordance; articles that already
  // carry full feed content do not show it.
  const bodyTextLength=data?htmlToPlainText(data.body,"").length:0;
  const isSnippet=Boolean(data)&&bodyTextLength<600;
  const photos=data?.photos??[];
  const enrichedBody=useMemo(()=>data?.body?buildBodyWithPhotos(data.body,photos):data?.body??null,[data?.body,photos]);
  // When the lead pulled photo was also saved as the article's image, the
  // standalone header image would duplicate the inline lead figure.
  const showHeaderImage=Boolean(data?.image_url)&&!(photos.length>0&&data?.image_url===photos[0]?.url);
  return <div className={stacked?"reader-backdrop reader-backdrop-stacked":"reader-backdrop"}><section className="reader" aria-label="Article reader"><header className="reader-bar"><button className="icon-button" aria-label={closing?"Saving reading progress":"Close article"} onClick={onClose} disabled={closing}><Icon name="back"/></button>{data&&<div className="reader-actions"><button className={data.starred?"starred":""} onClick={()=>onStar(data)} disabled={closing}><Icon name="star" size={17}/>{data.starred?"Starred":"Star"}</button><button onClick={()=>onUnread(data)} disabled={closing}>Unread</button><button onClick={()=>onArchive(data)} disabled={closing}>{closing?"Saving…":data.archived_at?"Restore":"Archive"}</button><button className="reader-delete" onClick={()=>onDeleteArticle(data)} disabled={closing}><Icon name="trash" size={15}/>Delete</button><a href={data.url} target="_blank" rel="noreferrer">Original <Icon name="external" size={15}/></a></div>}</header>{error?<div className="state-page"><strong>Could not open this article.</strong><span>Close the reader and try again.</span></div>:loading||!data?<div className="state-page">Opening article…</div>:<><div className="reader-scroll" ref={scrollRef}><div className="reader-heading"><div>{data.theme} · {data.feed}</div><h1 ref={headingRef} tabIndex={-1}>{data.title}</h1><p>{[data.author,agoText(data.published_at??data.ingested_at),`${data.read_minutes} min read`].filter(Boolean).join(" · ")}</p><button type="button" className="speed-read-cta" aria-label={`Speed read ${data.title}`} onClick={()=>setSpeedOpen(true)} disabled={closing}>▶ Speed read this article</button></div>{showHeaderImage&&data.image_url&&<img className="reader-image" src={data.image_url} alt={data.image_alt??data.title}/>}{isSnippet&&<div className="full-text-box" role={fetchError?"alert":undefined}><p>{fetchError??"This feed only included a short preview of the article."}</p><div className="full-text-actions"><button type="button" className="full-text-button" disabled={fetchFullText.isPending||closing} aria-busy={fetchFullText.isPending} onClick={()=>fetchFullText.mutate(data.id)}>{fetchFullText.isPending?"Fetching full text…":fetchError?"Try again":"Fetch full text"}</button><a href={data.url} target="_blank" rel="noreferrer">Open original <Icon name="external" size={14}/></a></div></div>}{photos.length===0&&<div className="full-text-box photos-box" role={photoError?"alert":undefined}><p>{photoError??"This article's photos aren't in the feed."}</p><div className="full-text-actions"><button type="button" className="full-text-button" disabled={fetchPhotos.isPending||closing} aria-busy={fetchPhotos.isPending} onClick={()=>fetchPhotos.mutate(data.id)}>{fetchPhotos.isPending?"Pulling photos…":photoError?"Try again":"Pull photos"}</button><a href={data.url} target="_blank" rel="noreferrer">Open original <Icon name="external" size={14}/></a></div></div>}<div className="reader-body" ref={bodyRef}>{data.body?<ArticleContent html={enrichedBody??data.body}/>:<p>{data.excerpt??"This feed did not include article text. Use Original to read it at the source."}</p>}</div><section className="annotations"><div className="annotation-heading"><h2>Notes</h2>{data.note&&<button className="delete-note" onClick={()=>setConfirmNoteDelete(true)}>Delete note</button>}</div><textarea {...FIELDS.saveNote.text} aria-label="Article note" value={note} onChange={e=>setNote(e.target.value)} placeholder="What do you want to remember?"/><button className="primary-button" onClick={()=>onNote(data.id,note)}>Save note</button>{data.highlights.length>0&&<div className="highlight-stack"><h2>Highlights</h2>{data.highlights.map(h=><div className="highlight-item" key={h.id}><blockquote>{h.text}</blockquote><button aria-label={`Delete highlight: ${h.text.slice(0,60)}`} onClick={()=>onDeleteHighlight(h.id)}>Delete</button></div>)}</div>}</section></div><button className={selection?"save-selection is-visible":"save-selection"} aria-hidden={!selection} disabled={!selection} onPointerDown={event=>event.preventDefault()} onClick={()=>{const text=selectionRef.current;if(!text)return;onHighlight(data.id,text);selectionRef.current="";setSelection("");window.getSelection()?.removeAllRanges()}}>Save selected text</button><nav className="reader-navigation" aria-label="Article navigation"><button aria-label="Previous article, keyboard shortcut K" onClick={onPrevious} disabled={closing||!onPrevious}><Icon name="up"/><span><small>Previous <kbd>K</kbd></small><strong>Article</strong></span></button><div aria-live="polite">{closing?"Saving…":position?`${position} of ${total}`:"Article"}</div><button aria-label="Next article, keyboard shortcut J" onClick={onNext} disabled={closing||!onNext}><span><small>Next <kbd>J</kbd></small><strong>Article</strong></span><Icon name="down"/></button></nav></>}</section>{confirmNoteDelete&&data&&<ConfirmDialog title="Delete note?" body="This note will be removed from your reading memory. The article and any highlights will stay." onCancel={()=>setConfirmNoteDelete(false)} onConfirm={()=>{onNote(data.id,"");setNote("");setConfirmNoteDelete(false)}}/>}{speedOpen&&data&&<SpeedReader articleId={data.id} title={data.title} subtitle={`${data.feed}`} text={htmlToPlainText(data.body,data.excerpt)} onBack={()=>setSpeedOpen(false)}/>}</div>
}
function LibraryView({items,loading,query,saving,starred,starredLoading,starredError,archived,archivedLoading,archivedError,archiveOpen,onToggleArchive,onOpenStarred,onOpenArchived,onToggleStar,onToggleRead,onDeleteArticle,onArchive,onNavigate,onSaveNote,onDeleteHighlight,onExport}:{items:ApiResponse<typeof api,"library">["items"];loading:boolean;query:string;saving:boolean;starred:Article[];starredLoading:boolean;starredError:unknown;archived:Article[];archivedLoading:boolean;archivedError:unknown;archiveOpen:boolean;onToggleArchive:()=>void;onOpenStarred:(id:number,index:number)=>void;onOpenArchived:(id:number,index:number)=>void;onToggleStar:(a:Article)=>void;onToggleRead:(a:Article)=>void;onDeleteArticle:(a:Article)=>void;onArchive?:(a:Article)=>void;onNavigate:(view:View)=>void;onSaveNote:(articleId:number,text:string)=>void;onDeleteHighlight:(id:number)=>void;onExport:()=>void}){
  const [editing,setEditing]=useState<number>();
  const [draft,setDraft]=useState("");
  const [deleteItem,setDeleteItem]=useState<(typeof items)[number]>();
  const beginEdit=(item:(typeof items)[number])=>{setEditing(item.id);setDraft(item.text)};
  return <section className="library-view">
    <div className="section-lead"><div><h2>Library</h2><p>Everything you have kept: starred articles and saved snippets.</p></div><button className="text-button" onClick={onExport}>Export markdown</button></div>
    <section className="library-section" aria-label="Starred articles">
      <h3>Starred articles</h3>
      {starredLoading?<p className="library-empty">Loading starred articles…</p>:starredError?<p className="library-empty">Could not load starred articles. Try again in a moment.</p>:starred.length===0?<p className="library-empty">{query?"No starred articles match your search.":"No starred articles yet. Star an article and it will live here."}</p>:<ArticleList articles={starred} loading={false} error={null} cursor={-1} query={query} onOpen={onOpenStarred} onToggleStar={onToggleStar} onToggleRead={onToggleRead} onDelete={onDeleteArticle} onArchive={onArchive}/>}
    </section>
    <section className="library-section" aria-label="Saved snippets">
      <h3>Saved snippets</h3>
      {loading?<p className="library-empty">Loading snippets…</p>:items.length===0?<p className="library-empty">{query?"No notes or highlights match your search.":"No notes or highlights yet. Open an article to save your first one."}</p>:<div className="library-list">{items.map(item=><article key={`${item.kind}-${item.id}`}><div className="library-item-top"><span className="kind-label">{item.kind}</span><div>{item.kind==="note"&&<button onClick={()=>beginEdit(item)}>Edit</button>}<button className="library-delete" onClick={()=>setDeleteItem(item)}>Delete</button></div></div>{item.kind==="note"&&editing===item.id?<div className="library-editor"><textarea {...FIELDS.saveNote.text} aria-label={`Edit note for ${item.article_title}`} value={draft} onChange={event=>setDraft(event.target.value)}/><div><button onClick={()=>setEditing(undefined)}>Cancel</button><button className="primary-button" disabled={saving||!draft.trim()} onClick={()=>{onSaveNote(item.article_id,draft);setEditing(undefined)}}>{saving?"Saving…":"Save note"}</button></div></div>:<blockquote><HighlightText text={item.text} query={query}/></blockquote>}<a href={item.article_url} target="_blank" rel="noreferrer"><HighlightText text={item.article_title} query={query}/></a><p><HighlightText text={`${item.theme} · ${item.feed}`} query={query}/> · {agoText(item.created_at)}</p></article>)}</div>}
    </section>
    <section className="library-section library-archive" aria-label="Archived articles">
      <button type="button" className="library-archive-toggle" aria-expanded={archiveOpen} onClick={onToggleArchive}><Icon name="archive" size={17}/><span>Archived articles</span><span className={archiveOpen?"library-chevron open":"library-chevron"}><Icon name="chevron" size={15}/></span></button>
      {archiveOpen&&(archivedLoading?<p className="library-empty">Loading the archive…</p>:archivedError?<p className="library-empty">Could not load the archive. Try again in a moment.</p>:archived.length===0?<p className="library-empty">{query?"No archived articles match your search.":"Nothing in the archive."}</p>:<ArticleList articles={archived} loading={false} error={null} cursor={-1} query={query} onOpen={onOpenArchived} onToggleStar={onToggleStar} onToggleRead={onToggleRead} onDelete={onDeleteArticle}/>)}
    </section>
    <section className="library-section library-manage" aria-label="Manage">
      <button type="button" className="library-manage-row" onClick={()=>onNavigate("Organize")}><Icon name="organize" size={17}/><span>Organize feeds</span><Icon name="chevron" size={15}/></button>
      <button type="button" className="library-manage-row" onClick={()=>onNavigate("Settings")}><Icon name="settings" size={17}/><span>Settings</span><Icon name="chevron" size={15}/></button>
    </section>
    {deleteItem&&<ConfirmDialog title={`Delete ${deleteItem.kind}?`} body={`This ${deleteItem.kind} will be removed from your reading memory. The article will stay.`} busy={saving} onCancel={()=>setDeleteItem(undefined)} onConfirm={()=>{if(deleteItem.kind==="note")onSaveNote(deleteItem.article_id,"");else onDeleteHighlight(deleteItem.id);setDeleteItem(undefined)}}/>}
  </section>
}
function OrganizeFeeds({data,search,adding,renaming,onAdd,onFeed,onRename,onDelete}:{data:Dashboard|undefined;search:string;adding:boolean;renaming:boolean;onAdd:(url:string,title:string,themeId:number)=>void;onFeed:(args:{id:number;muted?:boolean;keep_forever?:boolean;theme_id?:number})=>void;onRename:(id:number,name:string)=>void;onDelete:(id:number)=>void}){
  const [url,setUrl]=useState("");
  const [title,setTitle]=useState("");
  const [themeId,setThemeId]=useState<number>(data?.themes[0]?.id??0);
  const [confirmDelete,setConfirmDelete]=useState<number>();
  const [editingTheme,setEditingTheme]=useState<number>();
  const [themeName,setThemeName]=useState("");
  const [urlError,setUrlError]=useState("");
  const [renameError,setRenameError]=useState("");
  useEffect(()=>{if(!themeId&&data?.themes[0])setThemeId(data.themes[0].id)},[data?.themes,themeId]);
  const term=search.trim().toLowerCase();
  const submit=()=>{if(!url.trim()){setUrlError("Enter the feed URL first.");return}if(!themeId)return;setUrlError("");onAdd(url.trim(),title.trim(),themeId)};
  return <section className="organize-view">
    <div className="add-feed-panel"><div><h2>Add a feed</h2><p>Paste an RSS or Atom URL, then choose where it belongs.</p></div><div className="add-feed-form"><label><span>Feed URL</span><input {...FIELDS.addFeed.url} type="url" inputMode="url" value={url} onChange={e=>{setUrl(e.target.value);if(urlError)setUrlError("")}} placeholder="https://example.com/feed"/></label><label><span>Name <small>optional</small></span><input {...FIELDS.addFeed.title} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Use the feed’s title"/></label><label><span>Category</span><select value={themeId} onChange={e=>setThemeId(Number(e.target.value))}>{data?.themes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button className="primary-button add-feed-button" disabled={adding||!themeId} onClick={submit}>{adding?"Checking feed…":"Add feed"}</button></div>{urlError&&<p className="field-error" role="alert">{urlError}</p>}</div>
    <div className="organize-lead"><div><h2>Subscriptions</h2><p>{data?.feeds.length??0} feeds across {data?.themes.length??0} categories</p></div></div>
    <div className="category-stack">{data?.themes.map(t=>{const feeds=data.feeds.filter(f=>f.theme_id===t.id&&(!term||`${f.title} ${f.url}`.toLowerCase().includes(term)));if(term&&!feeds.length)return null;return <section className="feed-category" key={t.id}><header>{editingTheme===t.id?<div className="theme-rename"><input {...FIELDS.renameTheme.name} aria-label={`Rename ${t.name}`} value={themeName} onChange={event=>setThemeName(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"){if(themeName.trim()){onRename(t.id,themeName);setEditingTheme(undefined);setRenameError("")}else setRenameError("Enter a name for the category.")}if(event.key==="Escape"){setEditingTheme(undefined);setRenameError("")}}} autoFocus/><button onClick={()=>{setEditingTheme(undefined);setRenameError("")}}>Cancel</button><button disabled={renaming} onClick={()=>{if(!themeName.trim()){setRenameError("Enter a name for the category.");return}setRenameError("");onRename(t.id,themeName);setEditingTheme(undefined)}}>Save</button></div>:<><h3>{t.name}</h3><span>{feeds.length}</span><button className="rename-theme" onClick={()=>{setEditingTheme(t.id);setThemeName(t.name);setRenameError("")}}>Rename</button></>}</header>{editingTheme===t.id&&renameError&&<p className="field-error" role="alert">{renameError}</p>}{feeds.length===0?<p className="empty-category">No feeds in this category.</p>:<div className="feed-settings">{feeds.map(f=><div className={f.muted?"feed-setting is-muted":"feed-setting"} key={f.id}><div className="feed-identity"><strong>{f.title}</strong><span className={f.fetch_error?"feed-error":""}>{f.fetch_error??(f.last_fetched_at?`Updated ${agoText(f.last_fetched_at)}`:f.url)}</span></div><label className="category-control"><span className="theme-control-label">Theme</span><select aria-label={`Theme for ${f.title}`} value={f.theme_id} onChange={e=>onFeed({id:f.id,theme_id:Number(e.target.value)})}>{data.themes.map(theme=><option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label><div className="feed-toggles"><label className="mute-control"><input type="checkbox" checked={f.muted} onChange={e=>onFeed({id:f.id,muted:e.target.checked})}/><span>{f.muted?"Muted":"Active"}</span></label><label className="keep-control"><input type="checkbox" checked={f.keep_forever} onChange={e=>onFeed({id:f.id,keep_forever:e.target.checked})}/><span>Keep forever</span></label></div><button className="delete-feed" onClick={()=>setConfirmDelete(f.id)}>Delete</button>{confirmDelete===f.id&&<div className="delete-confirm" role="alert"><p>Delete <strong>{f.title}</strong> and its saved stories, notes, and highlights?</p><div><button onClick={()=>setConfirmDelete(undefined)}>Cancel</button><button className="destructive" onClick={()=>{onDelete(f.id);setConfirmDelete(undefined)}}>Delete feed</button></div></div>}</div>)}</div>}</section>})}</div>
    {term&&data&&data.feeds.every(f=>!`${f.title} ${f.url}`.toLowerCase().includes(term))&&<div className="state-page"><strong>No matching feeds.</strong><span>Try a different search.</span></div>}
  </section>
}
function Settings({data,onRetention,onExport}:{data:Dashboard|undefined;onRetention:(days:number)=>void;onExport:()=>void}){
  const [retentionDays,setRetentionDays]=useState(data?.retention_days??30);
  useEffect(()=>setRetentionDays(data?.retention_days??30),[data?.retention_days]);
  const validRetention=Number.isInteger(retentionDays)&&retentionDays>=1&&retentionDays<=365;
  return <section className="settings-view"><div className="settings-block"><h2>Reading flow</h2><p>Articles move to Archive when you leave the reader or mark them read.</p><label htmlFor="retention-days">Permanently delete unprotected articles after</label><div className="inline-setting"><input {...FIELDS.setRetentionDays.days} id="retention-days" type="number" value={retentionDays} onChange={e=>setRetentionDays(Number(e.target.value))}/><span>days</span><button disabled={!validRetention} onClick={()=>onRetention(retentionDays)}>Save</button></div>{!validRetention&&<p className="field-error">Choose a whole number from 1 to 365.</p>}<p className="retention-note">Starred articles, notes, highlights, and feeds marked Keep forever are protected.</p></div><div className="settings-block"><h2>Subscriptions</h2><p>Export your feeds and categories for use in another reader.</p><button className="text-button" onClick={onExport}>Export subscriptions as OPML</button></div></section>
}
