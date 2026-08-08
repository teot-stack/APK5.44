/**
 * Río Pinto Coach · Audio, cadencia y voz
 * Arquitectura modular consolidada
 */
import { cleanPhaseName, hrTarget, state } from "./core.js";
import { muteMusicForVoice, restoreMusicAfterVoice } from "./music.js";

export async function unlockAudio(){try{state.audio??=new (window.AudioContext||window.webkitAudioContext)();if(state.audio.state==="suspended")await state.audio.resume()}catch{}}

export function beep(freq,duration,volume){const s=state.session;if(!s||volume<=0||!state.audio)return;const o=state.audio.createOscillator(),g=state.audio.createGain();o.frequency.value=freq;g.gain.value=volume*.18;o.connect(g).connect(state.audio.destination);o.start();g.gain.exponentialRampToValueAtTime(.0001,state.audio.currentTime+duration);o.stop(state.audio.currentTime+duration)}

export function handleWarningBeep(remaining){const s=state.session,sec=Math.ceil(remaining);if(!s?.warningEnabled)return;if(sec<=5&&sec>=1&&sec!==state.lastWarningSecond){state.lastWarningSecond=sec;beep(720,.12,s.warningVolume)}}

export function cadenceRpm(){const s=state.session,p=s?.phases?.[s.phaseIndex];if(!p||p.metronome===false)return 0;const override=Number(s.cadenceOverride);if(override>0)return override;if(Number(p.cadenceRpm)>0)return Number(p.cadenceRpm);const nums=String(p.cadence||"").match(/\d{2,3}/g)?.map(Number)||[];return nums.length>1?Math.round((nums[0]+nums[1])/2):(nums[0]||0)}

export function startCadencePulse(){stopCadencePulse();const s=state.session,rpm=cadenceRpm();if(!s?.cadenceEnabled||!rpm||s.cadenceVolume<=0)return;beep(1100,.055,s.cadenceVolume);state.cadenceTimer=setInterval(()=>beep(1100,.055,s.cadenceVolume),60000/rpm)}

export function stopCadencePulse(){clearInterval(state.cadenceTimer);state.cadenceTimer=null}

export function spokenNumber(value){const words=["cero","uno","dos","tres","cuatro","cinco","seis","siete","ocho","nueve","diez","once","doce","trece","catorce","quince","dieciséis","diecisiete","dieciocho","diecinueve","veinte"];const n=Number(value);return Number.isInteger(n)&&n>=0&&n<words.length?words[n]:String(value)}

export function spokenPhaseName(name){return cleanPhaseName(name).replace(/\s*[·-]\s*\d+\s*\/\s*\d+\s*$/u,"").trim()}

export function phaseSpeechText(p){const s=state.session;const parts=[spokenPhaseName(p.name)];if(p.repetitionCount)parts.push(`${spokenNumber(p.repetition)} de ${spokenNumber(p.repetitionCount)}`);parts.push(p.duration);if(p.zone){const z=String(p.zone).match(/Z([1-5])/i)?.[1];parts.push(z?`Zona ${spokenNumber(z)}`:`Zona ${p.zone}`)}parts.push(p.cadence&&!/^cadencia libre$/i.test(String(p.cadence).trim())?String(p.cadence):"Cadencia libre");const target=p.hr&&p.hr!=="Según zona"?p.hr:hrTarget(p.zone||state.day.zone,s?.maxHr||185);if(target!=="—")parts.push(`Pulsaciones ${target}`);if(p.technique)parts.push(p.technique);return parts.filter(Boolean).join(". ")}

export function speakPhase(p){const s=state.session;if(!s?.voiceEnabled||s.voiceVolume<=0||p.voice===false)return;const text=phaseSpeechText(p);if(hasNativeAndroid()){try{window.AndroidNative.speak(text,s.voiceVolume,1.08)}catch{}return}if(!("speechSynthesis" in window))return;const token=++state.speechToken;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang="es-AR";u.volume=s.voiceVolume;u.rate=1.08;u.onstart=muteMusicForVoice;u.onend=()=>restoreMusicAfterVoice(token);u.onerror=()=>restoreMusicAfterVoice(token);window.speechSynthesis.speak(u)}
