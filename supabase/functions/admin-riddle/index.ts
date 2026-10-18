/**
 * admin-riddle — the second lock on the admin page, after the password.
 *
 * A "pass" token from admin-login (see _shared/admin.ts) can only do two
 * things here, and nothing anywhere else:
 *   { action: "ask" }                       -> { question, challenge }
 *   { action: "answer", challenge, answer } -> { token, expires_at } (an "unlocked" token)
 *
 * The riddle is picked at random from RIDDLES each time. The challenge is a
 * signed record of which one was asked, so an answer is always checked
 * against the riddle actually shown. A wrong answer is a 400 (not 401), so
 * the page stays on the riddle rather than dropping back to the password.
 * The answers live only here, server-side, never in the admin page's code.
 *
 * Deploy:  supabase functions deploy admin-riddle
 */

import { readToken, signClaims, handlePreflight, json } from "../_shared/admin.ts";

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const UNLOCKED_TTL_MS = 12 * 60 * 60 * 1000;

/** [question, ...accepted answers]. Answers are compared after normalise(). */
const RIDDLES: string[][] = [
  ["What has keys but can't open a single lock?", "keyboard", "piano"],
  ["What gets wetter the more it dries?", "towel"],
  ["I have cities but no houses, forests but no trees, and water but no fish. What am I?", "map"],
  ["What has to be broken before you can use it?", "egg"],
  ["What has a neck but no head?", "bottle"],
  ["What has hands but can't clap?", "clock", "watch"],
  ["What goes up but never comes down?", "age", "your age"],
  ["What has one eye but can't see?", "needle"],
  ["The more you take, the more you leave behind. What are they?", "footsteps", "footstep", "steps"],
  ["What can you catch but not throw?", "cold"],
  ["What has lots of teeth but can't bite?", "comb", "zip", "zipper", "saw"],
  ["What runs but never walks, and has a mouth but never talks?", "river"],
  ["What is full of holes but still holds water?", "sponge"],
  ["What belongs to you, but other people use it more than you do?", "name", "your name"],
  ["What has a head and a tail but no body?", "coin"],
  ["I'm tall when I'm young and short when I'm old. What am I?", "candle"],
  ["What can travel around the world while staying in a corner?", "stamp", "postage stamp"],
  ["What has words but never speaks?", "book"],
  ["Which month has 28 days?", "all", "all of them", "every month", "all months", "every one"],
  ["What comes once in a minute, twice in a moment, but never in a thousand years?", "m", "letter m"],
  ["What has legs but can't walk?", "table", "chair"],
  ["If you drop me I crack, but smile at me and I smile back. What am I?", "mirror"],
  ["What can fill a room but takes up no space?", "light"],
  ["Which building has the most stories?", "library"],
  ["What can you hold in your right hand but never in your left?", "left hand", "your left hand", "left elbow", "your left elbow"],
  ["Forward I'm heavy, backward I'm not. What am I?", "ton"],
  ["What has a thumb and four fingers but isn't alive?", "glove"],
  ["What is always in front of you but can never be seen?", "future", "the future"],
  ["What gets bigger the more you take away from it?", "hole"],
  ["I always balance, with assets on one side and liabilities and equity on the other. What am I?", "balance sheet", "statement of financial position"],
  ["Every entry I record has two sides, a debit and a credit. What system am I?", "double entry", "double entry bookkeeping", "double entry accounting"],
  ["I'm the tax on the profit when you sell an asset for more than it cost. What am I?", "capital gains tax", "cgt"],
];

/** Lower-case, letters and digits only, and no leading "a"/"an"/"the"/"it's". */
const normalise = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(it s |its |it is |you re |a |an |the )+/, "")
    .trim();

function isRight(rid: number, answer: string): boolean {
  const given = normalise(answer);
  if (!given) return false;
  return RIDDLES[rid].slice(1).some((a) => {
    const want = normalise(a);
    return given === want || given === `${want}s` || `${given}s` === want;
  });
}

async function ask() {
  const rid = Math.floor(Math.random() * RIDDLES.length);
  const { token: challenge } = await signClaims({ exp: Date.now() + CHALLENGE_TTL_MS, stage: "riddle", rid });
  return json({ question: RIDDLES[rid][0], challenge });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const pass = await readToken(req.headers.get("X-Admin-Token") ?? "", "pass");
    if (!pass) return json({ error: "Session expired — log in again" }, 401);

    const { action, challenge, answer } = await req.json();
    if (action === "ask") return ask();

    if (action === "answer") {
      const asked = await readToken(String(challenge || ""), "riddle");
      if (!asked || !RIDDLES[asked.rid]) return json({ error: "That riddle timed out. Try this one instead.", expired: true }, 400);
      if (!isRight(asked.rid, answer)) return json({ error: "Not quite. Have another go." }, 400);
      // Never outlives the password session it came from.
      const exp = Math.min(Date.now() + UNLOCKED_TTL_MS, pass.exp);
      return json(await signClaims({ exp, stage: "unlocked" }));
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: "Server error" }, 500);
  }
});
