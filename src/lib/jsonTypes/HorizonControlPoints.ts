import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";
import { EtpContentType, EtpUri, ResqmlClient } from "../client/ResqmlClient";
import { OSDUContext } from "./OsduContext";
import {
    getGeometries,
    ResqmlWorkProductComponent
} from "./WorkProductComponent";
import {
    Data,
    HorizonControlPoints
} from "./Generated/work-product-component/HorizonControlPoints.1.0.0";
import { FrameOfReferenceMetaDataItem } from "./Generated/manifest/Manifest.1.0.0";

/**
 * HorizonControlPoints converter for PointSetRepresentation with HorizonInterpretation.
 *
 * v2.0.1 variant.
 */
export class HorizonControlPointsOSDU
    extends ResqmlWorkProductComponent<SimpleJson<resqml20.obj_PointSetRepresentation>>
    implements HorizonControlPoints {
    public data: Data = {};
    public meta?: FrameOfReferenceMetaDataItem[];

    constructor(
        xml: SimpleJson<resqml20.obj_PointSetRepresentation>,
        context: OSDUContext
    ) {
        super(xml, context, "HorizonControlPoints.1.0.0");
    }

    public async initData(
        ReservoirDMSUrl: string,
        xml: SimpleJson<resqml20.AbstractRepresentation>,
        client: ResqmlClient
    ): Promise<HorizonControlPointsOSDU> {
        const context = this.__context;
        if (context === undefined) {
            return this;
        }

        const geometries = getGeometries(xml);

        this.data = {
            ...(await this.AbstractCommonResources(context)),
            ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
            ...(await this.AbstractWorkProductComponent(xml, context)),
            InterpretationID: await HorizonControlPointsOSDU.dorToSrn(
                ReservoirDMSUrl,
                (xml as any).RepresentedInterpretation,
                client,
                context
            ),
            InterpretationName: (xml as any).RepresentedInterpretation?.Title,
            LocalModelCompoundCrsID:
                geometries.length > 0 && geometries[0]?.LocalCrs
                    ? await HorizonControlPointsOSDU.dorToSrn(
                        ReservoirDMSUrl,
                        geometries[0].LocalCrs,
                        client,
                        context
                    )
                    : undefined,
            ExtensionProperties: undefined
        };

        // Enrich Name with interpretation name
        const interpName = this.data.InterpretationName;
        if (interpName && this.data.Name && !this.data.Name.startsWith(interpName)) {
            this.data.Name = `${interpName} \u2014 ${this.data.Name}`;
        }

        // Spatial info
        if (geometries.length > 0) {
            const dataspaceUri = EtpUri.createDataSpaceUri(
                new EtpUri(ReservoirDMSUrl).dataSpace
            );
            const { SpatialPoint, SpatialArea, FrameOfReferenceCRS } =
                await ResqmlWorkProductComponent.createSpatialInfo(
                    client,
                    dataspaceUri.uri,
                    geometries,
                    context
                );
            this.data.SpatialPoint = SpatialPoint;
            this.data.SpatialArea = SpatialArea;
            this.meta = [FrameOfReferenceCRS];
        }

        this.assignExtraMetaData((xml as any).ExtraMetadata);
        delete this.__context;
        return this;
    }
}

/**
 * Check if a non-Grid2d v2.0 representation is a PointSet with HorizonInterpretation.
 */
export const isHorizonControlPoints = (
    xml: SimpleJson<resqml20.AbstractRepresentation>
): boolean => {
    if (xml.$type !== "resqml20.obj_PointSetRepresentation") return false;
    const ct = (xml as any).RepresentedInterpretation?.ContentType;
    if (!ct) return false;
    return new EtpContentType(ct).dataType === "obj_HorizonInterpretation";
};

/**
 * HorizonControlPoints manifest factory for v2.0 PointSet + HorizonInterpretation.
 */
export const HorizonControlPointsManifest = async (
    uri: string,
    xml: SimpleJson<resqml20.AbstractRepresentation>,
    context: OSDUContext,
    client: ResqmlClient
): Promise<HorizonControlPointsOSDU> => {
    const osdu = new HorizonControlPointsOSDU(xml as any, context);
    return osdu.initData(uri, xml, client);
};

// ─── v2.2 ────────────────────────────────────────────────────────────────────

/**
 * HorizonControlPoints converter for v2.2 PointSetRepresentation + HorizonInterpretation.
 */
export class HorizonControlPoints22OSDU
    extends ResqmlWorkProductComponent<SimpleJson<resqml22.PointSetRepresentation>>
    implements HorizonControlPoints {
    public data: Data = {};
    public meta?: FrameOfReferenceMetaDataItem[];

    constructor(
        xml: SimpleJson<resqml22.PointSetRepresentation>,
        context: OSDUContext
    ) {
        super(xml, context, "HorizonControlPoints.1.0.0");
    }

    public async initData(
        ReservoirDMSUrl: string,
        xml: SimpleJson<resqml22.AbstractRepresentation>,
        client: ResqmlClient
    ): Promise<HorizonControlPoints22OSDU> {
        const context = this.__context;
        if (context === undefined) {
            return this;
        }

        const geometries = getGeometries(xml);

        this.data = {
            ...(await this.AbstractCommonResources(context)),
            ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
            ...(await this.AbstractWorkProductComponent(xml, context)),
            InterpretationID: await HorizonControlPoints22OSDU.dorToSrn(
                ReservoirDMSUrl,
                (xml as any).RepresentedObject,
                client,
                context
            ),
            InterpretationName: (xml as any).RepresentedObject?.Title,
            LocalModelCompoundCrsID:
                geometries.length > 0 && geometries[0]?.LocalCrs
                    ? await HorizonControlPoints22OSDU.dorToSrn(
                        ReservoirDMSUrl,
                        geometries[0].LocalCrs,
                        client,
                        context
                    )
                    : undefined,
            ExtensionProperties: undefined
        };

        // Enrich Name with interpretation name
        const interpName = this.data.InterpretationName;
        if (interpName && this.data.Name && !this.data.Name.startsWith(interpName)) {
            this.data.Name = `${interpName} \u2014 ${this.data.Name}`;
        }

        // Spatial info
        if (geometries.length > 0) {
            const dataspaceUri = EtpUri.createDataSpaceUri(
                new EtpUri(ReservoirDMSUrl).dataSpace
            );
            const { SpatialPoint, SpatialArea, FrameOfReferenceCRS } =
                await ResqmlWorkProductComponent.createSpatialInfo(
                    client,
                    dataspaceUri.uri,
                    geometries,
                    context
                );
            this.data.SpatialPoint = SpatialPoint;
            this.data.SpatialArea = SpatialArea;
            this.meta = [FrameOfReferenceCRS];
        }

        this.assignExtraMetaData((xml as any).ExtraMetadata);
        delete this.__context;
        return this;
    }
}

/**
 * Check if a non-Grid2d v2.2 representation is a PointSet with HorizonInterpretation.
 */
export const isHorizonControlPoints22 = (
    xml: SimpleJson<resqml22.AbstractRepresentation>
): boolean => {
    if (xml.$type !== "resqml22.PointSetRepresentation") return false;
    const qt = (xml as any).RepresentedObject?.QualifiedType;
    if (!qt) return false;
    return qt.endsWith("HorizonInterpretation");
};

/**
 * HorizonControlPoints manifest factory for v2.2 PointSet + HorizonInterpretation.
 */
export const HorizonControlPoints22Manifest = async (
    uri: string,
    xml: SimpleJson<resqml22.AbstractRepresentation>,
    context: OSDUContext,
    client: ResqmlClient
): Promise<HorizonControlPoints22OSDU> => {
    const osdu = new HorizonControlPoints22OSDU(xml as any, context);
    return osdu.initData(uri, xml, client);
};
