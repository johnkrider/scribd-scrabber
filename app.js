const $ = s => document.querySelector(s);
const fileInput=$("#fileInput"), dropZone=$("#dropZone"), fileInfo=$("#fileInfo");
const fileName=$("#fileName"), pageCount=$("#pageCount"), preview=$("#preview");
const previewCount=$("#previewCount"), startBtn=$("#startBtn");
const progressBar=$("#progressBar"), progressText=$("#progressText"), statusEl=$("#status");

let selectedFile=null, sourceText="", pageDefinitions=[];
let previewFrame=null, previewNodes=[];
let currentPage=0, zoom=1;
let thumbStart=0;

const PAGE_RE=/docManager\.addPage\(\{.*?pageNum:\s*(\d+).*?origWidth:\s*([\d.]+).*?origHeight:\s*([\d.]+).*?contentUrl:\s*"([^"]+)"/gs;

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function setProgress(v,text){progressBar.style.width=Math.max(0,Math.min(100,v))+"%";progressText.textContent=Math.round(v)+"%";if(text)statusEl.textContent=text;}

function parsePages(text){
  const pages=[],seen=new Set(); PAGE_RE.lastIndex=0; let m;
  while((m=PAGE_RE.exec(text))){
    const number=Number(m[1]); if(seen.has(number))continue; seen.add(number);
    pages.push({number,width:Number(m[2]),height:Number(m[3]),url:m[4]});
  }
  return pages.sort((a,b)=>a.number-b.number);
}

function makeViewerFrame(){
  const f=document.createElement("iframe");
  f.setAttribute("aria-hidden","true");
  f.style.cssText="position:fixed;left:-100000px;top:0;width:1600px;height:1200px;border:0;visibility:hidden";
  document.body.appendChild(f); return f;
}

async function loadFrame(frame){
  frame.srcdoc=sourceText;
  await new Promise(resolve=>{
    let done=false; const finish=()=>{if(!done){done=true;resolve();}};
    frame.addEventListener("load",finish,{once:true}); setTimeout(finish,15000);
  });
  const doc=frame.contentDocument; if(!doc)throw new Error("The browser could not access the viewer document.");
  injectCleanStyle(doc); await sleep(3500); return doc;
}

function injectCleanStyle(doc){
  const s=doc.createElement("style");
  s.textContent=`html,body{margin:0!important;padding:0!important;background:#fff!important;overflow:visible!important}
  header,nav,footer,[class*="cookie"],[id*="cookie"],[class*="consent"],[id*="consent"],
  [class*="toolbar"],[class*="sidebar"],[class*="topbar"],[class*="bottom-bar"],
  [class*="modal"],[class*="overlay"],[class*="popup"]{display:none!important}`;
  (doc.head||doc.documentElement).appendChild(s);
}

async function loadFile(file){
  if(!file)return;
  const lower=file.name.toLowerCase();
  if(!lower.endsWith(".html")&&!lower.endsWith(".htm")){alert("Please choose an HTML file.");return;}
  selectedFile=file;
  const reader=new FileReader();
  reader.onload=async()=>{
    sourceText=reader.result; pageDefinitions=parsePages(sourceText);
    fileName.textContent=file.name; pageCount.textContent=`${pageDefinitions.length} document pages detected`;
    fileInfo.classList.remove("hidden"); previewCount.textContent=`${pageDefinitions.length} pages`;
    startBtn.disabled=!pageDefinitions.length;
    if(!pageDefinitions.length){statusEl.textContent="No compatible Scribd page definitions were found.";preview.innerHTML='<div class="empty-preview">This HTML does not match the supported viewer structure.</div>';return;}
    setProgress(0,`Detected ${pageDefinitions.length} pages. Rendering preview…`);
    await buildRealPreview();
  };
  reader.readAsText(file);
}

async function buildRealPreview(){
  preview.innerHTML=""; if(previewFrame)previewFrame.remove();
  previewFrame=makeViewerFrame();
  try{
    const doc=await loadFrame(previewFrame);
    previewNodes=Array.from(doc.querySelectorAll('[id^="outer_page_"]'));
    if(!previewNodes.length)throw new Error("The viewer did not render any pages.");
    const count=Math.min(8,previewNodes.length);
    for(let i=0;i<count;i++){
      const item=document.createElement("button"); item.className="preview-item"; item.type="button";
      const thumb=document.createElement("div"); thumb.className="thumb";
      const node=previewNodes[i]; node.scrollIntoView({block:"center"}); await sleep(300);
      const c=await renderNode(node,0.55);
      thumb.appendChild(c);
      const cap=document.createElement("small"); cap.textContent=`Page ${i+1}`;
      item.append(thumb,cap); item.addEventListener("click",()=>openViewer(i)); preview.appendChild(item);
      setProgress(2+(i+1)/count*8,`Previewing page ${i+1} of ${count}…`);
    }
    if(previewNodes.length>8){const more=document.createElement("div");more.className="empty-preview";more.textContent=`+ ${previewNodes.length-8} more pages — open a page to use arrows`;preview.appendChild(more);}
    setProgress(10,`Ready — ${previewNodes.length} pages detected.`);
  }catch(e){
    console.error(e);preview.innerHTML='<div class="empty-preview">The page preview could not be rendered. You can still try Generate PDF.</div>';setProgress(0,"Preview unavailable — export can still be attempted.");
  }
}

async function renderNode(node,scale){
  if(!window.html2canvas)throw new Error("html2canvas did not load. Check your internet connection.");
  node.scrollIntoView({block:"center"}); await sleep(100);
  return await html2canvas(node,{scale,backgroundColor:"#fff",useCORS:true,allowTaint:false,logging:false,imageTimeout:20000});
}

async function showViewerPage(index){
  if(!previewNodes.length)return;
  currentPage=Math.max(0,Math.min(previewNodes.length-1,index));
  const holder=$("#viewerPage"); holder.innerHTML='<div class="viewer-loading">Rendering page…</div>';
  $("#viewerTitle").textContent=`Page ${currentPage+1} of ${previewNodes.length}`;
  try{
    const c=await renderNode(previewNodes[currentPage],Math.max(0.8,Math.min(1.5,zoom)));
    c.style.width=`${c.width*zoom}px`; c.style.height=`${c.height*zoom}px`;
    holder.innerHTML=""; holder.appendChild(c); updateThumbs();
  }catch(e){holder.innerHTML='<div class="viewer-loading">Could not render this page.</div>';console.error(e);}
}

function openViewer(index){
  if(!previewNodes.length)return;
  $("#viewerModal").classList.add("open");$("#viewerModal").setAttribute("aria-hidden","false");
  document.body.style.overflow="hidden"; zoom=1; $("#zoomText").textContent="100%"; showViewerPage(index);
}
function closeViewer(){
  $("#viewerModal").classList.remove("open");$("#viewerModal").setAttribute("aria-hidden","true");document.body.style.overflow="";
}
function changePage(delta){showViewerPage(currentPage+delta);}

function updateThumbs(){
  const strip=$("#thumbStrip"); strip.innerHTML="";
  // Keep a compact 8-thumbnail window around the current page.
  thumbStart=Math.max(0,Math.min(Math.max(0,previewNodes.length-8),currentPage-3));
  const end=Math.min(previewNodes.length,thumbStart+8);
  for(let i=thumbStart;i<end;i++){
    const b=document.createElement("button");b.type="button";b.className="viewer-thumb"+(i===currentPage?" active":"");
    const c=document.createElement("canvas");c.width=60;c.height=78;
    const ctx=c.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,60,78);ctx.fillStyle="#777";ctx.font="bold 11px sans-serif";ctx.textAlign="center";ctx.fillText(`PAGE ${i+1}`,30,40);
    b.appendChild(c);const s=document.createElement("span");s.textContent=i+1;b.appendChild(s);b.addEventListener("click",()=>showViewerPage(i));strip.appendChild(b);
  }
}

/* ---------------- Streaming PDF writer ---------------- */
const enc=new TextEncoder();
function ascii(s){return enc.encode(s)}
class StreamPDF{
  constructor(writable,total){this.writable=writable;this.offset=0;this.offsets=[];this.total=total;}
  async write(bytes){await this.writable.write(bytes);this.offset+=bytes.length;}
  async object(id,parts){this.offsets[id]=this.offset;await this.write(ascii(`${id} 0 obj\n`));for(const p of parts)await this.write(typeof p==="string"?ascii(p):p);await this.write(ascii("\nendobj\n"));}
  pageObj(i){return 3+i*3} contentObj(i){return 4+i*3} imageObj(i){return 5+i*3}
  async start(){
    await this.write(new Uint8Array([37,80,68,70,45,49,46,52,10,37,226,227,207,211,10]));
    const kids=Array.from({length:this.total},(_,i)=>`${this.pageObj(i)} 0 R`).join(" ");
    await this.object(1,[`<< /Type /Catalog /Pages 2 0 R >>`]);
    await this.object(2,[`<< /Type /Pages /Count ${this.total} /Kids [ ${kids} ] >>`]);
  }
  async addPage(i,width,height,jpegBytes,jpegW,jpegH){
    const po=this.pageObj(i),co=this.contentObj(i),io=this.imageObj(i);
    const content=`q\n${width} 0 0 ${height} 0 0 cm\n/Im1 Do\nQ\n`;
    await this.object(po,[`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im1 ${io} 0 R >> >> /Contents ${co} 0 R >>`]);
    await this.object(co,[`<< /Length ${ascii(content).length} >>\nstream\n`,content,"endstream"]);
    await this.object(io,[`<< /Type /XObject /Subtype /Image /Width ${jpegW} /Height ${jpegH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,jpegBytes,"\nendstream"]);
  }
  async finish(){
    const xref=this.offset,size=3+this.total*3;
    await this.write(ascii(`xref\n0 ${size}\n0000000000 65535 f \n`));
    for(let i=1;i<size;i++)await this.write(ascii(String(this.offsets[i]).padStart(10,"0")+" 00000 n \n"));
    await this.write(ascii(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    await this.writable.close();
  }
}
async function canvasJPEG(canvas,quality=.97){
  const blob=await new Promise(r=>canvas.toBlob(r,"image/jpeg",quality));
  if(!blob)throw new Error("Could not encode page image."); return new Uint8Array(await blob.arrayBuffer());
}
async function getWritable(defaultName){
  if(!window.showSaveFilePicker)throw new Error("This GitHub Pages build needs a modern Chrome or Edge browser with file saving enabled.");
  const fileHandle=await window.showSaveFilePicker({suggestedName:defaultName,types:[{description:"PDF document",accept:{"application/pdf":[".pdf"]}}]});
  // FIX for v3: showSaveFilePicker returns a FileSystemFileHandle. The writable stream is created from it.
  return await fileHandle.createWritable();
}

async function renderAllPages(){
  if(!selectedFile||!pageDefinitions.length)return;
  startBtn.disabled=true; const frame=makeViewerFrame(); let writable=null;
  try{
    if(!window.html2canvas)throw new Error("html2canvas did not load. Check your internet connection.");
    const base=selectedFile.name.replace(/\.(html?|HTML?)$/,"");
    writable=await getWritable(`${base}.pdf`);
    const pdf=new StreamPDF(writable,pageDefinitions.length);
    await pdf.start(); setProgress(10,"Opening the document viewer…");
    const doc=await loadFrame(frame);
    const nodes=Array.from(doc.querySelectorAll('[id^="outer_page_"]'));
    if(!nodes.length)throw new Error("No document pages were rendered.");
    const quality=Number($("#quality").value),delay=Number($("#delay").value);
    for(let i=0;i<nodes.length;i++){
      const node=nodes[i]; node.scrollIntoView({block:"center"}); await sleep(delay);
      const rect=node.getBoundingClientRect(); if(rect.width<2||rect.height<2)throw new Error(`Page ${i+1} has no visible document area.`);
      const c=await renderNode(node,quality); const bytes=await canvasJPEG(c,.97); const def=pageDefinitions[i]||{width:rect.width,height:rect.height};
      await pdf.addPage(i,def.width,def.height,bytes,c.width,c.height);
      c.width=1;c.height=1;
      setProgress(10+((i+1)/nodes.length)*87,`Writing page ${i+1} of ${nodes.length}…`);
      if(i%2===0)await sleep(10);
    }
    setProgress(98,"Finishing PDF index…"); await pdf.finish(); writable=null; setProgress(100,`Done — ${nodes.length} pages saved.`);
    alert("PDF created successfully.");
  }catch(e){
    console.error(e);setProgress(0,e.name==="AbortError"?"Export cancelled.":"Export failed.");
    if(writable){try{await writable.abort();}catch(_){} }
    if(e.name!=="AbortError")alert("Export failed.\n\n"+e.message);
  }finally{frame.remove();startBtn.disabled=false;}
}

fileInput.addEventListener("change",e=>loadFile(e.target.files[0]));
["dragenter","dragover"].forEach(t=>dropZone.addEventListener(t,e=>{e.preventDefault();dropZone.classList.add("drag")}));
["dragleave","drop"].forEach(t=>dropZone.addEventListener(t,e=>{e.preventDefault();dropZone.classList.remove("drag")}));
dropZone.addEventListener("drop",e=>loadFile(e.dataTransfer.files[0]));
dropZone.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" ")fileInput.click()});

$("#removeFile").addEventListener("click",()=>{selectedFile=null;sourceText="";pageDefinitions=[];previewNodes=[];if(previewFrame)previewFrame.remove();previewFrame=null;fileInput.value="";fileInfo.classList.add("hidden");startBtn.disabled=true;previewCount.textContent="0 pages";preview.innerHTML='<div class="empty-preview">Choose a file to preview its actual document pages.</div>';setProgress(0,"Waiting for an HTML file")});
startBtn.addEventListener("click",renderAllPages);
$("#themeBtn").addEventListener("click",()=>{document.documentElement.classList.toggle("light");$("#themeBtn").textContent=document.documentElement.classList.contains("light")?"☀":"☾"});

$("#closeViewer").addEventListener("click",closeViewer);
$("#prevPage").addEventListener("click",()=>changePage(-1));
$("#nextPage").addEventListener("click",()=>changePage(1));
$("#thumbPrev").addEventListener("click",()=>changePage(-8));
$("#thumbNext").addEventListener("click",()=>changePage(8));
$("#zoomIn").addEventListener("click",()=>{zoom=Math.min(2.5,zoom+.1);$("#zoomText").textContent=Math.round(zoom*100)+"%";showViewerPage(currentPage)});
$("#zoomOut").addEventListener("click",()=>{zoom=Math.max(.5,zoom-.1);$("#zoomText").textContent=Math.round(zoom*100)+"%";showViewerPage(currentPage)});
$("#fitBtn").addEventListener("click",()=>{zoom=1;$("#zoomText").textContent="100%";showViewerPage(currentPage)});
$("#viewerModal").addEventListener("click",e=>{if(e.target.id==="viewerModal")closeViewer()});
document.addEventListener("keydown",e=>{if(!$("#viewerModal").classList.contains("open"))return;if(e.key==="Escape")closeViewer();if(e.key==="ArrowLeft")changePage(-1);if(e.key==="ArrowRight")changePage(1)});
