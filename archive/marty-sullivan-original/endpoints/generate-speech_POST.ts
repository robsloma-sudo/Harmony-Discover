import { schema } from "./generate-speech_POST.schema";
import { z } from "zod";

export async function handle(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const key = process.env.OPENAI_API_KEY;
    if (!key) return Response.json({ error: "OpenAI API key is not connected to this isolated project." }, { status: 503 });
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "onyx",
        input: input.script,
        instructions: "VOICE IDENTITY: An original fictional man, approximately 60 years old. Clearly masculine, low baritone with chest resonance, weight and a naturally rough, weathered, slightly gravelly edge. Do not sound feminine, youthful, polished, smooth, or like a narrator. ACCENT: Strong, clearly audible New York City working-class accent, sustained consistently in ordinary words, not just a few slang words. Use natural NYC vowel placement, clipped consonants, softened or dropped final R where it belongs, and authentic local rhythm. Do not drift into neutral General American. DELIVERY: Speak like a real neighborhood bartender talking across the bar to one customer. Relaxed but alert, slightly tired, dryly amused, blunt, confident, with warmth underneath. Let stressed words stretch naturally; vary pitch and intensity; use uneven conversational timing, short pauses, small audible inhales and subtle exhales where natural. Give punchlines a little bite and a half-smile. Do not rush. Avoid theatrical acting, exaggerated dialect, cartoon accent, announcer cadence, or perfectly even synthetic phrasing.",
        response_format: "mp3",
        speed: 0.88
      })
    });
    if (!response.ok) {
      const detail = await response.text();
      return Response.json({ error: `OpenAI speech generation returned ${response.status}: ${detail.slice(0, 500)}` }, { status: 502 });
    }
    const audio = await response.arrayBuffer();
    if (!audio.byteLength) return Response.json({ error: "OpenAI returned an empty audio response." }, { status: 502 });
    return new Response(audio, { status: 200, headers: { "Content-Type": "audio/mpeg", "Content-Length": String(audio.byteLength), "Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="harmony-new-york-bartender-audition-01.mp3"' } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Please provide a script between 1 and 4,000 characters." }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "Unexpected server error." }, { status: 500 });
  }
}