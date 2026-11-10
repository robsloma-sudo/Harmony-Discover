import React, { useMemo, useState } from "react";
import { useAuth } from "../helpers/useAuth";
import { comedyScenarios } from "../helpers/comedyScenarios";
import styles from "./comedy-lab.module.css";

const dimensions = [
  {key:"specificity",label:"Specific to the guest"},
  {key:"originality",label:"Originality / surprise"},
  {key:"timing",label:"Timing / punchline shape"},
  {key:"naturalness",label:"Natural spoken delivery"},
  {key:"character",label:"Bartender character"},
  {key:"restraint",label:"Didn't force the joke"}
] as const;

export default function ComedyLab() {
  const { authState } = useAuth();
  const [category,setCategory] = useState("All");
  const [index,setIndex] = useState(0);
  const [scores,setScores] = useState<Record<string,number>>({});
  const [response,setResponse] = useState("");
  const [notes,setNotes] = useState("");
  const [status,setStatus] = useState("");
  const [saved,setSaved] = useState(0);
  const categories = useMemo(()=>["All",...Array.from(new Set(comedyScenarios.map(s=>s.category)))],[ ]);
  const filtered = useMemo(()=>comedyScenarios.filter(s=>category === "All" || s.category === category),[category]);
  const scenario = filtered[index % filtered.length];
  const average = dimensions.reduce((sum,d)=>sum+(scores[d.key]||0),0) / dimensions.filter(d=>scores[d.key]).length || 0;

  function changeCategory(value:string){setCategory(value);setIndex(0);setScores({});setResponse("");setNotes("");setStatus("");}
  function next(){setIndex(v=>(v+1)%filtered.length);setScores({});setResponse("");setNotes("");setStatus("");}

  async function save(){
    if(authState.type !== "authenticated"){setStatus("Sign in to save scored auditions to your private evaluation history.");return;}
    if(dimensions.some(d=>!scores[d.key])){setStatus("Score all six dimensions before saving.");return;}
    setStatus("Saving evaluation…");
    try{
      const detail = JSON.stringify({scenarioId:scenario.id,category:scenario.category,guestPrompt:scenario.guest,bartenderResponse:response,notes,scores,average:Number(average.toFixed(2)),rubricVersion:1});
      const r=await fetch("/_api/feedback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:`comedy-lab-${Date.now()}`,feedbackType:"comedy_evaluation",detail})});
      const data=await r.json();if(!r.ok)throw new Error(data.error||"Could not save evaluation.");
      setSaved(v=>v+1);setStatus("Evaluation saved to your private feedback history.");
    }catch(e){setStatus(e instanceof Error?e.message:"Could not save evaluation.");}
  }

  return <main className={styles.page}>
    <header className={styles.top}><a href="/" className={styles.back}>← Back to the bar</a><span>HARMONY DISCOVER · VOICE LAB</span></header>
    <section className={styles.hero}><div className={styles.kicker}>CHARACTER DEVELOPMENT / COMEDY INTELLIGENCE</div><h1>The Comedy <em>Lab.</em></h1><p>Stress-test the bartender's comic instincts. Give him a real guest prompt, listen to his response in the main bar, then score what actually landed.</p><div className={styles.stats}><div><strong>{comedyScenarios.length}</strong><span>ORIGINAL SCENARIOS</span></div><div><strong>6</strong><span>QUALITY DIMENSIONS</span></div><div><strong>{saved}</strong><span>SAVED THIS VISIT</span></div></div></section>
    <section className={styles.panel}>
      <div className={styles.panelHead}><div><span className={styles.label}>01 / THE PROMPT DECK</span><h2>Put him on the spot.</h2></div><span className={styles.counter}>{index+1} / {filtered.length}</span></div>
      <div className={styles.filters}><label htmlFor="category">Comedy skill</label><select id="category" value={category} onChange={e=>changeCategory(e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className={styles.promptCard}><div className={styles.promptMeta}><span>{scenario.category}</span><span>{scenario.difficulty}</span></div><blockquote>“{scenario.guest}”</blockquote><p><b>Test for:</b> {scenario.skill}</p></div>
      <div className={styles.actions}><button className={styles.secondary} onClick={next}>Skip scenario</button><button className={styles.primary} onClick={()=>{navigator.clipboard?.writeText(scenario.guest);setStatus("Guest prompt copied. Open the bar in another tab and say it to him.");}}>Copy guest line</button></div>
      <p className={styles.hint}>Open the main bar in another tab, start a fresh conversation, and deliver the guest line naturally. This lab does not fabricate or grade a response automatically.</p>
    </section>
    <section className={styles.panel}>
      <div className={styles.panelHead}><div><span className={styles.label}>02 / RESPONSE REVIEW</span><h2>Did the joke land?</h2></div><span className={styles.score}>{average ? average.toFixed(1)+" / 5" : "— / 5"}</span></div>
      <label className={styles.fieldLabel} htmlFor="bartender-response">Paste or transcribe his actual response</label><textarea id="bartender-response" rows={4} value={response} onChange={e=>setResponse(e.target.value)} placeholder="Paste what the bartender actually said…"/>
      <div className={styles.rubric}>{dimensions.map(d=><div className={styles.rubricRow} key={d.key}><label>{d.label}</label><div className={styles.rating}>{[1,2,3,4,5].map(n=><button key={n} aria-pressed={scores[d.key]===n} className={scores[d.key]===n?styles.selected:""} onClick={()=>setScores(old=>({...old,[d.key]:n}))}>{n}</button>)}</div></div>)}</div>
      <div className={styles.scale}><span>1 = weak / forced</span><span>5 = excellent</span></div>
      <label className={styles.fieldLabel} htmlFor="lab-notes">What worked or fell flat?</label><textarea id="lab-notes" rows={3} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Specific observation, stale phrasing, great timing, too mean, not funny…"/>
      <div className={styles.actions}><button className={styles.secondary} onClick={()=>{setScores({});setResponse("");setNotes("");setStatus("");}}>Clear review</button><button className={styles.primary} onClick={()=>void save()}>Save scored audition</button></div>
      {status&&<p className={styles.status}>{status}</p>}
      {authState.type!=="authenticated"&&<p className={styles.hint}>Sign in to save evaluations to your private feedback history. You can still use the scenario deck without signing in.</p>}
    </section>
    <section className={styles.method}><span className={styles.label}>03 / HOW TO USE THE SCORES</span><h2>Measure the craft, not the profanity.</h2><p>A high score means the response was specific, surprising, well-timed, natural, true to character, and appropriately restrained. Profanity alone earns no points. A technically correct answer can still be funny; a loud insult can still be lazy.</p><a href="/">Return to the live bartender →</a></section>
    <footer>PRIVATE PROTOTYPE · AUDITION DATA IS USER-SUBMITTED · NO AUTOMATIC MODEL TRAINING</footer>
  </main>;
}