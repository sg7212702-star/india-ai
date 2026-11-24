import { parseDraftImport, mergeImportedDrafts } from "./draft-import.js";
import { createLocalPhotoStore, validateLocalReferencePhoto } from "./local-photo-store.js";
(function(){
      const $ = (id) => document.getElementById(id);
      const STORE_KEY = "ai-animation-studio-drafts-v1";
      let mode = "prompt";
      let style = "3D Realistic";
      const photoStore = createLocalPhotoStore();
      let photoBlob = null;
      let photoLabel = "";
      let hasSavedPhoto = false;
      let photoRemoved = false;
      let photoPreviewUrl = "";
      let currentDraftId = null;
      function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");window.clearTimeout(toast.timer);toast.timer=window.setTimeout(()=>el.classList.remove("show"),2600);}
      function readDrafts(){try{return JSON.parse(localStorage.getItem(STORE_KEY)||"[]");}catch(_){return [];}}
      function writeDrafts(items){localStorage.setItem(STORE_KEY,JSON.stringify(items));}
      function escapeHtml(value){return String(value).replace(/[&<>"']/g,(ch)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));}
      function clearPhotoPreview(){if(photoPreviewUrl)URL.revokeObjectURL(photoPreviewUrl);photoPreviewUrl="";$("previewImage").removeAttribute("src");$("photoPreview").classList.remove("show");}
      function showPhoto(blob,name){clearPhotoPreview();photoPreviewUrl=URL.createObjectURL(blob);$("previewImage").src=photoPreviewUrl;$("photoName").textContent=name;$("photoPreview").classList.add("show");}
      function setMode(next){mode=next;document.querySelectorAll("#inputModes button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.mode===mode)));$("promptField").hidden=mode==="story";$("storyField").hidden=mode==="prompt";$("uploadField").hidden=mode!=="photo-story";}
      function setStyle(next){style=next;document.querySelectorAll("#styles button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.style===style)));}
      function getPayload(){
        return {id:currentDraftId||("draft-"+Date.now()),name:$("projectName").value.trim()||"Untitled animation project",mode,style,format:$("ratio").value,durationSeconds:Number($("duration").value),prompt:$("prompt").value.trim(),story:$("story").value.trim(),referencePhotoName:photoLabel,voice:$("voice").value,music:$("music").value,lipSync:$("lipSync").checked,characterContinuity:$("continuity").checked,updatedAt:new Date().toISOString()};
      }
      function validate(payload){
        if(mode==="prompt"&&!payload.prompt)return "Add a video prompt first.";
        if(mode==="story"&&!payload.story)return "Paste your story first.";
        if(mode==="photo-story"&&!payload.story)return "Add the story for your photo project.";
        if(mode==="photo-story"&&!photoBlob&&!hasSavedPhoto)return "Choose a reference photo or re-select the photo for this imported project.";
        return "";
      }
      function downloadJson(data,filename){const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.style.display="none";document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
      function renderDrafts(){
        const list=$("draftList"),items=readDrafts().sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
        if(!items.length){list.innerHTML='<div class="draft-empty">No saved briefs yet. Create one on the left.</div>';return;}
        list.innerHTML=items.map(item=>'<div class="draft-item"><div class="draft-symbol">✦</div><div class="draft-info"><b>'+escapeHtml(item.name)+'</b><small>'+escapeHtml(item.style)+' · '+escapeHtml(item.format)+' · '+Math.round(item.durationSeconds/60*10)/10+' min</small></div><button type="button" data-load="'+escapeHtml(item.id)+'">Open</button><button type="button" data-delete="'+escapeHtml(item.id)+'" aria-label="Delete '+escapeHtml(item.name)+'">×</button></div>').join("");
      }
      async function loadDraft(id){
        const item=readDrafts().find(d=>d.id===id);if(!item)return;
        currentDraftId=item.id;setMode(item.mode||"prompt");setStyle(item.style||"3D Realistic");
        $("projectName").value=item.name||"";$("prompt").value=item.prompt||"";$("story").value=item.story||"";
        $("ratio").value=item.format||"9:16";$("duration").value=String(item.durationSeconds||30);
        $("voice").value=item.voice||"Deep, warm Hindi storyteller";$("music").value=item.music||"Cinematic background score";
        $("lipSync").checked=item.lipSync!==false;$("continuity").checked=item.characterContinuity!==false;
        photoBlob=null;hasSavedPhoto=false;photoRemoved=false;photoLabel=item.referencePhotoName||"";
        $("photo").value="";clearPhotoPreview();
        if(item.mode==="photo-story"||item.referencePhotoName){
          try{
            const record=await photoStore.get(item.id);
            if(currentDraftId!==item.id)return;
            if(record){photoBlob=record.blob;photoLabel=record.name||photoLabel;hasSavedPhoto=true;showPhoto(record.blob,photoLabel);toast("Project and reference photo restored from this browser.");}
            else if(item.mode==="photo-story"){toast("Photo not found in this browser. Re-select it before saving this photo-story project.");}
          }catch(error){if(currentDraftId===item.id)toast(error.message||"Could not restore the local reference photo.");}
        }else{toast("Project opened.");}
        window.scrollTo({top:0,behavior:"smooth"});
      }
      async function saveDraft(event){
        event.preventDefault();const payload=getPayload();const error=validate(payload);if(error){toast(error);return;}
        const saveButton=$("projectForm").querySelector('button[type="submit"]');saveButton.disabled=true;
        try{
          if(payload.mode==="photo-story"&&photoBlob){await photoStore.save(payload.id,photoBlob,photoLabel);hasSavedPhoto=true;photoRemoved=false;}
          else if(photoRemoved){await photoStore.remove(payload.id);hasSavedPhoto=false;photoRemoved=false;}
          const items=readDrafts();const index=items.findIndex(d=>d.id===payload.id);
          if(index>=0)items[index]=payload;else items.unshift(payload);
          writeDrafts(items.slice(0,20));currentDraftId=payload.id;renderDrafts();
          toast(payload.mode==="photo-story"?"Project and reference photo saved in this browser.":"Project brief saved on this device.");
        }catch(error){toast(error.message||"Could not save the project on this device.");}
        finally{saveButton.disabled=false;}
      }
      async function importDraftFile(file){
        if(!file)return;
        if(file.size>1024*1024){toast("Import file must be 1 MB or smaller.");return;}
        try{
          const parsed=parseDraftImport(await file.text());
          const existing=readDrafts();
          const merged=mergeImportedDrafts(existing,parsed.drafts);
          writeDrafts(merged.drafts);
          renderDrafts();
          const stored=merged.importedCount;
          const clipped=merged.skippedCount;
          const photoNote=parsed.photoReferenceCount?" Photo-story projects need their reference photos re-selected.":"";
          toast(`Imported ${stored} project${stored===1?"":"s"}.${clipped?" "+clipped+" not added (20-draft limit).":""}${photoNote}`);
        }catch(error){toast(error.message||"Could not import project file.");}
        finally{$("draftImportFile").value="";}
      }
      function selectFile(file){
        if(!file)return;
        const validation=validateLocalReferencePhoto(file);
        if(!validation.ok){toast(validation.error);return;}
        photoBlob=file;photoLabel=file.name;hasSavedPhoto=true;photoRemoved=false;showPhoto(file,file.name);
      }
      document.querySelectorAll("#inputModes button").forEach(button=>button.addEventListener("click",()=>setMode(button.dataset.mode)));
      document.querySelectorAll("#styles button").forEach(button=>button.addEventListener("click",()=>setStyle(button.dataset.style)));
      $("projectForm").addEventListener("submit",saveDraft);
      $("choosePhoto").addEventListener("click",()=>$("photo").click());
      $("photo").addEventListener("change",event=>selectFile(event.target.files[0]));
      $("dropZone").addEventListener("dragover",event=>{event.preventDefault();$("dropZone").classList.add("dragging");});
      $("dropZone").addEventListener("dragleave",()=>$("dropZone").style.borderColor="");
      $("dropZone").addEventListener("drop",event=>{event.preventDefault();$("dropZone").classList.remove("dragging");selectFile(event.dataTransfer.files[0]);});
      $("removePhoto").addEventListener("click",()=>{photoBlob=null;photoLabel="";hasSavedPhoto=false;photoRemoved=true;$("photo").value="";clearPhotoPreview();});
      $("downloadCurrent").addEventListener("click",()=>{const payload=getPayload();const error=validate(payload);if(error){toast(error);return;}downloadJson(payload,"animation-project-brief.json");toast("Project brief downloaded.");});
      $("downloadAll").addEventListener("click",()=>{const items=readDrafts();if(!items.length){toast("There are no saved briefs to export.");return;}downloadJson(items,"animation-studio-drafts.json");});
      $("importDrafts").addEventListener("click",()=>$("draftImportFile").click());
      $("draftImportFile").addEventListener("change",event=>importDraftFile(event.target.files[0]));
      $("draftList").addEventListener("click",async event=>{const load=event.target.closest("[data-load]"),del=event.target.closest("[data-delete]");if(load)loadDraft(load.dataset.load);if(del){const id=del.dataset.delete;const item=readDrafts().find(d=>d.id===id);writeDrafts(readDrafts().filter(d=>d.id!==id));if(currentDraftId===id){currentDraftId=null;photoBlob=null;photoLabel="";hasSavedPhoto=false;photoRemoved=false;clearPhotoPreview();}renderDrafts();if(item?.referencePhotoName){try{await photoStore.remove(id);toast("Project and its local photo were deleted.");}catch(_){toast("Project deleted. The browser could not confirm local photo cleanup.");}}else{toast("Project deleted from this device.");}}});
      setMode("prompt");setStyle("3D Realistic");renderDrafts();
    })();
