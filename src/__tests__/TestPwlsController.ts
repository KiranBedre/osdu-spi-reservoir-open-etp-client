import "jest";

import {
  getPwlsStatus,
  getPropertyFromMnemonic,
  getQuantityClassForProperty,
  getPropertyTypeIdForProperty,
  isKnownPwlsProperty,
  loadVendorCatalog,
  getLoadedMnemonicCount,
  getLoadedVendors
} from "../lib/jsonTypes/PwlsCurveCatalog";

/**
 * Unit tests for the PWLS controller logic.
 * Tests the controller's resolution, validation, and catalog-loading behavior
 * by exercising the same functions the controller delegates to.
 */

// --- Helpers that mirror controller logic ---

function resolveEndpoint(mnemonic: string) {
  if (!mnemonic || mnemonic.trim().length === 0) {
    return { error: "Query parameter 'mnemonic' is required" };
  }

  const property = getPropertyFromMnemonic(mnemonic);
  if (property) {
    return {
      mnemonic,
      property,
      quantityClass: getQuantityClassForProperty(property),
      propertyTypeId: getPropertyTypeIdForProperty(property),
      resolved: true
    };
  }

  if (isKnownPwlsProperty(mnemonic)) {
    return {
      mnemonic,
      property: mnemonic.toLowerCase(),
      quantityClass: getQuantityClassForProperty(mnemonic),
      propertyTypeId: getPropertyTypeIdForProperty(mnemonic),
      resolved: true
    };
  }

  return { mnemonic, resolved: false };
}

interface CurveEntry {
  mnemonic: string;
  uom?: string;
}

interface ValidationResult {
  mnemonic: string;
  property?: string;
  quantityClass?: string;
  propertyTypeId?: string;
  knownProperty: boolean;
  mnemonicResolved: boolean;
  warnings?: string[];
}

function validateEndpoint(curves: CurveEntry[]) {
  const results: ValidationResult[] = [];

  for (const entry of curves) {
    if (!entry.mnemonic || typeof entry.mnemonic !== "string") {
      results.push({
        mnemonic: entry.mnemonic ?? "",
        knownProperty: false,
        mnemonicResolved: false,
        warnings: ["Invalid or missing mnemonic"]
      });
      continue;
    }

    const result: ValidationResult = {
      mnemonic: entry.mnemonic,
      knownProperty: false,
      mnemonicResolved: false
    };

    const property = getPropertyFromMnemonic(entry.mnemonic);
    if (property) {
      result.mnemonicResolved = true;
      result.property = property;
      result.quantityClass = getQuantityClassForProperty(property);
      result.propertyTypeId = getPropertyTypeIdForProperty(property);
      result.knownProperty = isKnownPwlsProperty(property);
    } else if (isKnownPwlsProperty(entry.mnemonic)) {
      result.knownProperty = true;
      result.property = entry.mnemonic.toLowerCase();
      result.quantityClass = getQuantityClassForProperty(entry.mnemonic);
      result.propertyTypeId = getPropertyTypeIdForProperty(entry.mnemonic);
    }

    if (entry.uom && result.quantityClass) {
      result.warnings = [
        `UOM '${entry.uom}' provided — QuantityClass is '${result.quantityClass}'. Verify compatibility.`
      ];
    } else if (!result.property) {
      result.warnings = [
        `Mnemonic '${entry.mnemonic}' not found in PWLS catalog or loaded vendor catalogs`
      ];
    }

    results.push(result);
  }

  const resolved = results.filter(r => r.mnemonicResolved || r.knownProperty).length;
  const withWarnings = results.filter(r => r.warnings && r.warnings.length > 0).length;

  return {
    total: results.length,
    resolved,
    unresolved: results.length - resolved,
    withWarnings,
    results
  };
}

// --- Tests ---

describe("PwlsController", () => {
  describe("GET /pwls/status", () => {
    it("should return status with properties, mnemonics, and vendors", () => {
      const status = getPwlsStatus();
      expect(status.properties).toBe(875);
      expect(status.mnemonics).toBeGreaterThan(30000);
      expect(status.vendors).toContain("Schlumberger");
    });
  });

  describe("GET /pwls/resolve", () => {
    it("should resolve a known SLB mnemonic (GR)", () => {
      const result = resolveEndpoint("GR");
      expect(result.resolved).toBe(true);
      expect(result.property).toBe("gamma ray");
      expect(result.quantityClass).toBe("API gamma ray");
      expect(result.propertyTypeId).toBeDefined();
    });

    it("should resolve NPHI to thermal neutron porosity", () => {
      const result = resolveEndpoint("NPHI");
      expect(result.resolved).toBe(true);
      expect(result.property).toBe("thermal neutron porosity");
      expect(result.quantityClass).toBe("dimensionless");
    });

    it("should resolve RHOB to bulk density", () => {
      const result = resolveEndpoint("RHOB");
      expect(result.resolved).toBe(true);
      expect(result.property).toBe("bulk density");
      expect(result.quantityClass).toBe("mass per volume");
    });

    it("should resolve a PWLS property name directly (fallback)", () => {
      const result = resolveEndpoint("porosity");
      expect(result.resolved).toBe(true);
      expect(result.property).toBe("porosity");
      expect(result.quantityClass).toBe("dimensionless");
    });

    it("should return resolved=false for unknown mnemonic", () => {
      const result = resolveEndpoint("TOTALLY_UNKNOWN_XYZ");
      expect(result.resolved).toBe(false);
      expect(result.property).toBeUndefined();
    });

    it("should return error for empty mnemonic", () => {
      const result = resolveEndpoint("");
      expect((result as any).error).toBeDefined();
    });

    it("should return error for whitespace-only mnemonic", () => {
      const result = resolveEndpoint("   ");
      expect((result as any).error).toBeDefined();
    });
  });

  describe("POST /pwls/validate", () => {
    it("should validate a mix of known and unknown curves", () => {
      const response = validateEndpoint([
        { mnemonic: "GR", uom: "gAPI" },
        { mnemonic: "NPHI" },
        { mnemonic: "UNKNOWN_CURVE_XYZ" }
      ]);

      expect(response.total).toBe(3);
      expect(response.resolved).toBe(2);
      expect(response.unresolved).toBe(1);

      // GR should resolve with UOM warning
      const gr = response.results[0];
      expect(gr.mnemonicResolved).toBe(true);
      expect(gr.property).toBe("gamma ray");
      expect(gr.quantityClass).toBe("API gamma ray");
      expect(gr.warnings).toBeDefined();
      expect(gr.warnings![0]).toContain("gAPI");
      expect(gr.warnings![0]).toContain("API gamma ray");

      // NPHI should resolve without warning (no UOM provided)
      const nphi = response.results[1];
      expect(nphi.mnemonicResolved).toBe(true);
      expect(nphi.property).toBe("thermal neutron porosity");
      expect(nphi.warnings).toBeUndefined();

      // Unknown should have warning
      const unknown = response.results[2];
      expect(unknown.mnemonicResolved).toBe(false);
      expect(unknown.knownProperty).toBe(false);
      expect(unknown.warnings).toBeDefined();
      expect(unknown.warnings![0]).toContain("not found");
    });

    it("should validate curves that are PWLS property names directly", () => {
      const response = validateEndpoint([
        { mnemonic: "porosity" },
        { mnemonic: "density", uom: "g/cm3" }
      ]);

      expect(response.total).toBe(2);
      expect(response.resolved).toBe(2);

      const porosity = response.results[0];
      expect(porosity.knownProperty).toBe(true);
      expect(porosity.property).toBe("porosity");
      expect(porosity.quantityClass).toBe("dimensionless");

      const density = response.results[1];
      expect(density.knownProperty).toBe(true);
      expect(density.property).toBe("density");
      expect(density.warnings).toBeDefined();
      expect(density.warnings![0]).toContain("g/cm3");
    });

    it("should handle empty curves array", () => {
      const response = validateEndpoint([]);
      expect(response.total).toBe(0);
      expect(response.resolved).toBe(0);
      expect(response.unresolved).toBe(0);
      expect(response.results).toEqual([]);
    });

    it("should handle invalid mnemonic entries", () => {
      const response = validateEndpoint([
        { mnemonic: "" },
        { mnemonic: null as any }
      ]);

      expect(response.total).toBe(2);
      expect(response.unresolved).toBe(2);
      expect(response.results[0].warnings![0]).toContain("Invalid or missing");
      expect(response.results[1].warnings![0]).toContain("Invalid or missing");
    });

    it("should produce propertyTypeId (UUID) for resolved curves", () => {
      const response = validateEndpoint([
        { mnemonic: "GR" },
        { mnemonic: "DT" },
        { mnemonic: "SP" }
      ]);

      for (const r of response.results) {
        expect(r.mnemonicResolved).toBe(true);
        expect(r.propertyTypeId).toBeDefined();
        expect(r.propertyTypeId!.length).toBe(36); // UUID format
      }
    });

    it("should count withWarnings correctly", () => {
      const response = validateEndpoint([
        { mnemonic: "GR", uom: "gAPI" },     // warning (UOM info)
        { mnemonic: "NPHI" },                  // no warning
        { mnemonic: "UNKNOWN" }                // warning (not found)
      ]);

      expect(response.withWarnings).toBe(2);
    });
  });

  describe("POST /pwls/catalog", () => {
    it("should load a custom vendor catalog", () => {
      const catalog = {
        schemaVersion: "1.0.0" as const,
        "Company Code": 888,
        "Company Name": "TestControllerVendor",
        data: [
          {
            "Curve Mnemonic": "CTRL_TEST_GR",
            Property: "gamma ray",
            "Curve Unit Quantity Class": "API gamma ray",
            "LIS Curve Mnemonic": null
          },
          {
            "Curve Mnemonic": "CTRL_TEST_POR",
            Property: "porosity",
            "Curve Unit Quantity Class": "dimensionless",
            "LIS Curve Mnemonic": null
          }
        ]
      };

      const countBefore = getLoadedMnemonicCount();
      const added = loadVendorCatalog(catalog as any);
      expect(added).toBe(2);
      expect(getLoadedMnemonicCount()).toBe(countBefore + 2);
      expect(getLoadedVendors()).toContain("TestControllerVendor");
    });

    it("should resolve newly loaded vendor mnemonics", () => {
      const result = resolveEndpoint("CTRL_TEST_GR");
      expect(result.resolved).toBe(true);
      expect(result.property).toBe("gamma ray");
    });

    it("should not duplicate mnemonics on re-load", () => {
      const catalog = {
        schemaVersion: "1.0.0" as const,
        "Company Code": 888,
        "Company Name": "TestControllerVendor",
        data: [
          {
            "Curve Mnemonic": "CTRL_TEST_GR",
            Property: "gamma ray",
            "Curve Unit Quantity Class": "API gamma ray",
            "LIS Curve Mnemonic": null
          }
        ]
      };

      const countBefore = getLoadedMnemonicCount();
      const added = loadVendorCatalog(catalog as any);
      expect(added).toBe(0); // already loaded
      expect(getLoadedMnemonicCount()).toBe(countBefore);
    });
  });
});
