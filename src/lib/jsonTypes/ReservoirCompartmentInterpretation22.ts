import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  ReservoirCompartmentInterpretation,
  ReservoirCompartmentUnit
} from "./Generated/work-product-component/ReservoirCompartmentInterpretation.1.2.0";

/**
 * Convert RESQML 2.2 ReservoirCompartmentInterpretation to OSDU manifest.
 *
 * RESQML inheritance: ReservoirCompartmentInterpretation extends GeologicUnitInterpretation
 *   extends AbstractFeatureInterpretation extends AbstractObject
 *
 * OSDU schema: work-product-component--ReservoirCompartmentInterpretation:1.2.0
 */
export class ReservoirCompartmentInterpretation22OSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml22.ReservoirCompartmentInterpretation>
  >
  implements ReservoirCompartmentInterpretation
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml22.ReservoirCompartmentInterpretation>,
    context: OSDUContext
  ) {
    super(xml, context, "ReservoirCompartmentInterpretation.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.ReservoirCompartmentInterpretation>,
    client: ResqmlClient
  ): Promise<ReservoirCompartmentInterpretation22OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    // Resolve nested ReservoirCompartmentUnitInterpretation array
    const units: ReservoirCompartmentUnit[] = [];
    const xmlAny = xml as any;
    if (xmlAny.ReservoirCompartmentUnit) {
      const rawUnits = Array.isArray(xmlAny.ReservoirCompartmentUnit)
        ? xmlAny.ReservoirCompartmentUnit
        : [xmlAny.ReservoirCompartmentUnit];

      for (const unit of rawUnits) {
        const fluidUnitIDs: string[] = [];
        if (unit.FluidUnits) {
          const dors = Array.isArray(unit.FluidUnits)
            ? unit.FluidUnits
            : [unit.FluidUnits];
          for (const dor of dors) {
            const srn =
              await ReservoirCompartmentInterpretation22OSDU.dorToSrn(
                ReservoirDMSUrl,
                dor,
                client,
                context
              );
            if (srn) fluidUnitIDs.push(srn);
          }
        }
        const geoUnitID = unit.GeologicUnitInterpretation
          ? await ReservoirCompartmentInterpretation22OSDU.dorToSrn(
              ReservoirDMSUrl,
              unit.GeologicUnitInterpretation,
              client,
              context
            )
          : undefined;

        units.push({
          FluidUnitIDs: fluidUnitIDs.length > 0 ? fluidUnitIDs : undefined,
          GeologicUnitInterpretationID: geoUnitID
        });
      }
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      ...(await this.AbstractInterpretation(
        ReservoirDMSUrl,
        xml,
        client,
        context
      )),
      ReservoirCompartmentUnits: units.length > 0 ? units : undefined,
      GeologicUnitShapeTypeID: xml.GeologicUnit3dShape
        ? context.addReferenceData(
            "GeologicUnitShapeType",
            this.capitalize(xml.GeologicUnit3dShape)
          )
        : undefined,
      LithologyTypeID: xml.GeologicUnitComposition
        ? context.addReferenceData(
            "LithologyType",
            this.capitalize(xml.GeologicUnitComposition)
          )
        : undefined,
      DepositionalEnvironmentTypeID: xml.DepositionalEnvironment
        ? context.addReferenceData(
            "DepositionalEnvironmentType",
            this.capitalize(xml.DepositionalEnvironment)
          )
        : undefined,
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const ReservoirCompartmentInterpretation22Manifest = async (
  uri: string,
  xml: SimpleJson<resqml22.ReservoirCompartmentInterpretation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<ReservoirCompartmentInterpretation22OSDU> =>
  new ReservoirCompartmentInterpretation22OSDU(xml, context).initData(
    uri,
    xml,
    client
  );
