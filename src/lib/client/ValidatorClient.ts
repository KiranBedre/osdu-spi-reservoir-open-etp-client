/**
 * ValidatorClient — TypeScript HTTP client for the RESQML Validator Service.
 *
 * Usage:
 *   import { ValidatorClient } from "../client/ValidatorClient";
 *   const validator = new ValidatorClient("http://localhost:8010");
 *   const report = await validator.validateObjects(objects);
 *   if (!report.is_valid) { ... }
 */

export interface ValidationError {
  message: string;
  severity: "error" | "warning" | "info";
  category: string;
  object_uuid?: string;
  object_type?: string;
  xpath?: string;
  line?: number;
}

export interface ValidationReport {
  is_valid: boolean;
  version: string | null;
  object_count: number;
  validated_count: number;
  error_count: number;
  warning_count: number;
  errors: ValidationError[];
}

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

export interface ValidationOptions {
  skip_xsd?: boolean;
  skip_dor?: boolean;
  skip_epc_structure?: boolean;
  skip_hdf5?: boolean;
  skip_cross_object?: boolean;
  skip_fesapi?: boolean;
  skip_fesapi_native?: boolean;
  skip_rddms?: boolean;
  skip_business_rules?: boolean;
  skip_pwls?: boolean;
}

export interface ObjectPayload {
  content_type: string;
  uuid: string;
  xml: string;
}

export class ValidatorClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl?: string, timeoutMs = 30_000) {
    this.baseUrl =
      baseUrl ||
      process.env.RDMS_VALIDATOR_URL ||
      "http://localhost:8010";
    this.timeoutMs = timeoutMs;
  }

  /** Health check — returns true if the validator service is reachable. */
  async isHealthy(): Promise<boolean> {
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
   * Optionally provide an H5 buffer.
   */
  async validateEpc(
    epcBuffer: Buffer,
    h5Buffer?: Buffer,
    options?: ValidationOptions
  ): Promise<ValidationReport> {
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
   * Fast path — no file I/O on the client side.
   */
  async validateObjects(
    objects: ObjectPayload[],
    options?: ValidationOptions
  ): Promise<ValidationReport> {
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
   */
  async validateRoundtrip(
    sent: ObjectPayload[],
    received: ObjectPayload[],
    options?: ValidationOptions
  ): Promise<RoundtripResult> {
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
