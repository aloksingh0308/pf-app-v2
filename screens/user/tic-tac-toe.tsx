import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import { AppStrings } from '@/constants/appStrings';
import React, { useMemo, useState } from 'react';
import { Animated, Easing, Modal } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import styled from 'styled-components/native';
import {
  InterstitialAd,
  AdEventType,
  TestIds
} from 'react-native-google-mobile-ads';


const INTERSTITIAL_AD_UNIT_ID = String(
  process.env.EXPO_PUBLIC_INTERSTITIAL_AD_UNIT_ID
  || ''
).trim();

const adUnitId = __DEV__
  ? TestIds.INTERSTITIAL
  : INTERSTITIAL_AD_UNIT_ID;

const interstitial = InterstitialAd.createForAdRequest(
  adUnitId,
  {
    requestNonPersonalizedAdsOnly: true,
  }
);

type Player = 'X' | 'O';
type Cell = Player | null;
type Mode = 'one' | 'two';

const winLines = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const getWinner = (board: Cell[]): Player | null => {
  for (const [a, b, c] of winLines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return null;
};

const getWinLine = (board: Cell[]): number[] => {
  for (const line of winLines) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return line;
  }
  return [];
};

const getAvailableMoves = (board: Cell[]): number[] => {
  return board
    .map((value, index) => ({ value, index }))
    .filter((entry) => entry.value === null)
    .map((entry) => entry.index);
};

const evaluateBoard = (board: Cell[]): number => {
  const winner = getWinner(board);
  if (winner === 'O') return 10;
  if (winner === 'X') return -10;
  return 0;
};

const minimax = (board: Cell[], depth: number, isMaximizing: boolean): number => {
  const score = evaluateBoard(board);
  if (score === 10 || score === -10) {
    return score - depth * (score > 0 ? 1 : -1);
  }

  const availableMoves = getAvailableMoves(board);
  if (availableMoves.length === 0) {
    return 0;
  }

  if (isMaximizing) {
    let best = -Infinity;
    for (const move of availableMoves) {
      board[move] = 'O';
      best = Math.max(best, minimax(board, depth + 1, false));
      board[move] = null;
    }
    return best;
  }

  let best = Infinity;
  for (const move of availableMoves) {
    board[move] = 'X';
    best = Math.min(best, minimax(board, depth + 1, true));
    board[move] = null;
  }
  return best;
};

const pickAiMove = (board: Cell[]): number | null => {
  const availableMoves = getAvailableMoves(board);
  if (availableMoves.length === 0) return null;

  let bestScore = -Infinity;
  let bestMove: number | null = null;

  for (const move of availableMoves) {
    board[move] = 'O';
    const score = minimax(board, 0, false);
    board[move] = null;

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
};

export default function TicTacToeScreen() {
  const MAX_FREE_RESTARTS = 2;
  const [mode, setMode] = useState<Mode>('one');
  const [board, setBoard] = useState<Cell[]>(Array(9).fill(null));
  const [turn, setTurn] = useState<Player>('X');
  const [usedFreeRestarts, setUsedFreeRestarts] = useState(0);
  const [showWatchAdModal, setShowWatchAdModal] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const celebrationScale = useMemo(() => new Animated.Value(0.7), []);
  const celebrationOpacity = useMemo(() => new Animated.Value(0), []);
  const celebrationTranslateY = useMemo(() => new Animated.Value(24), []);
  const [isAdLoaded, setIsAdLoaded] = useState(false);

  const [score, setScore] = useState({ X: 0, O: 0, draw: 0 });

  const winner = useMemo(() => getWinner(board), [board]);
  const winLine = useMemo(() => getWinLine(board), [board]);
  const isDraw = useMemo(() => !winner && board.every((cell) => cell !== null), [board, winner]);

  React.useEffect(() => {
    if (winner) setScore((prev) => ({ ...prev, [winner]: prev[winner] + 1 }));
    else if (isDraw) setScore((prev) => ({ ...prev, draw: prev.draw + 1 }));
  }, [winner, isDraw]);

  const handleRestartRequest = () => {

    // Free restarts available
    if (usedFreeRestarts < MAX_FREE_RESTARTS) {
      setUsedFreeRestarts(prev => prev + 1);
      resetGame();
      return;
    }

    // Free restarts finished
    if (isAdLoaded) {
      interstitial.show();
      const unsubscribe = interstitial.addAdEventListener(
        AdEventType.CLOSED,
        () => {
          unsubscribe();
          setUsedFreeRestarts(0);
          resetGame();
        },
      );
    } else {
      // If ad isn't loaded don't block gameplay
      setUsedFreeRestarts(0);
      resetGame();
      interstitial.load();
    }
  };

  React.useEffect(() => {
    const loadedListener = interstitial.addAdEventListener(
      AdEventType.LOADED,
      () => {
        setIsAdLoaded(true);
      },
    );

    const closedListener = interstitial.addAdEventListener(
      AdEventType.CLOSED,
      () => {
        setIsAdLoaded(false);
        interstitial.load(); // preload next ad
      },
    );

    interstitial.load();

    return () => {
      loadedListener();
      closedListener();
    };
  }, []);

  const resetGame = () => {
    setBoard(Array(9).fill(null));
    setTurn('X');
    setShowCelebration(false);
  };

  // const handleRestartRequest = () => {
  //   // if (usedFreeRestarts < MAX_FREE_RESTARTS) {
  //   setUsedFreeRestarts((prev) => prev + 1);
  //   resetGame();
  //   //   return;
  //   // }

  //   // setShowWatchAdModal(true);
  // };

  const handleWatchAdPlaceholder = () => {
    setShowWatchAdModal(false);
    setUsedFreeRestarts(0);
    resetGame();
  };

  const freeRestartsLeft = Math.max(0, MAX_FREE_RESTARTS - usedFreeRestarts);

  React.useEffect(() => {
    const shouldCelebrate = Boolean(winner || isDraw);
    if (!shouldCelebrate) {
      setShowCelebration(false);
      celebrationOpacity.setValue(0);
      celebrationScale.setValue(0.7);
      celebrationTranslateY.setValue(24);
      return;
    }

    setShowCelebration(true);
    celebrationOpacity.setValue(0);
    celebrationScale.setValue(0.7);
    celebrationTranslateY.setValue(24);

    Animated.parallel([
      Animated.timing(celebrationOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(celebrationScale, {
        toValue: 1,
        friction: 6,
        tension: 110,
        useNativeDriver: true,
      }),
      Animated.timing(celebrationTranslateY, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.back(1.2)),
        useNativeDriver: true,
      }),
    ]).start();
  }, [winner, isDraw, celebrationOpacity, celebrationScale, celebrationTranslateY]);

  const applyMove = (index: number, player: Player) => {
    setBoard((prev) => {
      if (prev[index] || getWinner(prev)) return prev;
      const next = [...prev];
      next[index] = player;
      return next;
    });
  };

  const handleCellPress = (index: number) => {
    if (board[index] || winner || isDraw) {
      return;
    }

    if (mode === 'two') {
      applyMove(index, turn);
      setTurn((prev) => (prev === 'X' ? 'O' : 'X'));
      return;
    }

    applyMove(index, 'X');

    const nextBoard = [...board];
    nextBoard[index] = 'X';
    if (getWinner(nextBoard) || nextBoard.every((cell) => cell !== null)) {
      return;
    }

    const aiMove = pickAiMove(nextBoard);
    if (aiMove === null) return;

    setTimeout(() => {
      applyMove(aiMove, 'O');
    }, 220);
  };

  const statusText = winner
    ? `Winner: ${winner}`
    : isDraw
      ? 'Draw game'
      : mode === 'one'
        ? 'Your move — you are X'
        : `Player ${turn}'s turn`;

  const celebrationTitle = winner
    ? mode === 'one'
      ? winner === 'X' ? 'You Win! 🎉' : 'Computer Wins!'
      : `Player ${winner} Wins!`
    : isDraw
      ? 'It is a Draw!'
      : '';

  const celebrationSubTitle = winner
    ? 'Great game! Tap Restart to play again.'
    : isDraw
      ? 'Nice match. Try one more round.'
      : '';

  return (
    <Container>
      <PageHeader title="Tic Tac Toe" />

      <Content contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <ModeRow>
          <ModeButton active={mode === 'one'} onPress={() => { setMode('one'); resetGame(); setScore({ X: 0, O: 0, draw: 0 }); }}>
            <ModeButtonText active={mode === 'one'}>1 Player</ModeButtonText>
          </ModeButton>
          <ModeButton active={mode === 'two'} onPress={() => { setMode('two'); resetGame(); setScore({ X: 0, O: 0, draw: 0 }); }}>
            <ModeButtonText active={mode === 'two'}>2 Player</ModeButtonText>
          </ModeButton>
        </ModeRow>

        <ScoreRow>
          <ScoreCard active={!winner && !isDraw && turn === 'X'}>
            <PieceX size={30} />
            <ScoreLabel>{mode === 'one' ? 'You' : 'Player X'}</ScoreLabel>
            <ScoreValue>{score.X}</ScoreValue>
          </ScoreCard>
          <ScoreCard active={false}>
            <DrawBadge><DrawBadgeText>=</DrawBadgeText></DrawBadge>
            <ScoreLabel>Draws</ScoreLabel>
            <ScoreValue>{score.draw}</ScoreValue>
          </ScoreCard>
          <ScoreCard active={!winner && !isDraw && turn === 'O'}>
            <PieceO size={30} />
            <ScoreLabel>{mode === 'one' ? 'Computer' : 'Player O'}</ScoreLabel>
            <ScoreValue>{score.O}</ScoreValue>
          </ScoreCard>
        </ScoreRow>

        <StatusText>{statusText}</StatusText>

        <BoardBase>
          <BoardTray>
            {board.map((cell, index) => {
              const isWinCell = winLine.includes(index);
              return (
                <CellSlot key={index}>
                  <TileButton
                    activeOpacity={0.85}
                    onPress={() => handleCellPress(index)}
                    accessibilityRole="button"
                    accessibilityLabel={`Cell ${index + 1}${cell ? `, ${cell}` : ', empty'}`}
                  >
                    <TileBase win={isWinCell}>
                      <TileFace win={isWinCell}>
                        {cell ? <AnimatedPiece player={cell} /> : null}
                      </TileFace>
                    </TileBase>
                  </TileButton>
                </CellSlot>
              );
            })}
          </BoardTray>
        </BoardBase>

        {showCelebration ? (
          <CelebrationWrap
            style={{
              opacity: celebrationOpacity,
              transform: [
                { translateY: celebrationTranslateY },
                { scale: celebrationScale },
              ],
            }}
            isDraw={Boolean(isDraw && !winner)}
          >
            <CelebrationTitle>{celebrationTitle}</CelebrationTitle>
            <CelebrationSubTitle>{celebrationSubTitle}</CelebrationSubTitle>
          </CelebrationWrap>
        ) : null}

        <ResetButton onPress={handleRestartRequest} activeOpacity={0.85}>
          <ResetText>{winner || isDraw ? 'Play Again' : 'Restart Game'}</ResetText>
        </ResetButton>
        <ChanceText>{AppStrings.game.freeRestartLabel.replace('{COUNT}', String(freeRestartsLeft))}</ChanceText>

        <Modal
          visible={showWatchAdModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowWatchAdModal(false)}
        >
          <ModalOverlay>
            <ModalCard>
              <ModalTitle>{AppStrings.game.watchAdTitle}</ModalTitle>
              <ModalMessage>{AppStrings.game.watchAdMessage}</ModalMessage>

              <ModalActions>
                <ModalSecondaryButton onPress={() => setShowWatchAdModal(false)}>
                  <ModalSecondaryText>{AppStrings.game.laterCta}</ModalSecondaryText>
                </ModalSecondaryButton>
                <ModalPrimaryButton onPress={handleWatchAdPlaceholder}>
                  <ModalPrimaryText>{AppStrings.game.watchAdCta}</ModalPrimaryText>
                </ModalPrimaryButton>
              </ModalActions>
            </ModalCard>
          </ModalOverlay>
        </Modal>
      </Content>
    </Container>
  );
}

/** Extruded "3D" X: a darker copy stacked below the glossy face gives it depth. */
function PieceX({ size }: { size: number | string }) {
  const bar = (fill: string, dy: number, key: string) => (
    <G key={key} transform={`translate(0 ${dy})`}>
      <Rect x={12} y={39} width={76} height={22} rx={11} fill={fill} transform="rotate(45 50 50)" />
      <Rect x={12} y={39} width={76} height={22} rx={11} fill={fill} transform="rotate(-45 50 50)" />
    </G>
  );
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="xFace" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#ff9a6b" />
          <Stop offset="0.55" stopColor="#f4511e" />
          <Stop offset="1" stopColor="#c62828" />
        </LinearGradient>
      </Defs>
      <Ellipse cx={52} cy={92} rx={30} ry={5} fill="#000" opacity={0.12} />
      {[7, 5, 3].map((dy) => bar('#8e1d12', dy, `s${dy}`))}
      {bar('url(#xFace)', 0, 'face')}
      <Rect x={18} y={42} width={64} height={5} rx={2.5} fill="#fff" opacity={0.35} transform="rotate(45 50 50)" />
      <Rect x={18} y={42} width={64} height={5} rx={2.5} fill="#fff" opacity={0.35} transform="rotate(-45 50 50)" />
    </Svg>
  );
}

/** Extruded "3D" O: a torus-like ring with a darker base ring and a specular arc. */
function PieceO({ size }: { size: number | string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="oFace" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#7fd6ff" />
          <Stop offset="0.5" stopColor="#2f8fe8" />
          <Stop offset="1" stopColor="#1a4fb5" />
        </LinearGradient>
      </Defs>
      <Ellipse cx={51} cy={92} rx={30} ry={5} fill="#000" opacity={0.12} />
      {[7, 5, 3].map((dy) => (
        <Circle key={dy} cx={50} cy={47 + dy} r={29} stroke="#123a85" strokeWidth={18} fill="none" />
      ))}
      <Circle cx={50} cy={47} r={29} stroke="url(#oFace)" strokeWidth={18} fill="none" />
      <Circle cx={50} cy={47} r={20} stroke="#0b2a66" strokeOpacity={0.25} strokeWidth={2} fill="none" />
      <Path d="M 27 36 A 26 26 0 0 1 50 22" stroke="#fff" strokeOpacity={0.55} strokeWidth={5} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function AnimatedPiece({ player }: { player: Player }) {
  const scale = useMemo(() => new Animated.Value(0.3), []);
  const drop = useMemo(() => new Animated.Value(-18), []);
  React.useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }),
      Animated.spring(drop, { toValue: 0, friction: 6, tension: 120, useNativeDriver: true }),
    ]).start();
  }, [scale, drop]);
  return (
    <Animated.View style={{ width: '72%', aspectRatio: 1, transform: [{ translateY: drop }, { scale }] }}>
      {player === 'X' ? <PieceX size="100%" /> : <PieceO size="100%" />}
    </Animated.View>
  );
}

const Container = styled(PageScreen)`
  flex: 1;
  background-color: #f6f7fb;
`;

const Content = styled.ScrollView`
  flex: 1;
`;

const ModeRow = styled.View`
  flex-direction: row;
  background-color: #eceef4;
  border-radius: 14px;
  padding: 4px;
`;

const ModeButton = styled.TouchableOpacity<{ active: boolean }>`
  flex: 1;
  padding: 11px;
  border-radius: 11px;
  align-items: center;
  background-color: ${(props: any) => (props.active ? '#f68712' : 'transparent')};
  elevation: ${(props: any) => (props.active ? 3 : 0)};
  shadow-color: #f68712;
  shadow-opacity: ${(props: any) => (props.active ? 0.35 : 0)};
  shadow-radius: 6px;
  shadow-offset: 0px 3px;
`;

const ModeButtonText = styled.Text<{ active: boolean }>`
  color: ${(props: any) => (props.active ? '#fff' : '#5b6275')};
  font-weight: 700;
  font-size: 14px;
`;

const ScoreRow = styled.View`
  flex-direction: row;
  margin-top: 16px;
`;

const ScoreCard = styled.View<{ active: boolean }>`
  flex: 1;
  align-items: center;
  padding: 10px 6px;
  margin: 0 4px;
  border-radius: 14px;
  background-color: #fff;
  border-width: 1.5px;
  border-color: ${(props: any) => (props.active ? '#f68712' : '#eceef4')};
  elevation: 2;
  shadow-color: #1f2a44;
  shadow-opacity: 0.08;
  shadow-radius: 6px;
  shadow-offset: 0px 2px;
`;

const ScoreLabel = styled.Text`
  margin-top: 4px;
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
`;

const ScoreValue = styled.Text`
  margin-top: 2px;
  font-size: 20px;
  font-weight: 800;
  color: #1f2a44;
`;

const DrawBadge = styled.View`
  width: 30px;
  height: 30px;
  border-radius: 15px;
  align-items: center;
  justify-content: center;
  background-color: #eceef4;
`;

const DrawBadgeText = styled.Text`
  font-size: 18px;
  font-weight: 800;
  color: #6b7280;
`;

const StatusText = styled.Text`
  margin-top: 18px;
  margin-bottom: 14px;
  font-size: 17px;
  font-weight: 700;
  color: #1f2a44;
  text-align: center;
`;

const ChanceText = styled.Text`
  margin-top: 10px;
  font-size: 12px;
  font-weight: 600;
  color: #8a90a2;
  text-align: center;
`;

/* The darker base peeking out under the tray gives the board its raised edge. */
const BoardBase = styled.View`
  width: 100%;
  border-radius: 24px;
  background-color: #d9681a;
  padding-bottom: 8px;
  elevation: 8;
  shadow-color: #7a3a0c;
  shadow-opacity: 0.35;
  shadow-radius: 12px;
  shadow-offset: 0px 8px;
`;

const BoardTray = styled.View`
  width: 100%;
  aspect-ratio: 1;
  flex-direction: row;
  flex-wrap: wrap;
  padding: 8px;
  border-radius: 24px;
  background-color: #f68712;
  border-top-width: 2px;
  border-color: #ffb36b;
`;

const CellSlot = styled.View`
  width: 33.3333%;
  height: 33.3333%;
  padding: 5px;
`;

const TileButton = styled.TouchableOpacity`
  flex: 1;
`;

const TileBase = styled.View<{ win: boolean }>`
  flex: 1;
  border-radius: 16px;
  padding-bottom: 6px;
  background-color: ${(props: any) => (props.win ? '#e0a400' : '#c9ccd8')};
`;

const TileFace = styled.View<{ win: boolean }>`
  flex: 1;
  border-radius: 16px;
  align-items: center;
  justify-content: center;
  background-color: ${(props: any) => (props.win ? '#fff4c7' : '#ffffff')};
  border-top-width: 2px;
  border-color: ${(props: any) => (props.win ? '#fffbe8' : '#ffffff')};
`;

const CelebrationWrap = styled(Animated.View) <{ isDraw: boolean }>`
  margin-top: 18px;
  border-radius: 14px;
  padding: 14px;
  align-items: center;
  background-color: ${(props: any) => (props.isDraw ? '#eaf2ff' : '#eaf9f0')};
  border-width: 1px;
  border-color: ${(props: any) => (props.isDraw ? '#bfd7ff' : '#bdeccf')};
`;

const CelebrationTitle = styled.Text`
  font-size: 19px;
  font-weight: 800;
  color: #1f2a44;
`;

const CelebrationSubTitle = styled.Text`
  margin-top: 4px;
  font-size: 13px;
  font-weight: 600;
  color: #4b5878;
`;

const ResetButton = styled.TouchableOpacity`
  background-color: #f68712;
  margin-top: 18px;
  padding: 15px;
  border-radius: 14px;
  align-items: center;
  border-bottom-width: 4px;
  border-color: #c9620a;
`;

const ResetText = styled.Text`
  color: #fff;
  font-size: 16px;
  font-weight: 800;
`;

const ModalOverlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.45);
  justify-content: center;
  padding: 20px;
`;

const ModalCard = styled.View`
  background-color: #fff;
  border-radius: 14px;
  padding: 18px;
`;

const ModalTitle = styled.Text`
  font-size: 18px;
  font-weight: 800;
  color: #1a1a1a;
`;

const ModalMessage = styled.Text`
  margin-top: 8px;
  color: #555;
  font-size: 14px;
  line-height: 20px;
`;

const ModalActions = styled.View`
  flex-direction: row;
  margin-top: 16px;
`;

const ModalSecondaryButton = styled.TouchableOpacity`
  flex: 1;
  border-width: 1px;
  border-color: #ddd;
  border-radius: 8px;
  padding: 12px;
  align-items: center;
  margin-right: 8px;
`;

const ModalSecondaryText = styled.Text`
  color: #666;
  font-size: 14px;
  font-weight: 700;
`;

const ModalPrimaryButton = styled.TouchableOpacity`
  flex: 1;
  background-color: #f68712;
  border-radius: 8px;
  padding: 12px;
  align-items: center;
  margin-left: 8px;
`;

const ModalPrimaryText = styled.Text`
  color: #fff;
  font-size: 14px;
  font-weight: 700;
`;
