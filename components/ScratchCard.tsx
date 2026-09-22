import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, PanResponder } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Mask, Rect, Stop } from 'react-native-svg';
import styled from 'styled-components/native';

export type ScratchRewardView = {
  title: string;
  description: string;
  couponCode: string;
  isCoinReward?: boolean;
  coinsEarned?: number;
};

type ScratchCardProps = {
  reward: ScratchRewardView;
  onScratchComplete: () => void;
  onContinue?: () => void;
  variant?: 'default' | 'embedded';
};

const SCRATCH_RADIUS = 18;
const CELL_SIZE = 16;
const REVEAL_THRESHOLD = 45;
const MAX_POINTS = 900;

type ScratchPoint = { x: number; y: number };
type SparkleParticle = {
  id: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  size: number;
  opacity: Animated.Value;
  scale: Animated.Value;
  translateX: Animated.Value;
  translateY: Animated.Value;
};

export default function ScratchCard({ reward, onScratchComplete, onContinue, variant = 'default' }: ScratchCardProps) {
  const [scratchPoints, setScratchPoints] = useState<ScratchPoint[]>([]);
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
  const [scratchedPercent, setScratchedPercent] = useState(0);
  const [isRevealed, setIsRevealed] = useState(false);
  const [copyStatus, setCopyStatus] = useState('Copy');
  const touchedCellsRef = useRef<Set<string>>(new Set());
  const lastPointRef = useRef<ScratchPoint | null>(null);
  const hasCompletedRef = useRef(false);
  const [particles, setParticles] = useState<SparkleParticle[]>([]);

  const pulseAnim = useRef(new Animated.Value(0)).current;
  const revealAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    if (!isRevealed) {
      pulse.start();
    }

    return () => {
      pulse.stop();
    };
  }, [isRevealed, pulseAnim]);

  useEffect(() => {
    if (!isRevealed) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => { });

    Animated.timing(revealAnim, {
      toValue: 1,
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    if (surfaceSize.width > 0 && surfaceSize.height > 0) {
      const centerX = surfaceSize.width / 2;
      const centerY = surfaceSize.height / 2;
      const generated: SparkleParticle[] = Array.from({ length: 14 }, (_, index) => {
        const angle = (Math.PI * 2 * index) / 14;
        const distance = 22 + Math.random() * 46;
        return {
          id: index,
          x: centerX,
          y: centerY,
          tx: Math.cos(angle) * distance,
          ty: Math.sin(angle) * distance,
          size: 4 + Math.random() * 5,
          opacity: new Animated.Value(0),
          scale: new Animated.Value(0.3),
          translateX: new Animated.Value(0),
          translateY: new Animated.Value(0),
        };
      });

      setParticles(generated);

      Animated.parallel(
        generated.map((particle) =>
          Animated.parallel([
            Animated.timing(particle.opacity, {
              toValue: 1,
              duration: 120,
              useNativeDriver: true,
            }),
            Animated.timing(particle.scale, {
              toValue: 1,
              duration: 220,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(particle.translateX, {
              toValue: particle.tx,
              duration: 360,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(particle.translateY, {
              toValue: particle.ty,
              duration: 360,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ])
        )
      ).start(() => {
        Animated.parallel(
          generated.map((particle) =>
            Animated.timing(particle.opacity, {
              toValue: 0,
              duration: 220,
              useNativeDriver: true,
            })
          )
        ).start();
      });
    }
  }, [isRevealed, revealAnim]);

  const progressText = useMemo(() => {
    if (isRevealed) return 'Reward unlocked';
    return `Scratch area: ${scratchedPercent}%`;
  }, [isRevealed, scratchedPercent]);

  const overlayOpacity = useMemo(() => {
    if (isRevealed) {
      return revealAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
    }
    return 1;
  }, [isRevealed, revealAnim]);

  const hintOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.95] });

  const onSurfaceLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSurfaceSize({ width: Math.max(1, width), height: Math.max(1, height) });
  };

  const pushScratchPoint = (point: ScratchPoint) => {
    if (isRevealed || surfaceSize.width <= 0 || surfaceSize.height <= 0) {
      return;
    }

    const x = Math.max(0, Math.min(surfaceSize.width, point.x));
    const y = Math.max(0, Math.min(surfaceSize.height, point.y));

    const previous = lastPointRef.current;
    if (previous) {
      const dx = x - previous.x;
      const dy = y - previous.y;
      if ((dx * dx + dy * dy) < 36) {
        return;
      }
    }
    lastPointRef.current = { x, y };

    const cellX = Math.floor(x / CELL_SIZE);
    const cellY = Math.floor(y / CELL_SIZE);
    touchedCellsRef.current.add(`${cellX}:${cellY}`);

    setScratchPoints((prev) => {
      if (prev.length >= MAX_POINTS) {
        return prev;
      }
      return [...prev, { x, y }];
    });

    const totalCells = Math.max(1, Math.ceil(surfaceSize.width / CELL_SIZE) * Math.ceil(surfaceSize.height / CELL_SIZE));
    const percent = Math.min(100, Math.round((touchedCellsRef.current.size / totalCells) * 100));
    setScratchedPercent(percent);

    if (percent >= REVEAL_THRESHOLD && !hasCompletedRef.current) {
      hasCompletedRef.current = true;
      setIsRevealed(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => { });
      onScratchComplete();
    }
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !isRevealed,
        onMoveShouldSetPanResponder: () => !isRevealed,
        onPanResponderGrant: (event) => {
          pushScratchPoint({
            x: event.nativeEvent.locationX,
            y: event.nativeEvent.locationY,
          });
        },
        onPanResponderMove: (event) => {
          pushScratchPoint({
            x: event.nativeEvent.locationX,
            y: event.nativeEvent.locationY,
          });
        },
      }),
    [isRevealed, surfaceSize.width, surfaceSize.height]
  );

  const handleCopyCode = async () => {
    if (reward.isCoinReward) {
      return;
    }
    await Clipboard.setStringAsync(reward.couponCode);
    setCopyStatus('Copied');
    setTimeout(() => setCopyStatus('Copy'), 1200);
  };

  return (
    <Container style={variant === 'embedded' ? { backgroundColor: 'transparent', borderWidth: 0, padding: 0 } : undefined}>
      {variant === 'default' ? <HeaderText>Scratch & Win</HeaderText> : null}
      {variant === 'default' ? <SubText>Scratch the card to reveal your reward coupon.</SubText> : null}

      <CardArea style={variant === 'embedded' ? { marginTop: 0, backgroundColor: '#ffffff', borderColor: '#ffe2c4', padding: 10 } : undefined}>
        
        {variant === 'default' ? <RewardTitle>{reward.title}</RewardTitle> : null}
        {variant === 'default' && reward.description ? (<RewardDescription>{reward.description}</RewardDescription>) : null}
        {variant === 'default' ? <RewardHint>Scratch the silver layer to unlock your coupon</RewardHint> : null}
        {!isRevealed ? (
          <ScratchSurface {...panResponder.panHandlers} onLayout={onSurfaceLayout} style={variant === 'embedded' ? { height: 175, borderRadius: 14, marginTop: 4 } : undefined}>
            <UnderLayer>
              <UnderTitle style={variant === 'embedded' ? { fontSize: 34, lineHeight: 38, textAlign: 'center' } : undefined}>{variant === 'embedded' ? 'Scratch here' : reward.title}</UnderTitle>
              <UnderText style={variant === 'embedded' ? { fontSize: 18, lineHeight: 24, textAlign: 'center' } : undefined}>{variant === 'embedded' ? 'Scratch and reveal your reward' : reward.description}</UnderText>
            </UnderLayer>

            <AnimatedOverlay style={{ opacity: overlayOpacity }}>
              {surfaceSize.width > 0 && surfaceSize.height > 0 ? (
                <Svg width={surfaceSize.width} height={surfaceSize.height}>
                  <Defs>
                    <LinearGradient id="scratchGradient" x1="0" y1="0" x2="1" y2="1">
                      <Stop offset="0" stopColor="#C9CED8" />
                      <Stop offset="0.45" stopColor="#9EA6B4" />
                      <Stop offset="1" stopColor="#BDC3CF" />
                    </LinearGradient>
                    <Mask id="scratchMask" x="0" y="0" width={surfaceSize.width} height={surfaceSize.height}>
                      <Rect x="0" y="0" width={surfaceSize.width} height={surfaceSize.height} fill="white" />
                      {scratchPoints.map((point, index) => (
                        <Circle
                          key={`${index}-${point.x}-${point.y}`}
                          cx={point.x}
                          cy={point.y}
                          r={SCRATCH_RADIUS}
                          fill="black"
                        />
                      ))}
                    </Mask>
                  </Defs>

                  <Rect
                    x="0"
                    y="0"
                    width={surfaceSize.width}
                    height={surfaceSize.height}
                    fill="url(#scratchGradient)"
                    mask="url(#scratchMask)"
                    rx="12"
                  />
                </Svg>
              ) : null}

              {!isRevealed ? (
                <HintOverlay>
                  <AnimatedHint style={{ opacity: hintOpacity }}>
                    <MaskText style={variant === 'embedded' ? { fontSize: 18, lineHeight: 22 } : undefined}>Scratch Here</MaskText>
                    <MaskProgress style={variant === 'embedded' ? { fontSize: 11 } : undefined}>{progressText}</MaskProgress>
                  </AnimatedHint>
                </HintOverlay>
              ) : null}
            </AnimatedOverlay>

            {particles.map((particle) => (
              <Sparkle
                key={particle.id}
                style={{
                  width: particle.size,
                  height: particle.size,
                  left: particle.x,
                  top: particle.y,
                  opacity: particle.opacity,
                  transform: [
                    { translateX: particle.translateX },
                    { translateY: particle.translateY },
                    { scale: particle.scale },
                  ],
                }}
              />
            ))}
          </ScratchSurface>
        ) : null}
        {isRevealed ? (
          <RevealArea>
            {reward.isCoinReward ? (
              <>
                <CouponLabel>Reward Coins</CouponLabel>
                {typeof reward.coinsEarned === 'number' && reward.coinsEarned > 0 ? (
                  <CoinAmountText>You won {Math.floor(reward.coinsEarned)} coins</CoinAmountText>
                ) : null}
                <CoinInfoText>
                  Coins will be added in Reward coins after you scratch
                </CoinInfoText>
              </>
            ) : (
              <>
                <CouponLabel>Coupon Code</CouponLabel>
                <CouponCode selectable>{reward.couponCode}</CouponCode>
                <ActionsRow>
                  <SecondaryButton onPress={handleCopyCode}>
                    <SecondaryButtonText>{copyStatus}</SecondaryButtonText>
                  </SecondaryButton>
                </ActionsRow>
              </>
            )}
          </RevealArea>
        ) : null}
      </CardArea>
    </Container>
  );
}

const Container = styled.View`
  background-color: #fff;
  border-radius: 14px;
  border-width: 1px;
  border-color: #ffd699;
  padding: 16px;
`;

const HeaderText = styled.Text`
  font-size: 20px;
  font-weight: 700;
  color: #222;
`;

const SubText = styled.Text`
  margin-top: 6px;
  font-size: 13px;
  color: #555;
`;

const CardArea = styled.View`
  margin-top: 16px;
  border-radius: 12px;
  background-color: #fff7ea;
  padding: 14px;
`;

const RewardTitle = styled.Text`
  font-size: 18px;
  font-weight: 700;
  color: #f68712;
`;

const RewardDescription = styled.Text`
  margin-top: 6px;
  font-size: 14px;
  color: #333;
`;

const RewardHint = styled.Text`
  margin-top: 8px;
  font-size: 12px;
  color: #6b7280;
`;

const ScratchSurface = styled.View`
  margin-top: 14px;
  border-radius: 10px;
  height: 120px;
  overflow: hidden;
`;

const UnderLayer = styled.View`
  flex: 1;
  border-radius: 10px;
  border-width: 1px;
  border-color: #f68712;
  background-color: #fff;
  padding: 14px;
`;

const UnderTitle = styled.Text`
  color: #f68712;
  font-size: 18px;
  font-weight: 800;
`;

const UnderText = styled.Text`
  margin-top: 6px;
  color: #374151;
  font-size: 13px;
`;

const AnimatedOverlay = styled(Animated.View)`
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
`;

const Sparkle = styled(Animated.View)`
  position: absolute;
  border-radius: 999px;
  background-color: #fbbf24;
`;

const HintOverlay = styled.View`
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  justify-content: center;
  align-items: center;
`;

const AnimatedHint = styled(Animated.View)`
  align-items: center;
`;

const MaskText = styled.Text`
  color: #fff;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.3px;
`;

const MaskProgress = styled.Text`
  margin-top: 8px;
  color: #e5e7eb;
  font-size: 12px;
`;

const RevealArea = styled.View`
  margin-top: 14px;
  border-radius: 10px;
  border-width: 1px;
  border-color: #f68712;
  padding: 12px;
  background-color: #fff;
`;

const CouponLabel = styled.Text`
  color: #666;
  font-size: 12px;
`;

const CouponCode = styled.Text`
  margin-top: 6px;
  color: #111;
  font-size: 20px;
  font-weight: 800;
`;

const ActionsRow = styled.View`
  margin-top: 12px;
  flex-direction: row;
  gap: 10px;
`;

const SecondaryButton = styled.TouchableOpacity`
  flex: 1;
  border-radius: 8px;
  border-width: 1px;
  border-color: #f68712;
  align-items: center;
  justify-content: center;
  padding: 10px;
`;

const CoinAmountText = styled.Text`
  margin-top: 8px;
  font-size: 20px;
  font-weight: 800;
  color: #f68712;
`;

const CoinInfoText = styled.Text`
  margin-top: 6px;
  font-size: 13px;
  line-height: 19px;
  color: #444;
`;

const SecondaryButtonText = styled.Text`
  color: #f68712;
  font-size: 14px;
  font-weight: 600;
`;

const PrimaryButton = styled.TouchableOpacity`
  flex: 1;
  border-radius: 8px;
  background-color: #f68712;
  align-items: center;
  justify-content: center;
  padding: 10px;
  opacity: ${(props: any) => (props.disabled ? 0.6 : 1)};
`;

const PrimaryButtonText = styled.Text`
  color: #fff;
  font-size: 14px;
  font-weight: 700;
`;
