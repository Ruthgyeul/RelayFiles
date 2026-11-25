"use client";

import { useLayoutEffect, useState } from "react";

type Fn = (...args: never[]) => unknown;
/** Props objects whose fields are stabilized one level down (drag source, drop target). */
const NESTED: ReadonlySet<string> = new Set(["drag", "drop"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;

function sameFields(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

/**
 * The handlers and nested props objects of every row, kept across renders. A render collects the
 * handlers it made (`pending`); once committed they become the ones the stable functions call.
 */
class RowPropsStore {
  private latest = new Map<string, Fn>();
  private pending = new Map<string, Fn>();
  private handlers = new Map<string, Fn>();
  private objects = new Map<string, Record<string, unknown>>();

  begin(): void {
    this.pending = new Map();
  }

  commit(): void {
    this.latest = this.pending;
  }

  private handler(path: string, fn: Fn): Fn {
    this.pending.set(path, fn);
    let stable = this.handlers.get(path);
    if (!stable) {
      stable = ((...args: never[]) => this.latest.get(path)?.(...args)) as Fn;
      this.handlers.set(path, stable);
    }
    return stable;
  }

  wrap<T extends object>(id: string, props: T): T {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      const path = `${id}:${key}`;
      if (typeof value === "function") out[key] = this.handler(path, value as Fn);
      else if (NESTED.has(key) && isPlainObject(value)) {
        const next = Object.fromEntries(Object.entries(value).map(([field, inner]) => [field, typeof inner === "function" ? this.handler(`${path}.${field}`, inner as Fn) : inner]));
        const before = this.objects.get(path);
        if (before && sameFields(before, next)) out[key] = before;
        else {
          this.objects.set(path, next);
          out[key] = next;
        }
      } else out[key] = value;
    }
    return out as T;
  }
}

/**
 * Row props that keep the same values from render to render while nothing a row shows changed,
 * so memoized rows skip rendering: every handler becomes a function that keeps its identity (per
 * row id and prop) and calls the handler of the latest committed render, and the drag and drop
 * props objects are reused while their fields are equal. Handlers run on events, after the render
 * that made them is committed, so they always see current state.
 */
export function useStableRowProps(): <T extends object>(id: string, props: T) => T {
  const [store] = useState(() => new RowPropsStore());
  store.begin();
  useLayoutEffect(() => store.commit());
  return (id, props) => store.wrap(id, props);
}
