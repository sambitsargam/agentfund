import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { fundingApi } from "../src/funding-api.js";
import { ATLAS_DEAL } from "@agentfund/shared";
const app = express(); app.use("/funding", fundingApi("test-token"));
describe("persistent funding service", () => {
  it("requires server authentication for reads and writes", async () => {
    expect((await request(app).get("/funding")).status).toBe(401);
    expect((await request(app).post("/funding").send({ action: "connect" })).status).toBe(401);
  });
  it("normalises a wallet address without any signing key", async () => {
    const r = await request(app).post("/funding").set("Authorization", "Bearer test-token").send({ action: "connect", address: ATLAS_DEAL.atlasAddress });
    expect(r.status).toBe(200); expect(r.body.address).toBe(ATLAS_DEAL.atlasAddress);
  });
  it("rejects malformed actions without exposing provider internals", async () => {
    const r = await request(app).post("/funding").set("Authorization", "Bearer test-token").send({ action: "erase" });
    expect(r.status).toBe(400); expect(r.body.error).toBe("Unknown funding action");
  });
});
