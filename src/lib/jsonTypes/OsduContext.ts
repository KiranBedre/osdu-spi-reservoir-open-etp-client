import {
  Eml23,
  EtpUri,
  IResqmlDataObject,
  Resqml20,
  ResqmlClient,
  SimpleJson
} from "../client/ResqmlClient";

import {
  AccessControlList,
  LegalMetaData
} from "./Generated/work-product-component/GenericRepresentation.1.0.0";

import { CoordinateReferenceSystem } from "./Generated/reference-data/CoordinateReferenceSystem.1.1.0";
import { Data as ExistenceKindData } from "./Generated/reference-data/ExistenceKind.1.0.0";
import {
  AbstractSpatialLocation,
  GenericReferenceData
} from "./Generated/manifest/Manifest.1.0.0";

import { osduUrl } from "../common/config";
import {
  getPropertyTypeIDFromResqmlAlias,
  PropertyTypesIds
} from "./PropertyTypes";

import fetch, { HeadersInit, RequestInit } from "node-fetch";

export type OSDUResourceType = {
  acl: AccessControlList;
  legal: LegalMetaData;
  kind: string;
  id?: string;
  version?: number;
  data?: any;
};

type Converter = (
  uri: string,
  xml: any,
  context: OSDUContext,
  client: ResqmlClient
) => Promise<OSDUResourceType | undefined>;

type OSDUEntry = {
  osduKind: (obj: IResqmlDataObject) => string;
  convert: Converter;
};

export class ResqmlOSDUMap {
  private static instance: ResqmlOSDUMap;
  private resqml2osdu: Map<string, OSDUEntry>;

  /**
   * The Singleton's constructor should always be private to prevent direct
   * construction calls with the `new` operator.
   */
  private constructor() {
    this.resqml2osdu = new Map();
  }

  /**
   * The static method that controls the access to the singleton instance.
   *
   * This implementation let you subclass the Singleton class while keeping
   * just one instance of each subclass around.
   */
  public static getInstance(): ResqmlOSDUMap {
    if (!ResqmlOSDUMap.instance) {
      ResqmlOSDUMap.instance = new ResqmlOSDUMap();
    }

    return ResqmlOSDUMap.instance;
  }

  add(
    resqmlType: string,
    osduKind: (obj: IResqmlDataObject) => string,
    convert: Converter
  ): void {
    this.resqml2osdu.set(resqmlType, {
      osduKind,
      convert
    });
  }

  public get(resqmlType: string): OSDUEntry | undefined {
    return this.resqml2osdu.get(resqmlType);
  }

  public getAll(): Map<string, OSDUEntry> {
    return this.resqml2osdu;
  }

  public buildReference(
    id: string,
    context: OSDUContext
  ): GenericReferenceData | undefined {
    return new ReferenceData(context, id);
  }
}

export interface IContact {
  EmailAddress?: string;
  PhoneNumber?: string;
  RoleTypeID?: string;
  DataGovernanceRoleTypeID?: string;
  WorkflowPersonaTypeID?: string;
  OrganisationID?: string;
  Name?: string;
}

export interface IAcceptableUsage {
  WorkflowUsage?: string;
  WorkflowPersona?: string;
}

export interface ITechnicalAssurance {
  AcceptableUsage?: IAcceptableUsage[];
  Comment?: string;
  EffectiveDate?: Date;
  Reviewers?: IContact[];
  TechnicalAssuranceTypeID: string;
  UnacceptableUsage?: IAcceptableUsage[];
}

const ResqmlOSDU = ResqmlOSDUMap.getInstance();

export interface DataspaceLegalACL {
  acl: AccessControlList;
  legal: LegalMetaData;
}

/**
 * Utility class for manipulating OSDU context
 *
 * @export
 * @class OSDUContext
 */
export class OSDUContext {
  public partition: string;
  public dataspaceACLs = new Map<string, DataspaceLegalACL>();
  public submitter: string;
  public tags?: { [key: string]: string };
  public references: Set<string> = new Set();
  public srnToUri: Map<string, string> = new Map();
  public uriToObject: Map<string, IResqmlDataObject> = new Map();
  public createMissingReferences?: boolean = true;
  public useDataArrayForManifest: boolean = false;
  public bearer?: string;
  public collaboration?: string;
  public generateLineageActivity: boolean = true;

  public created: Map<string, OSDUResourceType> = new Map();

  public projectedCRS: Map<string, CoordinateReferenceSystem> = new Map();
  public boundedCRS: Map<string, CoordinateReferenceSystem> = new Map();

  public osduUrl: string = osduUrl;

  public spatialPoint?: AbstractSpatialLocation = undefined;

  public rddmsId: string;

  public technicalAssurances?: ITechnicalAssurance[];

  public edges: { origin: string; target: string }[] = [];

  constructor(
    partition: string,
    submitter: string,
    tags?: { [key: string]: string },
    createMissingReferences?: boolean,
    useDataArrayForManifest?: boolean,
    rddmsId = "rddms1"
  ) {
    this.partition = partition;
    this.tags = tags;
    this.submitter = submitter;
    if (createMissingReferences !== undefined) {
      this.createMissingReferences = createMissingReferences;
    }
    this.useDataArrayForManifest =
      useDataArrayForManifest !== undefined ? useDataArrayForManifest : false;
    this.rddmsId = rddmsId;
  }

  /**
   * create a reference data SRN (including the trailing :)
   *
   * @param {string} referenceType reference-data type
   * @param {(string | undefined)} value reference-data value
   * @return {(string | undefined)} reference-data SRN
   * @memberof OSDUContext
   */
  public addReferenceData(
    referenceType: string,
    value: string | undefined
  ): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    const ref = `${
      this.partition
    }:reference-data--${referenceType}:${encodeURIComponent(value)}:`;
    if (referenceType !== "PropertyType" || PropertyTypesIds.has(value)) {
      // Do not create reference for Standards Resqml PropertyTypes
      this.references.add(ref);
    }
    return ref;
  }

  /**
   * Find projected CRS with corresponding EPSG code
   *
   * @param {number} epsgCode
   * @return {(Promise<CoordinateReferenceSystem | undefined>)}
   * @memberof OSDUContext
   */
  public async findProjectedEPSGCrs(
    epsgCode: number
  ): Promise<CoordinateReferenceSystem | undefined> {
    const id = `${this.partition}:reference-data--CoordinateReferenceSystem:Projected:EPSG::${epsgCode}`;
    const eCRS = this.projectedCRS.get(id);
    if (eCRS !== undefined) {
      return eCRS;
    }

    const query = `id:"${id}"`;

    const body = {
      kind: `*:*:reference-data--CoordinateReferenceSystem:*`,
      query
    };
    const bodyString = JSON.stringify(body);
    const r = await this.fetchOSDU<{ results: OSDUResourceType[] }>(
      "/api/search/v2/query",
      {
        method: "POST",
        headers: {
          "Content-Type": `application/json`,
          "Content-Length": `${bodyString.length}`
        },
        body: bodyString
      }
    );
    if (r === undefined) {
      return undefined;
    }
    for (const e of r.results) {
      const crs = e as CoordinateReferenceSystem;
      if (
        crs.id !== undefined &&
        crs.data !== undefined &&
        crs.data.CodeAsNumber === epsgCode
      ) {
        this.projectedCRS.set(id, crs);
        return crs;
      }
    }
    return undefined;
  }

  /**
   * Find bounded CRS with corresponding EPSG code
   *
   * @param {number} epsgCode
   * @return {(Promise<CoordinateReferenceSystem | undefined>)}
   * @memberof OSDUContext
   */
  public async findBoundedEPSGCrs(
    epsgCode: number
  ): Promise<CoordinateReferenceSystem | undefined> {
    const id = `${this.partition}:reference-data--CoordinateReferenceSystem:Projected:EPSG::${epsgCode}`;
    const eCRS = this.boundedCRS.get(id);
    if (eCRS !== undefined) {
      return eCRS;
    }

    const query = `data.SourceCRS.SourceCRSID:"${id}"`;
    const body = {
      kind: `*:*:reference-data--CoordinateReferenceSystem:*`,
      query
    };
    const bodyString = JSON.stringify(body);
    const r = await this.fetchOSDU<{ results: OSDUResourceType[] }>(
      "/api/search/v2/query",
      {
        method: "POST",
        headers: {
          "Content-Type": `application/json`,
          "Content-Length": `${bodyString.length}`
        },
        body: bodyString
      }
    );
    if (r === undefined) {
      return undefined;
    }
    const crs =
      r.results.length > 0
        ? (r.results[0] as CoordinateReferenceSystem)
        : undefined;
    if (crs !== undefined) {
      this.boundedCRS.set(id, crs);
    }
    return crs;
  }

  /**
   * Convert points to current coordinate system to WSG84
   *
   * @param {[number, number][]} points
   * @param {number} epsgCode of the current system
   * @return {Promise<[number, number][]>}
   * @memberof OSDUContext
   */
  public async convertPointsWGS84(
    points: [number, number][],
    epsgCode: number
  ): Promise<[number, number][]> {
    const boundedCrs = await this.findBoundedEPSGCrs(epsgCode);
    if (boundedCrs === undefined) {
      return Promise.reject("Bounded CRS not found");
    }

    const w84persistableReference =
      '{"wkt":"GEOGCS[\\"GCS_WGS_1984\\",DATUM[\\"D_WGS_1984\\",SPHEROID[\\"WGS_1984\\",6378137.0,298.257223563]],PRIMEM[\\"Greenwich\\",0.0],UNIT[\\"Degree\\",0.0174532925199433],AUTHORITY[\\"EPSG\\",4326]]","ver":"PE_10_3_1","name":"GCS_WGS_1984","authCode":{"auth":"EPSG","code":"4326"},"type":"LBC"}';

    const body = {
      fromCRS:
        boundedCrs.data?.PersistableReference === undefined
          ? undefined
          : boundedCrs.data.PersistableReference,
      toCRS: w84persistableReference,
      points: points.map(p => ({ x: p[0], y: p[1] }))
    };
    const bodyString = JSON.stringify(body);
    const r = await this.fetchOSDU<{
      points: { x: number; y: number; z: number }[];
    }>("/api/crs/converter/v3/convert", {
      method: "POST",
      headers: {
        "Content-Type": `application/json`,
        "Content-Length": `${bodyString.length}`
      },
      body: bodyString
    });
    if (r === undefined) {
      return Promise.reject("Invalid conversion");
    }
    return r.points.map(p => [p.x, p.y]);
  }

  /**
   * Get the osdu alias
   *
   * @static
   * @param {IResqmlDataObject} dataObject
   * @return {string|undefined} alias if exists
   * @memberof OSDUContext
   */
  public static osduAlias(dataObject: IResqmlDataObject): string | undefined {
    const dataObjectType = dataObject.$type;
    if (dataObjectType === undefined) {
      return undefined;
    }
    if (
      dataObjectType.startsWith("eml20") ||
      dataObjectType.startsWith("resqml20")
    ) {
      const o = dataObject as SimpleJson<Resqml20.AbstractResqmlDataObject>;
      const al = o.Aliases?.find(a => a.Authority === "osdu");

      if (al && al.Identifier) {
        return al.Identifier;
      }
    } else {
      const o = dataObject as SimpleJson<Eml23.AbstractObject>;
      const al = o.Aliases?.find(a => a.Authority === "osdu");
      if (al && al.Identifier) {
        return al.Identifier;
      }
    }
    return undefined;
  }

  /**
   * Get the osdu id using the uuid and the alias information
   *
   * @static
   * @param {string} id
   * @param {string} dataObjectType
   * @param {IResqmlDataObject} dataObject
   * @return {string} id
   * @memberof OSDUContext
   */
  public static osduId(id: string, dataObject: IResqmlDataObject): string {
    const alias = this.osduAlias(dataObject);
    return alias ?? id;
  }

  /**
   * Convert an ETP URI to an OSDU SRN
   *
   * @param {string} uri
   * @param {IResqmlDataObject} obj
   * @return {(string | undefined)}
   * @memberof OSDUContext
   */
  public uriToSrn(uri: string, obj: IResqmlDataObject): string | undefined {
    if (uri === undefined) {
      return undefined;
    }
    const etp = new EtpUri(uri);
    const r: OSDUEntry | undefined = ResqmlOSDU.get(etp.dataObjectType);
    if (r === undefined) {
      return undefined;
    }
    const kind = r?.osduKind(obj);

    const id = OSDUContext.osduId(etp.uuid, obj);

    const srn = r
      ? `${this.partition}:${kind?.split(":")[2]}:${id}`
      : undefined;
    if (!srn) {
      return undefined;
    }
    this.srnToUri.set(srn, uri);
    return srn;
  }

  /**
   * Build the dataset Id from an URI
   *
   * @param {string} uri
   * @return {string}
   * @memberof OSDUContext
   */
  public datasetId(uri: EtpUri): string {
    return encodeURIComponent(uri.dataSpace.replace("/", "-")).replace(
      "%",
      "_"
    );
  }

  /**
   * Create dataset SRN
   *
   * @param {string} objectUri
   * @return {(string[] | undefined)}
   * @memberof WorkProductComponent
   */
  public datasets(objectUri: string): string[] | undefined {
    // TODO the current manifest ingestion does not ingest WPC id datasets info is present, so temporary removing it
    const d = [
      `${this.partition}:dataset--ETPDataspace:${this.datasetId(
        new EtpUri(objectUri)
      )}:`
    ];

    return d.length > 0 ? d : undefined;
  }

  /**
   * Filter out all resources already in OSDU catalog
   *
   * @param {string[]} srn
   * @return {Promise<string[]>}
   * @memberof OSDUContext
   */
  public async filterOSDUResources(srn: string[]): Promise<string[]> {
    return Promise.all(
      srn.map(async m => {
        try {
          return (await this.getOSDUResourceVersion(m)) === undefined;
        } catch (e) {
          return false;
        }
      })
    ).then(results => srn.filter((_v, index) => results[index]));
  }

  /**
   * Get the version of a resource currently in OSDU catalog
   *
   * @param {string} srn
   * @return {(Promise<number | undefined>)}
   * @memberof OSDUContext
   */
  public async getOSDUResourceVersion(
    srn: string
  ): Promise<number | undefined> {
    try {
      const d = srn.split(":");
      if (d.length < 3) {
        return Promise.reject(new Error("Invalid srn " + srn));
      }
      const r: { recordId: string; versions: number[] } | undefined =
        await this.fetchOSDU<{ recordId: string; versions: number[] }>(
          `/api/storage/v2/records/versions/${d[0]}:${d[1]}:${d[2]}`
        );
      if (r === undefined) {
        return undefined;
      }
      let version: number | undefined = undefined;
      r.versions.forEach((v: number) => {
        version = version === undefined ? v : Math.max(v, version);
      });
      return version;
    } catch (e) {
      return undefined;
    }
  }

  /**
   * Divide array in to array of given size
   *
   * @template T
   * @param {T[]} arr starting array
   * @param {number} size maximum size for new arrays
   * @return {T[][]}
   * @memberof OSDUContext
   */
  public divideIntoChunks<T>(arr: T[], size: number): T[][] {
    const res = [];
    let ind = 0;
    while (ind < arr.length) {
      res.push(arr.slice(ind, (ind += size)));
    }
    return res;
  }

  /**
   * Filter out all reference data already in OSDU catalog
   *
   * @param {string[]} srn
   * @return {Promise<string[]>}
   * @memberof OSDUContext
   */
  public async filterOSDUReferenceData(srn: string[]): Promise<string[]> {
    srn = srn
      .map(s => {
        const token = s.split(":");
        if (token.length > 2 && token[1] === "reference-data--PropertyType") {
          const uid = getPropertyTypeIDFromResqmlAlias(token[2]);
          if (uid !== undefined) {
            return `${token[0]}:reference-data--PropertyType:${uid}:`;
          }
        }
        return s;
      })
      .filter(s => this.created.get(s.slice(0, -1)) === undefined);
    const chunks = this.divideIntoChunks(srn, 20);
    return Promise.all(
      chunks.map(async chunk => {
        const queryString = chunk
          .map(c => `id: "${c.slice(0, -1)}"`)
          .join(" OR ");
        const query = {
          kind: "*:*:reference-data--*:*",
          offset: 0,
          limit: 20,
          aggregateBy: "kind",
          query: queryString,
          returnedFields: ["id"]
        };
        try {
          const bodyString = JSON.stringify(query);
          const found = await this.fetchOSDU<{ results: { id: string }[] }>(
            `/api/search/v2/query`,
            {
              method: "POST",
              headers: {
                "Content-Type": `application/json`,
                "Content-Length": `${bodyString.length}`
              },
              body: bodyString
            }
          );
          return found === undefined ? [] : found.results.map(f => f.id);
        } catch (e) {
          return [];
        }
      })
    ).then(results => {
      const dataFound = results.flat().map(v => v + ":");
      return srn.filter(v => !dataFound.includes(v));
    });
  }

  /**
   * Get the known versions associated with id
   *
   * @param {string[]} ids
   * @return {Promise<string[]>}
   * @memberof OSDUContext
   */
  public async getVersions(ids: string[]): Promise<Map<string, number>> {
    const chunks = this.divideIntoChunks(ids, 20);
    const versions: Map<string, number> = new Map();
    await Promise.all(
      chunks.map(async chunk => {
        const queryString = chunk.map(c => `id: "${c}"`).join(" OR ");
        const query = {
          kind: "*:*:*--*:*",
          offset: 0,
          limit: 20,
          aggregateBy: "kind",
          query: queryString,
          returnedFields: ["id", "version"]
        };
        try {
          const bodyString = JSON.stringify(query);
          const found = await this.fetchOSDU<{
            results: { id: string; version: number }[];
          }>(`/api/search/v2/query`, {
            method: "POST",
            headers: {
              "Content-Type": `application/json`,
              "Content-Length": `${bodyString.length}`
            },
            body: bodyString
          });
          found?.results.forEach(r => versions.set(r.id, r.version));
        } catch (e) {
          // Do nothing
        }
      })
    );
    return versions;
  }

  /**
   * Fetch data in OSDU environment
   *
   * @private
   * @template T
   * @param {string} path
   * @param {RequestInit} [init] additional information
   * @return {(Promise<T | undefined>)}
   * @memberof OSDUContext
   */
  public async fetchOSDU<T>(
    path: string,
    init?: RequestInit
  ): Promise<T | undefined> {
    const headers: HeadersInit = {
      Authorization: `Bearer ${this.bearer}`,
      "data-partition-id": this.partition,
      ...(this.collaboration ? { "x-collaboration": this.collaboration } : {})
    };
    if (init === undefined) {
      init = { headers };
    } else {
      if (init.headers === undefined) {
        init.headers = headers;
      } else if (typeof init.headers === "object") {
        init.headers = { ...init.headers, ...headers };
      }
    }
    const url = this.osduUrl + path;
    return fetch(url, init)
      .then(async r => {
        if (r.status < 200 || r.status >= 300) {
          return undefined;
        }
        return (await r.json()) as T;
      })
      .catch(() => {
        return undefined;
      });
  }

  /**
   * Post data in OSDU environment
   *
   * @template T
   * @template R
   * @param {string} url to post at
   * @param {T} body payload
   * @return {Promise<boolean>}
   * @memberof OSDUContext
   */
  public async pushOSDU<T, R>(url: string, body: T): Promise<R | undefined> {
    try {
      const bodyString = JSON.stringify(body);
      return await this.fetchOSDU<R>(url, {
        method: "POST",
        headers: {
          "Content-Type": `application/json`,
          "Content-Length": `${bodyString.length}`
        },
        body: bodyString
      });
    } catch (e) {
      return undefined;
    }
  }
}

/**
 * Store an OSDU reference data information
 *
 * @export
 * @class ReferenceData
 */
export class ReferenceData {
  public acl: AccessControlList;
  createTime: Date;
  createUser: string;
  id: string;
  kind: string;
  legal: LegalMetaData;
  tags?: { [key: string]: string };
  version: number;
  data: ExistenceKindData & {
    ParentPropertyTypeID?: string;
    UnitQuantityID?: string;
  };

  constructor(context: OSDUContext, id: string) {
    //${context.namespace}:reference-data--${osduType}:${value}:

    let Code: string | undefined;
    let kind = "";
    const idSplit = id.split(":");
    if (idSplit.length >= 3) {
      Code = idSplit[2];
      kind = `osdu:wks:${idSplit[1]}:1.0.0`;
    }

    this.acl = { owners: [], viewers: [] };
    this.legal = {
      legaltags: [],
      otherRelevantDataCountries: []
    };
    const dataspaces = context.dataspaceACLs.keys();
    // Get the acl/legal from the first dataspace if available
    for (const ds of dataspaces) {
      const aclLegal = context.dataspaceACLs.get(ds);
      if (aclLegal !== undefined) {
        this.acl = aclLegal.acl;
        this.legal = aclLegal.legal;
        break;
      }
    }

    this.tags = context.tags;
    this.createTime = new Date(Date.now());
    this.createUser = context.submitter;
    this.kind = kind;
    this.id = id;
    this.version = 1;
    this.data = {
      ExistenceKind: context.addReferenceData("ExistenceKind", "Actual"),
      Code,
      Name: `${idSplit[1].slice(16)}-${Code}`,
      CommitDate: this.createTime
    };
    if (idSplit[1] === "reference-data--PropertyType") {
      // Workaround if Energistics PropertyType are not available
      this.data.ParentPropertyTypeID = context.addReferenceData(
        "PropertyType",
        getPropertyTypeIDFromResqmlAlias("quantity")
      );
      // none UnitQuantity
      this.data.UnitQuantityID = context.addReferenceData(
        "UnitQuantity",
        "none"
      );
    }
  }
}
