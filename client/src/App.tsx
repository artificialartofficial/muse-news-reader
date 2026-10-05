import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

type Dashboard = ApiResponse<typeof api, "dashboard">;
type Article = Dashboard["articles"][number];
type View = "Main" | "Theme" | "Feed" | "Starred" | "Archive" | "Library" | "Organize" | "Settings";

// Keep the briefing implementation available without exposing the experience.
const BRIEFING_ENABLED = false;

type IconName = "inbox" | "star" | "archive" | "library" | "organize" | "settings" | "refresh" | "search" | "back" | "external" | "chevron" | "up" | "down" | "trash" | "help" | "close";
function Icon({name,size=18}:{name:IconName;size?:number}) {
  const paths:Record<IconName,ReactNode>={
    inbox:<><path d="M4 4h16v12H4z"/><path d="M4 13h5l2 3h2l2-3h5"/></>,
    star:<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2-4.5-4.4 6.2-.9z"/>,
    archive:<><path d="M4 7h16v13H4z"/><path d="M3 4h18v3H3zM9 11h6"/></>,
    library:<><path d="M5 4h4v16H5zM11 4h4v16h-4zM17 5l3-1 3 15-3 1z"/></>,
    organize:<><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></>,
    settings:<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    refresh:<><path d="M20 6v5h-5"/><path d="M19 11a7 7 0 1 0 1 4"/></>,
    search:<><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    back:<path d="m15 18-6-6 6-6"/>, external:<><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v7H4V6h7"/></>,chevron:<path d="m9 18 6-6-6-6"/>,up:<path d="m6 15 6-6 6 6"/>,down:<path d="m6 9 6 6 6-6"/>,trash:<><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/><path d="M10 11v5M14 11v5"/></>,help:<><circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1.2.9-1.2 1.7M12 17h.01"/></>,close:<path d="m7 7 10 10M17 7 7 17"/>, 
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function relativeTime(value:string|null){if(!value)return "Unknown time";const d=new Date(value);const diff=Date.now()-d.getTime();const mins=Math.max(0,Math.round(diff/60000));if(mins<60)return `${mins}m`;const hrs=Math.round(mins/60);if(hrs<24)return `${hrs}h`;const days=Math.round(hrs/24);if(days<14)return `${days}d`;return new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric"}).format(d);}
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
function Digest({digest}:{digest:Dashboard["digest"]}){if(!digest)return <section className="digest digest-empty"><div><span className="digest-label">Briefing</span><p>Your first briefing will appear after newly ingested stories are reviewed.</p></div></section>;const lines=digest.markdown.split("\n").map(x=>x.trim()).filter(Boolean);return <section className="digest"><div className="digest-top"><span className="digest-label">Briefing</span><time>{relativeTime(digest.created_at)} ago</time></div><div className="digest-copy">{lines.map((line,i)=>line.startsWith("#")?<h2 key={i}><InlineMarkdown text={line.replace(/^#+\s*/,"")}/></h2>:line.match(/^[-*]\s/)?<p className="digest-bullet" key={i}><InlineMarkdown text={line.replace(/^[-*]\s/,"")}/></p>:<p key={i}><InlineMarkdown text={line}/></p>)}</div></section>}
function downloadFile(filename:string,content:string,type:string){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function isTypingTarget(target:EventTarget|null):boolean{const element=target instanceof HTMLElement?target:null;return Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));}
function ArticleContent({html}:{html:string}){return <div className="reader-body-content" dangerouslySetInnerHTML={{__html:html}}/>;}
function HighlightText({text,query}:{text:string;query:string}){
  const terms=[...new Set(query.trim().split(/\s+/).filter(term=>term.length>0))];
  if(!terms.length)return <>{text}</>;
  const escaped=terms.map(term=>term.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
  const pattern=new RegExp(`(${escaped.join("|")})`,"gi");
  return <>{text.split(pattern).map((part,index)=>terms.some(term=>term.toLowerCase()===part.toLowerCase())?<mark key={index}>{part}</mark>:part)}</>;
}
function ConfirmDialog({title,body,confirmLabel="Delete",busy=false,onCancel,onConfirm}:{title:string;body:string;confirmLabel?:string;busy?:boolean;onCancel:()=>void;onConfirm:()=>void}){
  useEffect(()=>{const onKey=(event:globalThis.KeyboardEvent)=>{if(event.key==="Escape"&&!busy){event.preventDefault();onCancel();}};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey)},[busy,onCancel]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onCancel()}}><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{title}</h2><p>{body}</p><div><button onClick={onCancel} disabled={busy}>Cancel</button><button className="destructive" onClick={onConfirm} disabled={busy}>{busy?"Deleting…":confirmLabel}</button></div></section></div>;
}
function ShortcutSheet({onClose}:{onClose:()=>void}){
  const rows:Array<[string,string]>=[["J / K","Move through articles"],["O","Open selected article"],["M","Toggle read or unread"],["S","Star or unstar"],["Shift + A","Mark the current list read"],["J / K, ← / →, [ / ]","Previous or next in reader"],["Esc","Close reader or this guide"],["?","Show or hide shortcuts"]];
  return <div className="modal-backdrop shortcut-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><section className="shortcut-sheet" role="dialog" aria-modal="true" aria-labelledby="shortcut-title"><header><div><h2 id="shortcut-title">Keyboard shortcuts</h2><p>Keys stay inactive while you type.</p></div><button className="icon-button" aria-label="Close keyboard shortcuts" onClick={onClose}><Icon name="close"/></button></header><dl>{rows.map(([keys,label])=><div key={keys}><dt>{keys.split(" / ").map((key,index)=><span key={key}>{index>0&&<i>/</i>}<kbd>{key}</kbd></span>)}</dt><dd>{label}</dd></div>)}</dl></section></div>;
}

export function App(){
  const qc=useQueryClient();
  const [view,setView]=useState<View>("Main"); const [theme,setTheme]=useState<string>(); const [feedId,setFeedId]=useState<number>();
  const [search,setSearch]=useState(""); const [selectedId,setSelectedId]=useState<number>(); const [readerQueue,setReaderQueue]=useState<Article[]>([]); const [openedIds,setOpenedIds]=useState<number[]>([]); const [cursor,setCursor]=useState(0); const [notice,setNotice]=useState<string>();
  const [showShortcuts,setShowShortcuts]=useState(false); const [deleteTarget,setDeleteTarget]=useState<{id:number;title:string;fromReader:boolean}>();
  const mutationError=()=>setNotice("That change could not be saved. Please try again.");
  const dash=useQuery({queryKey:["dashboard",view,theme,feedId,search],queryFn:()=>api.dashboard({view:view==="Library"||view==="Organize"||view==="Settings"?"Main":view,theme,feed_id:feedId,search,limit:120})});
  const library=useQuery({queryKey:["library",search],queryFn:()=>api.library({search}),enabled:view==="Library"});
  const article=useQuery({queryKey:["article",selectedId],queryFn:()=>api.getArticle({id:selectedId ?? 0}),enabled:selectedId!==undefined});
  const refresh=useMutation({mutationFn:()=>api.refresh_feeds({}),onSuccess:r=>{setNotice(`${r.new_count} new · ${r.error_count} feed errors`);void qc.invalidateQueries();},onError:mutationError});
  const state=useMutation({mutationFn:(args:{id:number;read?:boolean;starred?:boolean;archived?:boolean})=>api.setArticleState(args),onSuccess:(_result,args)=>{if(args.read===false)setOpenedIds(ids=>ids.filter(id=>id!==args.id));void qc.invalidateQueries({queryKey:["dashboard"]});if(args.starred!==undefined||args.archived===false||args.read===false)void qc.invalidateQueries({queryKey:["article",args.id]});},onError:mutationError});
  const finishReading=useMutation({mutationFn:(ids:number[])=>api.finishReading({ids}),onSuccess:()=>{setSelectedId(undefined);setReaderQueue([]);setOpenedIds([]);void qc.invalidateQueries({queryKey:["dashboard"]});},onError:mutationError});
  const markAll=useMutation({mutationFn:()=>api.markAllRead({view:view==="Theme"?"Theme":view==="Feed"?"Feed":"Main",theme,feed_id:feedId}),onSuccess:r=>{setNotice(`${r.updated} marked read`);void qc.invalidateQueries();},onError:mutationError});
  const addFeed=useMutation({mutationFn:(args:{url:string;title?:string;theme_id:number})=>api.addFeed(args),onSuccess:r=>{if(!r.ok){setNotice(r.error??"The feed could not be added.");return;}setNotice(`${r.title??"Feed"} added · ${r.added_count} stories`);void qc.invalidateQueries();},onError:mutationError});
  const updateFeed=useMutation({mutationFn:(args:{id:number;muted?:boolean;keep_forever?:boolean;theme_id?:number})=>api.updateFeed(args),onSuccess:()=>{setNotice("Feed settings saved");void qc.invalidateQueries();},onError:mutationError});
  const deleteFeed=useMutation({mutationFn:(id:number)=>api.deleteFeed({id}),onSuccess:()=>{setNotice("Feed deleted");void qc.invalidateQueries();},onError:mutationError});
  const setRetention=useMutation({mutationFn:(days:number)=>api.setRetentionDays({days}),onSuccess:r=>{setNotice(r.deleted?`Retention saved · ${r.deleted} old articles deleted`:"Retention saved");void qc.invalidateQueries();},onError:mutationError});
  const saveNote=useMutation({mutationFn:(args:{article_id:number;text:string})=>api.saveNote(args),onSuccess:()=>{setNotice("Note saved");void qc.invalidateQueries({queryKey:["library"]});void qc.invalidateQueries({queryKey:["article",selectedId]});},onError:mutationError});
  const saveHighlight=useMutation({mutationFn:(args:{article_id:number;text:string})=>api.saveHighlight(args),onSuccess:()=>{setNotice("Highlight saved");void qc.invalidateQueries({queryKey:["article",selectedId]});void qc.invalidateQueries({queryKey:["library"]});},onError:mutationError});
  const deleteHighlight=useMutation({mutationFn:(id:number)=>api.deleteHighlight({id}),onSuccess:()=>{setNotice("Highlight deleted");void qc.invalidateQueries({queryKey:["article",selectedId]});void qc.invalidateQueries({queryKey:["library"]});},onError:mutationError});
  const deleteArticle=useMutation({mutationFn:(id:number)=>api.deleteArticle({id}),onSuccess:(_result,id)=>{setNotice("Article deleted");setDeleteTarget(undefined);setReaderQueue(items=>items.filter(item=>item.id!==id));if(selectedId===id){const remainingOpened=openedIds.filter(itemId=>itemId!==id);if(remainingOpened.length)finishReading.mutate(remainingOpened);else{setSelectedId(undefined);setOpenedIds([]);}}else setOpenedIds(ids=>ids.filter(itemId=>itemId!==id));void qc.invalidateQueries({queryKey:["dashboard"]});void qc.invalidateQueries({queryKey:["library"]});},onError:mutationError});
  const renameTheme=useMutation({mutationFn:(args:{id:number;name:string})=>api.renameTheme(args),onSuccess:(r,args)=>{if(!r.ok){setNotice(r.error??"The category could not be renamed.");return;}setNotice(`Category renamed to ${r.name??"new name"}`);if(view==="Theme"&&dash.data?.themes.find(item=>item.id===args.id)?.name===theme)setTheme(r.name??undefined);void qc.invalidateQueries();},onError:mutationError});
  const articles=dash.data?.articles ?? [];
  const readerIndex=selectedId===undefined?-1:readerQueue.findIndex(item=>item.id===selectedId);
  const activeLabel=view==="Main"?"Inbox":view==="Theme"?theme??"Theme":view==="Feed"?dash.data?.feeds.find(f=>f.id===feedId)?.title??"Feed":view;
  useEffect(()=>{setCursor(0)},[view,theme,feedId,search]);
  useEffect(()=>{setCursor(current=>Math.min(current,Math.max(articles.length-1,0)))},[articles.length]);
  useEffect(()=>{
    if(!notice)return;
    const clearNotice=()=>setNotice(undefined);
    const timeout=window.setTimeout(clearNotice,5000);
    window.addEventListener("pointerdown",clearNotice,{capture:true});
    window.addEventListener("keydown",clearNotice,{capture:true});
    window.addEventListener("wheel",clearNotice,{capture:true});
    return()=>{
      window.clearTimeout(timeout);
      window.removeEventListener("pointerdown",clearNotice,{capture:true});
      window.removeEventListener("keydown",clearNotice,{capture:true});
      window.removeEventListener("wheel",clearNotice,{capture:true});
    };
  },[notice]);
  useEffect(()=>{if(selectedId===undefined){const active=document.querySelector<HTMLElement>(`[data-article-index="${cursor}"]`);active?.scrollIntoView({block:"nearest"});}},[cursor,selectedId]);
  useEffect(()=>{const onKey=(e:globalThis.KeyboardEvent)=>{if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey||isTypingTarget(e.target))return;if(e.key==="?"){e.preventDefault();setShowShortcuts(value=>!value);return;}if(e.key==="Escape"&&showShortcuts){e.preventDefault();setShowShortcuts(false);}};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey)},[showShortcuts]);
  useEffect(()=>{const onKey=(e:globalThis.KeyboardEvent)=>{if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey||selectedId!==undefined||showShortcuts||isTypingTarget(e.target))return;const list=articles;const key=e.key.toLowerCase();const articleView=["Main","Theme","Feed","Starred","Archive"].includes(view);if(!articleView)return;const current=list[cursor];if(key==="j"&&list.length){e.preventDefault();if(view==="Main"){const first=list[0];if(first){setCursor(0);setReaderQueue(list);setOpenedIds([first.id]);setSelectedId(first.id);}}else setCursor(c=>Math.min(c+1,list.length-1));}if(key==="k"&&list.length){e.preventDefault();setCursor(c=>Math.max(c-1,0));}if(key==="o"&&current){e.preventDefault();setReaderQueue(list);setOpenedIds([current.id]);setSelectedId(current.id);}if(key==="m"&&current){e.preventDefault();state.mutate({id:current.id,read:!current.read_at});}if(key==="s"&&current){e.preventDefault();state.mutate({id:current.id,starred:!current.starred});}if(key==="a"&&e.shiftKey&&["Main","Theme","Feed"].includes(view)){e.preventDefault();markAll.mutate();}};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey)},[articles,cursor,selectedId,view,state,markAll,showShortcuts]);
  const rememberOpened=(id:number)=>setOpenedIds(ids=>ids.includes(id)?ids:[...ids,id]);
  const leaveReader=()=>{if(finishReading.isPending)return;if(openedIds.length){finishReading.mutate(openedIds);return;}setSelectedId(undefined);setReaderQueue([]);};
  const choose=(next:View,nextTheme?:string,nextFeed?:number)=>{setCursor(0);setView(next);setTheme(nextTheme);setFeedId(nextFeed);setSelectedId(undefined);setReaderQueue([]);setOpenedIds([])};
  const nav=[{v:"Main" as View,label:"Inbox",icon:"inbox" as IconName,count:dash.data?.themes.reduce((n,t)=>n+t.unread,0)??0},{v:"Starred" as View,label:"Starred",icon:"star" as IconName},{v:"Library" as View,label:"Library",icon:"library" as IconName},{v:"Archive" as View,label:"Archive",icon:"archive" as IconName},{v:"Organize" as View,label:"Organize",icon:"organize" as IconName}];
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="side-primary">{nav.map(n=><button key={n.v} className={view===n.v?"nav-row active":"nav-row"} onClick={()=>choose(n.v)}><Icon name={n.icon}/><span>{n.label}</span>{n.count!==undefined&&<b>{n.count}</b>}</button>)}</div>
      <div className="side-rule"/><div className="side-section-title">Themes</div>
      <div className="theme-list">{dash.data?.themes.map(t=><button key={t.id} className={view==="Theme"&&theme===t.name?"theme-row active":"theme-row"} onClick={()=>choose("Theme",t.name)}><span>{t.name}</span><b>{t.unread}</b></button>)}</div>
      <div className="sidebar-foot"><button className={view==="Settings"?"nav-row active":"nav-row"} onClick={()=>choose("Settings")}><Icon name="settings"/><span>Settings</span></button></div>
    </aside>
    <main className="main-column">
      <header className="toolbar">
        <div className="mobile-view-select"><select aria-label="Choose view" value={view==="Theme"?`theme:${theme}`:view==="Feed"?`feed:${feedId}`:view} onChange={e=>{const val=e.target.value;if(val.startsWith("theme:"))choose("Theme",val.slice(6));else if(val.startsWith("feed:")){const id=Number(val.slice(5));const feed=dash.data?.feeds.find(f=>f.id===id);if(feed)choose("Feed",feed.theme,id)}else choose(val as View)}}><option value="Main">Inbox</option>{dash.data?.themes.map(t=><option key={t.id} value={`theme:${t.name}`}>{t.name} ({t.unread})</option>)}{view==="Feed"&&feedId!==undefined&&<option value={`feed:${feedId}`}>{activeLabel}</option>}<option value="Starred">Starred</option><option value="Library">Library</option><option value="Archive">Archive</option><option value="Organize">Organize</option><option value="Settings">Settings</option></select></div>
        <div className="heading-block"><h1>{activeLabel}</h1>{!['Library','Organize','Settings'].includes(view)&&<span>{articles.length} shown</span>}</div>
        <label className="search-box"><Icon name="search" size={16}/><input aria-label={view==="Organize"?"Search feeds":view==="Library"?"Search reading memory":"Search articles"} value={search} onChange={e=>setSearch(e.target.value)} placeholder={view==="Organize"?"Search feeds":view==="Library"?"Search reading memory":"Search"}/>{search&&<button type="button" className="search-clear" aria-label="Clear search" onClick={()=>setSearch("")}><Icon name="close" size={15}/></button>}</label>
        <button className="icon-button help-button" aria-label="Show keyboard shortcuts" onClick={()=>setShowShortcuts(true)}><Icon name="help"/></button>
        <button className="icon-button refresh-button" aria-label="Refresh feeds" onClick={()=>refresh.mutate()} disabled={refresh.isPending}><Icon name="refresh"/></button>
      </header>
      {notice&&<button className="notice" onClick={()=>setNotice(undefined)} aria-label="Dismiss status">{notice}</button>}
      {view==="Library"?<LibraryView items={library.data?.items??[]} loading={library.isPending} query={search} saving={saveNote.isPending||deleteHighlight.isPending} onSaveNote={(articleId,text)=>saveNote.mutate({article_id:articleId,text})} onDeleteHighlight={id=>deleteHighlight.mutate(id)} onExport={async()=>{try{const r=await api.exportMarkdown({});downloadFile(r.filename,r.content,"text/markdown")}catch{mutationError()}}}/>:view==="Organize"?<OrganizeFeeds data={dash.data} search={search} adding={addFeed.isPending} renaming={renameTheme.isPending} onAdd={(url,title,themeId)=>addFeed.mutate({url,title:title||undefined,theme_id:themeId})} onFeed={args=>updateFeed.mutate(args)} onRename={(id,name)=>renameTheme.mutate({id,name})} onDelete={id=>deleteFeed.mutate(id)}/>:view==="Settings"?<Settings data={dash.data} onRetention={d=>setRetention.mutate(d)} onExport={async()=>{try{const r=await api.exportOpml({});downloadFile(r.filename,r.content,"text/xml")}catch{mutationError()}}}/>:<>
        <div className="main-actions">{["Main","Theme","Feed"].includes(view)&&<button className="text-button" onClick={()=>markAll.mutate()} disabled={markAll.isPending}>Mark all read</button>}{(view==="Theme"||view==="Feed")&&<select aria-label={`Choose a feed in ${theme??"theme"}`} value={feedId??""} onChange={e=>{const id=Number(e.target.value);if(id)choose("Feed",theme,id);else choose("Theme",theme)}}><option value="">All feeds</option>{dash.data?.feeds.filter(f=>f.theme===theme).map(f=><option key={f.id} value={f.id}>{f.title} ({f.unread})</option>)}</select>}<span className="pull-state">{dash.data?.last_pull?.completed_at?`Pulled ${relativeTime(dash.data.last_pull.completed_at)} ago`:"Not pulled yet"}</span></div>
        {BRIEFING_ENABLED&&(view==="Main"||view==="Theme")&&<Digest digest={dash.data?.digest??null}/>}<ArticleList articles={articles} loading={dash.isPending} error={dash.error} cursor={cursor} query={search} onOpen={(id,index)=>{setCursor(index);setReaderQueue(articles);setOpenedIds([id]);setSelectedId(id)}} onToggleStar={a=>state.mutate({id:a.id,starred:!a.starred})} onToggleRead={a=>state.mutate({id:a.id,read:!a.read_at})} onDelete={a=>setDeleteTarget({id:a.id,title:a.title,fromReader:false})}/>
      </>}
    </main>
    <nav className="bottom-nav">{nav.map(n=><button key={n.v} className={view===n.v?"active":""} onClick={()=>choose(n.v)}><Icon name={n.icon}/><span>{n.label}</span>{n.count!==undefined&&<b>{n.count}</b>}</button>)}</nav>
    {selectedId!==undefined&&<Reader data={article.data?.article} loading={article.isPending} error={article.error} closing={finishReading.isPending||state.isPending||deleteArticle.isPending} position={readerIndex>=0?readerIndex+1:undefined} total={readerQueue.length} shortcutsOpen={showShortcuts||deleteTarget!==undefined} onPrevious={readerIndex>0?()=>{const previous=readerQueue[readerIndex-1];if(previous){setCursor(readerIndex-1);rememberOpened(previous.id);setSelectedId(previous.id)}}:undefined} onNext={readerIndex>=0&&readerIndex<readerQueue.length-1?()=>{const next=readerQueue[readerIndex+1];if(next){setCursor(readerIndex+1);rememberOpened(next.id);setSelectedId(next.id)}}:undefined} onClose={leaveReader} onStar={a=>state.mutate({id:a.id,starred:!a.starred})} onUnread={a=>state.mutate({id:a.id,read:false})} onArchive={a=>{if(a.archived_at){setOpenedIds(ids=>ids.filter(id=>id!==a.id));state.mutate({id:a.id,archived:false});}else leaveReader()}} onDeleteArticle={a=>setDeleteTarget({id:a.id,title:a.title,fromReader:true})} onNote={(id,text)=>saveNote.mutate({article_id:id,text})} onHighlight={(id,text)=>saveHighlight.mutate({article_id:id,text})} onDeleteHighlight={id=>deleteHighlight.mutate(id)}/>} 
    {showShortcuts&&<ShortcutSheet onClose={()=>setShowShortcuts(false)}/>} 
    {deleteTarget&&<ConfirmDialog title="Delete article?" body={`“${deleteTarget.title}” will be removed from the reader, along with its note and highlights. It will not return on the next feed refresh.`} busy={deleteArticle.isPending} onCancel={()=>setDeleteTarget(undefined)} onConfirm={()=>deleteArticle.mutate(deleteTarget.id)}/>} 
  </div>
}

function ArticleList({articles,loading,error,cursor,query,onOpen,onToggleStar,onToggleRead,onDelete}:{articles:Article[];loading:boolean;error:unknown;cursor:number;query:string;onOpen:(id:number,index:number)=>void;onToggleStar:(a:Article)=>void;onToggleRead:(a:Article)=>void;onDelete:(a:Article)=>void}){if(loading)return <div className="state-page">Loading your feeds…</div>;if(error)return <div className="state-page"><strong>Could not load the inbox.</strong><span>{String(error)}</span></div>;if(!articles.length)return <div className="state-page"><strong>Nothing here.</strong><span>Refresh feeds or choose another view.</span></div>;return <section className="article-list" aria-label="Articles">{articles.map((a,i)=><article key={a.id} data-article-index={i} className={`${a.read_at?"article-row read":"article-row unread"} ${cursor===i?"keyboard-focus":""}`}><button className="article-main" onClick={()=>onOpen(a.id,i)}><div className="article-copy"><div className="article-source"><span><HighlightText text={a.theme} query={query}/></span><b><HighlightText text={a.feed} query={query}/></b><time>{relativeTime(a.published_at??a.ingested_at)}</time></div><h2><HighlightText text={a.title} query={query}/></h2>{a.excerpt&&<p><HighlightText text={a.excerpt} query={query}/></p>}<div className="article-meta">{a.author&&<span><HighlightText text={a.author} query={query}/></span>}<span>{a.read_minutes} min read</span></div></div>{a.image_url&&<img className="article-thumbnail" src={a.image_url} alt={a.image_alt??a.title} loading="lazy"/>}</button><div className="row-actions"><button aria-label={a.starred?`Unstar ${a.title}`:`Star ${a.title}`} className={a.starred?"starred":""} onClick={()=>onToggleStar(a)}><Icon name="star" size={17}/></button><button aria-label={a.read_at?`Mark ${a.title} unread`:`Mark ${a.title} read`} onClick={()=>onToggleRead(a)}>{a.read_at?"Unread":"Read"}</button><button className="delete-row" aria-label={`Delete ${a.title}`} onClick={()=>onDelete(a)}><Icon name="trash" size={16}/></button></div></article>)}</section>}
function Reader({data,loading,error,closing,position,total,shortcutsOpen,onPrevious,onNext,onClose,onStar,onUnread,onArchive,onDeleteArticle,onNote,onHighlight,onDeleteHighlight}:{data:ApiResponse<typeof api,"getArticle">["article"]|undefined;loading:boolean;error:unknown;closing:boolean;position?:number;total:number;shortcutsOpen:boolean;onPrevious?:()=>void;onNext?:()=>void;onClose:()=>void;onStar:(a:ApiResponse<typeof api,"getArticle">["article"])=>void;onUnread:(a:ApiResponse<typeof api,"getArticle">["article"])=>void;onArchive:(a:ApiResponse<typeof api,"getArticle">["article"])=>void;onDeleteArticle:(a:ApiResponse<typeof api,"getArticle">["article"])=>void;onNote:(id:number,text:string)=>void;onHighlight:(id:number,text:string)=>void;onDeleteHighlight:(id:number)=>void}){
  const [note,setNote]=useState("");
  const [selection,setSelection]=useState("");
  const [confirmNoteDelete,setConfirmNoteDelete]=useState(false);
  const scrollRef=useRef<HTMLDivElement>(null);
  const bodyRef=useRef<HTMLDivElement>(null);
  const headingRef=useRef<HTMLHeadingElement>(null);
  const selectionRef=useRef("");
  useEffect(()=>{setNote(data?.note??"")},[data?.id,data?.note]);
  useEffect(()=>{selectionRef.current="";setSelection("");headingRef.current?.focus({preventScroll:true});scrollRef.current?.scrollTo({top:0,behavior:"auto"})},[data?.id]);
  useEffect(()=>{
    let timer:number|undefined;
    const readSelection=()=>{
      window.clearTimeout(timer);
      timer=window.setTimeout(()=>{
        const selected=window.getSelection();
        const anchor=selected?.anchorNode;
        const focus=selected?.focusNode;
        const body=bodyRef.current;
        const text=selected?.toString().trim()??"";
        const next=!selected?.isCollapsed&&anchor&&focus&&body?.contains(anchor)&&body.contains(focus)&&text.length>2?text:"";
        selectionRef.current=next;
        setSelection(current=>current===next?current:next);
      },160);
    };
    document.addEventListener("selectionchange",readSelection);
    document.addEventListener("pointerup",readSelection);
    document.addEventListener("touchend",readSelection);
    return()=>{window.clearTimeout(timer);document.removeEventListener("selectionchange",readSelection);document.removeEventListener("pointerup",readSelection);document.removeEventListener("touchend",readSelection)};
  },[]);
  useEffect(()=>{const onKey=(e:globalThis.KeyboardEvent)=>{if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey||closing||shortcutsOpen||confirmNoteDelete||isTypingTarget(e.target))return;const key=e.key.toLowerCase();if(key==="escape"){e.preventDefault();onClose();}else if((key==="k"||key==="arrowleft"||key==="[")&&onPrevious){e.preventDefault();onPrevious();}else if((key==="j"||key==="arrowright"||key==="]")&&onNext){e.preventDefault();onNext();}};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey)},[onPrevious,onNext,onClose,closing,shortcutsOpen,confirmNoteDelete]);
  return <div className="reader-backdrop"><section className="reader" aria-label="Article reader"><header className="reader-bar"><button className="icon-button" aria-label={closing?"Saving reading progress":"Close article"} onClick={onClose} disabled={closing}><Icon name="back"/></button>{data&&<div className="reader-actions"><button className={data.starred?"starred":""} onClick={()=>onStar(data)} disabled={closing}><Icon name="star" size={17}/>{data.starred?"Starred":"Star"}</button><button onClick={()=>onUnread(data)} disabled={closing}>Unread</button><button onClick={()=>onArchive(data)} disabled={closing}>{closing?"Saving…":data.archived_at?"Restore":"Archive"}</button><button className="reader-delete" onClick={()=>onDeleteArticle(data)} disabled={closing}><Icon name="trash" size={15}/>Delete</button><a href={data.url} target="_blank" rel="noreferrer">Original <Icon name="external" size={15}/></a></div>}</header>{error?<div className="state-page"><strong>Could not open this article.</strong><span>Close the reader and try again.</span></div>:loading||!data?<div className="state-page">Opening article…</div>:<><div className="reader-scroll" ref={scrollRef}><div className="reader-heading"><div>{data.theme} · {data.feed}</div><h1 ref={headingRef} tabIndex={-1}>{data.title}</h1><p>{[data.author,relativeTime(data.published_at??data.ingested_at)+" ago",`${data.read_minutes} min read`].filter(Boolean).join(" · ")}</p></div>{data.image_url&&<img className="reader-image" src={data.image_url} alt={data.image_alt??data.title}/>}<div className="reader-body" ref={bodyRef}>{data.body?<ArticleContent html={data.body}/>:<p>{data.excerpt??"This feed did not include article text. Use Original to read it at the source."}</p>}</div><section className="annotations"><div className="annotation-heading"><h2>Notes</h2>{data.note&&<button className="delete-note" onClick={()=>setConfirmNoteDelete(true)}>Delete note</button>}</div><textarea aria-label="Article note" value={note} onChange={e=>setNote(e.target.value)} placeholder="What do you want to remember?"/><button className="primary-button" onClick={()=>onNote(data.id,note)}>Save note</button>{data.highlights.length>0&&<div className="highlight-stack"><h2>Highlights</h2>{data.highlights.map(h=><div className="highlight-item" key={h.id}><blockquote>{h.text}</blockquote><button aria-label={`Delete highlight: ${h.text.slice(0,60)}`} onClick={()=>onDeleteHighlight(h.id)}>Delete</button></div>)}</div>}</section></div><button className={selection?"save-selection is-visible":"save-selection"} aria-hidden={!selection} disabled={!selection} onPointerDown={event=>event.preventDefault()} onClick={()=>{const text=selectionRef.current;if(!text)return;onHighlight(data.id,text);selectionRef.current="";setSelection("");window.getSelection()?.removeAllRanges()}}>Save selected text</button><nav className="reader-navigation" aria-label="Article navigation"><button aria-label="Previous article, keyboard shortcut K" onClick={onPrevious} disabled={closing||!onPrevious}><Icon name="up"/><span><small>Previous <kbd>K</kbd></small><strong>Article</strong></span></button><div aria-live="polite">{closing?"Saving…":position?`${position} of ${total}`:"Article"}</div><button aria-label="Next article, keyboard shortcut J" onClick={onNext} disabled={closing||!onNext}><span><small>Next <kbd>J</kbd></small><strong>Article</strong></span><Icon name="down"/></button></nav></>}</section>{confirmNoteDelete&&data&&<ConfirmDialog title="Delete note?" body="This note will be removed from your reading memory. The article and any highlights will stay." onCancel={()=>setConfirmNoteDelete(false)} onConfirm={()=>{onNote(data.id,"");setNote("");setConfirmNoteDelete(false)}}/>}</div>
}
function LibraryView({items,loading,query,saving,onSaveNote,onDeleteHighlight,onExport}:{items:ApiResponse<typeof api,"library">["items"];loading:boolean;query:string;saving:boolean;onSaveNote:(articleId:number,text:string)=>void;onDeleteHighlight:(id:number)=>void;onExport:()=>void}){
  const [editing,setEditing]=useState<number>();
  const [draft,setDraft]=useState("");
  const [deleteItem,setDeleteItem]=useState<(typeof items)[number]>();
  const beginEdit=(item:(typeof items)[number])=>{setEditing(item.id);setDraft(item.text)};
  return <section className="library-view"><div className="section-lead"><div><h2>Reading memory</h2><p>Notes and passages saved from your feeds.</p></div><button className="text-button" onClick={onExport}>Export markdown</button></div>{loading?<div className="state-page">Loading library…</div>:items.length===0?<div className="state-page"><strong>No notes or highlights yet.</strong><span>{query?"Try a different search.":"Open an article to save your first one."}</span></div>:<div className="library-list">{items.map(item=><article key={`${item.kind}-${item.id}`}><div className="library-item-top"><span className="kind-label">{item.kind}</span><div>{item.kind==="note"&&<button onClick={()=>beginEdit(item)}>Edit</button>}<button className="library-delete" onClick={()=>setDeleteItem(item)}>Delete</button></div></div>{item.kind==="note"&&editing===item.id?<div className="library-editor"><textarea aria-label={`Edit note for ${item.article_title}`} value={draft} onChange={event=>setDraft(event.target.value)}/><div><button onClick={()=>setEditing(undefined)}>Cancel</button><button className="primary-button" disabled={saving||!draft.trim()} onClick={()=>{onSaveNote(item.article_id,draft);setEditing(undefined)}}>{saving?"Saving…":"Save note"}</button></div></div>:<blockquote><HighlightText text={item.text} query={query}/></blockquote>}<a href={item.article_url} target="_blank" rel="noreferrer"><HighlightText text={item.article_title} query={query}/></a><p><HighlightText text={`${item.theme} · ${item.feed}`} query={query}/> · {relativeTime(item.created_at)} ago</p></article>)}</div>}{deleteItem&&<ConfirmDialog title={`Delete ${deleteItem.kind}?`} body={`This ${deleteItem.kind} will be removed from your reading memory. The article will stay.`} busy={saving} onCancel={()=>setDeleteItem(undefined)} onConfirm={()=>{if(deleteItem.kind==="note")onSaveNote(deleteItem.article_id,"");else onDeleteHighlight(deleteItem.id);setDeleteItem(undefined)}}/>}</section>
}
function OrganizeFeeds({data,search,adding,renaming,onAdd,onFeed,onRename,onDelete}:{data:Dashboard|undefined;search:string;adding:boolean;renaming:boolean;onAdd:(url:string,title:string,themeId:number)=>void;onFeed:(args:{id:number;muted?:boolean;keep_forever?:boolean;theme_id?:number})=>void;onRename:(id:number,name:string)=>void;onDelete:(id:number)=>void}){
  const [url,setUrl]=useState("");
  const [title,setTitle]=useState("");
  const [themeId,setThemeId]=useState<number>(data?.themes[0]?.id??0);
  const [confirmDelete,setConfirmDelete]=useState<number>();
  const [editingTheme,setEditingTheme]=useState<number>();
  const [themeName,setThemeName]=useState("");
  useEffect(()=>{if(!themeId&&data?.themes[0])setThemeId(data.themes[0].id)},[data?.themes,themeId]);
  const term=search.trim().toLowerCase();
  const submit=()=>{if(!url.trim()||!themeId)return;onAdd(url.trim(),title.trim(),themeId)};
  return <section className="organize-view">
    <div className="add-feed-panel"><div><h2>Add a feed</h2><p>Paste an RSS or Atom URL, then choose where it belongs.</p></div><div className="add-feed-form"><label><span>Feed URL</span><input type="url" inputMode="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://example.com/feed"/></label><label><span>Name <small>optional</small></span><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Use the feed’s title"/></label><label><span>Category</span><select value={themeId} onChange={e=>setThemeId(Number(e.target.value))}>{data?.themes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button className="primary-button add-feed-button" disabled={adding||!url.trim()||!themeId} onClick={submit}>{adding?"Checking feed…":"Add feed"}</button></div></div>
    <div className="organize-lead"><div><h2>Subscriptions</h2><p>{data?.feeds.length??0} feeds across {data?.themes.length??0} categories</p></div></div>
    <div className="category-stack">{data?.themes.map(t=>{const feeds=data.feeds.filter(f=>f.theme_id===t.id&&(!term||`${f.title} ${f.url}`.toLowerCase().includes(term)));if(term&&!feeds.length)return null;return <section className="feed-category" key={t.id}><header>{editingTheme===t.id?<div className="theme-rename"><input aria-label={`Rename ${t.name}`} value={themeName} maxLength={80} onChange={event=>setThemeName(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"&&themeName.trim()){onRename(t.id,themeName);setEditingTheme(undefined)}if(event.key==="Escape")setEditingTheme(undefined)}} autoFocus/><button onClick={()=>setEditingTheme(undefined)}>Cancel</button><button disabled={renaming||!themeName.trim()} onClick={()=>{onRename(t.id,themeName);setEditingTheme(undefined)}}>Save</button></div>:<><h3>{t.name}</h3><span>{feeds.length}</span><button className="rename-theme" onClick={()=>{setEditingTheme(t.id);setThemeName(t.name)}}>Rename</button></>}</header>{feeds.length===0?<p className="empty-category">No feeds in this category.</p>:<div className="feed-settings">{feeds.map(f=><div className={f.muted?"feed-setting is-muted":"feed-setting"} key={f.id}><div className="feed-identity"><strong>{f.title}</strong><span className={f.fetch_error?"feed-error":""}>{f.fetch_error??(f.last_fetched_at?`Updated ${relativeTime(f.last_fetched_at)} ago`:f.url)}</span></div><label className="category-control"><span className="theme-control-label">Theme</span><select aria-label={`Theme for ${f.title}`} value={f.theme_id} onChange={e=>onFeed({id:f.id,theme_id:Number(e.target.value)})}>{data.themes.map(theme=><option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label><div className="feed-toggles"><label className="mute-control"><input type="checkbox" checked={f.muted} onChange={e=>onFeed({id:f.id,muted:e.target.checked})}/><span>{f.muted?"Muted":"Active"}</span></label><label className="keep-control"><input type="checkbox" checked={f.keep_forever} onChange={e=>onFeed({id:f.id,keep_forever:e.target.checked})}/><span>Keep forever</span></label></div><button className="delete-feed" onClick={()=>setConfirmDelete(f.id)}>Delete</button>{confirmDelete===f.id&&<div className="delete-confirm" role="alert"><p>Delete <strong>{f.title}</strong> and its saved stories, notes, and highlights?</p><div><button onClick={()=>setConfirmDelete(undefined)}>Cancel</button><button className="destructive" onClick={()=>{onDelete(f.id);setConfirmDelete(undefined)}}>Delete feed</button></div></div>}</div>)}</div>}</section>})}</div>
    {term&&data&&data.feeds.every(f=>!`${f.title} ${f.url}`.toLowerCase().includes(term))&&<div className="state-page"><strong>No matching feeds.</strong><span>Try a different search.</span></div>}
  </section>
}
function Settings({data,onRetention,onExport}:{data:Dashboard|undefined;onRetention:(days:number)=>void;onExport:()=>void}){
  const [retentionDays,setRetentionDays]=useState(data?.retention_days??30);
  useEffect(()=>setRetentionDays(data?.retention_days??30),[data?.retention_days]);
  const validRetention=Number.isInteger(retentionDays)&&retentionDays>=1&&retentionDays<=365;
  return <section className="settings-view"><div className="settings-block"><h2>Reading flow</h2><p>Articles move to Archive when you leave the reader or mark them read.</p><label htmlFor="retention-days">Permanently delete unprotected articles after</label><div className="inline-setting"><input id="retention-days" type="number" min="1" max="365" value={retentionDays} onChange={e=>setRetentionDays(Number(e.target.value))}/><span>days</span><button disabled={!validRetention} onClick={()=>onRetention(retentionDays)}>Save</button></div>{!validRetention&&<p className="field-error">Choose a whole number from 1 to 365.</p>}<p className="retention-note">Starred articles, notes, highlights, and feeds marked Keep forever are protected.</p></div><div className="settings-block"><h2>Subscriptions</h2><p>Export your feeds and categories for use in another reader.</p><button className="text-button" onClick={onExport}>Export subscriptions as OPML</button></div></section>
}
