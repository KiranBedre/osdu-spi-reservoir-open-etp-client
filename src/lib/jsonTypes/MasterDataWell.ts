/**
 * Auto-create master-data--Well from RESQML WellboreFeature.
 *
 * RESQML has no explicit "Well" object — WellboreFeature is the closest
 * equivalent. This converter synthesizes a Well master-data record so that
 * WellboreTrajectory and WellboreInterpretation WPCs have a valid WellID
 * reference in their Wellbore master-data.
 *
 * Follows the BoundaryFeature dedup pattern: checks OSDU Storage before
 * creating to avoid duplicates.
 */
import { OSDUContext, OSDUResourceType } from "./OsduContext";
import { ResqmlResource } from "./WorkProductComponent";
import { Data, Well } from "./Generated/master-data/Well.1.2.0";

interface WellSourceData {
    Uuid: string;
    Citation?: { Title?: string; Description?: string };
    ExtraMetadata?: any;
    ExtensionNameValue?: any;
}

export class MasterDataWellOSDU
    extends ResqmlResource<any>
    implements Well {
    public data: Data = {};

    constructor(xml: WellSourceData, context: OSDUContext) {
        super(xml, context, "master-data", "Well.1.3.0");
    }

    public async initData(
        ReservoirDMSUrl: string,
        xml: WellSourceData
    ): Promise<MasterDataWellOSDU> {
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

            ExtensionProperties: undefined
        };

        if (xml.ExtraMetadata) this.assignExtraMetaData(xml.ExtraMetadata);
        if (xml.ExtensionNameValue) this.assignExtraMetaData(xml.ExtensionNameValue);

        delete this.__context;
        return this;
    }
}

/**
 * Create a master-data--Well if it doesn't already exist in OSDU.
 * Returns undefined if the record already exists (dedup).
 */
export const MasterDataWellManifest = async (
    uri: string,
    xml: WellSourceData,
    context: OSDUContext
): Promise<MasterDataWellOSDU | undefined> => {
    const instance = new MasterDataWellOSDU(xml, context);
    await instance.initData(uri, xml);

    if (instance.id && context.bearer) {
        const existingVersion = await context.getOSDUResourceVersion(instance.id);
        if (existingVersion) {
            return undefined;
        }
    }

    return instance;
};
