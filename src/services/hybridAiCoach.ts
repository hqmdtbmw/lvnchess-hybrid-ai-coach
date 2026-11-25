// Hybrid AI Coach — #BuildHybridAI 2026 entry (built 11–30 Nov 2026).
//
// Firebase AI Logic, hybrid inference, called at runtime — not just named in
// a README:
//   - Instant hint: PREFER_ON_DEVICE, so Chrome's on-device Gemini Nano
//     answers first (fast, offline-capable) and the cloud only fills in when
//     on-device is unavailable.
//   - Deep review: PREFER_IN_CLOUD, so the cloud Gemini model does the
//     heavier game review.
//
// Safety rule (same house rule as the server coach in /api/coach-ai): the
// model only ever rephrases verified board facts. Every reply is checked by
// validateCoachText() — any square or move not in the supplied facts is
// stripped, and a reply with nothing verifiable left falls back to the local
// deterministic explainMove(). The coach never invents a move, never shows
// a hallucinated square, and never returns empty text.
//
// No secrets here: Firebase AI Logic uses the minimal Firebase config in
// firebase.ts (public web-config keys from .env.local) and App Check,
// enabled in the Firebase console. No API key is embedded in client code
// or env files.

import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, type GenerativeModel } from 'firebase/ai';
import { firebaseApp } from './firebase';

// ---------------------------------------------------------------------------
// Standalone boundary: this file is deliberately self-contained so it can be
// lifted into a separate public repo for the #BuildHybridAI 2026 entry while
// the LvnChess repo stays private. Its only outside dependency is the
// Firebase app instance (firebaseApp from firebase.ts); everything else it
// needs — level policies, coach roster, the deterministic fallback line —
// lives in this file. The game UI keeps using the full versions in
// coachSystem.ts; the small copies below are the extractable standalone
// versions, kept in sync by the hybrid-ai-coach test. When extracting,
// replace the './cloud' import with a minimal Firebase initialisation (see
// firebase.ts in this repo).
// ---------------------------------------------------------------------------

export type ExperienceLevel = 'beginner' | 'novice' | 'intermediate' | 'tournament';
export type CoachId = 'ignis' | 'vespera' | 'malakor' | 'zuri' | 'sovereign' | 'buchi';

export interface HybridLevelPolicy {
  level: ExperienceLevel;
  maxSentences: number;
  maxWords: number;
  toneGuidance: string;
}

export const HYBRID_LEVEL_POLICIES: Record<ExperienceLevel, HybridLevelPolicy> = {
  beginner: {
    level: 'beginner', maxSentences: 1, maxWords: 16,
    toneGuidance: 'Use simple, everyday words. Never use algebraic notation (like Nf3 or e4xd5); name the piece and target square in plain English (e.g. "move your knight to f3"). Focus purely on keeping pieces safe and checking the king.',
  },
  novice: {
    level: 'novice', maxSentences: 2, maxWords: 22,
    toneGuidance: 'Introduce standard chess moves (like Nf3, e4). Teach opening principles: control the center, develop knights and bishops, castle early, and look out for forks.',
  },
  intermediate: {
    level: 'intermediate', maxSentences: 2, maxWords: 24,
    toneGuidance: 'Assume solid tactical awareness. Discuss pins, skewers, piece activity, outposts, and king pressure. Be direct and analytical.',
  },
  tournament: {
    level: 'tournament', maxSentences: 1, maxWords: 20,
    toneGuidance: 'Speak grandmaster-to-grandmaster. Be terse, precise, and concrete. State candidate moves and positional evaluations without basic explanations.',
  },
};

export interface HybridCoachProfile {
  id: CoachId;
  name: string;
  philosophy: string;
}

export const HYBRID_COACHES: Record<CoachId, HybridCoachProfile> = {
  buchi: { id: 'buchi', name: 'Buchi', philosophy: 'Find your least active piece. Give it a square where it helps the others.' },
  ignis: { id: 'ignis', name: 'Brother Ignis', philosophy: 'Every grandmaster was once a beginner. Stand firm in the center, protect your king, and peace will guide your blade.' },
  vespera: { id: 'vespera', name: 'Lady Vespera', philosophy: 'A pinned piece is a paralyzed piece. Strike where their defense is thin and dictate the tempo of every turn.' },
  malakor: { id: 'malakor', name: 'Lord Malakor', philosophy: 'Passion alone cannot overcome discipline. Calculate to depth, build an unbreakable structure, and suffocate your opponent.' },
  zuri: { id: 'zuri', name: 'Master Zuri', philosophy: 'Trust your intuition. Play with lightning speed, calculate sharp forcing lines, and pressure their clock into ruin.' },
  sovereign: { id: 'sovereign', name: 'The Sovereign Engine', philosophy: 'The board is pure geometry and dynamic energy. Balance calculation with aggressive initiative.' },
};

export function resolveHybridCoachId(id?: string): CoachId {
  if (!id) return 'vespera';
  const lower = id.toLowerCase();
  if (lower === 'mateo' || lower === 'ignis') return 'ignis';
  if (lower === 'nora' || lower === 'vespera') return 'vespera';
  if (lower === 'viktor' || lower === 'malakor' || lower === 'beaumont') return 'malakor';
  if (lower === 'zuri') return 'zuri';
  if (lower === 'koda' || lower === 'sovereign') return 'sovereign';
  return (lower in HYBRID_COACHES ? lower : 'vespera') as CoachId;
}

/**
 * Deterministic fallback line for one verified move (standalone copy of the
 * game UI's explainMove in coachSystem.ts). Used when the AI is unavailable
 * or its reply fails validation — it can only describe the move it is given,
 * so it can never invent a square.
 */
export function explainMoveLocal(san: string, yours: boolean): string {
  if (!san) return '';
  const who = yours ? 'You' : 'Your opponent';
  if (san.startsWith('O-O')) {
    const side = san.startsWith('O-O-O') ? 'queenside' : 'kingside';
    return `${who} castled ${side}. Castling moves the king to safety in the corner and activates the rook for battle.`;
  }
  const names: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' };
  const piece = names[san[0]] || 'pawn';
  const to = san.match(/[a-h][1-8](?=[+#?!]*$|=)/)?.[0] || '';
  const isCapture = san.includes('x');
  const isCheck = san.includes('+');
  const isCheckmate = san.includes('#');
  const move = `${who} ${isCapture ? 'captured with' : 'moved'} a ${piece}${to ? ' to ' + to : ''}.`;
  if (isCheckmate) return move + ' That is checkmate: the king is attacked and there is no legal escape.';
  if (isCheck) return move + ' That is check: the king is attacked. The reply must move the king to safety, block the attack, or capture the attacker.';
  if (piece === 'pawn' && (to === 'e4' || to === 'd4' || to === 'e5' || to === 'd5')) {
    return move + ' Controlling central squares with your pawns establishes space for your pieces.';
  }
  if (piece === 'knight') return move + ' Knights jump over pieces and excel in the center of the board.';
  if (piece === 'bishop') return move + ' Developing bishops along open diagonals controls long lines across the arena.';
  if (piece === 'queen') return move + ' Queens are your most powerful piece: command open files and diagonals with caution.';
  if (piece === 'rook') return move + ' Rooks dominate open files and rank attacks.';
  return move;
}

/** Cloud Gemini model used whenever inference runs in the cloud. */
export const HYBRID_CLOUD_MODEL = 'gemini-3.1-flash-lite';

export interface HybridCandidateMove {
  san: string;
  reason?: string;
}

export interface HybridHangingPiece {
  square: string;
  piece: string;
}

/**
 * Verified board facts only. Anything the coach says must be traceable to
 * these — SAN history, engine candidate moves, hanging pieces, check state.
 * There is no free-text board description the model could hallucinate from.
 */
export interface HybridCoachFacts {
  sanHistory: string[];
  candidateMoves: HybridCandidateMove[];
  hangingPlayer?: HybridHangingPiece[];
  hangingOpponent?: HybridHangingPiece[];
  inCheck?: boolean;
  kingSquare?: string;
  playerLevel?: ExperienceLevel;
  coachId?: CoachId | string;
  turningPointSan?: string;
  result?: string;
}

export type HybridInference = 'on-device' | 'in-cloud';

export interface HybridCoachResult {
  text: string;
  /** Which inference actually ran. 'local' means no model ran at all. */
  inference: HybridInference | 'local';
  /** True only when the SDK reported the inference source for this call. */
  inferenceReported: boolean;
  source: 'hybrid-ai' | 'local-fallback';
  coachId: string;
}

export interface HybridAvailability {
  supported: boolean;
  onDevice: boolean;
  detail: string;
}

export const stripHybridSan = (san: string): string => String(san || '').replace(/[+#!?]/g, '').trim();

const sanDestination = (san: string): string => {
  const match = stripHybridSan(san).match(/([a-h][1-8])(=[QRBN])?$/);
  return match ? match[1] : '';
};

/** Every square the coach is allowed to name: candidate destinations, hanging pieces, the king, and squares from moves already played. */
export function allowedSquares(facts: HybridCoachFacts): Set<string> {
  const squares = new Set<string>();
  for (const move of facts.candidateMoves || []) {
    const dest = sanDestination(move.san);
    if (dest) squares.add(dest);
  }
  for (const piece of [...(facts.hangingPlayer || []), ...(facts.hangingOpponent || [])]) {
    if (/^[a-h][1-8]$/.test(piece.square)) squares.add(piece.square);
  }
  if (facts.kingSquare && /^[a-h][1-8]$/.test(facts.kingSquare)) squares.add(facts.kingSquare);
  for (const san of facts.sanHistory || []) {
    const dest = sanDestination(san);
    if (dest) squares.add(dest);
  }
  return squares;
}

/** Every SAN the coach is allowed to name: candidate moves and moves already played. */
export function allowedSans(facts: HybridCoachFacts): Set<string> {
  const sans = new Set<string>();
  for (const move of facts.candidateMoves || []) {
    const clean = stripHybridSan(move.san);
    if (clean) sans.add(clean);
  }
  for (const san of facts.sanHistory || []) {
    const clean = stripHybridSan(san);
    if (clean) sans.add(clean);
  }
  return sans;
}

function coachName(facts: HybridCoachFacts): string {
  const id = resolveHybridCoachId(facts.coachId);
  return HYBRID_COACHES[id]?.name || 'Your coach';
}

function factsBlock(facts: HybridCoachFacts): string {
  const lines: string[] = [];
  lines.push(`Moves played so far: ${facts.sanHistory.length ? facts.sanHistory.join(', ') : 'none yet'}.`);
  lines.push(
    `Candidate moves from the engine: ${
      facts.candidateMoves.length
        ? facts.candidateMoves.map((m) => (m.reason ? `${m.san} (${m.reason})` : m.san)).join(', ')
        : 'none'
    }.`
  );
  if (facts.hangingPlayer?.length) {
    lines.push(`Your undefended pieces: ${facts.hangingPlayer.map((p) => `${p.piece} on ${p.square}`).join(', ')}.`);
  }
  if (facts.hangingOpponent?.length) {
    lines.push(`Opponent undefended pieces: ${facts.hangingOpponent.map((p) => `${p.piece} on ${p.square}`).join(', ')}.`);
  }
  if (facts.inCheck) lines.push('Your king is in check.');
  if (facts.turningPointSan) lines.push(`Turning point of the game: ${facts.turningPointSan}.`);
  if (facts.result) lines.push(`Result: ${facts.result}.`);
  return lines.join('\n');
}

function promptRules(facts: HybridCoachFacts): string {
  const policy = HYBRID_LEVEL_POLICIES[facts.playerLevel || 'novice'];
  return [
    `Speak as ${coachName(facts)} to a ${policy.level} player. ${policy.toneGuidance}`,
    'Only name squares and moves that appear in the verified facts below.',
    'Never invent a move, a square, a capture, or a threat that is not listed.',
    'If the facts do not support a point, leave it out instead of guessing.',
    `Keep it to at most ${policy.maxSentences} sentence(s) and about ${policy.maxWords} words.`,
  ].join('\n');
}

/** Prompt for the fast on-device hint: one concrete next idea, from the facts. */
export function buildHintPrompt(facts: HybridCoachFacts): string {
  return [
    'You are a chess coach giving a fast hint during a game review.',
    promptRules(facts),
    'Give one concrete idea: the best candidate move and why it helps, or what to defend first.',
    '',
    'Verified board facts:',
    factsBlock(facts),
  ].join('\n');
}

/** Prompt for the deeper cloud review: turning point, one lesson, best move. */
export function buildReviewPrompt(facts: HybridCoachFacts): string {
  return [
    'You are a chess coach reviewing a finished game.',
    promptRules(facts),
    'Cover three things, briefly: the turning point, one lesson to take away, and why the best candidate move works.',
    '',
    'Verified board facts:',
    factsBlock(facts),
  ].join('\n');
}

// SAN-shaped tokens a reply might contain: castling, piece moves/captures,
// pawn captures and pawn moves/promotions, with optional check/mate marks.
const SAN_TOKEN = /\b(?:O-O(?:-O)?|[KQRBN][a-h1-8]?x?[a-h][1-8](?:=[QRBN])?|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8](?:=[QRBN])?)[+#?!]*\b/g;
const SQUARE_TOKEN = /\b[a-h][1-8]\b/g;

function splitSentences(text: string): string[] {
  return String(text || '').match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [];
}

/**
 * Enforce the house rule on a model reply: drop every sentence naming a
 * square or a move that is not in the verified facts. Returns ok=false when
 * nothing verifiable survives, so the caller falls back to the local coach.
 */
export function validateCoachText(
  text: string,
  facts: HybridCoachFacts
): { ok: boolean; text: string; dropped: number } {
  const squares = allowedSquares(facts);
  const sans = allowedSans(facts);
  const policy = HYBRID_LEVEL_POLICIES[facts.playerLevel || 'novice'];
  const kept: string[] = [];
  let dropped = 0;
  for (const sentence of splitSentences(text)) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    let clean = true;
    for (const match of trimmed.matchAll(SQUARE_TOKEN)) {
      if (!squares.has(match[0])) {
        clean = false;
        break;
      }
    }
    if (clean) {
      for (const match of trimmed.matchAll(SAN_TOKEN)) {
        const token = stripHybridSan(match[0]);
        // A bare square (e.g. "f3") is covered by the square check above.
        if (/^[a-h][1-8]$/.test(token)) continue;
        if (!sans.has(token)) {
          clean = false;
          break;
        }
      }
    }
    if (clean) kept.push(trimmed);
    else dropped += 1;
  }
  const limited = kept.slice(0, Math.max(1, policy.maxSentences)).join(' ');
  return { ok: limited.length > 0, text: limited, dropped };
}

// One Firebase AI instance for the whole session, on the minimal Firebase
// app initialised in firebase.ts. No second app, no second config, no key
// in client code.
let aiInstance: ReturnType<typeof getAI> | null = null;

export function getHybridAi(): ReturnType<typeof getAI> | null {
  if (!firebaseApp) return null;
  if (!aiInstance) aiInstance = getAI(firebaseApp, { backend: new GoogleAIBackend() });
  return aiInstance;
}

let hintModel: GenerativeModel | null = null;
let reviewModel: GenerativeModel | null = null;

function getHintModel(ai: ReturnType<typeof getAI>): GenerativeModel {
  if (!hintModel) {
    hintModel = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams: { model: HYBRID_CLOUD_MODEL },
    });
  }
  return hintModel;
}

function getReviewModel(ai: ReturnType<typeof getAI>): GenerativeModel {
  if (!reviewModel) {
    reviewModel = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_IN_CLOUD,
      inCloudParams: { model: HYBRID_CLOUD_MODEL },
    });
  }
  return reviewModel;
}

function readInference(
  response: { inferenceSource?: string },
  requested: HybridInference
): { inference: HybridInference; reported: boolean } {
  const source = String(response.inferenceSource || '');
  if (source === 'on-device') return { inference: 'on-device', reported: true };
  if (source === 'in-cloud') return { inference: 'in-cloud', reported: true };
  // The SDK did not report the source for this call: say so, and report the
  // mode that was requested rather than claiming a run we cannot prove.
  return { inference: requested, reported: false };
}

async function runModel(
  model: GenerativeModel,
  prompt: string,
  requested: HybridInference
): Promise<{ text: string; inference: HybridInference; reported: boolean }> {
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const { inference, reported } = readInference(result.response, requested);
  return { text, inference, reported };
}

/** Local deterministic fallback: the existing coach line for the best known move. Never empty, never invented. */
function localFallback(facts: HybridCoachFacts): HybridCoachResult {
  const best = facts.candidateMoves[0]?.san || facts.sanHistory[facts.sanHistory.length - 1] || '';
  const text = best
    ? explainMoveLocal(best, true)
    : 'Keep your pieces defended and look for the move that improves your least active piece.';
  return {
    text,
    inference: 'local',
    inferenceReported: false,
    source: 'local-fallback',
    coachId: resolveHybridCoachId(facts.coachId),
  };
}

async function runHybrid(
  facts: HybridCoachFacts,
  kind: 'hint' | 'review'
): Promise<HybridCoachResult> {
  const ai = getHybridAi();
  if (!ai) return localFallback(facts);
  try {
    const model = kind === 'hint' ? getHintModel(ai) : getReviewModel(ai);
    const prompt = kind === 'hint' ? buildHintPrompt(facts) : buildReviewPrompt(facts);
    const { text, inference, reported } = await runModel(model, prompt, kind === 'hint' ? 'on-device' : 'in-cloud');
    const checked = validateCoachText(text, facts);
    if (!checked.ok) return localFallback(facts);
    return {
      text: checked.text,
      inference,
      inferenceReported: reported,
      source: 'hybrid-ai',
      coachId: resolveHybridCoachId(facts.coachId),
    };
  } catch {
    // Any AI failure — offline, no on-device model, quota, App Check — falls
    // back to the local coach instead of showing an error or an invented line.
    return localFallback(facts);
  }
}

/** Fast hint, on-device first (Gemini Nano) with cloud fallback. */
export function getInstantHint(facts: HybridCoachFacts): Promise<HybridCoachResult> {
  return runHybrid(facts, 'hint');
}

/** Deeper game review, in the cloud (Gemini). */
export function getDeepReview(facts: HybridCoachFacts): Promise<HybridCoachResult> {
  return runHybrid(facts, 'review');
}

/**
 * Best-effort check for on-device availability (Chrome desktop 139+,
 * Gemini Nano via the Prompt API). Returns supported=false outside a
 * browser or without Firebase configured; never throws.
 */
export async function checkHybridAvailability(): Promise<HybridAvailability> {
  if (typeof window === 'undefined') {
    return { supported: false, onDevice: false, detail: 'Hybrid AI runs in the browser.' };
  }
  if (!firebaseApp) {
    return { supported: false, onDevice: false, detail: 'Online services are not configured yet.' };
  }
  const scope = window as unknown as {
    LanguageModel?: { availability?: () => Promise<string> };
    ai?: { languageModel?: { availability?: () => Promise<string> } };
  };
  try {
    const languageModel = scope.LanguageModel ?? scope.ai?.languageModel;
    if (languageModel?.availability) {
      const state = await languageModel.availability();
      return {
        supported: true,
        onDevice: state === 'available' || state === 'downloadable' || state === 'downloading',
        detail: `Gemini Nano on-device model: ${state}.`,
      };
    }
  } catch {
    // Availability could not be probed; the hint call still tries on-device
    // first and falls back to the cloud or the local coach.
  }
  return {
    supported: true,
    onDevice: false,
    detail: 'On-device status could not be checked in this browser. Hints try on-device first and use the cloud when it is unavailable.',
  };
}
