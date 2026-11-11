import React, { useEffect, useRef, useState } from "react";
import { Badge } from "../components/Badge";
import styles from "./_index.module.css";
import { useAuth } from "../helpers/useAuth";

type Line = { id: string; who: "guest" | "bartender" | "system"; text: string };

export default function Home() {
  const [status, setStatus] = useState("Not connected");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [textMode, setTextMode] = useState(false);
  const [memories, setMemories] = useState<Array<{id:string|number;memoryType:string;memoryKey:string;memoryValue:string}>>([]);
  const [memoryType, setMemoryType] = useState("preference");
  const [memoryKey, setMemoryKey] = useState("");
  const [memoryValue, setMemoryValue] = useState("");
  const [memoryStatus, setMemoryStatus] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState("");
  const sessionIdRef = useRef(`bar-${Date.now()}-${Math.random().toString(36).slice(2,9)}`);
  const { authState, logout } = useAuth();
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const liveGuestRef = useRef("");
  const liveBartenderRef = useRef("");

  useEffect(() => {
    if (authState.type !== "authenticated") { setMemories([]); return; }
    fetch("/_api/memories").then(async r => { const data = await r.json(); if (r.ok) setMemories(data.memories || []); }).catch(() => undefined);
  }, [authState.type === "authenticated" ? authState.user.id : null]);

  async function saveMemory(e: React.FormEvent) {
    e.preventDefault(); setMemoryStatus("Saving…");
    try {
      const response = await fetch("/_api/memories", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({memoryType,memoryKey,memoryValue,source:"user_confirmed"}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save memory.");
      setMemories(old => [data.memory, ...old.filter(m => !(m.memoryType === data.memory.memoryType && m.memoryKey === data.memory.memoryKey))]);
      setMemoryKey(""); setMemoryValue(""); setMemoryStatus("Saved. He can use this next time you visit.");
    } catch (e) { setMemoryStatus(e instanceof Error ? e.message : "Could not save memory."); }
  }

  async function deleteMemory(memoryId: string | number) {
    setMemoryStatus("Removing…");
    try {
      const response = await fetch("/_api/memory-delete", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({memoryId}) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not remove memory.");
      setMemories(old => old.filter(m => String(m.id) !== String(memoryId))); setMemoryStatus(data.deleted ? "Memory removed." : "Memory was already gone.");
    } catch (e) { setMemoryStatus(e instanceof Error ? e.message : "Could not remove memory."); }
  }

  async function sendFeedback(feedbackType: string) {
    setFeedbackStatus("Saving feedback…");
    try {
      const response = await fetch("/_api/feedback", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({sessionId:sessionIdRef.current,feedbackType}) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not save feedback.");
      setFeedbackStatus("Thanks. Feedback saved to your learning profile.");
    } catch (e) { setFeedbackStatus(e instanceof Error ? e.message : "Could not save feedback."); }
  }

  function addLine(who: Line["who"], text: string) {
    if (!text.trim()) return;
    setLines(old => [...old, { id: `${Date.now()}-${Math.random()}`, who, text: text.trim() }].slice(-80));
  }

  async function connect() {
    setBusy(true); setError(""); setStatus("Requesting microphone…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const tokenResponse = await fetch("/_api/realtime-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const tokenBody = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(tokenBody.error || "Could not start a realtime session.");
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      const audio = new Audio(); audio.autoplay = true; audioRef.current = audio;
      pc.ontrack = event => { audio.srcObject = event.streams[0]; void audio.play().catch(() => undefined); };
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      const dc = pc.createDataChannel("oai-events"); dcRef.current = dc;
      dc.onopen = () => { setConnected(true); setStatus("At the bar · listening"); addLine("system", "He's behind the bar. Go ahead."); };
      dc.onmessage = event => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "input_audio_buffer.speech_started") {
            liveGuestRef.current = "";
            setStatus("You're talking…");
          }
          if (data.type === "conversation.item.input_audio_transcription.completed" && data.transcript) {
            addLine("guest", data.transcript); setStatus("He's thinking…");
          }
          if (data.type === "response.output_audio_transcript.delta") liveBartenderRef.current += data.delta || "";
          if (data.type === "response.output_audio_transcript.done" && data.transcript) {
            addLine("bartender", data.transcript); liveBartenderRef.current = ""; setStatus("At the bar · listening");
          }
          if (data.type === "response.done") setStatus("At the bar · listening");
          if (data.type === "error") setError(data.error?.message || "Realtime session error.");
        } catch { /* Ignore non-JSON data channel messages. */ }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") setStatus("Connection interrupted");
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await new Promise<void>((resolve, reject) => {
        if (pc.iceGatheringState === "complete") return resolve();
        const timeout = window.setTimeout(() => reject(new Error("Network setup timed out. Try again.")), 10000);
        pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === "complete") { window.clearTimeout(timeout); resolve(); } };
      });
      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST", body: pc.localDescription?.sdp,
        headers: { Authorization: `Bearer ${tokenBody.client_secret}`, "Content-Type": "application/sdp" }
      });
      if (!sdpResponse.ok) throw new Error(`Realtime connection failed (${sdpResponse.status}): ${(await sdpResponse.text()).slice(0, 300)}`);
      await pc.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
    } catch (e) {
      await disconnect(false);
      setStatus("Not connected");
      setError(e instanceof Error ? e.message : "Unable to connect.");
    } finally { setBusy(false); }
  }

  async function disconnect(showLine = true) {
    try { dcRef.current?.close(); } catch {}
    try { pcRef.current?.close(); } catch {}
    streamRef.current?.getTracks().forEach(track => track.stop());
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.srcObject = null; }
    dcRef.current = null; pcRef.current = null; streamRef.current = null; audioRef.current = null;
    setConnected(false); setStatus("Not connected");
    if (showLine) addLine("system", "You stepped away from the bar.");
  }

  function sendText() {
    const text = draft.trim(); if (!text || !dcRef.current || dcRef.current.readyState !== "open") return;
    dcRef.current.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } }));
    dcRef.current.send(JSON.stringify({ type: "response.create", response: { output_modalities: ["audio"] } }));
    addLine("guest", text); setDraft(""); setStatus("He's thinking…");
  }

  useEffect(() => () => {
    try { dcRef.current?.close(); pcRef.current?.close(); } catch {}
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  return <main className={styles.page}>
    <header className={styles.top}><div className={styles.brand}><span className={styles.mark}>H</span><div><div className={styles.brandName}>HARMONY <span>DISCOVER</span></div><div className={styles.eyebrow}>VOICE LAB · INTERACTIVE CHARACTER</div></div></div><Badge variant="success">ISOLATED PROTOTYPE</Badge></header>
    <section className={styles.hero}><div className={styles.kicker}>CHARACTER 01 <span>—</span> THE NEIGHBORHOOD BARTENDER</div><h1>Pull up a stool.<br/><em>He's listening.</em></h1><p className={styles.intro}>Not a voice recording. A live conversation with a sharp-tongued New York bartender who knows his drinks, remembers the thread of the conversation, and can give it right back.</p><div className={styles.tags}><span>LIVE SPEECH</span><span>INTERRUPTIBLE</span><span>DRY HUMOR</span><span>SESSION CONTEXT</span></div></section>
    <section className={styles.console}>
      <div className={styles.consoleHead}><div><div className={styles.label}>THE BAR IS OPEN</div><h2>Talk to the bartender.</h2></div><Badge variant={connected ? "success" : "secondary"}>{status}</Badge></div>
      <div className={styles.character}><div className={styles.avatar}>B</div><div><strong>The bartender</strong><span>Older · masculine · gravelly direction · New York attitude</span></div><span className={styles.liveDot} /> </div>
      <div className={styles.transcript} aria-live="polite">
        {lines.length === 0 && <div className={styles.empty}><span>“</span><p>Well? You gonna order something, or are we just gonna stare at each other all night?</p><small>Connect to hear him respond in real time.</small></div>}
        {lines.map(line => <div key={line.id} className={`${styles.line} ${styles[line.who]}`}><small>{line.who === "guest" ? "YOU" : line.who === "bartender" ? "BARTENDER" : "SYSTEM"}</small><p>{line.text}</p></div>)}
      </div>
      <div className={styles.controls}>
        {!connected ? <button className={styles.primary} onClick={connect} disabled={busy}>{busy ? "Connecting…" : "Start conversation · Enable microphone"}</button> : <button className={styles.end} onClick={() => void disconnect()}>End conversation</button>}
        {connected && <label className={styles.textToggle}><input type="checkbox" checked={textMode} onChange={e => setTextMode(e.target.checked)}/> Also send typed messages</label>}
        {connected && textMode && <form className={styles.textForm} onSubmit={e => { e.preventDefault(); sendText(); }}><input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Give him a hard time…"/><button type="submit" disabled={!draft.trim()}>Send</button></form>}
        {error && <p className={styles.error}>{error}</p>}
      </div>
      <p className={styles.note}>Microphone access is requested only when you start. The session uses a short-lived OpenAI credential; your permanent API key stays on the server. Conversation history currently lasts only for this session and is not saved as long-term memory.</p>
      {connected && authState.type === "authenticated" && <div className={styles.feedback}><span>How's he doing?</span><button onClick={()=>void sendFeedback("great_answer")}>Nailed it</button><button onClick={()=>void sendFeedback("not_funny")}>Not funny</button><button onClick={()=>void sendFeedback("too_sarcastic")}>Too much attitude</button><button onClick={()=>void sendFeedback("wrong_fact")}>Got a fact wrong</button>{feedbackStatus && <small>{feedbackStatus}</small>}</div>}
    </section>
    <section className={styles.memoryPanel}>
      <div className={styles.consoleHead}><div><div className={styles.label}>THE REGULARS BOOK</div><h2>What he remembers.</h2></div>{authState.type === "authenticated" ? <button className={styles.signOut} onClick={() => void logout()}>Sign out</button> : <a className={styles.signIn} href="/login">Sign in to enable memory ↗</a>}</div>
      {authState.type === "authenticated" ? <>
        <p className={styles.memoryIntro}>Save a preference or detail explicitly. These memories are private to your account and supplied to the bartender when you start a new conversation.</p>
        <form className={styles.memoryForm} onSubmit={saveMemory}>
          <select value={memoryType} onChange={e=>setMemoryType(e.target.value)}><option value="preference">Taste preference</option><option value="drink_history">Drink history</option><option value="interaction_style">Conversation style</option><option value="personal_context">Personal context</option></select>
          <input value={memoryKey} onChange={e=>setMemoryKey(e.target.value)} placeholder="Label (e.g. favorite spirit)" required maxLength={80}/>
          <input value={memoryValue} onChange={e=>setMemoryValue(e.target.value)} placeholder="What should he remember?" required maxLength={500}/>
          <button type="submit" disabled={!memoryKey.trim() || !memoryValue.trim()}>Save memory</button>
        </form>
        {memoryStatus && <p className={styles.memoryStatus}>{memoryStatus}</p>}
        <div className={styles.memoryList}>{memories.length ? memories.map(m=><div key={String(m.id)} className={styles.memoryItem}><span>{m.memoryType.replace("_"," ")}</span><strong>{m.memoryKey}</strong><p>{m.memoryValue}</p><button onClick={()=>void deleteMemory(m.id)}>Remove memory</button></div>) : <p className={styles.emptyMemory}>No saved memories yet. Add one above to get started.</p>}</div>
      </> : <p className={styles.memoryIntro}>Sign in to create your private regular's-book profile. Without an account, conversation context lasts only for the current session. <a href="/login">Sign in or create an account</a>.</p>}
    </section>
    <section className={styles.details}><div className={styles.label}>WHAT THIS PROTOTYPE TESTS</div><div className={styles.detailGrid}><article><b>01</b><h3>Natural conversation</h3><p>Speech-to-speech responses with real-time turn-taking and interruption support.</p></article><article><b>02</b><h3>Character consistency</h3><p>A stable bartender persona that can joke, spar, teach, and change tone when needed.</p></article><article><b>03</b><h3>Session memory</h3><p>He follows the current conversation. Persistent memory across visits is the next layer.</p></article></div></section>
    <footer className={styles.footer}>HARMONY DISCOVER <span>·</span> PRIVATE PROTOTYPE · NO PRODUCTION CONNECTION</footer>
  </main>;
}