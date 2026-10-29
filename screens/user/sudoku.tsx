import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import { useInterstitialAd } from '@/hooks/useInterstitialAd';
import Ionicons from '@react-native-vector-icons/ionicons';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

type Level = 'easy' | 'medium' | 'hard';
type Grid = number[]; // 81 cells, 0 = empty
type Snapshot = { values: Grid; notes: number[] };

const LEVELS: Level[] = ['easy', 'medium', 'hard'];
const LEVEL_LABEL: Record<Level, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
// Target number of given cells; removal stops early if uniqueness would break.
const GIVENS: Record<Level, number> = { easy: 40, medium: 32, hard: 26 };
const MAX_MISTAKES = 3;

const rowOf = (i: number) => Math.floor(i / 9);
const colOf = (i: number) => i % 9;
const boxOf = (i: number) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);

const shuffle = <T,>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Bitmask backtracking solver; counts solutions up to `limit` (fills `grid` with the first one when randomize is used to generate). */
const solve = (grid: Grid, limit: number, randomize = false): number => {
  const rows = Array(9).fill(0);
  const cols = Array(9).fill(0);
  const boxes = Array(9).fill(0);
  const empty: number[] = [];
  for (let i = 0; i < 81; i++) {
    const v = grid[i];
    if (v) {
      const bit = 1 << v;
      rows[rowOf(i)] |= bit;
      cols[colOf(i)] |= bit;
      boxes[boxOf(i)] |= bit;
    } else empty.push(i);
  }
  let count = 0;
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  const step = (): boolean => {
    // Most-constrained empty cell first keeps the search small.
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (const i of empty) {
      if (grid[i]) continue;
      const used = rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)];
      let n = 0;
      for (let d = 1; d <= 9; d++) if (!(used & (1 << d))) n++;
      if (n < bestCount) {
        best = i;
        bestCount = n;
        bestMask = used;
        if (n <= 1) break;
      }
    }
    if (best === -1) {
      count++;
      return count >= limit;
    }
    if (bestCount === 0) return false;
    const r = rowOf(best);
    const c = colOf(best);
    const b = boxOf(best);
    for (const d of randomize ? shuffle(digits) : digits) {
      const bit = 1 << d;
      if (bestMask & bit) continue;
      grid[best] = d;
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;
      if (step()) return true;
      grid[best] = 0;
      rows[r] &= ~bit;
      cols[c] &= ~bit;
      boxes[b] &= ~bit;
    }
    return false;
  };

  step();
  return count;
};

const generate = (level: Level): { puzzle: Grid; solution: Grid } => {
  const solution: Grid = Array(81).fill(0);
  solve(solution, 1, true);
  const puzzle = [...solution];
  let givens = 81;
  for (const i of shuffle([...Array(81).keys()])) {
    if (givens <= GIVENS[level]) break;
    const keep = puzzle[i];
    puzzle[i] = 0;
    if (solve([...puzzle], 2) !== 1) puzzle[i] = keep;
    else givens--;
  }
  return { puzzle, solution };
};

const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

export default function SudokuScreen() {
  const { width } = useWindowDimensions();
  const [level, setLevel] = useState<Level>('easy');
  const [game, setGame] = useState(() => generate('easy'));
  const [values, setValues] = useState<Grid>(() => [...game.puzzle]);
  // Pencil marks per cell as a bitmask of digits 1..9.
  const [notes, setNotes] = useState<number[]>(() => Array(81).fill(0));
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [noteMode, setNoteMode] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [hintsLeft, setHintsLeft] = useState(3);
  const [seconds, setSeconds] = useState(0);

  const solved = useMemo(() => values.every((v, i) => v === game.solution[i]), [values, game]);
  const lost = mistakes >= MAX_MISTAKES;
  const over = solved || lost;

  useEffect(() => {
    if (over) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [over]);

  // Digits already placed correctly 9 times are greyed out on the pad.
  const doneDigits = useMemo(() => {
    const counts = Array(10).fill(0);
    values.forEach((v, i) => { if (v && v === game.solution[i]) counts[v]++; });
    return counts.map((n) => n >= 9);
  }, [values, game]);

  const cell = Math.floor((Math.min(width - 32, 520) - 8) / 9);
  const boardSize = cell * 9;
  const selValue = selected !== null ? values[selected] : 0;

  const showAdThen = useInterstitialAd();

  const newGame = (nextLevel: Level = level) => {
    const g = generate(nextLevel);
    setLevel(nextLevel);
    setGame(g);
    setValues([...g.puzzle]);
    setNotes(Array(81).fill(0));
    setHistory([]);
    setSelected(null);
    setNoteMode(false);
    setMistakes(0);
    setHintsLeft(3);
    setSeconds(0);
  };

  const editable = (i: number) => !game.puzzle[i] && values[i] !== game.solution[i];

  const pushHistory = () => setHistory((h) => [...h, { values, notes }]);

  /** Placing a digit clears that digit from the notes of every peer cell. */
  const clearPeerNotes = (base: number[], i: number, d: number) =>
    base.map((m, j) => (j !== i && (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i)) ? m & ~(1 << d) : m));

  const place = (d: number) => {
    if (over || selected === null || !editable(selected)) return;
    const i = selected;
    if (noteMode) {
      if (values[i]) return;
      pushHistory();
      setNotes(notes.map((m, j) => (j === i ? m ^ (1 << d) : m)));
      return;
    }
    if (values[i] === d) return;
    pushHistory();
    setValues(values.map((v, j) => (j === i ? d : v)));
    const cleared = notes.map((m, j) => (j === i ? 0 : m));
    if (d === game.solution[i]) setNotes(clearPeerNotes(cleared, i, d));
    else {
      setNotes(cleared);
      setMistakes((m) => m + 1);
    }
  };

  const erase = () => {
    if (over || selected === null || !editable(selected)) return;
    if (!values[selected] && !notes[selected]) return;
    pushHistory();
    setValues(values.map((v, j) => (j === selected ? 0 : v)));
    setNotes(notes.map((m, j) => (j === selected ? 0 : m)));
  };

  const hint = () => {
    if (over || hintsLeft <= 0) return;
    // Use the selected cell if it needs filling, otherwise the first one that does.
    const target = selected !== null && editable(selected) ? selected : values.findIndex((v, i) => v !== game.solution[i]);
    if (target < 0) return;
    pushHistory();
    const d = game.solution[target];
    setValues(values.map((v, j) => (j === target ? d : v)));
    setNotes(clearPeerNotes(notes.map((m, j) => (j === target ? 0 : m)), target, d));
    setSelected(target);
    setHintsLeft((h) => h - 1);
  };

  const undo = () => {
    if (!history.length || over) return;
    const last = history[history.length - 1];
    setValues(last.values);
    setNotes(last.notes);
    setHistory(history.slice(0, -1));
  };

  return (
    <PageScreen style={styles.page}>
      <PageHeader title="Sudoku" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.segment}>
          {LEVELS.map((l) => (
            <Pressable key={l} onPress={() => showAdThen(() => newGame(l))} style={[styles.segmentBtn, level === l && styles.segmentBtnActive]}>
              <Text style={[styles.segmentText, level === l && styles.segmentTextActive]}>{LEVEL_LABEL[l]}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Ionicons name="close-circle-outline" size={16} color={mistakes ? '#ef4444' : '#9aa0b0'} />
            <Text style={[styles.statText, mistakes > 0 && { color: '#ef4444' }]}>Mistakes {mistakes}/{MAX_MISTAKES}</Text>
          </View>
          <View style={styles.stat}>
            <Ionicons name="time-outline" size={16} color="#9aa0b0" />
            <Text style={styles.statText}>{formatTime(seconds)}</Text>
          </View>
        </View>

        <View style={styles.stage}>
          <View style={[styles.board, { width: boardSize + 4, height: boardSize + 4 }]}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((r) => (
              <View key={r} style={styles.boardRow}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((c) => {
                  const i = r * 9 + c;
                  const v = values[i];
                  const given = !!game.puzzle[i];
                  const wrong = !!v && v !== game.solution[i];
                  const isSel = selected === i;
                  const peer = selected !== null && !isSel
                    && (rowOf(selected) === r || colOf(selected) === c || boxOf(selected) === boxOf(i));
                  const sameNum = !!selValue && v === selValue && !isSel;
                  return (
                    <Pressable
                      key={i}
                      onPress={() => setSelected(isSel ? null : i)}
                      accessibilityLabel={`Row ${r + 1} column ${c + 1}${v ? ` ${v}` : ' empty'}`}
                      style={[
                        styles.cell,
                        { width: cell, height: cell },
                        c % 3 === 2 && c < 8 && styles.boxRight,
                        r % 3 === 2 && r < 8 && styles.boxBottom,
                        peer && styles.cellPeer,
                        sameNum && styles.cellSame,
                        isSel && styles.cellSel,
                        wrong && styles.cellWrong,
                      ]}
                    >
                      {v ? (
                        <Text style={[styles.cellText, { fontSize: cell * 0.52 }, !given && styles.cellTextUser, wrong && styles.cellTextWrong]}>{v}</Text>
                      ) : notes[i] ? (
                        <View style={styles.notesGrid}>
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                            <Text key={d} style={[styles.noteText, { width: cell / 3, fontSize: cell * 0.22, lineHeight: cell / 3 - 1 }]}>
                              {notes[i] & (1 << d) ? d : ''}
                            </Text>
                          ))}
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
            {over ? (
              <View style={styles.resultOverlay}>
                <View style={styles.resultCard}>
                  <Text style={styles.resultTitle}>{solved ? 'Solved! 🎉' : 'Game over'}</Text>
                  <Text style={styles.resultSub}>
                    {solved ? `${LEVEL_LABEL[level]} · ${formatTime(seconds)}` : `${MAX_MISTAKES} mistakes made`}
                  </Text>
                  <Pressable onPress={() => showAdThen(() => newGame())} style={styles.resultBtn}>
                    <Text style={styles.primaryText}>Play Again</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>

          <View style={[styles.tools, { width: boardSize }]}>
            <ToolButton icon="arrow-undo-outline" label="Undo" onPress={undo} disabled={!history.length || over} />
            <ToolButton icon="backspace-outline" label="Erase" onPress={erase} disabled={over} />
            <ToolButton icon="pencil-outline" label={noteMode ? 'Notes On' : 'Notes'} onPress={() => setNoteMode((n) => !n)} active={noteMode} disabled={over} />
            <ToolButton icon="bulb-outline" label={`Hint (${hintsLeft})`} onPress={hint} disabled={over || hintsLeft <= 0} />
          </View>

          <View style={[styles.pad, { width: boardSize }]}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
              <Pressable
                key={d}
                onPress={() => place(d)}
                disabled={over || doneDigits[d]}
                style={[styles.padKey, doneDigits[d] && { opacity: 0.25 }]}
              >
                <Text style={[styles.padText, noteMode && styles.padTextNote]}>{d}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable onPress={() => showAdThen(() => newGame())} style={styles.primaryBtn}>
            <Text style={styles.primaryText}>New Game</Text>
          </Pressable>
        </View>
      </ScrollView>
    </PageScreen>
  );
}

function ToolButton({ icon, label, onPress, disabled, active }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.tool, disabled && { opacity: 0.4 }]}>
      <View style={[styles.toolIcon, active && styles.toolIconActive]}>
        <Ionicons name={icon} size={20} color={active ? '#fff' : '#5b6275'} />
      </View>
      <Text style={[styles.toolText, active && { color: '#d9681a' }]}>{label}</Text>
    </Pressable>
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
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, paddingHorizontal: 4 },
  stat: { flexDirection: 'row', alignItems: 'center' },
  statText: { marginLeft: 5, fontSize: 13, fontWeight: '700', color: '#5b6275' },
  stage: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 8 },
  board: {
    marginTop: 8, borderWidth: 2, borderColor: '#1f2a44', borderRadius: 6, overflow: 'hidden', backgroundColor: '#fff',
    elevation: 4, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },
  boardRow: { flexDirection: 'row' },
  cell: { alignItems: 'center', justifyContent: 'center', borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#c9cedb' },
  boxRight: { borderRightWidth: 2, borderRightColor: '#1f2a44' },
  boxBottom: { borderBottomWidth: 2, borderBottomColor: '#1f2a44' },
  cellPeer: { backgroundColor: '#fff6ec' },
  cellSame: { backgroundColor: '#ffe2c2' },
  cellSel: { backgroundColor: '#ffc98f' },
  cellWrong: { backgroundColor: '#fde2e2' },
  cellText: { fontWeight: '700', color: '#1f2a44' },
  cellTextUser: { color: '#d9681a' },
  cellTextWrong: { color: '#ef4444' },
  notesGrid: { flexDirection: 'row', flexWrap: 'wrap', width: '100%', height: '100%' },
  noteText: { textAlign: 'center', fontWeight: '600', color: '#6b7280' },
  resultOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(20,12,4,0.35)' },
  resultCard: { backgroundColor: '#fff', borderRadius: 16, paddingVertical: 18, paddingHorizontal: 26, alignItems: 'center' },
  resultTitle: { fontSize: 20, fontWeight: '800', color: '#1f2a44' },
  resultSub: { marginTop: 2, fontSize: 13, fontWeight: '600', color: '#6b7280' },
  resultBtn: { marginTop: 12, paddingVertical: 10, paddingHorizontal: 22, borderRadius: 12, backgroundColor: '#f68712' },
  tools: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 16 },
  tool: { alignItems: 'center', minWidth: 64 },
  toolIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e5ee' },
  toolIconActive: { backgroundColor: '#f68712', borderColor: '#f68712' },
  toolText: { marginTop: 4, fontSize: 11, fontWeight: '700', color: '#5b6275' },
  pad: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  padKey: { flex: 1, marginHorizontal: 2, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e5ee' },
  padText: { fontSize: 22, fontWeight: '800', color: '#1f2a44' },
  padTextNote: { color: '#9aa0b0' },
  actions: { flexDirection: 'row', marginTop: 'auto', paddingTop: 24 },
  primaryBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: '#f68712', borderBottomWidth: 4, borderColor: '#c9620a' },
  primaryText: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
