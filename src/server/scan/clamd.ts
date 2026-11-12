import "server-only";
import { createReadStream } from "node:fs";
import { connect, type Socket } from "node:net";
import { getEnv } from "@/config/env";
import { SCAN } from "@/config/policy";
import { BYTES_PER_GB } from "@/domain/quota";
import { parseClamdReply, type ScanVerdict } from "@/domain/scan";

/** Whether files received through upload-only links are scanned (CLAMAV_HOST is set). */
export function scanningEnabled(): boolean {
  return Boolean(getEnv("jobs").CLAMAV_HOST);
}

function clamdSocket(timeoutMs: number): Promise<Socket> {
  const { CLAMAV_HOST, CLAMAV_PORT } = getEnv("jobs");
  if (!CLAMAV_HOST) return Promise.reject(new Error("CLAMAV_HOST is not set"));
  return new Promise((resolve, reject) => {
    const socket = connect({ host: CLAMAV_HOST, port: CLAMAV_PORT });
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error("clamd timed out")));
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

/** Reads clamd's reply up to its NUL (z-commands), or until it closes the connection. */
function readReply(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let reply = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      reply = Buffer.concat([reply, chunk]);
      if (reply.length > SCAN.maxReplyBytes) socket.destroy(new Error("clamd reply too long"));
      else if (reply.includes(0)) {
        socket.end();
        resolve(reply.subarray(0, reply.indexOf(0)).toString("utf8"));
      }
    });
    socket.once("end", () => resolve(reply.toString("utf8")));
    socket.once("error", reject);
  });
}

/**
 * Sends a file to clamd (zINSTREAM: 4-byte big-endian chunk lengths, a zero length to end) and
 * returns its verdict. Throws when clamd cannot be reached or times out, so the job is tried again.
 */
export async function scanFile(path: string, size: number): Promise<ScanVerdict> {
  const timeoutMs = getEnv("jobs").CLAMAV_TIMEOUT_MS + Math.ceil(size / BYTES_PER_GB) * SCAN.msPerGb;
  const socket = await clamdSocket(timeoutMs);
  try {
    const reply = readReply(socket);
    socket.write("zINSTREAM\0");
    for await (const chunk of createReadStream(path, { highWaterMark: SCAN.chunkBytes }) as AsyncIterable<Buffer>) {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(chunk.length);
      if (!socket.write(Buffer.concat([length, chunk]))) await new Promise((resolve) => socket.once("drain", resolve));
    }
    socket.write(Buffer.alloc(4));
    return parseClamdReply(await reply);
  } finally {
    socket.destroy();
  }
}

/** clamd answers PING with PONG (health check). */
export async function pingClamd(timeoutMs: number): Promise<boolean> {
  const socket = await clamdSocket(timeoutMs);
  try {
    const reply = readReply(socket);
    socket.write("zPING\0");
    return (await reply).trim() === "PONG";
  } finally {
    socket.destroy();
  }
}
