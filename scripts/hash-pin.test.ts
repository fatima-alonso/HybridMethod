import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadEnvConfig } from "@next/env";
import { describe, expect, it } from "vitest";

import { hashApprovalPin } from "../src/lib/approval-pin";
import { escapeForDotenv } from "./hash-pin";

describe("npm run hash-pin", () => {
  it("escapa los $ para los archivos .env (Next.js los expandiría)", () => {
    expect(escapeForDotenv("$2b$12$abc")).toBe("\\$2b\\$12\\$abc");
  });

  it("el valor escapado se lee intacto desde un .env de Next.js", async () => {
    const hash = await hashApprovalPin("482917", 4);
    const dir = mkdtempSync(join(tmpdir(), "hash-pin-"));
    const key = "HASH_PIN_TEST_VALUE";
    try {
      writeFileSync(join(dir, ".env"), `${key}=${escapeForDotenv(hash)}\n`);
      loadEnvConfig(dir, false, { info: () => {}, error: () => {} }, true);
      expect(process.env[key]).toBe(hash);
    } finally {
      delete process.env[key];
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
