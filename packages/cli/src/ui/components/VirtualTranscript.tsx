import React, { useCallback, useMemo, useRef } from "react";
import type { ProviderId } from "@luckycli/core";
import ScrollBox, {
  type ScrollBoxHandle,
} from "../../vendor/ink/components/ScrollBox.js";
import VendorBox from "../../vendor/ink/components/Box.js";
import type { DOMElement } from "../../vendor/ink/dom.js";
import { useVirtualScroll } from "../../vendor/hooks/useVirtualScroll.js";
import type { Theme } from "../themes.js";
import type { Item } from "../lib/items.js";
import { TranscriptItem } from "./Transcript.js";

/**
 * Virtualized, bottom-pinned transcript built on the vendored Ink fork.
 *
 * Unlike the old ScrollViewport (which mounted every item and measured the
 * whole tree on each token — O(chat) per frame), this uses the fork's
 * `ScrollBox` (output-level culling against REAL Yoga positions) plus
 * `useVirtualScroll` (mounts only viewport+overscan fibers, sizing spacers from
 * Yoga-measured heights cached per item). Cost per frame is O(visible), so a
 * long chat no longer lags.
 *
 * The contract mirrors Claude Code's VirtualMessageList render shape:
 *   <ScrollBox stickyScroll>
 *     <Box ref={spacerRef} height={topSpacer} />   // unmounted items above
 *     {items[start..end] each wrapped in a measured <Box ref={measureRef(k)}>}
 *     <Box height={bottomSpacer} />                 // unmounted items below
 *   </ScrollBox>
 * `measureRef` records each mounted item's Yoga height; the hook feeds those
 * back into the next frame's spacer math. Heights are never estimated by us.
 *
 * The live streaming reply / thinking indicator / empty-state hint are NOT a
 * separate footer node — they ride INSIDE `items` as transient items (kinds
 * "streaming" / "thinking" / "hint", built per-render in App and never
 * persisted). This is Claude Code's approach: the ScrollBox content stays a
 * flat [topSpacer, ...items, bottomSpacer], which is exactly what
 * useVirtualScroll's spacer/sticky/cull math assumes. A variable-height node
 * outside that shape (the old `footer`) grew on every streamed token and broke
 * scrollHeight under the hook → jitter/overflow. stickyScroll follows the
 * growing streaming item naturally because it's a measured list item.
 */
export function VirtualTranscript({
  items,
  scrollRef,
  columns,
  width,
  theme,
  provider,
  model,
}: {
  items: Item[];
  scrollRef: React.RefObject<ScrollBoxHandle | null>;
  /** Terminal column count — invalidates cached heights on resize (rewrap). */
  columns: number;
  /** Content width passed to each TranscriptItem for its own wrapping. */
  width: number;
  theme: Theme;
  provider: ProviderId;
  model: string;
}): React.JSX.Element {
  // Stable per-item key. Items are append-only and patched in place (tool
  // output), so index is a stable identity here; include kind so a replaced
  // slot re-measures. The height cache is keyed on these.
  const itemKeys = useMemo(
    () => items.map((item, i) => `${i}:${item.kind}`),
    [items],
  );

  const { range, topSpacer, bottomSpacer, measureRef, spacerRef } =
    useVirtualScroll(scrollRef, itemKeys, columns);

  const [start, end] = range;
  const renderItem = useCallback(
    (item: Item, index: number) => (
      <TranscriptItem
        item={item}
        previous={index > 0 ? items[index - 1] : undefined}
        theme={theme}
        width={width}
        provider={provider}
        model={model}
      />
    ),
    [items, theme, width, provider, model],
  );

  const visible: React.ReactNode[] = [];
  for (let index = start; index < end; index++) {
    const item = items[index];
    if (!item) continue;
    const key = itemKeys[index]!;
    visible.push(
      <MeasuredItem key={key} itemKey={key} measureRef={measureRef}>
        {renderItem(item, index)}
      </MeasuredItem>,
    );
  }

  // The outer Box MUST clip (overflow:hidden) and grow: it gives the ScrollBox a
  // bounded height. Without this ceiling the ScrollBox's flexGrow makes its
  // viewport equal the (huge) spacer height, scrollTop pins at 0, and Ink's
  // screen buffer balloons to thousands of rows — the source of the stray
  // characters / torn redraw on long sessions.
  return (
    <VendorBox flexGrow={1} flexDirection="column" overflow="hidden" width="100%">
      <ScrollBox stickyScroll ref={scrollRef} flexGrow={1} flexDirection="column">
        <VendorBox ref={spacerRef} height={topSpacer} flexShrink={0} />
        {visible}
        {bottomSpacer > 0 ? (
          <VendorBox height={bottomSpacer} flexShrink={0} />
        ) : null}
      </ScrollBox>
    </VendorBox>
  );
}

/**
 * Wraps one transcript item in a measured Box. The Box ref is the measurement
 * anchor the virtual-scroll hook reads (TranscriptItem itself doesn't take a
 * ref); a single-child column Box passes the child's Yoga height through.
 */
function MeasuredItem({
  itemKey,
  measureRef,
  children,
}: {
  itemKey: string;
  measureRef: (key: string) => (el: DOMElement | null) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const ref = useMemo(() => measureRef(itemKey), [measureRef, itemKey]);
  return (
    <VendorBox ref={ref} flexDirection="column" flexShrink={0}>
      {children}
    </VendorBox>
  );
}
