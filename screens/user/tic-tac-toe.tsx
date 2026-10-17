import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import { AppStrings } from '@/constants/appStrings';
import React, { useMemo, useState } from 'react';
import { Animated, Easing, Modal } from 'react-native';
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

  const winner = useMemo(() => getWinner(board), [board]);
  const isDraw = useMemo(() => !winner && board.every((cell) => cell !== null), [board, winner]);

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
        ? 'You: X | Computer: O'
        : `Turn: ${turn}`;

  const celebrationTitle = winner
    ? `Player ${winner} Wins!`
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

      <Content>
        <ModeRow>
          <ModeButton active={mode === 'one'} onPress={() => { setMode('one'); resetGame(); }}>
            <ModeButtonText active={mode === 'one'}>1 Player</ModeButtonText>
          </ModeButton>
          <ModeButton active={mode === 'two'} onPress={() => { setMode('two'); resetGame(); }}>
            <ModeButtonText active={mode === 'two'}>2 Player</ModeButtonText>
          </ModeButton>
        </ModeRow>

        <StatusText>{statusText}</StatusText>
        <ChanceText>{AppStrings.game.freeRestartLabel.replace('{COUNT}', String(freeRestartsLeft))}</ChanceText>

        <Board>
          {board.map((cell, index) => (
            <CellButton key={index} onPress={() => handleCellPress(index)}>
              <CellText>{cell || ''}</CellText>
            </CellButton>
          ))}
        </Board>

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

        <ResetButton onPress={handleRestartRequest}>
          <ResetText>Restart Game</ResetText>
        </ResetButton>

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

const Container = styled(PageScreen)`
  flex: 1;
  background-color: #fff;
`;





const Content = styled.View`
  flex: 1;
  padding: 16px;
`;

const ModeRow = styled.View`
  flex-direction: row;
  background-color: #f5f5f5;
  border-radius: 10px;
  padding: 4px;
`;

const ModeButton = styled.TouchableOpacity<{ active: boolean }>`
  flex: 1;
  padding: 10px;
  border-radius: 8px;
  align-items: center;
  background-color: ${(props: any) => (props.active ? '#f68712' : 'transparent')};
`;

const ModeButtonText = styled.Text<{ active: boolean }>`
  color: ${(props: any) => (props.active ? '#fff' : '#555')};
  font-weight: 700;
  font-size: 14px;
`;

const StatusText = styled.Text`
  margin-top: 16px;
  margin-bottom: 8px;
  font-size: 16px;
  font-weight: 600;
  color: #333;
  text-align: center;
`;

const ChanceText = styled.Text`
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 600;
  color: #666;
  text-align: center;
`;

const Board = styled.View`
  width: 100%;
  aspect-ratio: 1;
  flex-direction: row;
  flex-wrap: wrap;
  border-width: 1px;
  border-color: #e6e6e6;
  border-radius: 12px;
  overflow: hidden;
`;

const CellButton = styled.TouchableOpacity`
  width: 33.3333%;
  height: 33.3333%;
  align-items: center;
  justify-content: center;
  border-width: 0.5px;
  border-color: #e6e6e6;
  background-color: #fff;
`;

const CelebrationWrap = styled(Animated.View) <{ isDraw: boolean }>`
  margin-top: 14px;
  border-radius: 12px;
  padding: 12px;
  align-items: center;
  background-color: ${(props: any) => (props.isDraw ? '#eaf2ff' : '#eaf9f0')};
  border-width: 1px;
  border-color: ${(props: any) => (props.isDraw ? '#bfd7ff' : '#bdeccf')};
`;

const CelebrationTitle = styled.Text`
  font-size: 18px;
  font-weight: 800;
  color: #1f2a44;
`;

const CelebrationSubTitle = styled.Text`
  margin-top: 4px;
  font-size: 13px;
  font-weight: 600;
  color: #4b5878;
`;

const CellText = styled.Text`
  font-size: 40px;
  font-weight: 700;
  color: #282939;
`;

const ResetButton = styled.TouchableOpacity`
  background-color: #f68712;
  margin-top: 18px;
  padding: 14px;
  border-radius: 10px;
  align-items: center;
`;

const ResetText = styled.Text`
  color: #fff;
  font-size: 16px;
  font-weight: 700;
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
