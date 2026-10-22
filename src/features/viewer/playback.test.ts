import { afterEach, describe, expect, it, vi } from "vitest";
import { playback, type Playable } from "./playback";

function media(paused = false): Playable & { pause: ReturnType<typeof vi.fn> } {
  const element = { paused, pause: vi.fn(() => (element.paused = true)) };
  return element;
}

describe("playback", () => {
  const created: Playable[] = [];
  const make = (paused?: boolean) => {
    const element = media(paused);
    created.push(element);
    return element;
  };
  afterEach(() => created.splice(0).forEach((element) => playback.release(element)));

  it("pauses the element that was playing when another one starts", () => {
    const first = make();
    const second = make();
    playback.claim(first);
    playback.claim(second);
    expect(first.pause).toHaveBeenCalledOnce();
    expect(second.pause).not.toHaveBeenCalled();
  });

  it("does not pause an element that plays again", () => {
    const only = make();
    playback.claim(only);
    playback.claim(only);
    expect(only.pause).not.toHaveBeenCalled();
  });

  it("leaves an already paused element alone", () => {
    const first = make(true);
    playback.claim(first);
    playback.claim(make());
    expect(first.pause).not.toHaveBeenCalled();
  });

  it("forgets a released element", () => {
    const first = make();
    playback.claim(first);
    playback.release(first);
    playback.claim(make());
    expect(first.pause).not.toHaveBeenCalled();
  });
});
