(function(){
      const $ = (id) => document.getElementById(id);
      const STORE_KEY = "ai-animation-studio-drafts-v1";
      let mode = "prompt";
      let style = "3D Realistic";
      let photoData = "";
      let photoLabel = "";
      let currentDraftId = null;
      function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");window.clearTimeout(toast.timer);toast.timer=window.setTimeout(()=>el.classList.remove("show"),2600);}
      function readDrafts(){try{return JSON.parse(localStorage.getItem(STORE_KEY)||"[]");}catch(_){return [];}}
      function writeDrafts(items){localStorage.setItem(STORE_KEY,JSON.stringify(items));}
      function escapeHtml(value){return String(value).replace(/[&<>"']/g,(ch)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));}
      function setMode(next){mode=next;document.querySelectorAll("#inputModes button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.mode===mode)));$("promptField").hidden=mode==="story";$("storyField").hidden=mode==="prompt";$("uploadField").hidden=mode!=="photo-story";}
      function setStyle(next){style=next;document.querySelectorAll("#styles button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.style===style)));}
      function getPayload(){
        return {id:currentDraftId||("draft-"+Date.now()),name:$("projectName").value.trim()||"Untitled animation project",mode,style,format:$("ratio").value,durationSeconds:Number($("duration").value),prompt:$("prompt").value.trim(),story:$("story").value.trim(),referencePhotoName:photoLabel,voice:$("voice").value,music:$("music").value,lipSync:$("lipSync").checked,characterContinuity:$("continuity").checked,updatedAt:new Date().toISOString()};
      }
      function validate(payload){
        if(mode==="prompt"&&!payload.prompt)return "Add a video prompt first.";
        if(mode==="story"&&!payload.story)return "Paste your story first.";
        if(mode==="photo-story"&&!payload.story)return "Add the story for your photo project.";
        if(mode==="photo-story"&&!photoData)return "Choose a reference photo for this project.";
        return "";
      }
      function downloadJson(data,filename){const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);}
      function renderDrafts(){
        const list=$("draftList"),items=readDrafts().sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
        if(!items.length){list.innerHTML='<div class="draft-empty">No saved briefs yet. Create one on the left.</div>';return;}
        list.innerHTML=items.map(item=>'<div class="draft-item"><div class="draft-symbol">✦</div><div class="draft-info"><b>'+escapeHtml(item.name)+'</b><small>'+escapeHtml(item.style)+' · '+escapeHtml(item.format)+' · '+Math.round(item.durationSeconds/60*10)/10+' min</small></div><button type="button" data-load="'+escapeHtml(item.id)+'">Open</button><button type="button" data-delete="'+escapeHtml(item.id)+'" aria-label="Delete '+escapeHtml(item.name)+'">×</button></div>').join("");
      }
      function loadDraft(id){
        const item=readDrafts().find(d=>d.id===id);if(!item)return;
        currentDraftId=item.id;setMode(item.mode||"prompt");setStyle(item.style||"3D Realistic");
        $("projectName").value=item.name||"";$("prompt").value=item.prompt||"";$("story").value=item.story||"";
        $("ratio").value=item.format||"9:16";$("duration").value=String(item.durationSeconds||30);
        $("voice").value=item.voice||"Deep, warm Hindi storyteller";$("music").value=item.music||"Cinematic background score";
        $("lipSync").checked=item.lipSync!==false;$("continuity").checked=item.characterContinuity!==false;
        photoData="";photoLabel=item.referencePhotoName||"";
        $("photoPreview").classList.remove("show");$("photo").value="";
        toast("Draft opened. Re-select its reference photo if needed.");
        window.scrollTo({top:0,behavior:"smooth"});
      }
      function saveDraft(event){
        event.preventDefault();const payload=getPayload();const error=validate(payload);if(error){toast(error);return;}
        const items=readDrafts();const index=items.findIndex(d=>d.id===payload.id);
        if(index>=0)items[index]=payload;else items.unshift(payload);
        try{writeDrafts(items.slice(0,20));currentDraftId=payload.id;renderDrafts();toast("Project brief saved on this device.");}
        catch(_){toast("Could not save: this browser may be out of local storage.");}
      }
      function selectFile(file){
        if(!file)return;
        if(!["image/jpeg","image/png","image/webp"].includes(file.type)){toast("Please choose a JPG, PNG or WebP image.");return;}
        if(file.size>8*1024*1024){toast("Image must be 8 MB or smaller.");return;}
        const reader=new FileReader();reader.onload=()=>{photoData=String(reader.result||"");photoLabel=file.name;$("previewImage").src=photoData;$("photoName").textContent=file.name;$("photoPreview").classList.add("show");};reader.readAsDataURL(file);
      }
      document.querySelectorAll("#inputModes button").forEach(button=>button.addEventListener("click",()=>setMode(button.dataset.mode)));
      document.querySelectorAll("#styles button").forEach(button=>button.addEventListener("click",()=>setStyle(button.dataset.style)));
      $("projectForm").addEventListener("submit",saveDraft);
      $("choosePhoto").addEventListener("click",()=>$("photo").click());
      $("photo").addEventListener("change",event=>selectFile(event.target.files[0]));
      $("dropZone").addEventListener("dragover",event=>{event.preventDefault();$("dropZone").classList.add("dragging");});
      $("dropZone").addEventListener("dragleave",()=>$("dropZone").style.borderColor="");
      $("dropZone").addEventListener("drop",event=>{event.preventDefault();$("dropZone").classList.remove("dragging");selectFile(event.dataTransfer.files[0]);});
      $("removePhoto").addEventListener("click",()=>{photoData="";photoLabel="";$("photo").value="";$("photoPreview").classList.remove("show");});
      $("downloadCurrent").addEventListener("click",()=>{const payload=getPayload();const error=validate(payload);if(error){toast(error);return;}downloadJson(payload,"animation-project-brief.json");toast("Project brief downloaded.");});
      $("downloadAll").addEventListener("click",()=>{const items=readDrafts();if(!items.length){toast("There are no saved briefs to export.");return;}downloadJson(items,"animation-studio-drafts.json");});
      $("draftList").addEventListener("click",event=>{const load=event.target.closest("[data-load]"),del=event.target.closest("[data-delete]");if(load)loadDraft(load.dataset.load);if(del){writeDrafts(readDrafts().filter(d=>d.id!==del.dataset.delete));renderDrafts();toast("Draft deleted from this device.");}});
      setMode("prompt");setStyle("3D Realistic");renderDrafts();
    })();
