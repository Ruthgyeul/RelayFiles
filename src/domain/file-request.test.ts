import { describe, expect, it } from "vitest";
import { fileRequestStatus, requestBatchError, requestRoom, type RequestLimits } from "./file-request";

const NOW = 1_800_000_000_000;
const base: RequestLimits = { expiresAt: null, maxFiles: null, maxBytes: null, filesReceived: 0, bytesReceived: 0n };
const size = (bytes: number) => `${bytes} B`;

describe("requestRoom", () => {
  it("is unlimited without limits", () => {
    expect(requestRoom(base)).toEqual({ files: null, bytes: null });
  });

  it("subtracts what was received and never goes below zero", () => {
    expect(requestRoom({ ...base, maxFiles: 5, filesReceived: 2, maxBytes: 100n, bytesReceived: 40n })).toEqual({ files: 3, bytes: 60n });
    expect(requestRoom({ ...base, maxFiles: 1, filesReceived: 3, maxBytes: 10n, bytesReceived: 50n })).toEqual({ files: 0, bytes: 0n });
  });
});

describe("fileRequestStatus", () => {
  it("is open until its date, then expired", () => {
    expect(fileRequestStatus({ ...base, expiresAt: NOW + 1 }, false, NOW)).toBe("open");
    expect(fileRequestStatus({ ...base, expiresAt: NOW }, false, NOW)).toBe("expired");
  });

  it("is expired with the owner's account", () => {
    expect(fileRequestStatus(base, true, NOW)).toBe("expired");
  });

  it("is full once the file count or the size is used up", () => {
    expect(fileRequestStatus({ ...base, maxFiles: 2, filesReceived: 2 }, false, NOW)).toBe("full");
    expect(fileRequestStatus({ ...base, maxBytes: 10n, bytesReceived: 10n }, false, NOW)).toBe("full");
    expect(fileRequestStatus({ ...base, maxFiles: 2, filesReceived: 1 }, false, NOW)).toBe("open");
  });
});

describe("requestBatchError", () => {
  it("accepts a batch that fits", () => {
    expect(requestBatchError({ files: 2, bytes: 10n }, [{ size: 4 }, { size: 6 }], size)).toBeNull();
    expect(requestBatchError({ files: null, bytes: null }, [{ size: 1e12 }], size)).toBeNull();
  });

  it("names the limit a batch would pass", () => {
    expect(requestBatchError({ files: 1, bytes: null }, [{ size: 1 }, { size: 1 }], size)).toBe("This link accepts 1 more file.");
    expect(requestBatchError({ files: 3, bytes: null }, [{ size: 1 }, { size: 1 }, { size: 1 }, { size: 1 }], size)).toBe("This link accepts 3 more files.");
    expect(requestBatchError({ files: null, bytes: 5n }, [{ size: 4 }, { size: 2 }], size)).toBe("This link accepts 5 B more.");
  });
});
