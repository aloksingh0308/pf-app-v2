import { AppColors } from '@/constants/appColors';

/** Design tokens for the customer app. Screens were hand-picking oranges (#f68712 / #ff7500 /
 *  #ff6b00) and a dozen greys; new and refreshed UI pulls from here so every page shares one
 *  palette, radius scale and type ramp. */
export const T = {
  color: {
    brand: AppColors.cta,
    brandSoft: '#fff3e8',
    brandBorder: '#ffd9b8',
    ink: '#1c1917',
    inkSoft: '#44403c',
    muted: '#78716c',
    faint: '#a8a29e',
    line: '#eeebe8',
    surface: '#ffffff',
    canvas: '#fcfaf8',
    /** Text-field fill on the login / sign-up screens (orange stays for focus + buttons). */
    inputBg: '#f4f4f5',
    success: '#16a34a',
    successSoft: '#ecfdf3',
    danger: '#dc2626',
    star: '#f59e0b',
    ratingGood: '#16a34a',
  },
  radius: { sm: 8, md: 12, lg: 16, pill: 999 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  font: { caption: 11, small: 12, body: 14, title: 16, heading: 20 },
  shadow: {
    card: { shadowColor: '#1c1917', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
    float: { shadowColor: '#1c1917', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  },
} as const;
