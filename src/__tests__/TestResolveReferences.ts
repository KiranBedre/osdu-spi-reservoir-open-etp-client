import "jest";

import { ResqmlClient } from "../lib/client/ResqmlClient";
import { EtpUri } from "../lib/common/EtpUri";
import { EtpContentType } from "../lib/common/EtpContentType";

// Regression test for issue #199: since v0.30.0 (!268) the inProgress cycle
// guard in resolveReferences() was keyed per recursion step, so structural
// recursion into a data object's OWN nested objects/arrays (which reuse the
// parent URI) was mis-detected as a cycle and returned without _data. Only
// direct top-level child references resolved. This verifies nested references
// and nested eml20.Hdf5Dataset arrays are resolved again, while a genuine
// mutual-DOR cycle is still short-circuited (no infinite recursion).

const DS = "demo/Volve";
const resqmlCt = (t: string) => EtpContentType.createContentType("resqml", "2.0", t);
const objUri = (t: string, guid: string) =>
  EtpUri.createObjectUri(DS, "resqml", "2.0", t, guid).uri;

describe("ResqmlClient.resolveReferences (issue #199)", () => {
  const resolve = (uri: string, obj: any, objects: Map<string, any>, dataArrays: Map<string, any>) =>
    (new ResqmlClient() as any).resolveReferences(
      uri,
      obj,
      objects,
      dataArrays,
      new Map(),
      "json",
      true
    );

  it("resolves references and arrays nested inside plain sub-objects", () => {
    const gridGuid = "6854264a-cfb8-437b-b64f-9a5f6cb7fad1";
    const crsGuid = "11111111-1111-1111-1111-111111111111";
    const suppGuid = "22222222-2222-2222-2222-222222222222";
    const proxyGuid = "33333333-3333-3333-3333-333333333333";

    const grid = {
      $type: "resqml20.obj_Grid2dRepresentation",
      Grid2dPatch: {
        Geometry: {
          // nested reference (was returned without _data before the fix)
          LocalCrs: {
            $type: "eml20.DataObjectReference",
            ContentType: resqmlCt("obj_LocalDepth3dCrs"),
            UUID: crsGuid
          },
          Points: {
            SupportingGeometry: {
              // nested reference two levels deeper
              SupportingRepresentation: {
                $type: "eml20.DataObjectReference",
                ContentType: resqmlCt("obj_Grid2dRepresentation"),
                UUID: suppGuid
              }
            },
            ZValues: {
              // nested eml20.Hdf5Dataset array
              Values: {
                $type: "eml20.Hdf5Dataset",
                HdfProxy: { UUID: proxyGuid },
                PathInHdfFile: "/RESQML/points"
              }
            }
          }
        }
      }
    };

    const objects = new Map<string, any>([
      [objUri("obj_LocalDepth3dCrs", crsGuid), { $type: "resqml20.obj_LocalDepth3dCrs", Title: "CRS" }],
      [objUri("obj_Grid2dRepresentation", suppGuid), { $type: "resqml20.obj_Grid2dRepresentation", Title: "supporting" }]
    ]);

    const proxyUri = EtpUri.createObjectUri(DS, "eml", "2.0", "obj_EpcExternalPartReference", proxyGuid).uri;
    const dataArrays = new Map<string, any>([
      [`${proxyUri}/RESQML/points`, { uid: { uri: proxyUri, pathInResource: "/RESQML/points" }, dimensions: [2] }]
    ]);

    const res = resolve(objUri("obj_Grid2dRepresentation", gridGuid), grid, objects, dataArrays);

    expect(res.Grid2dPatch.Geometry.LocalCrs._data).toBeDefined();
    expect(res.Grid2dPatch.Geometry.Points.SupportingGeometry.SupportingRepresentation._data).toBeDefined();
    expect(res.Grid2dPatch.Geometry.Points.ZValues.Values._data).toBeDefined();
  });

  it("still short-circuits a genuine mutual-DOR cycle", () => {
    const aGuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const bGuid = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    const a: any = {
      $type: "resqml20.obj_Grid2dRepresentation",
      RefB: { $type: "eml20.DataObjectReference", ContentType: resqmlCt("obj_Grid2dRepresentation"), UUID: bGuid }
    };
    const b: any = {
      $type: "resqml20.obj_Grid2dRepresentation",
      RefA: { $type: "eml20.DataObjectReference", ContentType: resqmlCt("obj_Grid2dRepresentation"), UUID: aGuid }
    };
    const objects = new Map<string, any>([
      [objUri("obj_Grid2dRepresentation", aGuid), a],
      [objUri("obj_Grid2dRepresentation", bGuid), b]
    ]);

    const res = resolve(objUri("obj_Grid2dRepresentation", aGuid), a, objects, new Map());

    // forward edge resolves, the back-edge that closes the cycle is left bare
    expect(res.RefB._data).toBeDefined();
    expect(res.RefB._data.RefA._data).toBeUndefined();
  });
});
