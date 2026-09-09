/**
 * The network canvas.
 *
 * Two things about `react-force-graph-2d` shape this file more than taste does:
 *
 * 1. It propagates props by reference identity, so an inline accessor is re-applied on every
 *    render — and this page re-renders every 5s because the marketplace context does. Every
 *    accessor here is therefore module-level or `useCallback`, and the component is memoised so
 *    the balance tick never reaches it at all.
 * 2. It sizes itself to `window.innerWidth`/`innerHeight`, captured when the module loads. Inside
 *    a 1100px column that overflows and never responds to a resize, so the width is measured and
 *    passed explicitly.
 *
 * Colours come from `theme.ts` directly rather than `var(--mp-*)`: a 2D canvas context cannot
 * read CSS custom properties. That is the sanctioned form of "never inline a hex", not an escape
 * from it.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { ForceGraphMethods } from 'react-force-graph-2d';
import { theme } from '../theme';
import type { GraphLink, GraphNode, NodeRole } from '../lib/graph';
import styles from './styles.module.css';

const HEIGHT = 520;
/** Overlap-free frames before the separation loop stands down; ~4s, matching the cooldown. */
const SETTLE_FRAMES = 240;
/** Radius of a node with no activity. Everything else grows from here. */
const BASE_RADIUS = 4;
/**
 * Floor on the radius of a node that has an avatar: a face needs more room than a dot does, and
 * 4px of one is unreadable.
 *
 * Keyed on `avatarUrl` rather than on the decoded sprite, so the layout does not shift when an
 * image lands seconds after its node was placed. The cost is real and deliberate — it flattens
 * the area-proportional size encoding below ~5 purchases, where every agent with a face reads as
 * the same size.
 */
const AVATAR_MIN_RADIUS = 9;
/** Side of the pre-scaled sprite, in device pixels. */
const AVATAR_SPRITE_PX = 96;

function radiusOf(node: GraphNode): number {
  // Area-proportional to activity, so a busy agent reads as busier without dwarfing the rest.
  // Floored so an agent that has never traded is still a visible, clickable dot.
  const base = BASE_RADIUS * Math.sqrt(1 + node.txCount);
  return node.avatarUrl ? Math.max(base, AVATAR_MIN_RADIUS) : base;
}

/** Shared with the legend, so the two can never drift apart. */
/**
 * Keep-apart radius: the drawn circle plus room for the label under it.
 *
 * Labels are the reason this is not just the node radius. A buyer's label is ~5px per character
 * and drawn centred beneath the dot, so without the allowance two adjacent nodes stay legally
 * apart while their captions sit on top of each other.
 */
function keepApartRadius(node: GraphNode): number {
  return radiusOf(node) + 10 + node.label.length * 2.6;
}

/**
 * Push overlapping nodes apart, once per simulation tick.
 *
 * Charge alone cannot fix this graph: buyers each pay several sellers, so they share a
 * barycentre and pile up there no matter how hard the sellers are pushed outwards — turning the
 * charge up only flings the sellers further away and makes the pile look smaller.
 *
 * Driven from an animation frame this component owns, rather than through force-graph. Two of
 * its extension points were tried first and both fail silently: a force installed via
 * `d3Force('collide', …)` registers and initialises with the right nodes but is never invoked,
 * and `onEngineTick` is applied once and never replaced, so under StrictMode's double mount the
 * surviving callback is the one from the discarded first instance — permanently frozen on the
 * node array as it was before any buyer existed. Owning the loop depends on neither.
 *
 * Returns how many corrections it made, so the loop can stop once the layout has settled.
 *
 * O(n^2) with no quadtree, which is free at the tens of nodes a marketplace has and would need
 * revisiting in the thousands.
 */
function separateOverlaps(nodes: GraphNode[]): number {
  let corrections = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      // A node the simulation has not placed yet has no position to correct. Treating it as
      // sitting at the origin is what collapses the whole layout onto one diagonal: every
      // unplaced pair separates along the same arbitrary axis, and the placed nodes get dragged
      // into line with them. Leave it to d3 and pick it up on a later tick.
      if (a.x === undefined || a.y === undefined || b.x === undefined || b.y === undefined) {
        continue;
      }

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const minimum = keepApartRadius(a) + keepApartRadius(b);
      if (distance >= minimum || distance === 0) continue;

      // A fraction of the correction per tick, split evenly. Closing the whole gap at once
      // overpowers the alpha-damped forces around it and produces a rigid, unnatural lattice.
      const shift = ((minimum - distance) / distance) * 0.25;
      a.x -= dx * shift;
      a.y -= dy * shift;
      b.x += dx * shift;
      b.y += dy * shift;
      corrections += 1;
    }
  }
  return corrections;
}

export function colorForRoles(roles: Set<NodeRole>): string {
  if (roles.has('treasury')) return theme.text;
  const sells = roles.has('seller');
  const buys = roles.has('buyer');
  if (sells && buys) return theme.warning;
  if (sells) return theme.accent;
  return theme.success;
}

function colorOf(node: GraphNode): string {
  return colorForRoles(node.roles);
}

/**
 * Avatar sprites, keyed by resolved card image URL.
 *
 * Module-level, so a remount — StrictMode's double mount, or leaving the map and coming back —
 * does not re-fetch and re-decode what is already here. A present key with a null value means
 * "asked for, nothing to draw", covering both still-loading and permanently-failed; the canvas
 * treats them identically and draws the plain dot.
 *
 * **A sprite must never be painted on the pointer-area canvas.** force-graph hit-tests by painting
 * every node in a unique colour to a second, shadow canvas and reading the pixel under the cursor
 * back with `getImageData` (`force-graph.mjs:1405`). Drawing a cross-origin image taints whatever
 * canvas it reaches, and `getImageData` on a tainted canvas throws `SecurityError` — which would
 * kill every click and hover on the map at once. Card images come from a Swarm gateway that is not
 * ours, so this is the ordinary case and not the exception. `paintPointerArea` therefore paints
 * plain circles, and the taint stays on the visible canvas, which nothing ever reads back.
 *
 * For the same reason `crossOrigin` is deliberately left unset on the loader: asking for CORS from
 * a gateway that does not send the header fails the load outright, trading every avatar away for a
 * property we have no use for.
 */
const sprites = new Map<string, HTMLCanvasElement | null>();

/**
 * Decode once into a small, already-circular canvas rather than clipping and downscaling the
 * full-size source on every frame of every node.
 *
 * Centre-cropped to a square: a card's `image` is arbitrary third-party content at an arbitrary
 * aspect ratio, and a cropped face reads better than a squashed one.
 */
function toSprite(image: HTMLImageElement): HTMLCanvasElement | null {
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  if (side === 0) return null;

  const sprite = document.createElement('canvas');
  sprite.width = AVATAR_SPRITE_PX;
  sprite.height = AVATAR_SPRITE_PX;
  const ctx = sprite.getContext('2d');
  if (!ctx) return null;

  const half = AVATAR_SPRITE_PX / 2;
  ctx.beginPath();
  ctx.arc(half, half, half, 0, 2 * Math.PI);
  ctx.clip();
  ctx.drawImage(
    image,
    (image.naturalWidth - side) / 2,
    (image.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SPRITE_PX,
    AVATAR_SPRITE_PX,
  );
  return sprite;
}

/**
 * Cache hit, or start one load and report back when it lands. Safe to call from a paint loop:
 * everything after the first call for a URL is a map lookup.
 *
 * There is no error branch and no retry. A card's image is third-party and may simply not be
 * there; leaving the null in place is the whole failure path, and the node keeps its dot.
 */
function spriteFor(url: string, onLoad: () => void): HTMLCanvasElement | null {
  const cached = sprites.get(url);
  if (cached !== undefined) return cached;

  sprites.set(url, null);
  const image = new Image();
  image.onload = () => {
    const sprite = toSprite(image);
    if (!sprite) return;
    sprites.set(url, sprite);
    onLoad();
  };
  image.src = url;
  return null;
}

/**
 * Agent Card names are third-party strings — anyone can register an agent called anything — and
 * the tooltip is injected as HTML, so they are escaped rather than trusted.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function roleSummary(node: GraphNode): string {
  const roles = [...node.roles];
  if (roles.length === 0) return 'no activity';
  return roles.join(' · ');
}

const nodeTooltip = (node: GraphNode): string => {
  const lines = [
    `<strong>${escapeHtml(node.label)}</strong>`,
    escapeHtml(roleSummary(node)),
    `${node.txCount} purchase${node.txCount === 1 ? '' : 's'} · ${node.counterparties.size} counterpart${
      node.counterparties.size === 1 ? 'y' : 'ies'
    }`,
  ];
  return lines.join('<br/>');
};

const linkColor = (link: GraphLink): string =>
  link.kind === 'payout' ? theme.linkPayout : theme.linkPurchase;

const linkWidth = (link: GraphLink): number => Math.min(6, 1 + Math.log2(1 + link.count));

const linkTooltip = (link: GraphLink): string =>
  `${escapeHtml(link.kind)} · ${link.count} transfer${link.count === 1 ? '' : 's'}`;

/** Measured rather than assumed — see the note at the top of the file. */
function useMeasuredWidth(): [RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined) setWidth(Math.round(next));
    });
    observer.observe(element);
    setWidth(Math.round(element.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

export interface AgentGraphProps {
  nodes: GraphNode[];
  links: GraphLink[];
  selectedId?: string;
  /** Must be stable, or the canvas re-applies it on every parent render. */
  onSelect: (node: GraphNode | undefined) => void;
}

function AgentGraph({ nodes, links, selectedId, onSelect }: AgentGraphProps) {
  const [ref, width] = useMeasuredWidth();
  const graph = useRef<ForceGraphMethods<GraphNode, GraphLink>>();
  const fitted = useRef(false);

  /**
   * Layout tuning, which has to go through the instance because force-graph exposes no props for
   * it. The defaults (charge -30, link distance 30) are sized for small unlabelled dots; with
   * labelled nodes whose radius grows with activity they pack the whole network into a knot in
   * the middle of the canvas. Re-applied on resize because the useful spread depends on width.
   */
  useEffect(() => {
    const instance = graph.current;
    if (!instance || width === 0) return;
    instance.d3Force('charge')?.strength(-260).distanceMax(900);
    // Weakened as well as lengthened: d3's default link strength is inversely proportional to
    // node degree, which pulls a buyer that bought from four sellers hard onto the centroid of
    // those four. Keeping nodes apart is separateOverlaps' job, not the charge's.
    instance.d3Force('link')?.distance(150).strength(0.3);
    fitted.current = false;
    instance.d3ReheatSimulation();
  }, [width]);

  // Fit once per layout run rather than continuously: a view that re-frames itself on every
  // refresh is harder to read than one that stays where the reader left it.
  const handleEngineStop = useCallback(() => {
    if (fitted.current) return;
    fitted.current = true;
    graph.current?.zoomToFit(400, 60);
  }, []);

  /**
   * Bumped when a sprite finishes decoding, purely to re-identify `drawNode`.
   *
   * force-graph pauses its own redraw once the engine is idle (`autoPauseRedraw` defaults on, see
   * `force-graph.mjs:1626`), so a sprite that lands after the layout settled would not appear
   * until the next drag or zoom. Re-applying an accessor makes the inner graph report
   * `needsRedraw` and the frame gets painted. Unlike re-applying `graphData` it does not restart
   * the layout, which is why this is its own signal and not a reheat.
   */
  const [avatarEpoch, setAvatarEpoch] = useState(0);
  const onAvatarLoad = useCallback(() => setAvatarEpoch((epoch) => epoch + 1), []);

  const drawNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const radius = radiusOf(node);
      const sprite = node.avatarUrl ? spriteFor(node.avatarUrl, onAvatarLoad) : null;

      if (sprite) {
        // Pre-clipped to a circle, so this needs no save/clip/restore of its own.
        ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
        // The role used to be the fill, which the avatar has now taken. It becomes the ring rather
        // than being dropped: seller / buyer / both is what the legend promises, and an avatar is
        // no substitute for it — an agent's picture says nothing about which side it trades on.
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = colorOf(node);
        ctx.lineWidth = 2.5 / globalScale;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = colorOf(node);
        ctx.fill();
      }

      // Outside the avatar's role ring, or on the dot's own edge when there is no avatar, so that
      // two rings are never drawn on top of each other.
      const ringRadius = radius + (sprite ? 3 / globalScale : 0);
      if (node.id === selectedId) {
        ctx.beginPath();
        ctx.arc(x, y, ringRadius, 0, 2 * Math.PI);
        ctx.strokeStyle = theme.text;
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      } else if (node.roles.has('treasury')) {
        // The hub is the one node that is not an agent; a ring says so without a second colour.
        ctx.beginPath();
        ctx.arc(x, y, ringRadius, 0, 2 * Math.PI);
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }

      const fontSize = 11 / globalScale;
      ctx.font = `${fontSize}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = node.id === selectedId ? theme.text : theme.textMuted;
      ctx.fillText(node.label, x, y + radius + 2 / globalScale);
    },
    [selectedId, onAvatarLoad, avatarEpoch],
  );

  /**
   * Hit area follows the drawn circle, generously, so small nodes stay clickable.
   *
   * Plain circles only — never the avatar. This paints to force-graph's shadow canvas, whose
   * pixels are read back with `getImageData` to resolve the node under the cursor; a cross-origin
   * sprite would taint it and turn every hit test into a `SecurityError`. See the note on
   * `sprites` above.
   */
  const paintPointerArea = useCallback(
    (node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, radiusOf(node) + 3, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    [],
  );

  const handleClick = useCallback(
    (node: GraphNode) => onSelect(node.id === selectedId ? undefined : node),
    [onSelect, selectedId],
  );

  const handleBackgroundClick = useCallback(() => onSelect(undefined), [onSelect]);

  /**
   * Keep nodes from overlapping, on our own animation frame.
   *
   * Restarts whenever the node set changes and stops once the layout has been overlap-free for
   * roughly as long as force-graph's own cooldown, so a settled page is not animating for
   * nothing.
   */
  useEffect(() => {
    let frame = 0;
    let settledFrames = 0;
    const step = () => {
      settledFrames = separateOverlaps(nodes) === 0 ? settledFrames + 1 : 0;
      if (settledFrames < SETTLE_FRAMES) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [nodes]);

  return (
    <div className={styles.graphCanvas} ref={ref} style={{ height: HEIGHT }}>
      {width > 0 && (
        <ForceGraph2D<GraphNode, GraphLink>
          ref={graph}
          graphData={{ nodes, links }}
          width={width}
          height={HEIGHT}
          backgroundColor={theme.surface}
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={paintPointerArea}
          nodeLabel={nodeTooltip}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkLabel={linkTooltip}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkCurvature={0.08}
          onNodeClick={handleClick}
          onBackgroundClick={handleBackgroundClick}
          onEngineStop={handleEngineStop}
          cooldownTime={4000}
          d3VelocityDecay={0.3}
        />
      )}
    </div>
  );
}

/**
 * Memoised deliberately. `MapPage` re-renders on every 5s balance tick; without this boundary the
 * canvas would re-apply every prop each time, and re-applying `graphData` restarts the layout.
 */
export default memo(AgentGraph);
