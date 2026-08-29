import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";
import { EtpContentType, EtpUri, ResqmlClient } from "../client/ResqmlClient";
import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";
import {
    Data,
    GenericBinGrid
} from "./Generated/work-product-component/GenericBinGrid.1.0.0";
import { FrameOfReferenceMetaDataItem } from "./Generated/manifest/Manifest.1.0.0";

/**
 * GenericBinGrid converter for Grid2dRepresentation objects that have no
 * associated interpretation (e.g. isochore, DEM, generic depth grids).
 *
 * v2.0.1 variant.
 */
export class GenericBinGridOSDU
    extends ResqmlWorkProductComponent<SimpleJson<resqml20.obj_Grid2dRepresentation>>
    implements GenericBinGrid {
    public data: Data = {};
    public meta?: FrameOfReferenceMetaDataItem[];

    constructor(
        xml: SimpleJson<resqml20.obj_Grid2dRepresentation>,
        context: OSDUContext
    ) {
        super(xml, context, "GenericBinGrid.1.0.0");
    }

    /**
     * Match: any Grid2d that was not already claimed by SeismicBinGrid,
     * SeismicHorizon, or StructureMap.  This includes grids with no
     * interpretation AND grids with non-horizon interpretations
     * (StratigraphicUnitInterpretation, GeobodyInterpretation, FaultInterpretation,
     * etc.) where preserving grid geometry is more valuable than falling
     * through to the unstructured GenericRepresentation catch-all.
     */
    static matchType(_xml: SimpleJson<resqml20.obj_Grid2dRepresentation>): boolean {
        return true;
    }

    public getGeometries(
        xml: SimpleJson<resqml20.obj_Grid2dRepresentation>
    ): SimpleJson<resqml20.PointGeometry>[] {
        return [xml.Grid2dPatch.Geometry];
    }

    public async initData(
        ReservoirDMSUrl: string,
        xml: SimpleJson<resqml20.obj_Grid2dRepresentation>,
        client: ResqmlClient
    ): Promise<GenericBinGridOSDU> {
        const context = this.__context;
        if (context === undefined) {
            return this;
        }

        this.data = {
            ...(await this.AbstractCommonResources(context)),
            ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
            ...(await this.AbstractWorkProductComponent(xml, context)),
            IndexableElementCount: [
                {
                    Count: xml.Grid2dPatch.SlowestAxisCount * xml.Grid2dPatch.FastestAxisCount,
                    IndexableElementID: context.addReferenceData("IndexableElement", "nodes")
                }
            ],
            LocalModelCompoundCrsID: await GenericBinGridOSDU.dorToSrn(
                ReservoirDMSUrl,
                xml.Grid2dPatch.Geometry.LocalCrs,
                client,
                context
            ),
            NodeCountOnIAxis: xml.Grid2dPatch.FastestAxisCount,
            NodeCountOnJAxis: xml.Grid2dPatch.SlowestAxisCount,
            ExtensionProperties: undefined
        };

        // Preserve interpretation link in ExtensionProperties when present.
        // GenericBinGrid has no typed InterpretationID field, but the
        // association is still geologically meaningful (e.g. isochore tied
        // to a StratigraphicUnitInterpretation).
        if (xml.RepresentedInterpretation?.ContentType) {
            const interpSrn = await GenericBinGridOSDU.dorToSrn(
                ReservoirDMSUrl,
                xml.RepresentedInterpretation,
                client,
                context
            );
            this.data.ExtensionProperties = {
                ...this.data.ExtensionProperties,
                InterpretationID: interpSrn,
                InterpretationName: xml.RepresentedInterpretation.Title,
                InterpretationType: new EtpContentType(xml.RepresentedInterpretation.ContentType).dataType
            };
        }

        // Extract grid geometry from lattice
        const geo = xml.Grid2dPatch.Geometry;
        let lattice: SimpleJson<resqml20.Point3dLatticeArray> | undefined;

        if (geo.Points.$type === "resqml20.Point3dLatticeArray") {
            lattice = geo.Points as SimpleJson<resqml20.Point3dLatticeArray>;
        } else if (geo.Points.$type === "resqml20.Point3dZValueArray") {
            const zArr = geo.Points as SimpleJson<resqml20.Point3dZValueArray>;
            if (zArr.SupportingGeometry?.$type === "resqml20.Point3dLatticeArray") {
                lattice = zArr.SupportingGeometry as SimpleJson<resqml20.Point3dLatticeArray>;
            }
        }

        if (lattice) {
            if (lattice.Offset?.length >= 2) {
                const off0 = lattice.Offset[0] as SimpleJson<resqml20.Point3dOffset>;
                const off1 = lattice.Offset[1] as SimpleJson<resqml20.Point3dOffset>;
                const dir0 = off0.Offset;
                const dir1 = off1.Offset;
                const sp0 = (off0.Spacing as any)?.Value ?? 1;
                const sp1 = (off1.Spacing as any)?.Value ?? 1;
                this.data.BinWidthOnIaxis = Math.sqrt(
                    dir0.Coordinate1 ** 2 + dir0.Coordinate2 ** 2
                ) * sp0;
                this.data.BinWidthOnJaxis = Math.sqrt(
                    dir1.Coordinate1 ** 2 + dir1.Coordinate2 ** 2
                ) * sp1;
                this.data.MapGridBearingOfBinGridJaxis =
                    (Math.atan2(dir1.Coordinate1, dir1.Coordinate2) * 180) / Math.PI;
            }
            this.data.OriginEasting = lattice.Origin.Coordinate1;
            this.data.OriginNorthing = lattice.Origin.Coordinate2;
        }

        // Spatial info from geometry
        const geometries = this.getGeometries(xml);
        if (geometries.length > 0 && lattice && lattice.Offset?.length >= 2) {
            const dataspaceUri = EtpUri.createDataSpaceUri(
                new EtpUri(ReservoirDMSUrl).dataSpace
            );
            const off0 = lattice.Offset[0] as SimpleJson<resqml20.Point3dOffset>;
            const off1 = lattice.Offset[1] as SimpleJson<resqml20.Point3dOffset>;
            const dir0 = off0.Offset;
            const dir1 = off1.Offset;
            const sp0 = (off0.Spacing as any)?.Value ?? 1;
            const sp1 = (off1.Spacing as any)?.Value ?? 1;
            const countJ = xml.Grid2dPatch.SlowestAxisCount - 1;
            const countI = xml.Grid2dPatch.FastestAxisCount - 1;
            const ox = lattice.Origin.Coordinate1;
            const oy = lattice.Origin.Coordinate2;
            const stepJ = [dir0.Coordinate1 * sp0, dir0.Coordinate2 * sp0];
            const stepI = [dir1.Coordinate1 * sp1, dir1.Coordinate2 * sp1];

            const corners: [number, number][] = [
                [ox, oy],
                [ox + stepI[0] * countI, oy + stepI[1] * countI],
                [
                    ox + stepI[0] * countI + stepJ[0] * countJ,
                    oy + stepI[1] * countI + stepJ[1] * countJ
                ],
                [ox + stepJ[0] * countJ, oy + stepJ[1] * countJ]
            ];

            const minX = Math.min(...corners.map(c => c[0]));
            const maxX = Math.max(...corners.map(c => c[0]));
            const minY = Math.min(...corners.map(c => c[1]));
            const maxY = Math.max(...corners.map(c => c[1]));

            const crsObj = await GenericBinGridOSDU.getObjectFromDor(
                client,
                dataspaceUri.uri,
                geo.LocalCrs,
                context
            );
            const crs = crsObj as SimpleJson<resqml20.AbstractLocal3dCrs>;
            const Domain =
                crsObj?.$type === "resqml20.obj_LocalDepth3dCrs" ? "Depth" : "Time";

            if (crs) {
                const bboxRing: [number, number][] = [
                    [minX, minY],
                    [maxX, minY],
                    [maxX, maxY],
                    [minX, maxY],
                    [minX, minY]
                ];

                const {
                    SpatialPoint,
                    SpatialArea,
                    FrameOfReferenceCRS
                } = await GenericBinGridOSDU.createSpatialInfoFrom2dPoints(
                    client,
                    dataspaceUri.uri,
                    bboxRing,
                    crs,
                    context
                );

                this.data.SpatialPoint = SpatialPoint;
                this.data.SpatialArea = SpatialArea;
                this.data.ABCDBinGridSpatialLocation = SpatialArea;
                this.data.DomainTypeID = context.addReferenceData("DomainType", Domain);
                this.meta = [FrameOfReferenceCRS];
            }
        }

        this.assignExtraMetaData(xml.ExtraMetadata);
        delete this.__context;
        return this;
    }
}

/**
 * GenericBinGrid converter for v2.2 Grid2dRepresentation.
 */
export class GenericBinGrid22OSDU
    extends ResqmlWorkProductComponent<SimpleJson<resqml22.Grid2dRepresentation>>
    implements GenericBinGrid {
    public data: Data = {};
    public meta?: FrameOfReferenceMetaDataItem[];

    constructor(
        xml: SimpleJson<resqml22.Grid2dRepresentation>,
        context: OSDUContext
    ) {
        super(xml, context, "GenericBinGrid.1.0.0");
    }

    /**
     * Match: any v2.2 Grid2d not already claimed by SeismicBinGrid,
     * SeismicHorizon, or StructureMap.  Covers both uninterpreted grids
     * and grids with non-horizon interpretations.
     */
    static matchType(_xml: SimpleJson<resqml22.Grid2dRepresentation>): boolean {
        return true;
    }

    public async initData(
        ReservoirDMSUrl: string,
        xml: SimpleJson<resqml22.Grid2dRepresentation>,
        client: ResqmlClient
    ): Promise<GenericBinGrid22OSDU> {
        const context = this.__context;
        if (context === undefined) {
            return this;
        }

        const geo = xml.Geometry;

        this.data = {
            ...(await this.AbstractCommonResources(context)),
            ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
            ...(await this.AbstractWorkProductComponent(xml, context)),
            IndexableElementCount: [
                {
                    Count: xml.SlowestAxisCount * xml.FastestAxisCount,
                    IndexableElementID: context.addReferenceData("IndexableElement", "nodes")
                }
            ],
            LocalModelCompoundCrsID: geo
                ? await GenericBinGrid22OSDU.dorToSrn(
                    ReservoirDMSUrl,
                    geo.LocalCrs,
                    client,
                    context
                )
                : undefined,
            NodeCountOnIAxis: xml.FastestAxisCount,
            NodeCountOnJAxis: xml.SlowestAxisCount,
            ExtensionProperties: undefined
        };

        // Preserve interpretation link in ExtensionProperties when present.
        if (xml.RepresentedObject?.QualifiedType) {
            const interpSrn = await GenericBinGrid22OSDU.dorToSrn(
                ReservoirDMSUrl,
                xml.RepresentedObject,
                client,
                context
            );
            const qt = xml.RepresentedObject.QualifiedType;
            this.data.ExtensionProperties = {
                ...this.data.ExtensionProperties,
                InterpretationID: interpSrn,
                InterpretationName: xml.RepresentedObject.Title,
                InterpretationType: qt.substring(qt.lastIndexOf(".") + 1)
            };
        }

        // Extract grid geometry from lattice
        let lattice: any;
        if (geo?.Points?.$type === "resqml22.Point3dLatticeArray") {
            lattice = geo.Points;
        } else if (geo?.Points?.$type === "resqml22.Point3dZValueArray") {
            const zArr = geo.Points as any;
            if (zArr.SupportingGeometry?.$type === "resqml22.Point3dLatticeArray") {
                lattice = zArr.SupportingGeometry;
            }
        }

        if (lattice && lattice.Offset?.length >= 2) {
            const off0 = lattice.Offset[0];
            const off1 = lattice.Offset[1];
            const dir0 = off0.Offset;
            const dir1 = off1.Offset;
            const sp0 = off0.Spacing?.Value ?? 1;
            const sp1 = off1.Spacing?.Value ?? 1;
            this.data.BinWidthOnIaxis = Math.sqrt(
                dir0.Coordinate1 ** 2 + dir0.Coordinate2 ** 2
            ) * sp0;
            this.data.BinWidthOnJaxis = Math.sqrt(
                dir1.Coordinate1 ** 2 + dir1.Coordinate2 ** 2
            ) * sp1;
            this.data.MapGridBearingOfBinGridJaxis =
                (Math.atan2(dir1.Coordinate1, dir1.Coordinate2) * 180) / Math.PI;
            this.data.OriginEasting = lattice.Origin.Coordinate1;
            this.data.OriginNorthing = lattice.Origin.Coordinate2;

            // Spatial info from lattice corners
            const dataspaceUri = EtpUri.createDataSpaceUri(
                new EtpUri(ReservoirDMSUrl).dataSpace
            );
            const countJ = xml.SlowestAxisCount - 1;
            const countI = xml.FastestAxisCount - 1;
            const ox = lattice.Origin.Coordinate1;
            const oy = lattice.Origin.Coordinate2;
            const stepJ = [dir0.Coordinate1 * sp0, dir0.Coordinate2 * sp0];
            const stepI = [dir1.Coordinate1 * sp1, dir1.Coordinate2 * sp1];

            const corners: [number, number][] = [
                [ox, oy],
                [ox + stepI[0] * countI, oy + stepI[1] * countI],
                [
                    ox + stepI[0] * countI + stepJ[0] * countJ,
                    oy + stepI[1] * countI + stepJ[1] * countJ
                ],
                [ox + stepJ[0] * countJ, oy + stepJ[1] * countJ]
            ];

            const minX = Math.min(...corners.map(c => c[0]));
            const maxX = Math.max(...corners.map(c => c[0]));
            const minY = Math.min(...corners.map(c => c[1]));
            const maxY = Math.max(...corners.map(c => c[1]));

            const crsObj = geo?.LocalCrs
                ? await GenericBinGrid22OSDU.getObjectFromDor(
                    client,
                    dataspaceUri.uri,
                    geo.LocalCrs,
                    context
                )
                : undefined;

            if (crsObj) {
                const Domain =
                    crsObj.$type === "eml23.LocalEngineeringCompoundCrs" ? "Depth" : "Time";
                const bboxRing: [number, number][] = [
                    [minX, minY],
                    [maxX, minY],
                    [maxX, maxY],
                    [minX, maxY],
                    [minX, minY]
                ];

                const {
                    SpatialPoint,
                    SpatialArea,
                    FrameOfReferenceCRS
                } = await GenericBinGrid22OSDU.createSpatialInfoFrom2dPoints(
                    client,
                    dataspaceUri.uri,
                    bboxRing,
                    crsObj as any,
                    context
                );

                this.data.SpatialPoint = SpatialPoint;
                this.data.SpatialArea = SpatialArea;
                this.data.ABCDBinGridSpatialLocation = SpatialArea;
                this.data.DomainTypeID = context.addReferenceData("DomainType", Domain);
                this.meta = [FrameOfReferenceCRS];
            }
        }

        this.assignExtraMetaData(xml.ExtensionNameValue);
        delete this.__context;
        return this;
    }
}
