import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";
import { getKind } from "./MilestoneKinds";

import {
  Data,
  LocalModelCompoundCRS
} from "./Generated/work-product-component/LocalModelCompoundCrs.1.2.0";

/**
 * Pure-geodetic identity of a compound CRS, matching the accepted
 * `LocalModelCompoundCrs:1.3.0` field set (datadef/crs O1). Local-frame
 * parameters (offsets, rotation, axis, Z direction) are deliberately excluded —
 * they belong on dataset `FrameOfReferenceCRS` metadata, not this record.
 */
interface GeodeticIdentity {
  CoordinateReferenceSystemID?: string;
  VerticalCoordinateReferenceSystemID?: string;
  PersistableReferenceProjectedCrs?: string;
  PersistableReferenceVerticalCrs?: string;
  ProjectedCrsName?: string;
  VerticalCrsName?: string;
}

/** True when the resolved `LocalModelCompoundCrs` kind is >= 1.3.0. */
function compoundCrsSupportsTopLevelGeodetic(): boolean {
  const kind = getKind("LocalModelCompoundCrs");
  const m = kind?.match(/:(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [maj, min] = [parseInt(m[1], 10), parseInt(m[2], 10)];
  return maj > 1 || (maj === 1 && min >= 3);
}

export class LocalModelCompoundCrsOSDU
  extends ResqmlWorkProductComponent<SimpleJson<resqml20.obj_LocalDepth3dCrs>>
  implements LocalModelCompoundCRS
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml20.obj_LocalDepth3dCrs>,
    context: OSDUContext
  ) {
    super(xml, context, "LocalModelCompoundCrs.1.2.0");
  }
  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_LocalDepth3dCrs>
  ): Promise<LocalModelCompoundCrsOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }
    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      ExtensionProperties: undefined
    };

    // O1: fill the geodetic identity so the record is no longer hollow. Until
    // the 1.3.0 kind is registered in the Schema/Search service, the identity
    // rides in ExtensionProperties (1.2.0-safe); once the service resolves a
    // >= 1.3.0 kind, it is additionally stamped at the data top level.
    const geodetic = await this.geodeticIdentity(xml, context);
    if (Object.keys(geodetic).length > 0) {
      const ext = (this.data.ExtensionProperties ??= {});
      Object.assign(ext, geodetic);
      if (compoundCrsSupportsTopLevelGeodetic()) {
        Object.assign(this.data as Record<string, unknown>, geodetic);
      }
    }

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }

  /**
   * Read the projected + vertical CRS identity from the RESQML LocalDepth3dCrs
   * and project it onto the OSDU LocalModelCompoundCrs geodetic field set,
   * reusing the shared `referenceSystemId` / `persistableReferenceSystem`
   * helpers. Degrades gracefully: any unresolved field is simply omitted.
   */
  private async geodeticIdentity(
    xml: SimpleJson<resqml20.obj_LocalDepth3dCrs>,
    context: OSDUContext
  ): Promise<GeodeticIdentity> {
    const out: GeodeticIdentity = {};
    const projected = (xml as any).ProjectedCrs;
    if (projected?.$type === "eml20.ProjectedCrsEpsgCode" && projected.EpsgCode != null) {
      const code = Number(projected.EpsgCode);
      try {
        const epsgCrs = await context.findProjectedEPSGCrs(code);
        out.CoordinateReferenceSystemID = ResqmlWorkProductComponent.referenceSystemId(epsgCrs, code, context);
        out.PersistableReferenceProjectedCrs = ResqmlWorkProductComponent.persistableReferenceSystem(epsgCrs, code);
        if (epsgCrs?.data?.Name) out.ProjectedCrsName = epsgCrs.data.Name;
      } catch {
        out.CoordinateReferenceSystemID = context.addReferenceData(
          "CoordinateReferenceSystem",
          `Projected:EPSG::${code}`
        );
        out.PersistableReferenceProjectedCrs = JSON.stringify({ authCode: { auth: "EPSG", code } });
      }
    } else if (projected?.$type === "eml20.ProjectedUnknownCrs" && typeof projected.Unknown === "string") {
      out.PersistableReferenceProjectedCrs = projected.Unknown;
    }

    const vertical = (xml as any).VerticalCrs;
    if (vertical?.$type === "eml20.VerticalCrsEpsgCode" && vertical.EpsgCode != null) {
      const vcode = Number(vertical.EpsgCode);
      out.VerticalCoordinateReferenceSystemID = context.addReferenceData(
        "CoordinateReferenceSystem",
        `Vertical:EPSG::${vcode}`
      );
      out.PersistableReferenceVerticalCrs = JSON.stringify({ authCode: { auth: "EPSG", code: vcode } });
    } else if (vertical?.$type === "eml20.VerticalUnknownCrs" && typeof vertical.Unknown === "string") {
      out.PersistableReferenceVerticalCrs = vertical.Unknown;
    }
    return out;
  }
}


export const LocalModelCompoundCrsManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_LocalDepth3dCrs>,
  context: OSDUContext,
  _client: ResqmlClient
): Promise<LocalModelCompoundCrsOSDU> =>
  new LocalModelCompoundCrsOSDU(xml, context).initData(uri, xml);
