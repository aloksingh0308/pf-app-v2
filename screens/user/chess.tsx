import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import { useInterstitialAd } from '@/hooks/useInterstitialAd';
import Ionicons from '@react-native-vector-icons/ionicons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

type Color = 'w' | 'b';
type PType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
type Piece = { t: PType; c: Color };
type Square = Piece | null;
type Castling = { wK: boolean; wQ: boolean; bK: boolean; bQ: boolean };
type Move = { from: number; to: number; promo?: PType; ep?: boolean; castle?: 'K' | 'Q' };
type GameState = {
  board: Square[];
  turn: Color;
  castling: Castling;
  ep: number | null;
  lastMove: Move | null;
};
type Mode = 'ai' | 'two';
type Level = 1 | 2 | 3;

// Board index = row * 8 + col; row 0 is rank 8 (black's back rank).
const sq = (r: number, c: number) => r * 8 + c;
const onBoard = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
const enemy = (c: Color): Color => (c === 'w' ? 'b' : 'w');

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const PROMOS: PType[] = ['q', 'r', 'b', 'n'];

const initialState = (): GameState => {
  const back: PType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  const board: Square[] = Array(64).fill(null);
  for (let c = 0; c < 8; c++) {
    board[sq(0, c)] = { t: back[c], c: 'b' };
    board[sq(1, c)] = { t: 'p', c: 'b' };
    board[sq(6, c)] = { t: 'p', c: 'w' };
    board[sq(7, c)] = { t: back[c], c: 'w' };
  }
  return { board, turn: 'w', castling: { wK: true, wQ: true, bK: true, bQ: true }, ep: null, lastMove: null };
};

const isAttacked = (board: Square[], target: number, by: Color): boolean => {
  const r = target >> 3;
  const c = target & 7;
  const pawnRow = by === 'w' ? r + 1 : r - 1;
  for (const dc of [-1, 1]) {
    if (onBoard(pawnRow, c + dc)) {
      const p = board[sq(pawnRow, c + dc)];
      if (p && p.c === by && p.t === 'p') return true;
    }
  }
  for (const [dr, dc] of KNIGHT) {
    if (!onBoard(r + dr, c + dc)) continue;
    const p = board[sq(r + dr, c + dc)];
    if (p && p.c === by && p.t === 'n') return true;
  }
  for (const [dr, dc] of KING) {
    if (!onBoard(r + dr, c + dc)) continue;
    const p = board[sq(r + dr, c + dc)];
    if (p && p.c === by && p.t === 'k') return true;
  }
  const rays = (dirs: number[][], types: PType[]) => {
    for (const [dr, dc] of dirs) {
      let rr = r + dr;
      let cc = c + dc;
      while (onBoard(rr, cc)) {
        const p = board[sq(rr, cc)];
        if (p) {
          if (p.c === by && types.includes(p.t)) return true;
          break;
        }
        rr += dr;
        cc += dc;
      }
    }
    return false;
  };
  return rays(ROOK_DIRS, ['r', 'q']) || rays(BISHOP_DIRS, ['b', 'q']);
};

const findKing = (board: Square[], color: Color) =>
  board.findIndex((p) => p?.t === 'k' && p.c === color);

const inCheck = (s: GameState, color: Color = s.turn) =>
  isAttacked(s.board, findKing(s.board, color), enemy(color));

const pseudoMoves = (s: GameState): Move[] => {
  const { board, turn } = s;
  const moves: Move[] = [];
  const pushPawn = (from: number, to: number, extra: Partial<Move> = {}) => {
    const row = to >> 3;
    if (row === 0 || row === 7) PROMOS.forEach((promo) => moves.push({ from, to, promo }));
    else moves.push({ from, to, ...extra });
  };

  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p || p.c !== turn) continue;
    const r = i >> 3;
    const c = i & 7;

    if (p.t === 'p') {
      const dir = turn === 'w' ? -1 : 1;
      const startRow = turn === 'w' ? 6 : 1;
      if (onBoard(r + dir, c) && !board[sq(r + dir, c)]) {
        pushPawn(i, sq(r + dir, c));
        if (r === startRow && !board[sq(r + 2 * dir, c)]) moves.push({ from: i, to: sq(r + 2 * dir, c) });
      }
      for (const dc of [-1, 1]) {
        if (!onBoard(r + dir, c + dc)) continue;
        const to = sq(r + dir, c + dc);
        const t = board[to];
        if (t && t.c !== turn) pushPawn(i, to);
        else if (to === s.ep) moves.push({ from: i, to, ep: true });
      }
      continue;
    }

    if (p.t === 'n' || p.t === 'k') {
      for (const [dr, dc] of p.t === 'n' ? KNIGHT : KING) {
        if (!onBoard(r + dr, c + dc)) continue;
        const t = board[sq(r + dr, c + dc)];
        if (!t || t.c !== turn) moves.push({ from: i, to: sq(r + dr, c + dc) });
      }
      continue;
    }

    const dirs = p.t === 'r' ? ROOK_DIRS : p.t === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
    for (const [dr, dc] of dirs) {
      let rr = r + dr;
      let cc = c + dc;
      while (onBoard(rr, cc)) {
        const t = board[sq(rr, cc)];
        if (t && t.c === turn) break;
        moves.push({ from: i, to: sq(rr, cc) });
        if (t) break;
        rr += dr;
        cc += dc;
      }
    }
  }
  return moves;
};

const applyMove = (s: GameState, m: Move): GameState => {
  const board = s.board.slice();
  const piece = board[m.from]!;
  const castling = { ...s.castling };
  const fromRow = m.from >> 3;

  board[m.to] = m.promo ? { t: m.promo, c: piece.c } : piece;
  board[m.from] = null;
  if (m.ep) board[sq(fromRow, m.to & 7)] = null;
  if (m.castle === 'K') {
    board[sq(fromRow, 5)] = board[sq(fromRow, 7)];
    board[sq(fromRow, 7)] = null;
  } else if (m.castle === 'Q') {
    board[sq(fromRow, 3)] = board[sq(fromRow, 0)];
    board[sq(fromRow, 0)] = null;
  }

  if (piece.t === 'k') {
    if (piece.c === 'w') castling.wK = castling.wQ = false;
    else castling.bK = castling.bQ = false;
  }
  // A rook leaving or being captured on its corner kills that side's castling.
  for (const corner of [m.from, m.to]) {
    if (corner === 63) castling.wK = false;
    if (corner === 56) castling.wQ = false;
    if (corner === 7) castling.bK = false;
    if (corner === 0) castling.bQ = false;
  }

  const ep = piece.t === 'p' && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : null;
  return { board, turn: enemy(s.turn), castling, ep, lastMove: m };
};

const legalMoves = (s: GameState): Move[] => {
  const legal = pseudoMoves(s).filter((m) => !inCheck(applyMove(s, m), s.turn));

  const row = s.turn === 'w' ? 7 : 0;
  const kingSq = sq(row, 4);
  const king = s.board[kingSq];
  if (king?.t === 'k' && king.c === s.turn && !inCheck(s)) {
    const opp = enemy(s.turn);
    const free = (...cols: number[]) => cols.every((c) => !s.board[sq(row, c)]);
    const safe = (...cols: number[]) => cols.every((c) => !isAttacked(s.board, sq(row, c), opp));
    const canK = s.turn === 'w' ? s.castling.wK : s.castling.bK;
    const canQ = s.turn === 'w' ? s.castling.wQ : s.castling.bQ;
    if (canK && free(5, 6) && safe(5, 6)) legal.push({ from: kingSq, to: sq(row, 6), castle: 'K' });
    if (canQ && free(1, 2, 3) && safe(2, 3)) legal.push({ from: kingSq, to: sq(row, 2), castle: 'Q' });
  }
  return legal;
};

const insufficientMaterial = (board: Square[]) => {
  const rest = board.filter((p): p is Piece => !!p && p.t !== 'k');
  return rest.length === 0 || (rest.length === 1 && (rest[0].t === 'n' || rest[0].t === 'b'));
};

/* ---------- AI: alpha-beta over material + simple positional terms ---------- */

const VALUE: Record<PType, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100000;

const evaluate = (board: Square[]): number => {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p) continue;
    const r = i >> 3;
    const c = i & 7;
    const center = 7 - (Math.abs(3.5 - r) + Math.abs(3.5 - c));
    let v = VALUE[p.t];
    if (p.t === 'n' || p.t === 'b') v += center * 4;
    if (p.t === 'p') v += (p.c === 'w' ? 6 - r : r - 1) * 6 + (c >= 2 && c <= 5 ? center * 2 : 0);
    if (p.t === 'q') v += center;
    score += p.c === 'w' ? v : -v;
  }
  return score;
};

const orderMoves = (s: GameState, moves: Move[]) =>
  moves
    .map((m) => ({ m, k: (s.board[m.to] ? VALUE[s.board[m.to]!.t] * 10 - VALUE[s.board[m.from]!.t] : 0) + (m.promo === 'q' ? 800 : 0) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.m);

const negamax = (s: GameState, depth: number, alpha: number, beta: number, ply: number): number => {
  // Leaves skip move generation (and so mate detection) to keep Hard responsive on phones.
  if (depth === 0) return (s.turn === 'w' ? 1 : -1) * evaluate(s.board);
  const moves = legalMoves(s);
  if (moves.length === 0) return inCheck(s) ? -MATE + ply : 0;
  let best = -Infinity;
  for (const m of orderMoves(s, moves)) {
    const score = -negamax(applyMove(s, m), depth - 1, -beta, -alpha, ply + 1);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
};

const pickAiMove = (s: GameState, level: Level): Move | null => {
  const moves = orderMoves(s, legalMoves(s));
  if (moves.length === 0) return null;
  let bestScore = -Infinity;
  let best: Move[] = [];
  for (const m of moves) {
    // Easy adds noise so it blunders now and then.
    const noise = level === 1 ? Math.random() * 120 : 0;
    const score = -negamax(applyMove(s, m), level - 1, -Infinity, Infinity, 1) + noise;
    if (score > bestScore + 0.5) {
      bestScore = score;
      best = [m];
    } else if (Math.abs(score - bestScore) <= 0.5) {
      best.push(m);
    }
  }
  return best[Math.floor(Math.random() * best.length)];
};

/* ------------------------------------------------------------------ */
/* 3D pieces                                                           */
/* ------------------------------------------------------------------ */

const PALETTE = {
  w: { shade: ['#bfae8c', '#fffdf6', '#efe4cc', '#9c8a66'], stroke: '#6e5c3e', detail: '#8b7754' },
  b: { shade: ['#2a2a2e', '#77777f', '#323238', '#050506'], stroke: '#000', detail: '#9a9aa3' },
};

/** Cylinder-shaded SVG piece: a horizontal gradient (rim light → highlight → body → shadow) fakes the turned-wood look. */
function ChessPiece({ piece, size }: { piece: Piece; size: number | string }) {
  const pal = PALETTE[piece.c];
  const id = `g${piece.c}`;
  const fill = `url(#${id})`;
  const common = { fill, stroke: pal.stroke, strokeWidth: 1.6, strokeLinejoin: 'round' as const };

  const base = (
    <G>
      <Path d="M20 89 Q20 81 28 79 L72 79 Q80 81 80 89 Z" {...common} />
      <Ellipse cx={50} cy={79} rx={22} ry={3.6} {...common} />
    </G>
  );

  let body: React.ReactNode = null;
  switch (piece.t) {
    case 'p':
      body = (
        <G>
          <Path d="M34 79 Q38 64 44 55 L56 55 Q62 64 66 79 Z" {...common} />
          <Ellipse cx={50} cy={55} rx={13} ry={3.6} {...common} />
          <Circle cx={50} cy={40} r={13} {...common} />
        </G>
      );
      break;
    case 'r':
      body = (
        <G>
          <Path d="M33 79 L36 42 L64 42 L67 79 Z" {...common} />
          <Ellipse cx={50} cy={42} rx={19} ry={3.4} {...common} />
          <Path d="M29 42 L29 20 L38 20 L38 27 L45.5 27 L45.5 20 L54.5 20 L54.5 27 L62 27 L62 20 L71 20 L71 42 Z" {...common} />
          <Path d="M37 52 L63 52 M36 64 L64 64" stroke={pal.detail} strokeWidth={1.4} opacity={0.6} />
        </G>
      );
      break;
    case 'n':
      body = (
        <G>
          <Path
            d="M34 79 Q32 62 42 52 Q34 54 27 52 Q19 48 22 40 L37 27 Q39 18 46 15 L49 7 L54 15 Q67 19 71 38 Q75 60 68 79 Z"
            {...common}
          />
          <Circle cx={43} cy={29} r={2.4} fill={piece.c === 'w' ? '#3b2f1e' : '#d8d8de'} />
          <Path d="M54 16 Q66 26 66 46" stroke={pal.detail} strokeWidth={1.6} fill="none" opacity={0.7} />
          <Path d="M25 45 Q28 47 31 45" stroke={pal.stroke} strokeWidth={1.3} fill="none" />
        </G>
      );
      break;
    case 'b':
      body = (
        <G>
          <Path d="M36 79 Q42 66 44 57 L56 57 Q58 66 64 79 Z" {...common} />
          <Ellipse cx={50} cy={57} rx={14} ry={3.6} {...common} />
          <Path d="M50 17 Q67 33 61 51 Q50 57 39 51 Q33 33 50 17 Z" {...common} />
          <Path d="M55 29 L46 40" stroke={pal.stroke} strokeWidth={2.2} strokeLinecap="round" />
          <Circle cx={50} cy={13} r={4.5} {...common} />
        </G>
      );
      break;
    case 'q':
      body = (
        <G>
          <Path d="M34 79 Q40 62 42 51 L58 51 Q60 62 66 79 Z" {...common} />
          <Ellipse cx={50} cy={51} rx={17} ry={3.6} {...common} />
          <Path d="M28 22 L36 47 L64 47 L72 22 L60 35 L50 15 L40 35 Z" {...common} />
          {[[28, 21], [50, 13], [72, 21], [40, 33], [60, 33]].map(([x, y]) => (
            <Circle key={`${x}-${y}`} cx={x} cy={y} r={4.2} {...common} />
          ))}
        </G>
      );
      break;
    case 'k':
      body = (
        <G>
          <Path d="M34 79 Q40 62 42 51 L58 51 Q60 62 66 79 Z" {...common} />
          <Ellipse cx={50} cy={51} rx={17} ry={3.6} {...common} />
          <Path d="M33 47 Q27 31 38 28 Q48 26 50 36 Q52 26 62 28 Q73 31 67 47 Z" {...common} />
          <Rect x={46.5} y={6} width={7} height={24} rx={1.5} {...common} />
          <Rect x={40} y={12} width={20} height={6.5} rx={1.5} {...common} />
        </G>
      );
      break;
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={pal.shade[0]} />
          <Stop offset="0.3" stopColor={pal.shade[1]} />
          <Stop offset="0.62" stopColor={pal.shade[2]} />
          <Stop offset="1" stopColor={pal.shade[3]} />
        </LinearGradient>
      </Defs>
      <Ellipse cx={53} cy={91} rx={31} ry={5} fill="#000" opacity={0.32} />
      {base}
      {body}
    </Svg>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

const FILES = 'abcdefgh';
const START_COUNT: Record<PType, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };

const capturedBy = (board: Square[], victim: Color): Piece[] => {
  const left: Record<string, number> = {};
  board.forEach((p) => { if (p && p.c === victim) left[p.t] = (left[p.t] || 0) + 1; });
  const out: Piece[] = [];
  (['q', 'r', 'b', 'n', 'p'] as PType[]).forEach((t) => {
    for (let i = 0; i < Math.max(0, START_COUNT[t] - (left[t] || 0)); i++) out.push({ t, c: victim });
  });
  return out;
};

export default function ChessScreen() {
  const { width } = useWindowDimensions();
  const [mode, setMode] = useState<Mode>('ai');
  const [level, setLevel] = useState<Level>(2);
  const [state, setState] = useState<GameState>(initialState);
  const [history, setHistory] = useState<GameState[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [promotion, setPromotion] = useState<Move[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const aiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const moves = useMemo(() => legalMoves(state), [state]);
  const checked = useMemo(() => inCheck(state), [state]);
  const outcome = useMemo(() => {
    if (moves.length === 0) return checked ? 'mate' : 'stalemate';
    if (insufficientMaterial(state.board)) return 'insufficient';
    return null;
  }, [moves, checked, state.board]);
  const targets = useMemo(
    () => (selected === null ? [] : moves.filter((m) => m.from === selected).map((m) => m.to)),
    [moves, selected],
  );
  const kingSq = checked ? findKing(state.board, state.turn) : -1;
  const aiTurn = mode === 'ai' && state.turn === 'b';

  // Whole-pixel squares so 8 always fit per row (fractional widths wrapped on Android).
  const FRAME = 20;
  const INSET = 3;
  const cell = Math.floor((Math.min(width - 32, 520) - 2 * (FRAME + INSET)) / 8);
  const boardSize = cell * 8;

  useEffect(() => {
    if (!aiTurn || outcome) return;
    setThinking(true);
    aiTimer.current = setTimeout(() => {
      const m = pickAiMove(state, level);
      if (m) setState((prev) => applyMove(prev, m));
      setThinking(false);
    }, 350);
    return () => {
      if (aiTimer.current) clearTimeout(aiTimer.current);
    };
  }, [aiTurn, outcome, state, level]);

  const commit = (m: Move) => {
    setHistory((h) => [...h, state]);
    setState(applyMove(state, m));
    setSelected(null);
    setPromotion(null);
  };

  const onSquare = (i: number) => {
    if (outcome || aiTurn || thinking) return;
    if (selected !== null) {
      const options = moves.filter((m) => m.from === selected && m.to === i);
      if (options.length > 1) return setPromotion(options);
      if (options.length === 1) return commit(options[0]);
    }
    const p = state.board[i];
    setSelected(p && p.c === state.turn && selected !== i ? i : null);
  };

  const showAdThen = useInterstitialAd();

  const newGame = (nextMode: Mode = mode) => {
    if (aiTimer.current) clearTimeout(aiTimer.current);
    setMode(nextMode);
    setState(initialState());
    setHistory([]);
    setSelected(null);
    setPromotion(null);
    setThinking(false);
  };

  const undo = () => {
    if (!history.length || thinking) return;
    // Only player moves are pushed to history, so vs Computer this also drops the reply.
    setState(history[history.length - 1]);
    setHistory(history.slice(0, -1));
    setSelected(null);
  };

  const sideName = (c: Color) => (mode === 'ai' ? (c === 'w' ? 'You' : 'CPU') : c === 'w' ? 'White' : 'Black');
  const winner: Color | null = outcome === 'mate' ? enemy(state.turn) : null;
  const resultTitle = outcome === 'mate'
    ? mode === 'ai' ? (winner === 'w' ? 'You win! 🎉' : 'Computer wins') : `${sideName(winner!)} wins!`
    : 'Draw';
  const resultSub = outcome === 'mate' ? 'Checkmate' : outcome === 'stalemate' ? 'Stalemate' : 'Insufficient material';

  /** Compact square tile per side; the border colour carries turn / check / win state. */
  const PlayerTile = ({ color, align }: { color: Color; align: 'left' | 'right' }) => {
    const active = !outcome && state.turn === color;
    const borderColor = winner === color ? '#22c55e' : active ? (checked ? '#ef4444' : '#f68712') : '#e2e5ee';
    const taken = capturedBy(state.board, enemy(color));
    const isCpu = mode === 'ai' && color === 'b';
    return (
      <View style={[styles.playerHalf, align === 'left' && { flexDirection: 'row-reverse' }]}>
        <View style={[styles.tile, color === 'w' ? styles.tileW : styles.tileB, { borderColor }]}>
          <Ionicons name={isCpu ? 'hardware-chip-outline' : 'person'} size={22} color={color === 'w' ? '#5b4a2e' : '#f1f1f4'} />
          <Text style={[styles.tileName, { color: color === 'w' ? '#5b4a2e' : '#d6d6dc' }]} numberOfLines={1}>
            {isCpu && thinking ? '···' : sideName(color)}
          </Text>
        </View>
        <View style={[styles.captured, align === 'left' && { justifyContent: 'flex-end' }]}>
          {taken.map((p, idx) => (
            <View key={idx} style={{ marginHorizontal: -3 }}>
              <ChessPiece piece={p} size={18} />
            </View>
          ))}
        </View>
      </View>
    );
  };

  return (
    <PageScreen style={styles.page}>
      <PageHeader title="Chess" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.segment}>
          {(['ai', 'two'] as Mode[]).map((m) => (
            <Pressable key={m} onPress={() => newGame(m)} style={[styles.segmentBtn, mode === m && styles.segmentBtnActive]}>
              <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
                {m === 'ai' ? 'vs Computer' : '2 Player'}
              </Text>
            </Pressable>
          ))}
        </View>

        {mode === 'ai' ? (
          <View style={styles.levelRow}>
            {([1, 2, 3] as Level[]).map((l) => (
              <Pressable key={l} onPress={() => setLevel(l)} style={[styles.levelChip, level === l && styles.levelChipActive]}>
                <Text style={[styles.levelText, level === l && styles.levelTextActive]}>
                  {l === 1 ? 'Easy' : l === 2 ? 'Medium' : 'Hard'}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Board + players fill the space between the controls and the buttons, centred vertically. */}
        <View style={styles.stage}>
        {/* Raised wooden board: darker plinth under the frame gives it thickness. */}
        <View style={styles.plinth}>
          <View style={styles.frame}>
            <View style={styles.inset}>
            <View style={{ width: boardSize, height: boardSize }}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((r) => (
                <View key={r} style={styles.boardRow}>
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((c) => {
                    const i = sq(r, c);
                    const p = state.board[i];
                    const light = (r + c) % 2 === 0;
                    const isLast = state.lastMove && (state.lastMove.from === i || state.lastMove.to === i);
                    const isTarget = targets.includes(i);
                    const isSel = selected === i;
                    return (
                      <Pressable
                        key={i}
                        onPress={() => onSquare(i)}
                        accessibilityLabel={`${FILES[c]}${8 - r}${p ? ` ${p.c === 'w' ? 'white' : 'black'} ${p.t}` : ''}`}
                        style={[
                          { width: cell, height: cell, backgroundColor: light ? '#f0d9b5' : '#b07d4f' },
                          isLast && { backgroundColor: light ? '#f3e48c' : '#cdae4a' },
                          isSel && { backgroundColor: light ? '#a8dc8f' : '#76b65c' },
                        ]}
                      >
                        {i === kingSq ? <View style={[styles.checkGlow, { borderRadius: cell / 2 }]} /> : null}
                        {p ? (
                          <View style={[styles.pieceWrap, isSel && styles.pieceLifted]} pointerEvents="none">
                            <ChessPiece piece={p} size={cell * 0.92} />
                          </View>
                        ) : null}
                        {isTarget ? (
                          p ? <View style={[styles.captureRing, { borderRadius: cell / 2 }]} pointerEvents="none" />
                            : <View style={[styles.moveDot, { left: cell * 0.35, top: cell * 0.35, width: cell * 0.3, height: cell * 0.3, borderRadius: cell * 0.15 }]} pointerEvents="none" />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
              {/* Soft top-left light + varnish sheen over the squares. */}
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <Svg width={boardSize} height={boardSize}>
                <Defs>
                  <LinearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0" stopColor="#fff" stopOpacity={0.22} />
                    <Stop offset="0.45" stopColor="#fff" stopOpacity={0.04} />
                    <Stop offset="1" stopColor="#000" stopOpacity={0.16} />
                  </LinearGradient>
                </Defs>
                <Rect x={0} y={0} width={boardSize} height={boardSize} fill="url(#sheen)" />
              </Svg>
              </View>
              {outcome ? (
                <View style={styles.resultOverlay}>
                  <View style={styles.resultCard}>
                    <Text style={styles.resultTitle}>{resultTitle}</Text>
                    <Text style={styles.resultSub}>{resultSub}</Text>
                    <Pressable onPress={() => showAdThen(() => newGame())} style={styles.resultBtn}>
                      <Text style={styles.primaryText}>Play Again</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
            </View>
            {/* Coordinates engraved into the frame. */}
            {[0, 1, 2, 3, 4, 5, 6, 7].map((r) => (
              <Text key={`r${r}`} style={[styles.frameCoord, { left: 0, width: FRAME, top: FRAME + INSET + r * cell + cell / 2 - 7 }]}>{8 - r}</Text>
            ))}
            {[0, 1, 2, 3, 4, 5, 6, 7].map((c) => (
              <Text key={`f${c}`} style={[styles.frameCoord, { bottom: 2, left: FRAME + INSET + c * cell, width: cell }]}>{FILES[c]}</Text>
            ))}
          </View>
        </View>

        <View style={styles.playersRow}>
          <PlayerTile color="w" align="left" />
          <Text style={styles.vs}>VS</Text>
          <PlayerTile color="b" align="right" />
        </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={undo}
            disabled={!history.length || thinking}
            style={[styles.secondaryBtn, (!history.length || thinking) && { opacity: 0.5 }]}
          >
            <Text style={styles.secondaryText}>Undo</Text>
          </Pressable>
          <Pressable onPress={() => showAdThen(() => newGame())} style={styles.primaryBtn}>
            <Text style={styles.primaryText}>New Game</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal visible={!!promotion} transparent animationType="fade" onRequestClose={() => setPromotion(null)}>
        <Pressable style={styles.overlay} onPress={() => setPromotion(null)}>
          <View style={styles.promoCard}>
            <Text style={styles.promoTitle}>Promote pawn to</Text>
            <View style={styles.promoRow}>
              {promotion?.map((m) => (
                <Pressable key={m.promo} onPress={() => commit(m)} style={styles.promoOption}>
                  <ChessPiece piece={{ t: m.promo!, c: state.turn }} size={52} />
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
    </PageScreen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f6f7fb' },
  content: { flexGrow: 1, padding: 16, paddingBottom: 24 },
  segment: { flexDirection: 'row', backgroundColor: '#eceef4', borderRadius: 14, padding: 4 },
  segmentBtn: { flex: 1, paddingVertical: 11, borderRadius: 11, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: '#f68712', elevation: 3, shadowColor: '#f68712', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  segmentText: { fontSize: 14, fontWeight: '700', color: '#5b6275' },
  segmentTextActive: { color: '#fff' },
  levelRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 12 },
  levelChip: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 18, marginHorizontal: 4, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e5ee' },
  levelChipActive: { backgroundColor: '#fff3e6', borderColor: '#f68712' },
  levelText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  levelTextActive: { color: '#d9681a', fontWeight: '800' },
  stage: { flexGrow: 1, justifyContent: 'center', paddingVertical: 8 },
  playersRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  vs: { marginHorizontal: 12, fontSize: 13, fontWeight: '900', color: '#9aa0b0' },
  playerHalf: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  tile: { width: 58, height: 58, borderRadius: 14, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  tileW: { backgroundColor: '#f4ead8' },
  tileB: { backgroundColor: '#3a3a40' },
  tileName: { marginTop: 1, fontSize: 10, fontWeight: '800' },
  captured: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 },
  plinth: {
    alignSelf: 'center', marginTop: 16, borderRadius: 16, backgroundColor: '#2e1a0b', paddingBottom: 9,
    elevation: 12, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 14, shadowOffset: { width: 0, height: 10 },
  },
  frame: { padding: 20, borderRadius: 16, backgroundColor: '#6b3f1d', borderTopWidth: 1, borderColor: '#a06a3a' },
  inset: { borderWidth: 3, borderColor: '#3b2210', borderTopColor: '#2a170a', borderBottomColor: '#8a5a30' },
  boardRow: { flexDirection: 'row' },
  frameCoord: { position: 'absolute', textAlign: 'center', fontSize: 11, fontWeight: '800', color: '#e9c99a' },
  pieceWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  pieceLifted: { transform: [{ translateY: -5 }, { scale: 1.1 }] },
  checkGlow: { ...StyleSheet.absoluteFillObject, backgroundColor: '#ef4444', opacity: 0.55 },
  moveDot: { position: 'absolute', backgroundColor: 'rgba(30,30,30,0.28)' },
  captureRing: { ...StyleSheet.absoluteFillObject, borderWidth: 4, borderColor: 'rgba(30,30,30,0.3)' },
  resultOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(20,12,4,0.35)' },
  resultCard: { backgroundColor: '#fff', borderRadius: 16, paddingVertical: 18, paddingHorizontal: 26, alignItems: 'center' },
  resultTitle: { fontSize: 20, fontWeight: '800', color: '#1f2a44' },
  resultSub: { marginTop: 2, fontSize: 13, fontWeight: '600', color: '#6b7280' },
  resultBtn: { marginTop: 12, paddingVertical: 10, paddingHorizontal: 22, borderRadius: 12, backgroundColor: '#f68712' },
  actions: { flexDirection: 'row', marginTop: 'auto', paddingTop: 24 },
  secondaryBtn: { flex: 1, marginRight: 8, paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e5ee' },
  secondaryText: { fontSize: 15, fontWeight: '800', color: '#5b6275' },
  primaryBtn: { flex: 2, paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: '#f68712', borderBottomWidth: 4, borderColor: '#c9620a' },
  primaryText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  promoCard: { backgroundColor: '#fff', borderRadius: 16, padding: 18 },
  promoTitle: { fontSize: 17, fontWeight: '800', color: '#1f2a44', textAlign: 'center' },
  promoRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 14 },
  promoOption: { padding: 6, borderRadius: 12, backgroundColor: '#f6f1e7' },
});
