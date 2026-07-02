import "jest";
import request from "supertest";
import restApp from "../lib/restApi/App";
import { restApiServerPath } from "../lib/common/config";

// ─────────────────────────────────────────────────────────────────────────────
// PWLS REST API Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("PWLS REST API", () => {
  let nestAppServer: any;

  beforeAll(async () => {
    const nestApp = await restApp();
    nestAppServer = (await nestApp.init()).getHttpServer();
  });

  describe("GET /health/pwls", () => {
    it("should return PWLS catalog status", async () => {
      const response = await request(nestAppServer)
        .get(`${restApiServerPath}/health/pwls`)
        .expect(200);

      expect(response.body).toHaveProperty("properties");
      expect(response.body).toHaveProperty("mnemonics");
      expect(response.body).toHaveProperty("vendors");

      expect(response.body.properties).toBe(875);
      expect(response.body.mnemonics).toBeGreaterThan(30000);
      expect(response.body.vendors).toContain("Schlumberger");
    });

    it("should return valid JSON with correct types", async () => {
      const response = await request(nestAppServer)
        .get(`${restApiServerPath}/health/pwls`)
        .expect("Content-Type", /json/)
        .expect(200);

      expect(typeof response.body.properties).toBe("number");
      expect(typeof response.body.mnemonics).toBe("number");
      expect(Array.isArray(response.body.vendors)).toBe(true);
    });
  });

  describe("POST /health/pwls/catalog", () => {
    const mockHalliburtonCatalog = {
      schemaVersion: "1.0.0",
      LastUpdated: "2025-06-01",
      "Company Code": 280,
      "Company Name": "Halliburton_Test",
      data: [
        {
          "Curve Mnemonic": "ITEST_HAL_GR",
          Property: "gamma ray",
          "Curve Unit Quantity Class": "API gamma ray",
          "LIS Curve Mnemonic": null,
          "Curve Description": "Integration test gamma ray"
        },
        {
          "Curve Mnemonic": "ITEST_HAL_NPHI",
          Property: "neutron porosity",
          "Curve Unit Quantity Class": "dimensionless",
          "LIS Curve Mnemonic": "TNPH",
          "Curve Description": "Integration test neutron porosity"
        },
        {
          "Curve Mnemonic": "ITEST_HAL_RHOB",
          Property: "bulk density",
          "Curve Unit Quantity Class": "mass per volume",
          "LIS Curve Mnemonic": null,
          "Curve Description": "Integration test density"
        }
      ]
    };

    it("should load a vendor catalog and return added count", async () => {
      const response = await request(nestAppServer)
        .post(`${restApiServerPath}/health/pwls/catalog`)
        .send(mockHalliburtonCatalog)
        .set("Content-Type", "application/json")
        .expect(201);

      expect(response.body).toHaveProperty("added");
      expect(response.body).toHaveProperty("total");
      expect(response.body).toHaveProperty("vendor");

      expect(response.body.added).toBe(3);
      expect(response.body.total).toBeGreaterThan(30000);
      expect(response.body.vendor).toBe("Halliburton_Test");
    });

    it("should show new vendor in GET /health/pwls after loading", async () => {
      const response = await request(nestAppServer)
        .get(`${restApiServerPath}/health/pwls`)
        .expect(200);

      expect(response.body.vendors).toContain("Halliburton_Test");
      expect(response.body.vendors).toContain("Schlumberger");
    });

    it("should not add duplicate mnemonics on re-POST", async () => {
      const response = await request(nestAppServer)
        .post(`${restApiServerPath}/health/pwls/catalog`)
        .send(mockHalliburtonCatalog)
        .set("Content-Type", "application/json")
        .expect(201);

      // All 3 mnemonics already exist from previous test
      expect(response.body.added).toBe(0);
    });

    it("should handle empty data array", async () => {
      const emptyCatalog = {
        schemaVersion: "1.0.0",
        LastUpdated: "2025-01-01",
        "Company Code": 999,
        "Company Name": "EmptyVendor",
        data: []
      };

      const response = await request(nestAppServer)
        .post(`${restApiServerPath}/health/pwls/catalog`)
        .send(emptyCatalog)
        .set("Content-Type", "application/json")
        .expect(201);

      expect(response.body.added).toBe(0);
      expect(response.body.vendor).toBe("EmptyVendor");
    });

    it("should handle large catalog body", async () => {
      // Generate a large catalog with 1000 entries
      const largeCatalog = {
        schemaVersion: "1.0.0",
        LastUpdated: "2025-01-01",
        "Company Code": 998,
        "Company Name": "LargeTestVendor",
        data: Array.from({ length: 1000 }, (_, i) => ({
          "Curve Mnemonic": `ITEST_LARGE_${i.toString().padStart(4, "0")}`,
          Property: "gamma ray",
          "Curve Unit Quantity Class": "API gamma ray",
          "LIS Curve Mnemonic": null
        }))
      };

      const response = await request(nestAppServer)
        .post(`${restApiServerPath}/health/pwls/catalog`)
        .send(largeCatalog)
        .set("Content-Type", "application/json")
        .expect(201);

      expect(response.body.added).toBe(1000);
      expect(response.body.vendor).toBe("LargeTestVendor");
    });
  });

  describe("GET /health/converters (existing, sanity check)", () => {
    it("should still work alongside PWLS endpoints", async () => {
      const response = await request(nestAppServer)
        .get(`${restApiServerPath}/health/converters`)
        .expect(200);

      expect(response.body).toHaveProperty("count");
      expect(response.body).toHaveProperty("types");
      expect(response.body.count).toBeGreaterThan(0);
    });
  });
});
