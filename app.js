const $ = s => document.querySelector(s);
const fileInput=$("#fileInput"), dropZone=$("#dropZone"), fileInfo=$("#fileInfo");
const fileName=$("#fileName"), pageCount=$("#pageCount"), preview=$("#preview");
const previewCount=$("#previewCount"), startBtn=$("#startBtn");
const progressBar=$("#progressBar"), progressText=$("#progressText"), statusEl=$("#status");

let selectedFile=null, sourceText="", pageDefinitions=[];

const PAGE_RE=/docManager\.addPage\(\{.*?pageNum:\s*(\d+).*?origWidth:\s*([\d.]+).*?origHeight:\s*([\d.]+).*?contentUrl:\s*"([^"]+)"/gs;

function setProgress(v,text){v=Math.max(0,Math.min(100,v));progressBar.style.width=v+"%";progressText.textContent=Math.round(v)+"%";if(text)statusEl.textContent=text}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

function parsePages(text){
  const out=[],seen=new Set();PAGE_RE.lastIndex=0;let m;
  while((m=PAGE_RE.exec(text))){
    const n=Number(m[1]);if(seen.has(n))continue;seen.add(n);
    out.push({number:n,width:Number(m[2]),height:Number(m[3]),url:m[4]});
  }
  return out.sort((a,b)=>a.number-b.number);
}

function loadFile(file){
  if(!file)return;
  const n=file.name.toLowerCase();
  if(!n.endsWith(".html")&&!n.endsWith(".htm")){alert("Please choose an HTML file.");return}
  selectedFile=file;
  const reader=new FileReader();
  reader.onload=async()=>{
    sourceText=reader.result;pageDefinitions=parsePages(sourceText);
    fileName.textContent=file.name;pageCount.textContent=`${pageDefinitions.length} document pages detected`;
    fileInfo.classList.remove("hidden");previewCount.textContent=`${pageDefinitions.length} pages`;
    startBtn.disabled=!pageDefinitions.length;
    if(!pageDefinitions.length){statusEl.textContent="No compatible Scribd page definitions were found.";preview.innerHTML='<div class="empty-preview">This HTML does not match the supported viewer structure.</div>';return}
    setProgress(0,`Detected ${pageDefinitions.length} pages. Rendering preview…`);
    await buildRealPreview();
  };
  reader.readAsText(file);
}

async function buildRealPreview(){
  preview.innerHTML="";
  const frame=document.createElement("iframe");
  frame.style.cssText="position:fixed;left:-100000px;top:0;width:1600px;height:1200px;border:0;visibility:hidden";
  document.body.appendChild(frame);
  try{
    frame.srcdoc=sourceText;
    await new Promise(resolve=>{
      let done=false;const finish=()=>{if(!done){done=true;resolve()}};
      frame.addEventListener("load",finish,{once:true});setTimeout(finish,15000);
    });
    const doc=frame.contentDocument;
    if(!doc)throw new Error("The browser could not access the viewer document.");
    injectCleanStyle(doc);
    await sleep(3500);
    const nodes=Array.from(doc.querySelectorAll('[id^="outer_page_"]'));
    if(!nodes.length)throw new Error("The viewer did not render any pages.");

    const sample=nodes.slice(0,8);
    for(let i=0;i<sample.length;i++){
      const item=document.createElement("div");item.className="preview-item";
      const thumb=document.createElement("div");thumb.className="thumb";
      const node=sample[i];node.scrollIntoView({block:"center"});await sleep(400);
      const c=await html2canvas(node,{scale:0.65,backgroundColor:"#fff",useCORS:true,allowTaint:false,logging:false,imageTimeout:15000});
      thumb.appendChild(c);
      const cap=document.createElement("small");cap.textContent=`Page ${i+1}`;
      item.append(thumb,cap);preview.appendChild(item);
      setProgress(2+(i+1)/sample.length*8,`Previewing page ${i+1} of ${sample.length}…`);
    }
    if(nodes.length>8){const more=document.createElement("div");more.className="empty-preview";more.textContent=`+ ${nodes.length-8} more pages`;preview.appendChild(more)}
    setProgress(10,`Ready — ${nodes.length} pages detected.`);
  }catch(e){
    console.error(e);preview.innerHTML='<div class="empty-preview">The page preview could not be rendered. You can still try Generate PDF.</div>';
    setProgress(0,"Preview unavailable — export can still be attempted.");
  }finally{frame.remove()}
}

function injectCleanStyle(doc){
  const s=doc.createElement("style");
  s.textContent=`html,body{margin:0!important;padding:0!important;background:#fff!important;overflow:visible!important}
  header,nav,footer,[class*="cookie"],[id*="cookie"],[class*="consent"],[id*="consent"],
  [class*="toolbar"],[class*="sidebar"],[class*="topbar"],[class*="bottom-bar"],
  [class*="modal"],[class*="overlay"],[class*="popup"]{display:none!important}`;
  (doc.head||doc.documentElement).appendChild(s);
}

/* ---------------- Streaming PDF writer ----------------
   PDF objects:
   1 = Catalog
   2 = Pages
   each page i:
   page object = 3 + i*3
   content object = page + 1
   image object = page + 2
--------------------------------------------------------- */

const enc=new TextEncoder();
function ascii(s){return enc.encode(s)}
function concatBytes(...arrays){
  let n=0;for(const a of arrays)n+=a.length;
  const out=new Uint8Array(n);let p=0;for(const a of arrays){out.set(a,p);p+=a.length}return out;
}

class StreamPDF{
  constructor(handle,total){this.handle=handle;this.offset=0;this.offsets=[];this.total=total}
  async write(bytes){await this.handle.write(bytes);this.offset+=bytes.length}
  async object(id,parts){this.offsets[id]=this.offset;await this.write(ascii(`${id} 0 obj\n`));for(const p of parts)await this.write(typeof p==="string"?ascii(p):p);await this.write(ascii("\nendobj\n"))}
  pageObj(i){return 3+i*3}
  contentObj(i){return 4+i*3}
  imageObj(i){return 5+i*3}
  async start(){
    await this.write(new Uint8Array([37,80,68,70,45,49,46,52,10,37,226,227,207,211,10]));
    const kids=Array.from({length:this.total},(_,i)=>`${this.pageObj(i)} 0 R`).join(" ");
    await this.object(1,[`<< /Type /Catalog /Pages 2 0 R >>`]);
    // Pages object is written at the end because the kids are known already;
    // a forward reference would also work, but writing it now keeps the tree clear.
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
    const xref=this.offset;const size=3+this.total*3;
    await this.write(ascii(`xref\n0 ${size}\n0000000000 65535 f \n`));
    for(let i=1;i<size;i++)await this.write(ascii(String(this.offsets[i]).padStart(10,"0")+" 00000 n \n"));
    await this.write(ascii(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    await this.handle.close();
  }
}

async function canvasJPEG(canvas,quality=0.96){
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",quality));
  if(!blob)throw new Error("Could not encode page image.");
  return new Uint8Array(await blob.arrayBuffer());
}

async function getSaveHandle(defaultName){
  if(!window.showSaveFilePicker)throw new Error("Your browser does not support direct large-file saving. Please use Microsoft Edge or Google Chrome.");
  return await window.showSaveFilePicker({
    suggestedName:defaultName,
    types:[{description:"PDF document",accept:{"application/pdf":[".pdf"]}}]
  });
}

async function renderAllPages(){
  if(!selectedFile||!pageDefinitions.length)return;
  startBtn.disabled=true;
  const frame=document.createElement("iframe");
  frame.style.cssText="position:fixed;left:-100000px;top:0;width:1600px;height:1200px;border:0;visibility:hidden";
  document.body.appendChild(frame);

  try{
    if(!window.html2canvas)throw new Error("html2canvas did not load. Check your internet connection.");
    const base=selectedFile.name.replace(/\.(html?|HTML?)$/,"");
    const handle=await getSaveHandle(`${base}.pdf`);
    const pdf=new StreamPDF(handle,pageDefinitions.length);
    await pdf.start();

    setProgress(10,"Opening the document viewer…");
    frame.srcdoc=sourceText;
    await new Promise(resolve=>{
      let done=false;const finish=()=>{if(!done){done=true;resolve()}};
      frame.addEventListener("load",finish,{once:true});setTimeout(finish,15000);
    });

    const doc=frame.contentDocument;
    if(!doc)throw new Error("The browser could not access the viewer document.");
    injectCleanStyle(doc);
    await sleep(3500);

    const nodes=Array.from(doc.querySelectorAll('[id^="outer_page_"]'));
    if(!nodes.length)throw new Error("No document pages were rendered.");
    const quality=Number($("#quality").value),delay=Number($("#delay").value);

    for(let i=0;i<nodes.length;i++){
      const node=nodes[i];
      node.scrollIntoView({block:"center"});
      await sleep(delay);

      const rect=node.getBoundingClientRect();
      if(rect.width<2||rect.height<2)throw new Error(`Page ${i+1} has no visible document area.`);

      const c=await html2canvas(node,{
        scale:quality,backgroundColor:"#fff",useCORS:true,allowTaint:false,
        logging:false,imageTimeout:20000
      });

      const bytes=await canvasJPEG(c,0.97);
      const def=pageDefinitions[i]||{width:rect.width,height:rect.height};
      await pdf.addPage(i,def.width,def.height,bytes,c.width,c.height);

      // Release the large canvas immediately.
      c.width=1;c.height=1;

      setProgress(10+((i+1)/nodes.length)*87,`Writing page ${i+1} of ${nodes.length}…`);
      if(i%2===0)await sleep(15);
    }

    setProgress(98,"Finishing PDF index…");
    await pdf.finish();
    setProgress(100,`Done — ${nodes.length} pages saved.`);
    alert("PDF created successfully.");
  }catch(e){
    console.error(e);setProgress(0,"Export failed.");
    if(e.name==="AbortError")return;
    alert("Export failed.\n\n"+e.message);
  }finally{
    frame.remove();startBtn.disabled=false;
  }
}

fileInput.addEventListener("change",e=>loadFile(e.target.files[0]));
["dragenter","dragover"].forEach(t=>dropZone.addEventListener(t,e=>{e.preventDefault();dropZone.classList.add("drag")}));
["dragleave","drop"].forEach(t=>dropZone.addEventListener(t,e=>{e.preventDefault();dropZone.classList.remove("drag")}));
dropZone.addEventListener("drop",e=>loadFile(e.dataTransfer.files[0]));
dropZone.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" ")fileInput.click()});

$("#removeFile").addEventListener("click",()=>{
  selectedFile=null;sourceText="";pageDefinitions=[];fileInput.value="";
  fileInfo.classList.add("hidden");startBtn.disabled=true;previewCount.textContent="0 pages";
  preview.innerHTML='<div class="empty-preview">Choose a file to preview its actual document pages.</div>';
  setProgress(0,"Waiting for an HTML file");
});
startBtn.addEventListener("click",renderAllPages);
$("#themeBtn").addEventListener("click",()=>{
  document.documentElement.classList.toggle("light");
  $("#themeBtn").textContent=document.documentElement.classList.contains("light")?"☀":"☾";
});
