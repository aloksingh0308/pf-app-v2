import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import { useInterstitialAd } from '@/hooks/useInterstitialAd';
import Ionicons from '@react-native-vector-icons/ionicons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

/* ------------------------------------------------------------------ */
/* Board geometry                                                      */
/* ------------------------------------------------------------------ */

type LColor = 'red' | 'green' | 'yellow' | 'blue';
type Phase = 'roll' | 'rolling' | 'pick' | 'moving' | 'over';
type Mode = 'cpu' | 'local';
type Game = {
  players: LColor[];
  cpu: Record<LColor, boolean>;
  // Per-token progress: -1 in base, 0..50 main track, 51..55 home column, 56 finished.
  tokens: Record<LColor, number[]>;
  turn: number;
  dice: number | null;
  phase: Phase;
  sixes: number;
  movable: number[];
  winner: LColor | null;
};

const ORDER: LColor[] = ['red', 'green', 'yellow', 'blue'];
const SEATS: Record<number, LColor[]> = { 2: ['red', 'yellow'], 3: ['red', 'green', 'yellow'], 4: ORDER };
const FINISH = 56;
const LAST_TRACK = 50;

const PALETTE: Record<LColor, { main: string; light: string; dark: string; soft: string; name: string }> = {
  red: { main: '#e53935', light: '#ff9e97', dark: '#8e1b17', soft: '#fde4e3', name: 'Red' },
  green: { main: '#2e9e48', light: '#93e3a5', dark: '#14532a', soft: '#e3f6e7', name: 'Green' },
  yellow: { main: '#f5b800', light: '#ffe98a', dark: '#8a6400', soft: '#fff6d6', name: 'Yellow' },
  blue: { main: '#1e7be5', light: '#9ccbff', dark: '#0d3f80', soft: '#e2efff', name: 'Blue' },
};

// 52 shared squares as [row, col], clockwise from Red's start square.
const TRACK: [number, number][] = [
  ...[13, 12, 11, 10, 9].map((r) => [r, 6] as [number, number]),
  ...[5, 4, 3, 2, 1, 0].map((c) => [8, c] as [number, number]),
  [7, 0], [6, 0],
  ...[1, 2, 3, 4, 5].map((c) => [6, c] as [number, number]),
  ...[5, 4, 3, 2, 1, 0].map((r) => [r, 6] as [number, number]),
  [0, 7], [0, 8],
  ...[1, 2, 3, 4, 5].map((r) => [r, 8] as [number, number]),
  ...[9, 10, 11, 12, 13, 14].map((c) => [6, c] as [number, number]),
  [7, 14], [8, 14],
  ...[13, 12, 11, 10, 9].map((c) => [8, c] as [number, number]),
  ...[9, 10, 11, 12, 13, 14].map((r) => [r, 8] as [number, number]),
  [14, 7], [14, 6],
];
const START: Record<LColor, number> = { red: 0, green: 13, yellow: 26, blue: 39 };
const STARS = [8, 21, 34, 47];
const SAFE = new Set([0, 13, 26, 39, ...STARS]);
const HOME_COL: Record<LColor, [number, number][]> = {
  red: [13, 12, 11, 10, 9].map((r) => [r, 7]),
  green: [1, 2, 3, 4, 5].map((c) => [7, c]),
  yellow: [1, 2, 3, 4, 5].map((r) => [r, 7]),
  blue: [13, 12, 11, 10, 9].map((c) => [7, c]),
};
const BASE: Record<LColor, [number, number]> = { red: [9, 0], green: [0, 0], yellow: [0, 9], blue: [9, 9] };
// Centroid of each colour's centre triangle (x, y in cell units).
const GOAL: Record<LColor, [number, number]> = { red: [7.5, 8.45], green: [6.55, 7.5], yellow: [7.5, 6.55], blue: [8.45, 7.5] };

const absSquare = (color: LColor, p: number) => (START[color] + p) % 52;

/** Centre of a token in cell units (x = col, y = row). */
const tokenPoint = (color: LColor, p: number, i: number): [number, number] => {
  if (p === -1) {
    const [r0, c0] = BASE[color];
    return [c0 + (i % 2 ? 4 : 2), r0 + (i < 2 ? 2 : 4)];
  }
  if (p === FINISH) {
    const [x, y] = GOAL[color];
    const off = [[-0.32, -0.18], [0.32, -0.18], [-0.32, 0.22], [0.32, 0.22]][i];
    return [x + off[0], y + off[1]];
  }
  const [r, c] = p <= LAST_TRACK ? TRACK[absSquare(color, p)] : HOME_COL[color][p - LAST_TRACK - 1];
  return [c + 0.5, r + 0.5];
};

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

const newGame = (count: number, mode: Mode): Game => {
  const players = SEATS[count];
  return {
    players,
    cpu: { red: false, green: mode === 'cpu', yellow: mode === 'cpu', blue: mode === 'cpu' },
    tokens: { red: [-1, -1, -1, -1], green: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] },
    turn: 0,
    dice: null,
    phase: 'roll',
    sixes: 0,
    movable: [],
    winner: null,
  };
};

const movableTokens = (tokens: number[], roll: number) =>
  tokens
    .map((p, i) => ((p === -1 ? roll === 6 : p < FINISH && p + roll <= FINISH) ? i : -1))
    .filter((i) => i >= 0);

const destination = (p: number, roll: number) => (p === -1 ? 0 : p + roll);

/** Opponent tokens sitting `1..6` squares behind an absolute square can hit it next turn. */
const threatened = (g: Game, color: LColor, abs: number) =>
  g.players.some((o) => o !== color && g.tokens[o].some((t) => {
    if (t < 0 || t > LAST_TRACK) return false;
    const d = (abs - absSquare(o, t) + 52) % 52;
    return d >= 1 && d <= 6;
  }));

const aiPick = (g: Game, color: LColor, roll: number): number => {
  let best = g.movable[0];
  let bestScore = -Infinity;
  for (const i of g.movable) {
    const from = g.tokens[color][i];
    const to = destination(from, roll);
    let score = to / 10;
    if (to === FINISH) score += 100;
    if (from === -1) score += 60;
    if (to > LAST_TRACK && from <= LAST_TRACK) score += 35;
    if (to <= LAST_TRACK) {
      const abs = absSquare(color, to);
      const victims = SAFE.has(abs) ? 0 : g.players.filter((o) => o !== color && g.tokens[o].some((t) => t >= 0 && t <= LAST_TRACK && absSquare(o, t) === abs)).length;
      score += victims * 90;
      if (SAFE.has(abs)) score += 20;
      else if (threatened(g, color, abs)) score -= 40;
    }
    if (from >= 0 && from <= LAST_TRACK && !SAFE.has(absSquare(color, from)) && threatened(g, color, absSquare(color, from))) score += 25;
    score += Math.random() * 3;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
};

/* ------------------------------------------------------------------ */
/* 3D pieces                                                           */
/* ------------------------------------------------------------------ */

function Token3D({ color, size }: { color: LColor; size: number }) {
  const pal = PALETTE[color];
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={`b${color}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={pal.light} />
          <Stop offset="0.45" stopColor={pal.main} />
          <Stop offset="1" stopColor={pal.dark} />
        </LinearGradient>
        <RadialGradient id={`h${color}`} cx="0.38" cy="0.32" r="0.75">
          <Stop offset="0" stopColor="#ffffff" />
          <Stop offset="0.25" stopColor={pal.light} />
          <Stop offset="0.65" stopColor={pal.main} />
          <Stop offset="1" stopColor={pal.dark} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={53} cy={91} rx={27} ry={7} fill="#000" opacity={0.3} />
      <Ellipse cx={50} cy={84} rx={27} ry={9} fill={`url(#b${color})`} stroke={pal.dark} strokeWidth={2} />
      <Path d="M31 84 Q33 60 43 50 L57 50 Q67 60 69 84 Z" fill={`url(#b${color})`} stroke={pal.dark} strokeWidth={2} />
      <Ellipse cx={50} cy={50} rx={10} ry={3} fill={pal.dark} opacity={0.5} />
      <Circle cx={50} cy={34} r={19} fill={`url(#h${color})`} stroke={pal.dark} strokeWidth={2} />
      <Ellipse cx={43} cy={27} rx={6} ry={4} fill="#fff" opacity={0.75} />
    </Svg>
  );
}

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

/** Dice with a darker underside for depth; tumbles and flickers faces while rolling. */
function Dice3D({ value, rolling, color, size, pulse }: { value: number; rolling: boolean; color: LColor; size: number; pulse: Animated.Value | null }) {
  const [face, setFace] = useState(value);
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!rolling) {
      setFace(value);
      return;
    }
    spin.setValue(0);
    Animated.timing(spin, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const t = setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 70);
    return () => clearInterval(t);
  }, [rolling, value, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '720deg'] });
  const pip = size * 0.17;
  const pos = [0.24, 0.5, 0.76];
  return (
    <Animated.View style={{ transform: [{ rotate }, ...(pulse ? [{ scale: pulse }] : [])] }}>
      <View style={[styles.diceBase, { width: size, height: size + 5, borderRadius: size * 0.22 }]}>
        <View style={[styles.diceFace, { width: size, height: size, borderRadius: size * 0.22, borderColor: PALETTE[color].main }]}>
          {PIPS[face].map((k) => (
            <View
              key={k}
              style={{
                position: 'absolute', width: pip, height: pip, borderRadius: pip / 2, backgroundColor: face === 1 ? PALETTE[color].main : '#1f2a44',
                left: size * pos[k % 3] - pip / 2 - 2, top: size * pos[Math.floor(k / 3)] - pip / 2 - 2,
              }}
            />
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

const starPath = (cx: number, cy: number, R: number, r: number) => {
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rad = k % 2 ? r : R;
    pts.push(`${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`);
  }
  return `M${pts.join(' L')} Z`;
};

/** Static board art in 15×15 cell units. */
const BoardArt = React.memo(function BoardArt({ size }: { size: number }) {
  const cells: React.ReactNode[] = [];
  TRACK.forEach(([r, c], i) => {
    const startOf = ORDER.find((col) => START[col] === i);
    cells.push(
      <Rect key={`t${i}`} x={c} y={r} width={1} height={1} fill={startOf ? PALETTE[startOf].main : '#fff'} stroke="#c9ced9" strokeWidth={0.035} />,
    );
    if (STARS.includes(i)) cells.push(<Path key={`s${i}`} d={starPath(c + 0.5, r + 0.5, 0.36, 0.15)} fill="#c3c8d4" />);
    if (startOf) cells.push(<Path key={`ss${i}`} d={starPath(c + 0.5, r + 0.5, 0.34, 0.14)} fill="#fff" opacity={0.85} />);
  });
  ORDER.forEach((col) => {
    HOME_COL[col].forEach(([r, c], k) => {
      cells.push(<Rect key={`h${col}${k}`} x={c} y={r} width={1} height={1} fill={PALETTE[col].main} stroke="#c9ced9" strokeWidth={0.035} />);
    });
  });

  return (
    <Svg width={size} height={size} viewBox="0 0 15 15">
      <Defs>
        <LinearGradient id="ludoSheen" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#fff" stopOpacity={0.25} />
          <Stop offset="0.5" stopColor="#fff" stopOpacity={0} />
          <Stop offset="1" stopColor="#000" stopOpacity={0.12} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={15} height={15} fill="#fff" />
      {ORDER.map((col) => {
        const [r0, c0] = BASE[col];
        return (
          <G key={col}>
            <Rect x={c0} y={r0} width={6} height={6} fill={PALETTE[col].main} />
            <Rect x={c0 + 0.85} y={r0 + 0.85} width={4.3} height={4.3} rx={0.5} fill={PALETTE[col].dark} opacity={0.35} />
            <Rect x={c0 + 0.8} y={r0 + 0.75} width={4.3} height={4.3} rx={0.5} fill="#fff" />
            {[0, 1, 2, 3].map((i) => {
              const [x, y] = tokenPoint(col, -1, i);
              return (
                <G key={i}>
                  <Circle cx={x} cy={y + 0.06} r={0.62} fill={PALETTE[col].dark} opacity={0.35} />
                  <Circle cx={x} cy={y} r={0.62} fill={PALETTE[col].soft} stroke={PALETTE[col].main} strokeWidth={0.1} />
                </G>
              );
            })}
          </G>
        );
      })}
      {cells}
      <Polygon points="6,6 6,9 7.5,7.5" fill={PALETTE.green.main} />
      <Polygon points="6,6 9,6 7.5,7.5" fill={PALETTE.yellow.main} />
      <Polygon points="9,6 9,9 7.5,7.5" fill={PALETTE.blue.main} />
      <Polygon points="6,9 9,9 7.5,7.5" fill={PALETTE.red.main} />
      <Rect x={0} y={0} width={15} height={15} fill="url(#ludoSheen)" />
    </Svg>
  );
});

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

export default function LudoScreen() {
  const { width } = useWindowDimensions();
  const [mode, setMode] = useState<Mode>('cpu');
  const [count, setCount] = useState(4);
  const [game, setGameState] = useState<Game>(() => newGame(4, 'cpu'));
  const gameRef = useRef(game);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const showAdThen = useInterstitialAd();
  const pulse = useRef(new Animated.Value(1)).current;

  const FRAME = 10;
  const cell = Math.floor((Math.min(width - 32, 520) - 2 * FRAME) / 15);
  const boardSize = cell * 15;

  const setGame = (g: Game) => {
    gameRef.current = g;
    setGameState(g);
  };
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.12, duration: 450, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 450, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const current = game.players[game.turn];

  const restart = (nextCount = count, nextMode = mode) => {
    clearTimers();
    setCount(nextCount);
    setMode(nextMode);
    setGame(newGame(nextCount, nextMode));
  };

  const passTurn = () => {
    const g = gameRef.current;
    setGame({ ...g, turn: (g.turn + 1) % g.players.length, dice: null, sixes: 0, phase: 'roll', movable: [] });
  };

  const resolve = (color: LColor, idx: number) => {
    const g = gameRef.current;
    const tokens = { ...g.tokens };
    const p = tokens[color][idx];
    let captured = false;
    if (p <= LAST_TRACK) {
      const abs = absSquare(color, p);
      if (!SAFE.has(abs)) {
        g.players.forEach((o) => {
          if (o === color) return;
          tokens[o] = tokens[o].map((t) => {
            if (t >= 0 && t <= LAST_TRACK && absSquare(o, t) === abs) {
              captured = true;
              return -1;
            }
            return t;
          });
        });
      }
    }
    if (tokens[color].every((t) => t === FINISH)) {
      setGame({ ...g, tokens, phase: 'over', winner: color, movable: [] });
      return;
    }
    const extra = g.dice === 6 || captured || p === FINISH;
    if (extra) setGame({ ...g, tokens, phase: 'roll', movable: [], sixes: g.dice === 6 ? g.sixes : 0 });
    else setGame({ ...g, tokens, turn: (g.turn + 1) % g.players.length, phase: 'roll', movable: [], sixes: 0, dice: null });
  };

  const move = (idx: number) => {
    const g = gameRef.current;
    if (g.phase !== 'pick' || !g.movable.includes(idx) || g.dice === null) return;
    const color = g.players[g.turn];
    const from = g.tokens[color][idx];
    const path = from === -1 ? [0] : Array.from({ length: g.dice }, (_, k) => from + k + 1);
    setGame({ ...g, phase: 'moving', movable: [] });
    path.forEach((p, k) => {
      later(() => {
        const cur = gameRef.current;
        const tokens = { ...cur.tokens, [color]: cur.tokens[color].map((t, i) => (i === idx ? p : t)) };
        setGame({ ...cur, tokens });
        if (k === path.length - 1) later(() => resolve(color, idx), 160);
      }, 140 * (k + 1));
    });
  };

  const roll = () => {
    const g = gameRef.current;
    if (g.phase !== 'roll') return;
    setGame({ ...g, phase: 'rolling' });
    later(() => {
      const g2 = gameRef.current;
      const color = g2.players[g2.turn];
      const value = 1 + Math.floor(Math.random() * 6);
      const sixes = value === 6 ? g2.sixes + 1 : 0;
      if (sixes === 3) {
        // Third six in a row forfeits the turn.
        setGame({ ...g2, dice: value, sixes: 0, phase: 'moving', movable: [] });
        later(passTurn, 900);
        return;
      }
      const movable = movableTokens(g2.tokens[color], value);
      const g3: Game = { ...g2, dice: value, sixes, movable, phase: movable.length ? 'pick' : 'moving' };
      setGame(g3);
      if (!movable.length) {
        later(passTurn, 900);
        return;
      }
      const sameSpot = new Set(movable.map((i) => g3.tokens[color][i])).size === 1;
      if (g3.cpu[color]) later(() => move(aiPick(g3, color, value)), 600);
      else if (sameSpot) later(() => move(movable[0]), 350);
    }, 650);
  };

  // Computer turns roll on their own.
  useEffect(() => {
    if (game.phase === 'roll' && game.cpu[current]) {
      const t = setTimeout(roll, 700);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.phase, game.turn, game.dice, current]);

  const humanTurn = !game.cpu[current];

  // Group tokens by spot so stacked tokens fan out instead of hiding each other.
  const pieces = useMemo(() => {
    const list: { color: LColor; i: number; x: number; y: number; p: number }[] = [];
    game.players.forEach((color) => game.tokens[color].forEach((p, i) => {
      const [x, y] = tokenPoint(color, p, i);
      list.push({ color, i, x, y, p });
    }));
    const groups: Record<string, typeof list> = {};
    list.forEach((t) => {
      if (t.p === -1 || t.p === FINISH) return;
      (groups[`${t.x},${t.y}`] ||= []).push(t);
    });
    return list
      .map((t) => {
        const group = t.p === -1 || t.p === FINISH ? null : groups[`${t.x},${t.y}`];
        if (!group || group.length === 1) return { ...t, scale: t.p === FINISH ? 0.55 : 1 };
        const k = group.indexOf(t);
        const off = [[-0.2, -0.12], [0.2, -0.12], [-0.2, 0.18], [0.2, 0.18]][k % 4];
        return { ...t, x: t.x + off[0], y: t.y + off[1], scale: 0.7 };
      })
      .sort((a, b) => a.y - b.y);
  }, [game.players, game.tokens]);

  const label = (color: LColor) => (mode === 'cpu' ? (color === 'red' ? 'You' : 'CPU') : PALETTE[color].name);
  const resultTitle = game.winner
    ? mode === 'cpu' ? (game.winner === 'red' ? 'You win! 🎉' : `${PALETTE[game.winner].name} CPU wins`) : `${PALETTE[game.winner].name} wins! 🎉`
    : '';

  // Plain render function (not a component) so the dice keeps its state across renders.
  const renderCorner = (color: LColor, align: 'left' | 'right') => {
    if (!game.players.includes(color)) return <View style={styles.corner} />;
    const active = game.phase !== 'over' && current === color;
    const home = game.tokens[color].filter((t) => t === FINISH).length;
    const isCpu = game.cpu[color];
    const canRoll = active && !isCpu && game.phase === 'roll';
    return (
      <View style={[styles.corner, align === 'right' && { flexDirection: 'row-reverse' }]}>
        <View style={[styles.tile, { backgroundColor: PALETTE[color].soft, borderColor: active || game.winner === color ? PALETTE[color].main : '#e2e5ee' }]}>
          <Ionicons name={isCpu ? 'hardware-chip-outline' : 'person'} size={20} color={PALETTE[color].dark} />
          <Text style={[styles.tileName, { color: PALETTE[color].dark }]}>{label(color)}</Text>
          {home ? <Text style={[styles.homeBadge, { backgroundColor: PALETTE[color].main }]}>{home}</Text> : null}
        </View>
        {active ? (
          <Pressable onPress={roll} disabled={!canRoll} hitSlop={10} style={{ marginHorizontal: 12 }} accessibilityLabel="Roll dice">
            <Dice3D value={game.dice ?? 6} rolling={game.phase === 'rolling'} color={color} size={44} pulse={canRoll ? pulse : null} />
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <PageScreen style={styles.page}>
      <PageHeader
        title="Ludo"
        actions={[{ icon: 'refresh', label: 'New game', onPress: () => showAdThen(() => restart()) }]}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.segment}>
          {(['cpu', 'local'] as Mode[]).map((m) => (
            <Pressable key={m} onPress={() => restart(count, m)} style={[styles.segmentBtn, mode === m && styles.segmentBtnActive]}>
              <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>{m === 'cpu' ? 'vs Computer' : 'Pass & Play'}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.countRow}>
          {[2, 3, 4].map((n) => (
            <Pressable key={n} onPress={() => restart(n, mode)} style={[styles.countChip, count === n && styles.countChipActive]}>
              <Text style={[styles.countText, count === n && styles.countTextActive]}>{n} Players</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.stage}>
          <View style={styles.cornerRow}>
            {renderCorner('green', 'left')}
            {renderCorner('yellow', 'right')}
          </View>

          <View style={styles.plinth}>
            <View style={styles.frame}>
              <View style={{ width: boardSize, height: boardSize }}>
                <BoardArt size={boardSize} />
                {pieces.map((t) => {
                  const canMove = game.phase === 'pick' && humanTurn && t.color === current && game.movable.includes(t.i);
                  const s = cell * 1.15 * t.scale;
                  return (
                    <Pressable
                      key={`${t.color}${t.i}`}
                      onPress={() => canMove && move(t.i)}
                      disabled={!canMove}
                      hitSlop={6}
                      accessibilityLabel={`${PALETTE[t.color].name} token ${t.i + 1}`}
                      style={{ position: 'absolute', left: t.x * cell - s / 2, top: t.y * cell - s * 0.8, width: s, height: s, zIndex: canMove ? 10 : 1 }}
                    >
                      {canMove ? (
                        <Animated.View
                          pointerEvents="none"
                          style={[styles.moveRing, {
                            width: cell * 0.95, height: cell * 0.95, borderRadius: cell, left: s / 2 - cell * 0.475, top: s * 0.8 - cell * 0.475,
                            borderColor: PALETTE[t.color].main, transform: [{ scale: pulse }],
                          }]}
                        />
                      ) : null}
                      <Token3D color={t.color} size={s} />
                    </Pressable>
                  );
                })}
                {game.phase === 'over' ? (
                  <View style={styles.resultOverlay}>
                    <View style={styles.resultCard}>
                      <Text style={styles.resultTitle}>{resultTitle}</Text>
                      <Pressable onPress={() => showAdThen(() => restart())} style={styles.resultBtn}>
                        <Text style={styles.resultBtnText}>Play Again</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </View>
            </View>
          </View>

          <View style={styles.cornerRow}>
            {renderCorner('red', 'left')}
            {renderCorner('blue', 'right')}
          </View>
        </View>
      </ScrollView>
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
  countRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 12 },
  countChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, marginHorizontal: 4, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e5ee' },
  countChipActive: { backgroundColor: '#fff3e6', borderColor: '#f68712' },
  countText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  countTextActive: { color: '#d9681a', fontWeight: '800' },
  stage: { flexGrow: 1, justifyContent: 'center', paddingVertical: 8 },
  cornerRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 10 },
  corner: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  tile: { width: 56, height: 56, borderRadius: 14, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  tileName: { fontSize: 10, fontWeight: '800', marginTop: 1 },
  homeBadge: { position: 'absolute', top: -8, right: -8, minWidth: 18, height: 18, borderRadius: 9, color: '#fff', fontSize: 11, fontWeight: '800', textAlign: 'center', lineHeight: 18, overflow: 'hidden' },
  diceBase: { backgroundColor: '#c3c7d3' },
  diceFace: { backgroundColor: '#fff', borderWidth: 2 },
  plinth: {
    alignSelf: 'center', borderRadius: 16, backgroundColor: '#2e1a0b', paddingBottom: 8,
    elevation: 12, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 14, shadowOffset: { width: 0, height: 10 },
  },
  frame: { padding: 10, borderRadius: 16, backgroundColor: '#6b3f1d', borderTopWidth: 1, borderColor: '#a06a3a' },
  moveRing: { position: 'absolute', borderWidth: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  resultOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(20,12,4,0.35)', zIndex: 20 },
  resultCard: { backgroundColor: '#fff', borderRadius: 16, paddingVertical: 18, paddingHorizontal: 26, alignItems: 'center' },
  resultTitle: { fontSize: 20, fontWeight: '800', color: '#1f2a44' },
  resultBtn: { marginTop: 12, paddingVertical: 10, paddingHorizontal: 22, borderRadius: 12, backgroundColor: '#f68712' },
  resultBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
