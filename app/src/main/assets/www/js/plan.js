/**
 * Río Pinto Coach · Plan y preparación
 * Arquitectura modular consolidada
 */
import { $, cleanPhaseName, escapeHtml, formatClock, parseDurationSeconds, state, zoneColor } from "./core.js";
import { populatePhaseMusicSelect, togglePreferredMusicFields } from "./music.js";

const customKey = () => `rpc.phases.${state.week.number}.${state.dayName}`;

export function initializePlan(data) {
  state.data = data;
  if (!Array.isArray(state.data?.weeks) || !state.data.weeks.length) {
    throw new Error("El archivo del plan no contiene semanas válidas");
  }

  const savedWeek = Number(localStorage.getItem("rpc.week")) || 1;
  const savedDay = localStorage.getItem("rpc.day") || "Martes";

  $("#weekSelect").innerHTML = state.data.weeks
    .map(week => `<option value="${week.number}">${week.number}${week.recovery ? " · Descarga" : ""}</option>`)
    .join("");

  $("#weekSelect").value = state.data.weeks.some(week => week.number === savedWeek)
    ? savedWeek
    : 1;

  loadDays(savedDay);
}

export function bindPlanEvents() {
  $("#weekSelect").addEventListener("change", () => loadDays("Martes"));
  $("#daySelect").addEventListener("change", render);
  $("#prepareButton").addEventListener("click", openPrepare);
  $("#backButton").addEventListener("click", closePrepare);
  $("#addPhaseButton").addEventListener("click", () => openPhaseEditor());
  $("#resetPhasesButton").addEventListener("click", resetCustomPhases);
  $("#phaseList").addEventListener("click", handlePhaseAction);
  $("#savePhaseButton").addEventListener("click", savePhase);
}

export function currentWeek(){return state.data.weeks.find(w=>w.number===Number($("#weekSelect").value))}

export function loadDays(preferred){const w=currentWeek(),names=Object.keys(w.days);$("#daySelect").innerHTML=names.map(d=>`<option>${d}</option>`).join("");$("#daySelect").value=names.includes(preferred)?preferred:names[0];render()}

export function render(){const w=currentWeek(),day=$("#daySelect").value,d=w.days[day];state.week=w;state.day=d;state.dayName=day;localStorage.setItem("rpc.week",w.number);localStorage.setItem("rpc.day",day);$("#weekTitle").textContent=`Semana ${w.number} · ${w.title}`;$("#phaseName").textContent=w.phase;$("#phaseObjective").textContent=w.phaseObjective;$("#duration").textContent=d.duration||"—";$("#zone").textContent=d.zone||d.phases?.[0]?.zone||"—";$("#cadence").textContent=d.cadence||d.phases?.[0]?.cadence||"Cadencia libre";$("#type").textContent=d.type||"MTB";$("#distance").textContent=d.distance?`Distancia estimada: ${d.distance}`:"";$("#nutrition").textContent=d.nutrition;$("#technique").textContent=d.technique}

export function originalPhases(){return state.day.phases?.length?structuredClone(state.day.phases):[{name:"Sesión continua",duration:state.day.duration,zone:state.day.zone,cadence:state.day.cadence,technique:state.day.technique}]}

export function getPhases(){try{return JSON.parse(localStorage.getItem(customKey()))||originalPhases()}catch{return originalPhases()}}

export function saveCustomPhases(phases){localStorage.setItem(customKey(),JSON.stringify(phases))}

export function openPrepare(pushHistory=true){$("#prepareTitle").textContent=state.day.title;$("#prepareWeek").textContent=`Semana ${state.week.number} · ${state.dayName}`;renderPhaseList();showView("prepare");if(pushHistory&&!location.hash)history.pushState({prepare:true},"","#preparar")}

export function renderPhaseList(){const phases=getPhases();$("#prepareDuration").textContent=formatClock(phases.reduce((a,p)=>a+parseDurationSeconds(p.duration),0),true);$("#phaseList").innerHTML=phases.map((p,i)=>`<article class="phase-row" style="--zone:${zoneColor(p.zone||p.name)}"><span class="phase-index">${i+1}</span><div><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.zone||"Sin zona")} · ${escapeHtml(p.cadence||state.day.cadence||"Cadencia libre")}</p></div><span class="phase-time">${escapeHtml(p.duration||"—")}</span><div class="phase-detail">${escapeHtml(p.technique||"Sin técnica específica")} · Pulsaciones: ${escapeHtml(p.hr||"según zona")}</div><div class="phase-actions"><button data-action="edit" data-index="${i}">Editar</button><button data-action="up" data-index="${i}">↑</button><button data-action="down" data-index="${i}">↓</button><button class="delete-phase" data-action="delete" data-index="${i}">Eliminar</button></div></article>`).join("")}

export function handlePhaseAction(e){const b=e.target.closest("button[data-action]");if(!b)return;const phases=getPhases(),i=Number(b.dataset.index),a=b.dataset.action;if(a==="edit")return openPhaseEditor(i);if(a==="delete")phases.splice(i,1);if(a==="up"&&i>0)[phases[i-1],phases[i]]=[phases[i],phases[i-1]];if(a==="down"&&i<phases.length-1)[phases[i+1],phases[i]]=[phases[i],phases[i+1]];if(!phases.length)phases.push({name:"Nuevo período",duration:"5 min",zone:"Z1"});saveCustomPhases(phases);renderPhaseList()}

export function openPhaseEditor(i=""){const p=i===""?{name:"Nuevo período",duration:"5 min",technique:"",zone:"Z1",cadence:state.day.cadence||"",hr:"",music:"auto",musicPreferences:[]}:getPhases()[i];$("#editPhaseIndex").value=i;for(const [id,key] of [["editPhaseName","name"],["editPhaseDuration","duration"],["editPhaseTechnique","technique"],["editPhaseZone","zone"],["editPhaseCadence","cadence"],["editPhaseHr","hr"]])$("#"+id).value=p[key]||"";populatePhaseMusicSelect(p.music||"auto",p.musicPreferences||[]);togglePreferredMusicFields();$("#phaseEditorDialog").showModal()}

export function savePhase(e){e.preventDefault();const phases=getPhases(),i=$("#editPhaseIndex").value,p={name:$("#editPhaseName").value.trim(),duration:$("#editPhaseDuration").value.trim(),technique:$("#editPhaseTechnique").value.trim(),zone:$("#editPhaseZone").value.trim(),cadence:$("#editPhaseCadence").value.trim(),hr:$("#editPhaseHr").value.trim(),music:$("#editPhaseMusic").value,musicPreferences:[1,2,3].map(n=>$("#editPhaseMusic"+n).value).filter(Boolean)};if(!p.name||!p.duration)return;if(i==="")phases.push(p);else phases[Number(i)]=p;saveCustomPhases(phases);$("#phaseEditorDialog").close();renderPhaseList()}

export function resetCustomPhases(){localStorage.removeItem(customKey());renderPhaseList()}

export function closePrepare(){showView("home");if(location.hash)history.replaceState(null,"",location.pathname)}

export function showView(name){$("#homeView").hidden=name!=="home";$("#prepareView").hidden=name!=="prepare";$("#trainingView").hidden=name!=="training";localStorage.setItem("rpc.view",name);scrollTo(0,0)}

export function repetitionInfo(phase){const duration=String(phase?.duration||""),name=String(phase?.name||"");let m=duration.match(/(\d+)\s*[×xX]\s*(\d+(?:[.,]\d+)?)\s*(min|s(?:eg)?)/i);if(m)return {count:Number(m[1]),unit:`${m[2]} ${m[3]}`};const count=name.match(/(?:^|\D)(\d+)\s*[×xX]\s*(?:\d+(?:[.,]\d+)?)?(?:\D|$)/i)?.[1];const unit=duration.match(/(\d+(?:[.,]\d+)?)\s*(min|s(?:eg)?)/i);return count&&unit?{count:Number(count),unit:`${unit[1]} ${unit[2]}`} : null}

export function expandPhases(source){const out=[];for(let i=0;i<source.length;i++){const p={...source[i]},rep=repetitionInfo(p),next=source[i+1],isRecovery=next&&/recuperaci[oó]n/i.test(next.name||"");if(!rep||rep.count<2){out.push(p);continue}const blockId=`${state.week?.number||0}-${state.dayName}-${i}`;for(let r=1;r<=rep.count;r++){out.push({...p,duration:rep.unit,repetition:r,repetitionCount:rep.count,name:`${cleanPhaseName(p.name)} · ${r}/${rep.count}`,musicGroup:`${blockId}-work`,musicResume:true});if(isRecovery&&r<rep.count)out.push({...next,name:cleanPhaseName(next.name),intercalatedRecovery:true,musicGroup:`${blockId}-recovery`,musicResume:true})}if(isRecovery)i++}return out}
