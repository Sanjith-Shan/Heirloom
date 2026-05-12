/**
 * Heirloom inference sidecar.
 *
 * Runs alongside the FastAPI agent inside the same Docker image. Owns all
 * EigenAI calls because:
 *   1. The official LLM Proxy provider (@layr-labs/ai-gateway-provider) is
 *      TypeScript-only.
 *   2. Inside a TEE it auto-mints short-lived JWTs from the KMS using the
 *      attestation token at /run/container_launcher/attestation_verifier_claims_token.
 *      No equivalent exists in Python.
 *
 * FastAPI calls POST /infer over loopback. The endpoint mirrors the OpenAI
 * chat-completions shape on the way in and returns the model's text plus
 * whatever traceability fields the SDK exposes (the gateway response itself
 * does NOT include a per-call signature — verifiability is by image-digest
 * attestation upstream).
 */

import express from "express";
import { eigen } from "@layr-labs/ai-gateway-provider";
import { generateText } from "ai";

const PORT = Number(process.env.SIDECAR_PORT || 9090);
const HOST = process.env.SIDECAR_HOST || "127.0.0.1";

const app = express();
app.use(express.json({ limit: "1mb" }));

function modeFromEnv() {
  if (process.env.KMS_SERVER_URL && process.env.KMS_PUBLIC_KEY) return "tee-attested";
  if (process.env.KMS_AUTH_JWT) return "manual-jwt";
  return "no-auth";
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    mode: modeFromEnv(),
    gateway_url:
      process.env.EIGEN_GATEWAY_URL || "https://ai-gateway-dev.eigencloud.xyz",
    has_kms_server: !!process.env.KMS_SERVER_URL,
    has_kms_pubkey: !!process.env.KMS_PUBLIC_KEY,
    has_manual_jwt: !!process.env.KMS_AUTH_JWT,
  });
});

app.post("/infer", async (req, res) => {
  const {
    model = "anthropic/claude-sonnet-4.6",
    messages,
    prompt,
    seed = 42,
    temperature = 0,
    maxOutputTokens,
  } = req.body || {};

  const msgs = messages || (prompt ? [{ role: "user", content: prompt }] : null);
  if (!msgs?.length) {
    return res.status(400).json({ error: "either `messages` or `prompt` required" });
  }

  try {
    const result = await generateText({
      model: eigen(model),
      messages: msgs,
      seed,
      temperature,
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
    });
    res.json({
      text: result.text,
      model,
      mode: modeFromEnv(),
      response_id: result.response?.id ?? null,
      finish_reason: result.finishReason ?? null,
      usage: result.usage ?? null,
    });
  } catch (err) {
    const msg = err?.message || String(err);
    console.error("[sidecar] infer failed:", msg);
    res.status(500).json({ error: msg, mode: modeFromEnv() });
  }
});

app.listen(PORT, HOST, () => {
  console.log(
    `[heirloom-sidecar] listening on http://${HOST}:${PORT} mode=${modeFromEnv()}`,
  );
});
