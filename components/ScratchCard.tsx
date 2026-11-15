import Ionicons from '@react-native-vector-icons/ionicons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, GestureResponderEvent, LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Mask, Path, Rect, Stop } from 'react-native-svg';
import { T } from '@/constants/tokens';

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
  /** Kept for existing call sites — the card always renders in its compact (modal) form. */
  variant?: 'default' | 'embedded';
};

const SURFACE_HEIGHT = 190;
const BRUSH_RADIUS = 22;
/** Coverage grid — a cell counts as scratched once the brush has passed over its centre. */
const CELL_SIZE = 10;
const REVEAL_THRESHOLD = 0.5;
const SPARKLE_COUNT = 16;

type Point = { x: number; y: number };
type Sparkle = { id: number; size: number; color: string; dx: number; dy: number; progress: Animated.Value };

const SPARKLE_COLORS = ['#fbbf24', T.color.brand, '#f59e0b', '#fb923c'];

/**
 * Scratch-to-reveal card. The scratched path is one SVG stroke in the cover's mask (round caps
 * and joins, so fast swipes leave a continuous trail instead of dotted circles), redrawn at most
 * once per animation frame. Touches are tracked against the surface's own origin so the finger
 * never "jumps" when it crosses a child view. Past REVEAL_THRESHOLD of the area the cover fades
 * out over the real prize, which sits underneath the whole time.
 */
export default function ScratchCard({ reward, onScratchComplete, onContinue }: ScratchCardProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [pathD, setPathD] = useState('');
  const [progress, setProgress] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [coverGone, setCoverGone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  const sizeRef = useRef(size);
  sizeRef.current = size;
  const pathRef = useRef('');
  const frameRef = useRef<number | null>(null);
  const originRef = useRef<Point>({ x: 0, y: 0 });
  const lastRef = useRef<Point | null>(null);
  const cellsRef = useRef<Set<number>>(new Set());
  const revealedRef = useRef(false);
  const completeRef = useRef(onScratchComplete);
  completeRef.current = onScratchComplete;

  const coverOpacity = useRef(new Animated.Value(1)).current;
  const hintPulse = useRef(new Animated.Value(0)).current;
  const prizeScale = useRef(new Animated.Value(0.94)).current;

  useEffect(() => {
    if (revealed) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(hintPulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(hintPulse, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [revealed, hintPulse]);

  useEffect(() => () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); }, []);

  const flush = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setPathD(pathRef.current);
      const { width, height } = sizeRef.current;
      const total = Math.ceil(width / CELL_SIZE) * Math.ceil(height / CELL_SIZE);
      setProgress(total > 0 ? Math.min(1, cellsRef.current.size / total) : 0);
    });
  }, []);

  const reveal = useCallback(() => {
    if (revealedRef.current) return;
    revealedRef.current = true;
    setRevealed(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    completeRef.current();

    const { width, height } = sizeRef.current;
    const generated: Sparkle[] = Array.from({ length: SPARKLE_COUNT }, (_, id) => {
      const angle = (Math.PI * 2 * id) / SPARKLE_COUNT + Math.random() * 0.3;
      const distance = Math.min(width, height) * (0.3 + Math.random() * 0.25);
      return {
        id,
        size: 5 + Math.random() * 5,
        color: SPARKLE_COLORS[id % SPARKLE_COLORS.length],
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance,
        progress: new Animated.Value(0),
      };
    });
    setSparkles(generated);

    Animated.parallel([
      Animated.timing(coverOpacity, { toValue: 0, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(prizeScale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
      ...generated.map((sparkle) =>
        Animated.timing(sparkle.progress, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      ),
    ]).start(() => {
      setCoverGone(true);
      setSparkles([]);
    });
  }, [coverOpacity, prizeScale]);

  /** Marks every grid cell the brush covers between two points. */
  const markCells = useCallback((from: Point, to: Point) => {
    const { width, height } = sizeRef.current;
    const cols = Math.ceil(width / CELL_SIZE);
    const rows = Math.ceil(height / CELL_SIZE);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / (BRUSH_RADIUS / 2)));
    const reach = Math.ceil(BRUSH_RADIUS / CELL_SIZE);
    for (let step = 0; step <= steps; step++) {
      const x = from.x + ((to.x - from.x) * step) / steps;
      const y = from.y + ((to.y - from.y) * step) / steps;
      const cx = Math.floor(x / CELL_SIZE);
      const cy = Math.floor(y / CELL_SIZE);
      for (let gx = cx - reach; gx <= cx + reach; gx++) {
        if (gx < 0 || gx >= cols) continue;
        for (let gy = cy - reach; gy <= cy + reach; gy++) {
          if (gy < 0 || gy >= rows) continue;
          const centerX = gx * CELL_SIZE + CELL_SIZE / 2;
          const centerY = gy * CELL_SIZE + CELL_SIZE / 2;
          if ((centerX - x) ** 2 + (centerY - y) ** 2 <= BRUSH_RADIUS ** 2) cellsRef.current.add(gy * cols + gx);
        }
      }
    }
  }, []);

  const pointFrom = (event: GestureResponderEvent): Point => {
    const { width, height } = sizeRef.current;
    return {
      x: Math.max(0, Math.min(width, event.nativeEvent.pageX - originRef.current.x)),
      y: Math.max(0, Math.min(height, event.nativeEvent.pageY - originRef.current.y)),
    };
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !revealedRef.current,
      onMoveShouldSetPanResponder: () => !revealedRef.current,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (event) => {
        // Children are pointerEvents="none", so locationX/Y here are relative to the surface —
        // fix the origin once and follow pageX/Y for the rest of the stroke.
        originRef.current = {
          x: event.nativeEvent.pageX - event.nativeEvent.locationX,
          y: event.nativeEvent.pageY - event.nativeEvent.locationY,
        };
        const point = pointFrom(event);
        lastRef.current = point;
        // A zero-length segment draws a dot (round cap) where the finger lands.
        pathRef.current += `M${point.x.toFixed(1)} ${point.y.toFixed(1)}l0.1 0`;
        markCells(point, point);
        Haptics.selectionAsync().catch(() => {});
        flush();
      },
      onPanResponderMove: (event) => {
        if (revealedRef.current) return;
        const point = pointFrom(event);
        const last = lastRef.current;
        if (last && Math.hypot(point.x - last.x, point.y - last.y) < 2) return;
        pathRef.current += `L${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
        markCells(last || point, point);
        lastRef.current = point;
        flush();
      },
      onPanResponderRelease: () => {
        lastRef.current = null;
      },
    })
  ).current;

  useEffect(() => {
    if (!revealed && progress >= REVEAL_THRESHOLD) reveal();
  }, [progress, revealed, reveal]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };

  const copyCode = async () => {
    await Clipboard.setStringAsync(reward.couponCode);
    setCopied(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setTimeout(() => setCopied(false), 1400);
  };

  const hintOpacity = hintPulse.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] });
  const hintScale = hintPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const coins = Math.floor(Number(reward.coinsEarned || 0));

  return (
    <View>
      <View style={styles.surface} onLayout={onLayout} {...(coverGone ? {} : panResponder.panHandlers)}>
        {/* The prize — always underneath, so scratching shows it through the cover. */}
        <Animated.View pointerEvents="none" style={[styles.prize, { transform: [{ scale: prizeScale }] }]}>
          <View style={styles.prizeIcon}>
            <Ionicons name={reward.isCoinReward ? 'sparkles' : 'pricetag'} size={22} color={T.color.brand} />
          </View>
          {reward.isCoinReward ? (
            <>
              <Text style={styles.prizeBig}>{coins > 0 ? `${coins} coins` : 'Reward coins'}</Text>
              <Text numberOfLines={2} style={styles.prizeText}>{reward.title}</Text>
            </>
          ) : (
            <>
              <Text numberOfLines={2} style={styles.prizeTitle}>{reward.title}</Text>
              {reward.description ? <Text numberOfLines={2} style={styles.prizeText}>{reward.description}</Text> : null}
              <View style={styles.codeChip}><Text selectable style={styles.codeText}>{reward.couponCode}</Text></View>
            </>
          )}
        </Animated.View>

        {!coverGone && size.width > 0 ? (
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: coverOpacity }]}>
            <Svg width={size.width} height={size.height}>
              <Defs>
                <LinearGradient id="cover" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0" stopColor="#ffa040" />
                  <Stop offset="0.55" stopColor={T.color.brand} />
                  <Stop offset="1" stopColor="#e85d00" />
                </LinearGradient>
                <Mask id="scratched" x="0" y="0" width={size.width} height={size.height} maskUnits="userSpaceOnUse">
                  <Rect x="0" y="0" width={size.width} height={size.height} fill="white" />
                  {pathD ? (
                    <Path d={pathD} stroke="black" strokeWidth={BRUSH_RADIUS * 2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  ) : null}
                </Mask>
              </Defs>
              <G mask="url(#scratched)">
                <Rect x="0" y="0" width={size.width} height={size.height} fill="url(#cover)" />
                {/* Confetti dots so the cover reads as a scratch card, not a button. */}
                {COVER_DOTS.map((dot, index) => (
                  <Circle key={index} cx={dot.x * size.width} cy={dot.y * size.height} r={dot.r} fill="#ffffff" opacity={0.18} />
                ))}
              </G>
            </Svg>
            {/* Gone at the first stroke so it never sits on top of the prize showing through. */}
            {!revealed && !pathD ? (
              <Animated.View style={[styles.hint, { opacity: hintOpacity, transform: [{ scale: hintScale }] }]}>
                <Ionicons name="finger-print" size={28} color="#fff" />
                <Text style={styles.hintTitle}>Scratch here</Text>
                <Text style={styles.hintText}>Rub with your finger to reveal</Text>
              </Animated.View>
            ) : null}
          </Animated.View>
        ) : null}

        {sparkles.map((sparkle) => (
          <Animated.View
            key={sparkle.id}
            pointerEvents="none"
            style={[
              styles.sparkle,
              {
                width: sparkle.size,
                height: sparkle.size,
                left: size.width / 2,
                top: size.height / 2,
                backgroundColor: sparkle.color,
                opacity: sparkle.progress.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
                transform: [
                  { translateX: sparkle.progress.interpolate({ inputRange: [0, 1], outputRange: [0, sparkle.dx] }) },
                  { translateY: sparkle.progress.interpolate({ inputRange: [0, 1], outputRange: [0, sparkle.dy] }) },
                  { scale: sparkle.progress.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.3, 1.2, 0.6] }) },
                ],
              },
            ]}
          />
        ))}
      </View>

      {revealed ? (
        <View style={styles.actions}>
          {reward.isCoinReward ? (
            <View style={styles.coinNote}>
              <Ionicons name="checkmark-circle" size={16} color={T.color.success} />
              <Text numberOfLines={1} style={styles.coinNoteText}>Coins added</Text>
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => void copyCode()} style={[styles.button, styles.buttonOutline]}>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={T.color.brand} />
              <Text style={styles.buttonOutlineText}>{copied ? 'Copied' : 'Copy code'}</Text>
            </Pressable>
          )}
          {onContinue ? (
            <Pressable accessibilityRole="button" onPress={onContinue} style={[styles.button, styles.buttonSolid]}>
              <Text style={styles.buttonSolidText}>Done</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(Math.min(1, progress / REVEAL_THRESHOLD) * 100)}%` }]} />
        </View>
      )}
    </View>
  );
}

/** Fixed (not random) so the pattern doesn't reshuffle on every redraw. */
const COVER_DOTS = [
  { x: 0.08, y: 0.18, r: 5 }, { x: 0.22, y: 0.82, r: 3 }, { x: 0.35, y: 0.12, r: 2.5 }, { x: 0.5, y: 0.9, r: 4 },
  { x: 0.64, y: 0.1, r: 3.5 }, { x: 0.78, y: 0.78, r: 5 }, { x: 0.92, y: 0.25, r: 3 }, { x: 0.12, y: 0.55, r: 2 },
  { x: 0.88, y: 0.55, r: 2.5 }, { x: 0.7, y: 0.42, r: 1.8 }, { x: 0.3, y: 0.45, r: 1.8 }, { x: 0.96, y: 0.92, r: 2 },
];

const styles = StyleSheet.create({
  surface: { height: SURFACE_HEIGHT, borderRadius: T.radius.lg, overflow: 'hidden', backgroundColor: T.color.surface },
  prize: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: T.space.lg,
    borderRadius: T.radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: T.color.brandBorder,
    backgroundColor: T.color.brandSoft,
  },
  prizeIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: T.color.surface, alignItems: 'center', justifyContent: 'center', marginBottom: T.space.sm },
  prizeTitle: { fontSize: T.font.heading, fontWeight: '800', color: T.color.ink, textAlign: 'center' },
  prizeBig: { fontSize: 28, fontWeight: '900', color: T.color.brand, textAlign: 'center' },
  prizeText: { marginTop: 4, fontSize: T.font.small, color: T.color.muted, textAlign: 'center' },
  codeChip: { marginTop: T.space.sm, paddingHorizontal: T.space.md, paddingVertical: 6, borderRadius: T.radius.sm, backgroundColor: T.color.surface, borderWidth: 1, borderColor: T.color.brandBorder },
  codeText: { fontSize: T.font.title, fontWeight: '800', letterSpacing: 1.2, color: T.color.ink },
  hint: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  hintTitle: { marginTop: 6, fontSize: 22, fontWeight: '900', color: '#fff' },
  hintText: { marginTop: 2, fontSize: T.font.small, fontWeight: '600', color: 'rgba(255,255,255,0.9)' },
  sparkle: { position: 'absolute', borderRadius: 999 },
  progressTrack: { marginTop: T.space.md, height: 4, borderRadius: 2, backgroundColor: T.color.line, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: T.color.brand },
  actions: { marginTop: T.space.md, flexDirection: 'row', gap: T.space.sm },
  button: { flex: 1, minHeight: 46, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: T.radius.md },
  buttonOutline: { borderWidth: 1, borderColor: T.color.brand, backgroundColor: T.color.surface },
  buttonOutlineText: { fontSize: T.font.body, fontWeight: '700', color: T.color.brand },
  buttonSolid: { backgroundColor: T.color.brand },
  buttonSolidText: { fontSize: T.font.body, fontWeight: '800', color: '#fff' },
  coinNote: { flex: 1, minHeight: 46, paddingHorizontal: T.space.md, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: T.radius.md, backgroundColor: T.color.successSoft },
  coinNoteText: { fontSize: T.font.body, fontWeight: '700', color: T.color.success },
});
