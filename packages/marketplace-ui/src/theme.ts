/**
 * Colour tokens. Single source of truth — never inline a hex value in a component or CSS module.
 *
 * The first four are lifted verbatim from erc8004-dashboard/src/index.css and App.tsx, which has
 * no token file of its own. Everything after them is a marketplace-ui addition, derived from that
 * base so the two dashboards stay visually reconcilable.
 */
export const theme = {
  // ── from erc8004-dashboard ────────────────────────────────────────────────
  bg: '#0b0d10',
  text: '#f1ede4',
  accent: '#f5a524',
  textMuted: '#a9a397',

  // ── marketplace-ui additions ──────────────────────────────────────────────
  surface: '#12151a',
  surfaceRaised: '#181c22',
  border: '#242932',
  borderStrong: '#333a45',
  accentSoft: 'rgba(245, 165, 36, 0.12)',
  success: '#5cc98a',
  successSoft: 'rgba(92, 201, 138, 0.12)',
  danger: '#e5674f',
  dangerSoft: 'rgba(229, 103, 79, 0.12)',
  warning: '#e0b341',
  skeleton: '#1c2027',

  // Map of Agents edges. Dimmed derivations of accent/success: on a dense canvas the edges are
  // background, and node labels have to stay readable over them.
  linkPurchase: 'rgba(245, 165, 36, 0.55)',
  linkPayout: 'rgba(92, 201, 138, 0.45)',
} as const;

export type ThemeToken = keyof typeof theme;

/** kebab-cases a token name: `surfaceRaised` → `--mp-surface-raised`. */
function cssVarName(token: string): string {
  return `--mp-${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/**
 * Stamp the tokens onto :root as custom properties, so CSS modules can use `var(--mp-bg)` while
 * the values stay defined once, in TypeScript.
 */
export function applyTheme(root: HTMLElement = document.documentElement): void {
  for (const [token, value] of Object.entries(theme)) {
    root.style.setProperty(cssVarName(token), value);
  }
}
