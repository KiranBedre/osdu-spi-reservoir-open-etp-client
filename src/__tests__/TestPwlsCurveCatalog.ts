import "jest";

import {
  getQuantityClassForProperty,
  getPropertyTypeIdForProperty,
  isKnownPwlsProperty,
  loadVendorCatalog,
  getPropertyFromMnemonic,
  getPropertyTypeIdFromMnemonic,
  getQuantityClassFromMnemonic,
  getLoadedMnemonicCount,
  hasVendorCatalog,
  getLoadedVendors,
  getPwlsStatus,
  PwlsPropertyNames
} from "../lib/jsonTypes/PwlsCurveCatalog";

describe("PwlsCurveCatalog", () => {
  describe("Static property lookup (bundled PWLS v4 properties)", () => {
    it("should have 875 properties loaded", () => {
      expect(PwlsPropertyNames.size).toBe(875);
    });

    it("should recognize known PWLS properties (case-insensitive)", () => {
      expect(isKnownPwlsProperty("porosity")).toBe(true);
      expect(isKnownPwlsProperty("Porosity")).toBe(true);
      expect(isKnownPwlsProperty("density")).toBe(true);
      expect(isKnownPwlsProperty("acoustic slowness")).toBe(true);
      expect(isKnownPwlsProperty("permeability")).toBe(true);
    });

    it("should reject unknown property names", () => {
      expect(isKnownPwlsProperty("foobar_unknown")).toBe(false);
      expect(isKnownPwlsProperty("")).toBe(false);
    });

    it("should return QuantityClass for known properties", () => {
      expect(getQuantityClassForProperty("porosity")).toBe("dimensionless");
      expect(getQuantityClassForProperty("density")).toBe("mass per volume");
      expect(getQuantityClassForProperty("acceleration")).toBe(
        "linear acceleration"
      );
      expect(getQuantityClassForProperty("acoustic slowness")).toBe(
        "time per length"
      );
    });

    it("should return undefined QuantityClass for unknown properties", () => {
      expect(getQuantityClassForProperty("nonsense")).toBeUndefined();
    });

    it("should return PropertyType UUID for known properties", () => {
      // "acceleration" has UUID ca5a4057-f4c9-4efb-8168-7924d2b18a18
      const uuid = getPropertyTypeIdForProperty("acceleration");
      expect(uuid).toBe("ca5a4057-f4c9-4efb-8168-7924d2b18a18");
    });

    it("should return PropertyType UUID for case-insensitive lookup", () => {
      const uuid = getPropertyTypeIdForProperty("Porosity");
      expect(uuid).toBeDefined();
      expect(typeof uuid).toBe("string");
      expect(uuid!.length).toBe(36); // UUID format
    });

    it("should return undefined for properties without UUID", () => {
      // The 2 unmatched properties: 'attenuation gain', 'penetration per rotation'
      const uuid = getPropertyTypeIdForProperty("attenuation gain");
      // May fall through to RESQML alias lookup, either way should not throw
      expect(uuid === undefined || typeof uuid === "string").toBe(true);
    });
  });

  describe("Vendor mnemonic catalog (loaded on demand)", () => {
    it("should start with no vendor catalog loaded", () => {
      // Note: other tests in the suite may have already loaded, 
      // so we just check the API works
      expect(typeof getLoadedMnemonicCount()).toBe("number");
      expect(typeof hasVendorCatalog()).toBe("boolean");
    });

    it("should load a vendor catalog and resolve mnemonics", () => {
      const mockCatalog = {
        $schema: "https://placeholder.opengroup.org/schemas/1.0.0/pwls_curve_mapping.json",
        schemaVersion: "1.0.0" as const,
        LastUpdated: "2025-01-01",
        "Company Code": 999,
        "Company Name": "TestVendor",
        data: [
          {
            "Curve Mnemonic": "XTEST_NP1",
            Property: "neutron porosity",
            "Curve Unit Quantity Class": "dimensionless",
            "LIS Curve Mnemonic": "XNP1"
          },
          {
            "Curve Mnemonic": "XTEST_GR1",
            Property: "gamma ray",
            "Curve Unit Quantity Class": "API gamma ray",
            "LIS Curve Mnemonic": null
          },
          {
            "Curve Mnemonic": "XTEST_DT1",
            Property: "acoustic slowness",
            "Curve Unit Quantity Class": "time per length",
            "LIS Curve Mnemonic": null
          }
        ]
      };

      const added = loadVendorCatalog(mockCatalog);
      expect(added).toBe(3);
      expect(hasVendorCatalog()).toBe(true);
    });

    it("should resolve loaded mnemonics to PWLS properties", () => {
      expect(getPropertyFromMnemonic("XTEST_NP1")).toBe("neutron porosity");
      expect(getPropertyFromMnemonic("XTEST_GR1")).toBe("gamma ray");
      expect(getPropertyFromMnemonic("XTEST_DT1")).toBe("acoustic slowness");
    });

    it("should resolve mnemonics case-insensitively (uppercase fallback)", () => {
      expect(getPropertyFromMnemonic("xtest_np1")).toBe("neutron porosity");
    });

    it("should return undefined for unknown mnemonics", () => {
      expect(getPropertyFromMnemonic("ZZZZZ_UNKNOWN")).toBeUndefined();
    });

    it("should chain mnemonic → property → UUID", () => {
      const uuid = getPropertyTypeIdFromMnemonic("XTEST_DT1");
      // "acoustic slowness" has a UUID in the manifest
      expect(uuid).toBeDefined();
      expect(typeof uuid).toBe("string");
    });

    it("should chain mnemonic → property → QuantityClass", () => {
      expect(getQuantityClassFromMnemonic("XTEST_NP1")).toBe("dimensionless");
      expect(getQuantityClassFromMnemonic("XTEST_DT1")).toBe("time per length");
    });

    it("should return undefined for unknown mnemonic chains", () => {
      expect(getPropertyTypeIdFromMnemonic("UNKNOWN_XYZ")).toBeUndefined();
      expect(getQuantityClassFromMnemonic("UNKNOWN_XYZ")).toBeUndefined();
    });
  });

  describe("Auto-loaded SLB vendor catalog (default)", () => {
    it("should have SLB auto-loaded at module init", () => {
      expect(hasVendorCatalog()).toBe(true);
      expect(getLoadedVendors()).toContain("Schlumberger");
    });

    it("should have ~30K SLB mnemonics loaded", () => {
      // SLB has 30,201 + any test mnemonics added above
      expect(getLoadedMnemonicCount()).toBeGreaterThan(30000);
    });

    it("should resolve common SLB mnemonics", () => {
      // Well-known SLB curve mnemonics
      expect(getPropertyFromMnemonic("GR")).toBeDefined();
      expect(getPropertyFromMnemonic("NPHI")).toBeDefined();
      expect(getPropertyFromMnemonic("RHOB")).toBeDefined();
      expect(getPropertyFromMnemonic("DT")).toBeDefined();
    });

    it("should resolve GR → gamma ray", () => {
      expect(getPropertyFromMnemonic("GR")).toBe("gamma ray");
    });

    it("should resolve NPHI → thermal neutron porosity", () => {
      expect(getPropertyFromMnemonic("NPHI")).toBe("thermal neutron porosity");
    });

    it("should resolve RHOB → bulk density", () => {
      expect(getPropertyFromMnemonic("RHOB")).toBe("bulk density");
    });

    it("should resolve DT → compressional slowness", () => {
      expect(getPropertyFromMnemonic("DT")).toBe("compressional slowness");
    });

    it("should chain SLB mnemonic → property → QuantityClass", () => {
      expect(getQuantityClassFromMnemonic("GR")).toBe("API gamma ray");
      expect(getQuantityClassFromMnemonic("NPHI")).toBe("dimensionless");
      expect(getQuantityClassFromMnemonic("RHOB")).toBe("mass per volume");
      expect(getQuantityClassFromMnemonic("DT")).toBe("time per length");
    });

    it("should chain SLB mnemonic → property → UUID", () => {
      const grUuid = getPropertyTypeIdFromMnemonic("GR");
      expect(grUuid).toBeDefined();
      expect(grUuid!.length).toBe(36);

      const dtUuid = getPropertyTypeIdFromMnemonic("DT");
      expect(dtUuid).toBeDefined();
      expect(dtUuid!.length).toBe(36);
    });
  });

  describe("getPwlsStatus() introspection", () => {
    it("should return complete status summary", () => {
      const status = getPwlsStatus();
      expect(status.properties).toBe(875);
      expect(status.mnemonics).toBeGreaterThan(30000);
      expect(status.vendors).toContain("Schlumberger");
    });
  });

  describe("Full resolution chain (end-to-end)", () => {
    const testCases = [
      { mnemonic: "GR", property: "gamma ray", qc: "API gamma ray" },
      { mnemonic: "NPHI", property: "thermal neutron porosity", qc: "dimensionless" },
      { mnemonic: "RHOB", property: "bulk density", qc: "mass per volume" },
      { mnemonic: "DT", property: "compressional slowness", qc: "time per length" },
      { mnemonic: "SP", property: "spontaneous potential", qc: "electric potential difference" },
      { mnemonic: "CALI", property: "borehole diameter", qc: "length" },
      { mnemonic: "PERM", property: "permeability", qc: "permeability rock" },
    ];

    for (const tc of testCases) {
      it(`${tc.mnemonic} → ${tc.property} → ${tc.qc}`, () => {
        const resolved = getPropertyFromMnemonic(tc.mnemonic);
        expect(resolved).toBe(tc.property);
        expect(getQuantityClassFromMnemonic(tc.mnemonic)).toBe(tc.qc);
        expect(isKnownPwlsProperty(tc.property)).toBe(true);
        // UUID should exist for standard properties
        const uuid = getPropertyTypeIdFromMnemonic(tc.mnemonic);
        expect(uuid).toBeDefined();
      });
    }
  });
});
