/**
 * Slideshow order in the media viewer: pictures only, in list order, stopping after the last
 * one (no wrap-around, so a slideshow ends instead of looping forever).
 */

/** Index of the next picture after `from`, or null at the end. */
export function nextSlideIndex(items: readonly { kind: string }[], from: number): number | null {
  for (let index = from + 1; index < items.length; index += 1) if (items[index]!.kind === "image") return index;
  return null;
}

/** Index of the first picture, or null when there is none. */
export function firstSlideIndex(items: readonly { kind: string }[]): number | null {
  return nextSlideIndex(items, -1);
}

/** Whether the viewer offers a slideshow: the current item is a picture and there is another one. */
export function canSlideshow(items: readonly { kind: string }[], current: number): boolean {
  return items[current]?.kind === "image" && items.filter((item) => item.kind === "image").length > 1;
}
