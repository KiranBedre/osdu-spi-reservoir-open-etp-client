/**
 * ValidatorClient — RESQML Validator with local (in-process) and remote modes.
 *
 * **Local mode** (default): Uses the built-in TypeScript validator — no external
 * service needed, no subprocess, no Python. Runs in the Node.js process.
 *
 * **Remote mode**: Falls back to HTTP calls to an external validator service
 * (e.g. the Python FastAPI service) when RDMS_VALIDATOR_URL is set.
 *
 * Usage:
 *   import { ValidatorClient } from "../client/ValidatorClient";
 *   const validator = new ValidatorClient();           // local mode
 *   const report = await validator.validateObjects(objects);
 *   if (!report.is_valid) { ... }
 *
 *   const remote = new ValidatorClient("http://validator:8010");  // remote mode
 */

import * as LocalValidator from "../validation/ResqmlValidator";

// Re-export types from the local validator for backwards compatibility
export type { ValidationError, ValidationReport, ValidationOptions } from "../validation/ResqmlValidator";
export { Severity, ValidationCategory } from "../validation/ResqmlValidator";

import type { ValidationError, ValidationReport, ValidationOptions } from "../validation/ResqmlValidator";

export interface RoundtripDiff {
  missing_in_received: string[];
  extra_in_received: string[];
  content_mismatches: Array<{
    uuid: string;
    sent_content_type: string;
    sent_length: number;
    received_length: number;
  }>;
}

export interface RoundtripResult {
  received_validation: ValidationReport;
  roundtrip_diff: RoundtripDiff;
  roundtrip_ok: boolean;
}

export interface ObjectPayload {
  content_type: string;
  uuid: string;
  xml: string;
}

export class ValidatorClient {
  private baseUrl: string | null;
  private timeoutMs: number;
  private readonly useLocal: boolean;

  /**
   * Create a validator client.
   *
   * - No args / no env var → **local mode** (in-process TypeScript validator)
   * - `baseUrl` or `RDMS_VALIDATOR_URL` set → **remote mode** (HTTP to external service)
   */
  constructor(baseUrl?: string, timeoutMs = 30_000) {
    this.baseUrl = baseUrl || process.env.RDMS_VALIDATOR_URL || null;
    this.useLocal = !this.baseUrl;
    this.timeoutMs = timeoutMs;
  }

  /** Health check — local mode always returns true. */
  async isHealthy(): Promise<boolean> {
    if (this.useLocal) return true;
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Validate an EPC file (as a Buffer).
   * In local mode, writes to a temp file and validates in-process.
   */
  async validateEpc(
    epcBuffer: Buffer,
    h5Buffer?: Buffer,
    options?: ValidationOptions
  ): Promise<ValidationReport> {
    if (this.useLocal) {
      const fs = await import("fs");
      const os = await import("os");
      const path = await import("path");

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rddms-validate-"));
      const epcPath = path.join(tmpDir, "model.epc");
      fs.writeFileSync(epcPath, epcBuffer);

      let h5Path: string | undefined;
      if (h5Buffer) {
        h5Path = path.join(tmpDir, "model.h5");
        fs.writeFileSync(h5Path, h5Buffer);
      }

      try {
        return LocalValidator.validateEpc(epcPath, options ?? {}, h5Path);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }

    // Remote mode
    const formData = new FormData();
    formData.append(
      "epc",
      new Blob([epcBuffer], { type: "application/octet-stream" }),
      "model.epc"
    );
    if (h5Buffer) {
      formData.append(
        "h5",
        new Blob([h5Buffer], { type: "application/octet-stream" }),
        "model.h5"
      );
    }
    formData.append("options", JSON.stringify(options ?? {}));

    const res = await fetch(`${this.baseUrl}/validate/epc`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(
        `Validator returned ${res.status}: ${await res.text()}`
      );
    }
    return (await res.json()) as ValidationReport;
  }

  /**
   * Validate in-memory XML objects (e.g. from ETP GetDataObjects).
   * In local mode, runs the validator directly — no file I/O, no HTTP.
   */
  async validateObjects(
    objects: ObjectPayload[],
    options?: ValidationOptions
  ): Promise<ValidationReport> {
    if (this.useLocal) {
      return LocalValidator.validateObjects(objects, options ?? {});
    }

    // Remote mode
    const res = await fetch(`${this.baseUrl}/validate/objects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objects, options: options ?? {} }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(
        `Validator returned ${res.status}: ${await res.text()}`
      );
    }
    return (await res.json()) as ValidationReport;
  }

  /**
   * Roundtrip validation: compare what was sent (PutDataObjects)
   * against what was received back (GetDataObjects).
   *
   * In local mode, validates the received objects and computes diff.
   */
  async validateRoundtrip(
    sent: ObjectPayload[],
    received: ObjectPayload[],
    options?: ValidationOptions
  ): Promise<RoundtripResult> {
    if (this.useLocal) {
      const receivedReport = LocalValidator.validateObjects(received, options ?? {});

      // Compute diff
      const sentUuids = new Set(sent.map(o => o.uuid.toLowerCase()));
      const receivedUuids = new Set(received.map(o => o.uuid.toLowerCase()));

      const missing = sent
        .filter(o => !receivedUuids.has(o.uuid.toLowerCase()))
        .map(o => o.uuid);
      const extra = received
        .filter(o => !sentUuids.has(o.uuid.toLowerCase()))
        .map(o => o.uuid);

      const contentMismatches: RoundtripDiff["content_mismatches"] = [];
      for (const s of sent) {
        const r = received.find(o => o.uuid.toLowerCase() === s.uuid.toLowerCase());
        if (r && s.xml.length !== r.xml.length) {
          contentMismatches.push({
            uuid: s.uuid,
            sent_content_type: s.content_type,
            sent_length: s.xml.length,
            received_length: r.xml.length,
          });
        }
      }

      return {
        received_validation: receivedReport,
        roundtrip_diff: {
          missing_in_received: missing,
          extra_in_received: extra,
          content_mismatches: contentMismatches,
        },
        roundtrip_ok: missing.length === 0 && extra.length === 0 && contentMismatches.length === 0,
      };
    }

    // Remote mode
    const res = await fetch(`${this.baseUrl}/validate/roundtrip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sent, received, options: options ?? {} }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(
        `Validator returned ${res.status}: ${await res.text()}`
      );
    }
    return (await res.json()) as RoundtripResult;
  }
}
