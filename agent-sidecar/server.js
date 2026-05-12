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
import { AttestClient, JwtProvider } from "@layr-labs/ecloud-sdk/attest";
import { generateText } from "ai";

const PORT = Number(process.env.SIDECAR_PORT || 9090);
const HOST = process.env.SIDECAR_HOST || "127.0.0.1";

const app = express();
app.use(express.json({ limit: "1mb" }));

function decodeJwtParts(jwt) {
  try {
    const [h, p] = jwt.split(".");
    return {
      header: JSON.parse(Buffer.from(h, "base64url").toString("utf8")),
      payload: JSON.parse(Buffer.from(p, "base64url").toString("utf8")),
    };
  } catch (e) {
    return { error: String(e) };
  }
}

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

/**
 * Debug endpoint — returns the actual JWT that attestation produces, decoded,
 * plus the raw gateway response for a tiny test call. Lets us diagnose JWT
 * rejection without redeploying every time.
 */
app.get("/debug/attest", async (_req, res) => {
  const out = { mode: modeFromEnv(), env: {
    KMS_SERVER_URL: !!process.env.KMS_SERVER_URL,
    KMS_PUBLIC_KEY_first40: (process.env.KMS_PUBLIC_KEY || "").slice(0, 40),
    KMS_PUBLIC_KEY_len: (process.env.KMS_PUBLIC_KEY || "").length,
    EIGEN_GATEWAY_URL: process.env.EIGEN_GATEWAY_URL || "https://ai-gateway-dev.eigencloud.xyz",
  } };

  if (!process.env.KMS_SERVER_URL || !process.env.KMS_PUBLIC_KEY) {
    out.error = "KMS env not set; can't run attestation";
    return res.json(out);
  }

  // Get a JWT once (audience llm-proxy — known correct), then test it
  // against multiple candidate gateway hosts and request shapes.
  let jwt;
  try {
    const client = new AttestClient({
      kmsServerURL: process.env.KMS_SERVER_URL,
      kmsPublicKey: process.env.KMS_PUBLIC_KEY,
      audience: "llm-proxy",
    });
    jwt = await client.attest();
    out.jwt = {
      first50: jwt.slice(0, 50),
      last20: jwt.slice(-20),
      decoded: decodeJwtParts(jwt),
    };
  } catch (e) {
    out.attest_error = String(e?.message || e);
    return res.json(out);
  }

  const gateways = [
    "https://ai-gateway-dev.eigencloud.xyz",
    "https://ai-gateway.eigencloud.xyz",
    "https://llm-proxy.eigencloud.xyz",
    "https://llm-proxy-dev.eigencloud.xyz",
  ];
  const paths = ["/v1/chat/completions", "/chat/completions", "/v1/completions"];
  out.gateway_attempts = [];

  for (const gw of gateways) {
    for (const path of paths) {
      const attempt = { url: gw + path };
      try {
        const r = await fetch(gw + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${jwt}`,
          },
          body: JSON.stringify({
            model: "anthropic/claude-sonnet-4.6",
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 5,
          }),
          signal: AbortSignal.timeout(15000),
        });
        attempt.status = r.status;
        attempt.body = (await r.text()).slice(0, 300);
      } catch (e) {
        attempt.error = String(e?.message || e);
      }
      out.gateway_attempts.push(attempt);
    }
  }

  res.json(out);
});

app.listen(PORT, HOST, () => {
  console.log(
    `[heirloom-sidecar] listening on http://${HOST}:${PORT} mode=${modeFromEnv()}`,
  );
});
