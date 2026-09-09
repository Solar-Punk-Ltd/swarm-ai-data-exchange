import { useMemo } from 'react';
import qrcode from 'qrcode-generator';
import styles from './styles.module.css';

/**
 * Modules of light margin around the symbol. Four is the spec minimum, and omitting it is the
 * classic "scans on one phone but not another" bug — the decoder needs the quiet zone to find the
 * symbol's edges at all.
 */
const QUIET_ZONE = 4;

export interface QrCodeProps {
  value: string;
  /** Rendered edge length in px, quiet zone included. */
  size?: number;
}

/**
 * A QR code as inline SVG.
 *
 * Built from `qrcode-generator`'s matrix (`getModuleCount` + `isDark`) rather than its
 * `createSvgTag()` / `createImgTag()` helpers: those return HTML strings, which would need
 * `dangerouslySetInnerHTML`, and they bake their own colours in, which the never-inline-a-hex rule
 * forbids. One `<path>` of per-module subpaths, so a version-6 symbol is a single DOM node rather
 * than ~700 rects.
 *
 * **Polarity is deliberate.** Modules are painted `--mp-bg` on a `--mp-text` field — dark on
 * light — even though the rest of the dashboard is light on dark. Inverted codes are optional for
 * a decoder and plenty of Android scanners will not read one; a QR that only works on the
 * presenter's iPhone is worse than an off-theme card.
 */
export default function QrCode({ value, size = 240 }: QrCodeProps) {
  const { moduleCount, path } = useMemo(() => {
    // Type 0 picks the smallest version that fits; 'M' is ~15% recovery, the usual screen default.
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();

    const moduleCount = qr.getModuleCount();
    const parts: string[] = [];
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (qr.isDark(row, col)) {
          parts.push(`M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`);
        }
      }
    }
    return { moduleCount, path: parts.join('') };
  }, [value]);

  const extent = moduleCount + QUIET_ZONE * 2;

  return (
    <svg
      className={styles.qrSvg}
      width={size}
      height={size}
      viewBox={`0 0 ${extent} ${extent}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR code for ${value}`}
    >
      <rect width={extent} height={extent} fill="var(--mp-text)" />
      <path d={path} fill="var(--mp-bg)" />
    </svg>
  );
}
