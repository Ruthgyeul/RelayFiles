"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "./share-handoff";

/** Registers the share-target service worker once the app shell has loaded (renders nothing). */
export function RegisterServiceWorker() {
  useEffect(() => registerServiceWorker(), []);
  return null;
}
