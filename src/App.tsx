import { useEffect, useMemo, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import {
  checkHybridAvailability,
  getDeepReview,
  getInstantHint,
  HYBRID_COACHES,
  type ExperienceLevel,
  type HybridAvailability,
  type HybridCoachFacts,
  type HybridCoachResult,
} from './services/hybridAiCoach';
import { firebaseConfigured } from './services/firebase';

const PIECES: Record<string, Record<string, string>> = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function inferenceLabel(result: HybridCoachResult): string {
  if (result.inference === 'on-device') return 'On-device (Gemini Nano)';
  if (result.inference === 'in-cloud') return 'In cloud (Gemini)';
  return 'Local fallback (no model ran)';
}

export default function App() {
  const [fen, setFen] = useState(() => new Chess().fen());
  const [history, setHistory] = useState<string[]>([]);
  const [selected, setSelected] = useState<Square | null>(null);
  const [level, setLevel] = useState<ExperienceLevel>('novice');
  const [coachId, setCoachId] = useState('vespera');
  const [availability, setAvailability] = useState<HybridAvailability | null>(null);
  const [coachResult, setCoachResult] = useState<HybridCoachResult | null>(null);
  const [coachKind, setCoachKind] = useState<'hint' | 'review' | null>(null);
  const [coachBusy, setCoachBusy] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);

  const game = useMemo(() => new Chess(fen), [fen]);
  const legalMoves = useMemo(() => game.moves({ verbose: true }), [game]);
  const isGameOver = game.isGameOver();
  const targets = selected
    ? legalMoves.filter((m) => m.from === selected).map((m) => m.to)
    : [];

  useEffect(() => {
    let cancelled = false;
    checkHybridAvailability().then((a) => {
      if (!cancelled) setAvailability(a);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Demo opponent: plays a random legal move. It is not an engine — it
  // exists only so there is a game for the coach to comment on.
  useEffect(() => {
    if (game.turn() !== 'b' || game.isGameOver()) return;
    const timer = window.setTimeout(() => {
      const replyGame = new Chess(fen);
      const moves = replyGame.moves({ verbose: true });
      if (moves.length === 0) return;
      const pick = moves[Math.floor(Math.random() * moves.length)];
      const moved = replyGame.move({ from: pick.from, to: pick.to, promotion: 'q' });
      setFen(replyGame.fen());
      setHistory((h) => [...h, moved.san]);
      setSelected(null);
    }, 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen]);

  function doMove(from: Square, to: Square) {
    const next = new Chess(fen);
    let moved;
    try {
      moved = next.move({ from, to, promotion: 'q' });
    } catch {
      return;
    }
    setFen(next.fen());
    setHistory((h) => [...h, moved.san]);
    setSelected(null);
  }

  function onSquareClick(square: Square) {
    if (isGameOver || game.turn() !== 'w') return;
    if (selected && targets.includes(square)) {
      doMove(selected, square);
      return;
    }
    const piece = game.get(square);
    if (piece && piece.color === 'w') {
      setSelected(square);
    } else {
      setSelected(null);
    }
  }

  function buildFacts(): HybridCoachFacts {
    let kingSquare: string | undefined;
    for (const row of game.board()) {
      for (const cell of row) {
        if (cell && cell.type === 'k' && cell.color === 'w') kingSquare = cell.square;
      }
    }
    return {
      sanHistory: history,
      // Legal moves from chess.js, not engine-ranked: this demo has no
      // search engine, so the coach comments on legal options, not a
      // best-move evaluation.
      candidateMoves: legalMoves.slice(0, 10).map((m) => ({ san: m.san })),
      inCheck: game.isCheck(),
      kingSquare,
      playerLevel: level,
      coachId,
    };
  }

  async function askCoach(kind: 'hint' | 'review') {
    setCoachBusy(true);
    setCoachKind(kind);
    setCoachError(null);
    try {
      const facts = buildFacts();
      const result =
        kind === 'hint' ? await getInstantHint(facts) : await getDeepReview(facts);
      setCoachResult(result);
    } catch {
      setCoachError('The coach could not answer. Try again.');
    } finally {
      setCoachBusy(false);
    }
  }

  const status = game.isCheckmate()
    ? game.turn() === 'w'
      ? 'Checkmate — Black wins.'
      : 'Checkmate — White wins.'
    : game.isStalemate()
      ? 'Stalemate — draw.'
      : game.isDraw()
        ? 'Draw.'
        : game.isCheck()
          ? `${game.turn() === 'w' ? 'White' : 'Black'} to move — in check.`
          : `${game.turn() === 'w' ? 'White (you)' : 'Black (demo opponent)'} to move.`;

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h1>Hybrid AI Chess Coach</h1>
      <p>
        #BuildHybridAI 2026 — instant hints try on-device Gemini Nano first
        (Firebase AI Logic, PREFER_ON_DEVICE); deep reviews run in the cloud
        (PREFER_IN_CLOUD, gemini-3.1-flash-lite). The label under each answer
        shows which inference actually ran.
      </p>

      <p>
        <strong>Availability:</strong>{' '}
        {availability ? availability.detail : 'Checking…'}
      </p>
      {!firebaseConfigured && (
        <p>
          <strong>Firebase is not configured</strong> — copy{' '}
          <code>.env.example</code> to <code>.env.local</code> and fill in your
          Firebase web config to enable the AI. Until then the coach answers
          with its local deterministic fallback.
        </p>
      )}

      <section aria-label="Demo board">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(8, 1fr)',
            width: 'min(100%, 480px)',
            border: '2px solid #191736',
          }}
        >
          {game.board().flatMap((row, rowIdx) =>
            row.map((cell, colIdx) => {
              const square = `${FILES[colIdx]}${8 - rowIdx}` as Square;
              const isLight = (rowIdx + colIdx) % 2 === 0;
              const isTarget = targets.includes(square);
              return (
                <button
                  key={square}
                  type="button"
                  aria-label={square}
                  onClick={() => onSquareClick(square)}
                  style={{
                    aspectRatio: '1',
                    fontSize: 34,
                    lineHeight: 1,
                    border: 'none',
                    padding: 0,
                    background: selected === square
                      ? '#818cf8'
                      : isTarget
                        ? '#f2bd3c'
                        : isLight
                          ? '#f4f5ff'
                          : '#6366f1',
                    color: cell?.color === 'w' ? '#ffffff' : '#191736',
                    textShadow: '0 1px 2px rgba(0,0,0,0.4)',
                  }}
                >
                  {cell ? PIECES[cell.color][cell.type] : ''}
                </button>
              );
            }),
          )}
        </div>
      </section>

      <p>{status}</p>
      <p>
        You play White. Click one of your pieces, then a highlighted square to
        move. The demo opponent replies with a random legal move — it is not
        an engine.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '16px 0' }}>
        <label>
          Level{' '}
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as ExperienceLevel)}
          >
            <option value="beginner">Beginner</option>
            <option value="novice">Novice</option>
            <option value="intermediate">Intermediate</option>
            <option value="tournament">Tournament</option>
          </select>
        </label>
        <label>
          Coach{' '}
          <select value={coachId} onChange={(e) => setCoachId(e.target.value)}>
            {Object.values(HYBRID_COACHES).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => askCoach('hint')}
          disabled={coachBusy}
        >
          {coachBusy && coachKind === 'hint' ? 'Thinking…' : 'Instant hint'}
        </button>
        <button
          type="button"
          onClick={() => askCoach('review')}
          disabled={coachBusy}
        >
          {coachBusy && coachKind === 'review' ? 'Reviewing…' : 'Deep review'}
        </button>
        <button
          type="button"
          onClick={() => {
            const fresh = new Chess();
            setFen(fresh.fen());
            setHistory([]);
            setSelected(null);
            setCoachResult(null);
            setCoachKind(null);
          }}
        >
          New game
        </button>
      </div>

      {coachError && <p>{coachError}</p>}
      {coachResult && (
        <section
          aria-live="polite"
          style={{ border: '1px solid #6366f1', padding: 16, marginTop: 8 }}
        >
          <p>
            <strong>
              {coachKind === 'review' ? 'Deep review' : 'Instant hint'} —{' '}
              {inferenceLabel(coachResult)}
            </strong>
          </p>
          <p>{coachResult.text}</p>
          <p style={{ fontSize: 14 }}>
            Inference reported by the SDK for this call:{' '}
            {coachResult.inferenceReported ? 'yes' : 'no'}
            {coachResult.inferenceReported
              ? ''
              : ' — the label shows the mode that was requested (or the local fallback).'}{' '}
            Source: {coachResult.source}.
          </p>
        </section>
      )}

      <section>
        <h2>Moves</h2>
        <p>{history.length ? history.join(' ') : 'No moves yet.'}</p>
        <p style={{ fontSize: 14 }}>
          Candidate moves sent to the coach are legal moves from chess.js
          (up to 10) — this demo has no search engine, so they are not
          engine-ranked.
        </p>
      </section>
    </main>
  );
}
