import "jest";
import "reflect-metadata";

import { ArgumentMetadata, BadRequestException, ValidationPipe } from "@nestjs/common";

import PwlsController, {
  CurveValidationRequestDto
} from "../lib/restApi/read-etp.module/Pwls.controller";

/**
 * Regression tests for POST /pwls/validate.
 *
 * Guards against a class-validator regression where an under-decorated DTO plus
 * the default `forbidUnknownValues` rejected every request body with
 * "an unknown value was passed to the validate function" before the handler ran.
 *
 * Two layers are covered:
 *  - the request DTO run through the real global ValidationPipe (type contract), and
 *  - the controller handler (business semantics for missing/unknown mnemonics).
 */
describe("POST /pwls/validate", () => {
  const meta: ArgumentMetadata = {
    type: "body",
    metatype: CurveValidationRequestDto,
    data: ""
  };

  // Mirror of the global pipe configuration in App.ts.
  function makePipe(forbidUnknownValues: boolean | undefined): ValidationPipe {
    return new ValidationPipe({
      transform: true,
      skipUndefinedProperties: true,
      transformerPackage: require("class-transformer"),
      validatorPackage: require("class-validator"),
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues,
      validationError: { target: false, value: false }
    });
  }

  // Include the App.ts value (false) and the class-validator default (true/undefined)
  // so the DTO contract holds even if the global flag is ever changed.
  const flagVariants: Array<boolean | undefined> = [false, true, undefined];

  describe.each(flagVariants)("DTO via ValidationPipe (forbidUnknownValues=%s)", (flag) => {
    it("accepts a well-formed curves body", async () => {
      const body = {
        curves: [{ mnemonic: "GR", uom: "gAPI" }, { mnemonic: "NPHI" }]
      };
      const out = await makePipe(flag).transform(body, meta);
      expect(out.curves).toHaveLength(2);
      expect(out.curves[0].mnemonic).toBe("GR");
      expect(out.curves[0].uom).toBe("gAPI");
      expect(out.curves[1].mnemonic).toBe("NPHI");
    });

    it("never throws the class-validator 'unknown value' error", async () => {
      const body = { curves: [{ mnemonic: "GR" }] };
      await expect(makePipe(flag).transform(body, meta)).resolves.toBeDefined();
    });

    it("rejects curves that is not an array", async () => {
      await expect(
        makePipe(flag).transform({ curves: "GR" }, meta)
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects a present but non-string mnemonic", async () => {
      await expect(
        makePipe(flag).transform({ curves: [{ mnemonic: 123 }] }, meta)
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects a present but non-string uom", async () => {
      await expect(
        makePipe(flag).transform({ curves: [{ mnemonic: "GR", uom: 123 }] }, meta)
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("controller handler", () => {
    const controller = new PwlsController();

    it("returns results for a well-formed body", () => {
      const res = controller.validate({
        curves: [{ mnemonic: "GR", uom: "gAPI" }, { mnemonic: "NPHI" }]
      } as CurveValidationRequestDto);
      expect(res.total).toBe(2);
      expect(res.resolved + res.unresolved).toBe(2);
    });

    it("throws 400 when curves is missing (pipe skips undefined, handler guards it)", () => {
      expect(() =>
        controller.validate({} as CurveValidationRequestDto)
      ).toThrow(BadRequestException);
    });

    it("handles a missing mnemonic gracefully instead of failing", () => {
      const res = controller.validate({
        curves: [{ uom: "gAPI" }]
      } as unknown as CurveValidationRequestDto);
      expect(res.total).toBe(1);
    });
  });
});
