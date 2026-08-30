/**
 * Auto-create master-data--Wellbore from RESQML WellboreInterpretation.
 *
 * RESQML WellboreInterpretation is the closest equivalent to an OSDU Wellbore
 * master-data record. This converter synthesizes one so that WellboreTrajectory
 * and WellboreMarkerSet WPCs have a valid WellboreID reference.
 *
 * The parent Well is resolved from the WellboreInterpretation's InterpretedFeature
 * (WellboreFeature) and a corresponding master-data--Well record is also created.
 *
 * Follows the BoundaryFeature dedup pattern: checks OSDU Storage before creating.
 */
import { ResqmlClient } from "../client/ResqmlClient";

import { OSDUContext, OSDUResourceType } from "./OsduContext";
import { ResqmlResource, ResqmlWorkProductComponent } from "./WorkProductComponent";
import { Data, Wellbore } from "./Generated/master-data/Wellbore.1.3.0";
import { MasterDataWellManifest, MasterDataWellOSDU } from "./MasterDataWell";

/** Minimal shape needed from both resqml20.obj_WellboreInterpretation and resqml22.WellboreInterpretation */
interface WellboreSourceData {
    Uuid: string;
    Citation?: { Title?: string; Description?: string };
    InterpretedFeature?: any; // DataObjectReference
    ExtraMetadata?: any;
    ExtensionNameValue?: any;
}

export class MasterDataWellboreOSDU
    extends ResqmlResource<any>
    implements Wellbore {
    public data: Data = {};

    constructor(
        xml: WellboreSourceData,
        context: OSDUContext
    ) {
        super(xml, context, "master-data", "Wellbore.1.3.0");
    }

    public async initData(
        ReservoirDMSUrl: string,
        xml: WellboreSourceData,
        wellSrn?: string
    ): Promise<MasterDataWellboreOSDU> {
        const context = this.__context;
        if (context === undefined) {
            return this;
        }

        this.data = {
            ...(await this.AbstractCommonResources(context)),

            GeoContexts: undefined,
            NameAliases: undefined,
            SpatialLocation: undefined,
            TechnicalAssurances: context.technicalAssurances,
            DDMSDatasets: [
                ReservoirDMSUrl.replace("eml:///", `eml://${context.rddmsId}/`)
            ],

            FacilityName: xml.Citation?.Title,
            WellID: wellSrn,

            ExtensionProperties: undefined
        };

        if (xml.ExtraMetadata) this.assignExtraMetaData(xml.ExtraMetadata);
        if (xml.ExtensionNameValue) this.assignExtraMetaData(xml.ExtensionNameValue);

        delete this.__context;
        return this;
    }
}

/**
 * Create master-data--Wellbore (and parent Well) from a RESQML WellboreInterpretation.
 *
 * 1. Resolves InterpretedFeature → WellboreFeature to get the well identity
 * 2. Creates master-data--Well from the WellboreFeature (with dedup)
 * 3. Creates master-data--Wellbore from the WellboreInterpretation (with dedup)
 *
 * Returns the Wellbore master-data (or undefined if it already exists).
 * The Well master-data is added to context.created as a side effect.
 */
export const MasterDataWellboreManifest = async (
    uri: string,
    xml: WellboreSourceData,
    context: OSDUContext,
    client: ResqmlClient
): Promise<MasterDataWellboreOSDU | undefined> => {
    // 1. Resolve WellboreFeature (InterpretedFeature DOR) to get well identity
    let wellSrn: string | undefined;
    if (xml.InterpretedFeature) {
        const feature = await ResqmlWorkProductComponent.getObjectFromDor(
            client,
            uri,
            xml.InterpretedFeature,
            context
        ) as { Uuid: string; Citation?: { Title?: string }; ExtraMetadata?: any; ExtensionNameValue?: any } | undefined;

        if (feature) {
            // 2. Create master-data--Well from the WellboreFeature
            const wellMasterData = await MasterDataWellManifest(uri, feature, context);
            if (wellMasterData !== undefined && wellMasterData.id) {
                context.created.set(wellMasterData.id, wellMasterData);
                wellSrn = wellMasterData.id + ":";
            } else {
                // Well already exists in OSDU — construct deterministic SRN for reference
                wellSrn = new MasterDataWellOSDU(feature, context).id + ":";
            }
        }
    }

    // 3. Create master-data--Wellbore
    const instance = new MasterDataWellboreOSDU(xml, context);
    await instance.initData(uri, xml, wellSrn);

    if (instance.id && context.bearer) {
        const existingVersion = await context.getOSDUResourceVersion(instance.id);
        if (existingVersion) {
            return undefined;
        }
    }

    return instance;
};
