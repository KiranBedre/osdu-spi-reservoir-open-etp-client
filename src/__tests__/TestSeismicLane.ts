import "jest";

import { RddmsClient } from "../../sdk";
import type { DataObject } from "../../sdk";

/**
 * Domain-typed seismic lane (§10.6 #2): the `rddms.seismic.*` methods wire the
 * pure builders into transaction-aware put + domain get with reversible OSDU
 * projection. These tests stub the transport (model.put / resources.get /
 * arrays.*) so the *composition* — right object graph in, right OSDU record out
 * — is verified without a live server.
 */
describe("seismic lane — put composition (build → model.put)", () => {
    const client = new RddmsClient({ baseUrl: "http://localhost/api" });
    const putSpy = jest.spyOn(client.model, "put").mockResolvedValue({ transactionId: "tx-1", success: true });

    afterEach(() => putSpy.mockClear());

    it("velocity.put builds an interval-velocity ContinuousProperty and writes it atomically", async () => {
        const res = await client.seismic.velocity.put("ds", {
            title: "Vint",
            hdfUuid: "hdf",
            version: "2.0.1",
            supportingRepUuid: "grid",
            supportingRepType: "resqml20.obj_Grid2dRepresentation",
            velocityKind: "interval",
            values: [2400, 2600],
        });
        expect(putSpy).toHaveBeenCalledTimes(1);
        const [ds, input] = putSpy.mock.calls[0];
        expect(ds).toBe("ds");
        expect(input.parts).toHaveLength(1);
        const obj = input.parts![0].object as any;
        expect(obj.$type).toBe("resqml20.obj_ContinuousProperty");
        expect(obj.PropertyKind.Kind).toBe("interval velocity");
        expect(obj.UOM).toBe("m/s");
        expect(res).toEqual({ transactionId: "tx-1", success: true, uuid: obj.Uuid, parts: input.parts });
    });

    it("checkshots.put (2.0.1) decomposes into a frame + two-way-time property (2 parts)", async () => {
        await client.seismic.checkshots.put("ds", {
            title: "CS",
            hdfUuid: "hdf",
            version: "2.0.1",
            trajectoryUuid: "traj",
            mds: [500, 1000, 1500],
            times: [400, 780, 1150],
        });
        const [, input] = putSpy.mock.calls[0];
        expect(input.parts).toHaveLength(2);
        expect((input.parts![0].object as any).$type).toBe("resqml20.obj_WellboreFrameRepresentation");
        expect((input.parts![1].object as any).$type).toBe("resqml20.obj_ContinuousProperty");
    });

    it("horizons/faults/properties compose their builders and return the primary uuid", async () => {
        const g = await client.seismic.horizons.putGridded("ds", {
            title: "H1",
            hdfUuid: "hdf",
            crsUuid: "crs",
            version: "2.0.1",
            ni: 2,
            nj: 2,
            origin: { x: 0, y: 0 },
            iSpacing: 25,
            jSpacing: 25,
            zValues: [10, 11, 12, 13],
        });
        expect((putSpy.mock.calls[0][1].parts![0].object as any).$type).toContain("Grid2dRepresentation");
        expect(g.uuid).toBeDefined();
    });
});

describe("seismic lane — domain get + reversible OSDU projection", () => {
    const client = new RddmsClient({ baseUrl: "http://localhost/api" });

    it("velocity.get projects a ContinuousProperty onto OSDU GenericProperty:1.0.0", async () => {
        const object: DataObject = {
            $type: "resqml20.obj_ContinuousProperty",
            Uuid: "vm-1",
            SchemaVersion: "2.0.0.20140822",
            Citation: { Title: "Vint", Originator: "t", Creation: "now" },
            PropertyKind: { Kind: "interval velocity" },
            UOM: "m/s",
            MinimumValue: [2400],
            MaximumValue: [2600],
        } as any;
        jest.spyOn(client.resources, "get").mockResolvedValue([object]);

        const { osdu } = await client.seismic.velocity.get("ds", "vm-1", { version: "2.0.1", osdu: true });
        expect(osdu!.kind).toBe("osdu:wks:work-product-component--GenericProperty:1.0.0");
        expect(osdu!.data.ValueType).toBe("continuous");
        expect(osdu!.data.PropertyType).toBe("interval velocity");
        expect(osdu!.data.ExtensionProperties.ResqmlObjectUUID).toBe("vm-1");
        expect(osdu!.data.ExtensionProperties.ResqmlSchemaVersion).toBe("2.0.0.20140822");
    });
});
