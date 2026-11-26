// Guards the Marty character book against host / service-minded manners coming back
// (Rob, P-20261125-1654: "I don't want a nice Marty"), and against phonetic spelling
// (the base script says the accent is spoken, never spelled).
import { assert, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import { martyCharacterBook, MARTY_CHARACTER_BOOK_MAX_CHARS } from "./_shared/martyCharacterBook.ts";

const BANNED_HOST_PHRASES: RegExp[] = [
  /\bkind(ly|ness)?\b/i, /\bwarm(th|ly|ing)?\b/i, /\bwelcom\w*/i, /\bhospitab\w*/i, /\bhospitality\b/i,
  /\bhappy to\b/i, /\bglad to\b/i, /\bglad (you|they)\b/i, /\bgreat question\b/i, /\bgood question\b/i,
  /\bthank\w*/i, /\bsorry\b/i, /\banything else\b/i, /\bof course\b/i, /\babsolutely\b/i, /\bno problem\b/i,
  /\bhow can i help\b/i, /\bhappy to help\b/i, /\bmy pleasure\b/i, /\bservice-minded\b/i,
  /\bsoft heart\b/i, /\bbe nice\b/i, /\bbe helpful\b/i, /\bgentle(man)?\b/i, /\bgood-natured\b/i,
];

Deno.test("character book: no warm-host / hospitable / service phrases anywhere", () => {
  const text = martyCharacterBook;
  for (const re of BANNED_HOST_PHRASES) {
    const m = text.match(re);
    assertFalse(m !== null, `banned host phrase found: "${m?.[0]}" (${re})`);
  }
});

Deno.test("character book: Boston words written normally, no phonetic spelling", () => {
  const phonetic = /\b(cah|pahk|bah|heah|theah|nevah|wahtah|ordah|chowdah|hahdah|smaht|shuah|idear|suppah|dinnah|papah|weathah|bittah|hahbah|floatah|ya|whaddaya)\b/i;
  const m = martyCharacterBook.match(phonetic);
  assertFalse(m !== null, `phonetic spelling found: "${m?.[0]}"`);
});

Deno.test("character book: default is grumpy and mean, hard lines kept, niceness is no exception", () => {
  for (const k of [
    "grumpy, impatient, sarcastic", "He roasts what the guest orders", "He never flatters the guest",
    "He never apologizes", "He curses", "Roast the order or the question, never who the person is",
    "No slurs", "No threats. Nothing sexual.", "drop the act at once", "call or text 988",
    "Never encourage overdrinking", "drunk driving", "Being nice, polite or helpful-sounding is NOT an exception",
    "11. FACTS RULE", "made-up character voice", "Do not invent personal history", "the Leaky Dory", "all made-up names",
  ]) assertStringIncludes(martyCharacterBook, k);
  assertFalse(martyCharacterBook.includes("MARTY CHARACTER BOOK"));
  assert(martyCharacterBook.length > 5000 && martyCharacterBook.length <= MARTY_CHARACTER_BOOK_MAX_CHARS);
});

// P-20261126-0022 part 1: Marty's pet peeves (trigger -> reaction), with the hard lines restated inside it.
const peeves = () => {
  const i = martyCharacterBook.indexOf("12. MARTY'S PET PEEVES");
  return i < 0 ? "" : martyCharacterBook.slice(i);
};

Deno.test("character book: pet peeves section present, with triggers and the groan-then-answer rule", () => {
  const p = peeves();
  assert(p.length > 1500, "pet peeves section missing or too short");
  for (const k of [
    "DRINKS HE HATES MAKING", "THINGS HE HATES HEARING OR SEEING", "EAST COAST OLD-MAN GRUDGES",
    "then still gives the real answer or a better pick", "never the same line twice in a row",
    "spikes on a peeve, then settles", "Mojito", "Ramos Gin Fizz", "Long Island", "This ain't a cruise ship",
    "Cosmo", "Espresso martini", "Make it strong", "less ice", "Surprise me", "It's my birthday",
    "Snapping", "smile more", "oat milk", "mixologist", "Yankees fans",
  ]) assertStringIncludes(p, k);
});

Deno.test("character book: hard lines restated in the pet peeves section, and the book-wide safety lines kept", () => {
  const p = peeves();
  for (const k of [
    "HARD LINES STILL HOLD HERE", "never anyone's race, religion, sexuality, gender, disability, nationality or body",
    "No slurs, no threats, nothing sexual", "genuinely upset, unwell, in danger or too drunk, drop the act",
    "Never push overdrinking or drunk driving", "No made-up drink facts", "Section 9 and the 988 line always win",
    "never cheers on getting hammered", "Never a bigger one",
  ]) assertStringIncludes(p, k);
  for (const k of ["9. HARD LINES", "call or text 988", "Never serve more", "flat no and a glass of water"]) {
    assertStringIncludes(martyCharacterBook, k);
  }
});
