import { describe, expect, it } from "vitest";
import { ApiClientError, errorMessage, GENERIC_ERROR } from "./api-client";

describe("errorMessage", () => {
  it("shows the server's message for an API error", () => {
    expect(errorMessage(new ApiClientError("CONFLICT", "That name already exists here.", 409))).toBe("That name already exists here.");
  });

  it("hides browser and runtime exception text", () => {
    expect(errorMessage(new DOMException("The user aborted a request.", "AbortError"))).toBe(GENERIC_ERROR);
    expect(errorMessage(new TypeError("Failed to fetch"))).toBe(GENERIC_ERROR);
    expect(errorMessage("boom")).toBe(GENERIC_ERROR);
  });
});
