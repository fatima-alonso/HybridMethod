import { describe, expect, it, vi } from "vitest";

import type { Db } from "@/lib/prisma";

import { recordAudit } from "./audit.service";

function fakeDb() {
  const create = vi.fn(async ({ data }: { data: unknown }) => data);
  return { db: { auditLog: { create } } as unknown as Db, create };
}

describe("auditoría (SDD §9.6)", () => {
  it("guarda la entrada y recorta el user-agent", async () => {
    const { db, create } = fakeDb();
    await recordAudit(
      {
        action: "transfer.approved",
        actor: "ferro",
        entityType: "Contract",
        entityId: "c1",
        ip: "203.0.113.7",
        userAgent: "x".repeat(2000),
        metadata: { reference: "HM-2026-000001" },
      },
      db,
    );
    const data = create.mock.calls[0][0].data as { userAgent: string; ip: string };
    expect(data.userAgent).toHaveLength(512);
    expect(data.ip).toBe("203.0.113.7");
  });

  it.each(["token", "pin", "otpCode", "tokenHash", "nested.secret"])(
    "rechaza metadatos sensibles (%s)",
    async (key) => {
      const { db, create } = fakeDb();
      const [outer, inner] = key.split(".");
      const metadata = inner ? { [outer]: { [inner]: "x" } } : { [outer]: "x" };
      await expect(
        recordAudit({ action: "a", actor: "system", entityType: "X", entityId: "1", metadata }, db),
      ).rejects.toThrow(/datos sensibles/);
      expect(create).not.toHaveBeenCalled();
    },
  );
});
