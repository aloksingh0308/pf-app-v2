/**
 * Screen-size scaling utilities.
 *
 * The app's styled-components were designed against a single reference
 * device size. These helpers scale those fixed values proportionally to the
 * device actually running the app, so layouts stay visually consistent
 * (rather than clipped/oversized) across small phones, large phones, and
 * tablets.
 *
 * Base dimensions match the design reference size (a common 375x812
 * portrait phone viewport) used when the original fixed px values were
 * chosen throughout the app.
 */
import { Dimensions, PixelRatio } from 'react-native';

const BASE_WIDTH = 375;
const BASE_HEIGHT = 812;

const getWindow = () => Dimensions.get('window');

/** Scales a size horizontally relative to the device's width vs. the base design width. */
export const scale = (size: number): number => {
  const { width } = getWindow();
  return (width / BASE_WIDTH) * size;
};

/** Scales a size vertically relative to the device's height vs. the base design height. */
export const verticalScale = (size: number): number => {
  const { height } = getWindow();
  return (height / BASE_HEIGHT) * size;
};

/**
 * Scales a size horizontally, but only partway (by `factor`) toward the full
 * `scale()` result. Use for paddings/margins/dimensions where you want them
 * to grow/shrink with the screen without becoming disproportionately large
 * on tablets.
 */
export const moderateScale = (size: number, factor = 0.5): number => {
  return size + (scale(size) - size) * factor;
};

/** Vertical counterpart to `moderateScale`. */
export const moderateVerticalScale = (size: number, factor = 0.5): number => {
  return size + (verticalScale(size) - size) * factor;
};

/**
 * Scales a font size moderately with screen width and rounds to the nearest
 * device pixel, so text grows/shrinks sensibly across device sizes without
 * the extreme jumps a full linear `scale()` would produce.
 */
export const scaleFont = (size: number, factor = 0.3): number => {
  return Math.round(PixelRatio.roundToNearestPixel(moderateScale(size, factor)));
};
