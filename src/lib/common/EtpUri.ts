// ============================================================================
// Copyright 2019-2022 Emerson Paradigm Holding LLC. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ============================================================================

/**
 * Represents a UUID as an array of byte
 */
export type ArrayByteUuid = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number
];

export type Uuid = string | ArrayByteUuid;

/**
 * Class representing an OData query
 */
export type ODataQuery = {
  filter?: string;
  top?: number;
  skip?: number;
  orderby?: string;
};

const queryToString = (query?: ODataQuery): string => {
  if (!query || Object.keys(query).length === 0) {
    return "";
  }
  let str = "";
  if (query.filter) {
    str += `$filter=${query.filter}`;
  }
  if (query.top) {
    str += `${str ? "&" : ""}$top=${query.top}`;
  }
  if (query.skip) {
    str += `${str ? "&" : ""}$skip=${query.skip}`;
  }
  if (query.orderby) {
    str += `${str ? "&" : ""}$orderby=${query.orderby}`;
  }
  return str ? `?${str}` : "";
};

const regexp = new RegExp(
  [
    /^(?:eml:\/\/\/|^eml:\/\/\/dataspace\('(?<dataspace>[^'"]*?(?:''[^'"]*?)*)'\)\/?)/, // dataspace can be simple/double quoted between parenthesis
    /(?:(?<domain>witsml|resqml|prodml|eml)(?<domainVersion>[1-9]\d)\.(?<objectType>\w+)(?:\((?:(?<uuid>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})|uuid=(?<uuid2>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}),version='(?<version>[^']*?(?:''[^']*?)*)')\))?)?/,
    /(?<query>\?(?:\$(?:orderby=(?<orderby>[^(?$&)]+)|skip=(?<skip>[0-9]+)|top=(?<top>[0-9]+)|filter=(?<filter>[^?$&]+))+&?)+)?$/
  ]
    .map(r => r.source)
    .join(""),
  "i"
);

/**
 * Utility class to build and parse ETP uris
 *
 * @export
 * @class EtpUri
 */
export class EtpUri {
  /**
   * Return invalid Guid
   *
   * @static
   * @returns {ArrayByteUuid}
   * @memberof EtpUri
   */
  public static invalidGuid(): ArrayByteUuid {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }

  /**
   * * Convert a UUID from string to a 16-bytes array
   *
   * @static
   * @param {string} str string representation of guid (with dash)
   * @returns {ArrayByteUuid} array of 16 bytes
   * @memberof EtpUri
   */
  public static uuidStringToByteArray(str: string): ArrayByteUuid {
    const byteArray = EtpUri.invalidGuid();
    let c = 0;
    str.split("-").forEach((n: string) => {
      const rev = n.match(/.{1,2}/g);
      if (rev) {
        rev.forEach((b: string) => {
          if (c < 16) {
            byteArray[c] = parseInt(b, 16);
          }
          c += 1;
        });
      }
    });
    return byteArray;
  }

  /**
   * Convert a UUID from a 16-bytes array to string
   *
   * @static
   * @param {ArrayByteUuid} byteArray array of 16 bytes
   * @returns {string} string representation of guid (with dash)
   * @memberof EtpUri
   */
  public static uuidByteArrayToString(byteArray: ArrayByteUuid): string {
    const b = Array.from(byteArray).map(item =>
      item.toString(16).padStart(2, "0")
    );
    b.splice(4, 0, "-");
    b.splice(7, 0, "-");
    b.splice(10, 0, "-");
    b.splice(13, 0, "-");
    return b.join("");
  }

  /**
   * Pattern matching a canonical (dashed) UUID token anywhere in a string.
   * Case-insensitive so it matches UUIDs regardless of the casing used by the
   * server or the object serializer.
   */
  public static readonly uuidTokenPattern =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

  /**
   * Replace every UUID token found in a piece of text using the provided map.
   *
   * Each 36-character UUID is treated as an opaque, globally-unique token, so a
   * plain replace over the text correctly rewrites an object's own identity, all
   * of its Data Object Reference (DOR) uuids and any array paths that embed a
   * uuid, without having to parse the underlying XML. UUIDs that are not present
   * in the map (for example references to objects outside the dataspace) are left
   * untouched.
   *
   * @static
   * @param {string} text source text (object body, uri, array path, ...)
   * @param {Map<string, string>} uuidMap lower-cased old uuid -> new uuid
   * @returns {string} the text with all mapped uuids replaced
   * @memberof EtpUri
   */
  public static remapUuids(text: string, uuidMap: Map<string, string>): string {
    if (uuidMap.size === 0) {
      return text;
    }
    // Fresh RegExp instance to avoid sharing lastIndex state on the global regex.
    return text.replace(
      new RegExp(EtpUri.uuidTokenPattern),
      match => uuidMap.get(match.toLowerCase()) ?? match
    );
  }

  get isWitsml(): boolean {
    return this.domainFamily === "witsml";
  }

  /**
   * Check if parsing is valid
   *
   * @readonly
   * @type {boolean}
   * @memberof EtpUri
   */
  get isValid(): boolean {
    return this._emlURI !== null;
  }

  /**
   * Get the full domain information including version
   *
   * @readonly
   * @type {string}
   * @memberof EtpUri
   */
  get domain(): string {
    return this.domainFamily + this.domainVersion;
  }

  /**
   * Get the domain family (i.e resqml or eml)
   *
   * @readonly
   * @type {string}
   * @memberof EtpUri
   */
  get domainFamily(): string {
    return this.groups ? this.groups.domain ?? "" : "";
  }

  /**
   * Return the version of the domain without . (i.e 20)
   *
   * @readonly
   * @type {string}
   * @memberof EtpUri
   */
  get domainVersion(): string {
    return this.groups ? this.groups.domainVersion ?? "" : "";
  }

  /**
   * Returns true if the URI match one of the accepted root(i.e eml:///)
   *
   * @readonly
   * @type {boolean}
   * @memberof EtpUri
   */
  get isRoot(): boolean {
    return this.uri === "eml:///" || this.uri === "eml:/";
  }

  /**
   * Returns true if the dataSpace is defined (not default)
   *
   * @readonly
   * @type {boolean}
   * @memberof EtpUri
   */
  get hasDataSpace(): boolean {
    return this.dataSpace.length !== 0;
  }

  /**
   * Returns the type of the object (not containing the domain information. i.e obj_SeismicLatticeFeature)
   *
   * @readonly
   * @type {string}
   * @memberof EtpUri
   */
  get objectType(): string {
    return this.groups ? this._emlURI.groups.objectType ?? "" : "";
  }

  /**
   * Returns the unique identifier of the object instance
   *
   * @readonly
   * @type {string}
   * @memberof EtpUri
   */
  get uuid(): string {
    if (!this.groups) {
      return "";
    }
    if (this.groups.uuid) {
      return this.groups.uuid;
    }
    if (this.groups.uuid2) {
      return this.groups.uuid2;
    }
    return "";
  }

  /**
   * Returns the unique identifier of the object instance as a guid
   *
   * @readonly
   * @type {string}
   * @memberof EtpUri
   */
  get guid(): ArrayByteUuid {
    return EtpUri.uuidStringToByteArray(this.uuid);
  }

  /**
   * Returns the dataSpace ("" if default) in which the object is located
   *
   * @readonly
   * @type {string}
   * @memberof EtpUri
   */
  get dataSpace(): string {
    return this.groups ? this._emlURI.groups.dataspace ?? "" : "";
  }

  /**
   * Returns the qualified type of the object (including the domain information. i.e resqml20.obj_SeismicLatticeFeature)
   *
   * @readonly
   * @type {string}
   * @memberof EtpUri
   */
  get dataObjectType(): string {
    return this.domain ? `${this.domain}.${this.objectType}` : "";
  }

  /**
   * Return the object version
   *
   * @readonly
   * @type {string}
   * @memberof EtpUri
   */
  get version(): string {
    return this.groups ? this._emlURI.groups.version ?? "" : "";
  }

  /**
   * Return the orderby part of oData query
   *
   * @readonly
   * @type {string}
   * @memberof EtpUri
   */
  get orderby(): string {
    return this.query?.orderby ? this.query.orderby ?? "" : "";
  }

  /**
   * Return the top part of oData query
   *
   * @readonly
   * @type {number | undefined}
   * @memberof EtpUri
   */
  get top(): number | undefined {
    return this.query ? this.query.top : undefined;
  }

  /**
   * Return the skip part of oData query
   *
   * @readonly
   * @type {number|undefined}
   * @memberof EtpUri
   */
  get skip(): number | undefined {
    return this.query ? this.query.skip : undefined;
  }

  /**
   * Return the filter part of oData query
   *
   * @readonly
   * @type {string}
   * @memberof EtpUri
   */
  get filter(): string {
    return this.query?.filter ? this.query.filter ?? "" : "";
  }

  /**
   * Return the query
   *
   * @readonly
   * @type {(ODataQuery | null)}
   * @memberof EtpUri
   */
  get query(): ODataQuery | null {
    return this._query;
  }

  /**
   * Create a dataspace URI
   *
   * @static
   * @param {string} dataspace support both dataspace name and full uri eml:///dataspace('dataspace')
   * @returns {EtpUri} corresponding URI string
   * @memberof EtpUri
   */
  public static createDataSpaceUri(dataspace?: string): EtpUri {
    if (!dataspace) {
      return new EtpUri(`eml:///`);
    }
    if (
      RegExp(
        /^eml:\/\/\/$|^eml:\/\/\/dataspace\('(?:[^'"]*?(?:''[^'"]*?)*)'\)$/
      ).exec(dataspace)
    ) {
      return new EtpUri(dataspace);
    }
    return new EtpUri(`eml:///dataspace('${dataspace}')`);
  }

  /**
   * Create an object URI providing its different elements
   *
   * @static
   * @param {string} dataspace
   * @param {string} domainFamily
   * @param {string} domainVersion
   * @param {string} objectType
   * @param {string} uuid
   * @param {string} [version]
   * @param {ODataQuery} [oDataQuery] oDataQuery in the format "?filter=...&top=..&skip=...&orderby=..."
   * @returns corresponding URI string
   * @memberof EtpUri
   */
  public static createObjectUri(
    dataspace: string,
    domainFamily: string,
    domainVersion: string,
    objectType: string,
    uuid: string,
    version?: string,
    oDataQuery?: ODataQuery
  ): EtpUri {
    const dVersion = domainVersion.replace(".", "");
    return EtpUri.createTypedObjectUri(
      dataspace,
      `${domainFamily}${dVersion}.${objectType}`,
      uuid,
      version,
      oDataQuery
    );
  }

  /**
   * Create an object URI providing its different elements
   *
   * @static
   * @param {string} dataspace
   * @param {string} qualifiedType example "resqml20.obj_TriangulatedSetRepresentation"
   * @param {string} uuid
   * @param {string} [version]
   * @param {ODataQuery} [oDataQuery] oDataQuery in the format "?filter=...&top=..&skip=...&orderby=..."
   * @returns corresponding URI string
   * @memberof EtpUri
   */
  public static createTypedObjectUri(
    dataspace: string,
    qualifiedType: string,
    uuid: string,
    version?: string,
    oDataQuery?: ODataQuery
  ): EtpUri {
    const ds =
      EtpUri.createDataSpaceUri(dataspace).uri + (dataspace ? "/" : "");
    const id = version ? `uuid=${uuid},version='${version}'` : `${uuid}`;
    return new EtpUri(
      `${ds}${qualifiedType}(${id})${queryToString(oDataQuery)}`
    );
  }

  /**
   * Create a URI providing its different elements
   *
   * @static
   * @param {string} dataspace
   * @param {string} domainFamily
   * @param {string} domainVersion
   * @param {string} objectType
   * @param {string} uuid
   * @param {ODataQuery} [oDataQuery] oDataQuery in the format "?filter=...&top=..&skip=...&orderby=..."
   * @returns corresponding URI
   * @memberof EtpUri
   * @deprecated Use createObjectUri().uri instead
   */
  public static create(
    dataspace: string,
    domainFamily: string,
    domainVersion: string,
    objectType: string,
    uuid: string,
    oDataQuery?: ODataQuery
  ): string {
    return EtpUri.createObjectUri(
      dataspace,
      domainFamily,
      domainVersion,
      objectType,
      uuid,
      "",
      oDataQuery
    ).uri;
  }

  private readonly _emlURI: any;
  private readonly _query: any;
  constructor(private readonly uriString: string) {
    this._emlURI = RegExp(regexp).exec(uriString);
    const q = this.uriQuery;
    // Unfortunately, capturing group does not work for OData, so use brute force
    this._query = null;
    if (q.length > 1) {
      this._query = {};
      q.substring(1)
        .split("&")
        .forEach((element: string) => {
          if (element.startsWith("$filter=")) {
            this._query.filter = element.substring(8);
          } else if (element.startsWith("$orderby=")) {
            this._query.orderby = element.substring(9);
          } else if (element.startsWith("$top=")) {
            this._query.top = +element.substring(5);
          } else if (element.startsWith("$skip=")) {
            this._query.skip = +element.substring(6);
          }
        });
    }
  }

  /**
   * Get back URI used at creation
   *
   * @readonly
   * @type {string}
   * @memberof EtpUri
   */
  get uri(): string {
    return this._emlURI ? this._emlURI.input ?? "" : "";
  }

  /**
   * Get back path part of URI (non query)
   *
   * @readonly
   * @type {string}
   * @memberof EtpUri
   */
  get uriPath(): string {
    const u = this.uri;
    const index = u.indexOf("?");
    return index === -1 ? u : u.substring(0, index);
  }

  /**
   * Get back query part of URI (after ?)
   *
   * @readonly
   * @type {string}
   * @memberof EtpUri
   */
  get uriQuery(): string {
    return this.groups ? this.groups.query ?? "" : "";
  }

  /**
   * Get the uri regex group
   *
   * @readonly
   * @private
   * @memberof EtpUri
   */
  private get groups() {
    return this._emlURI ? this._emlURI.groups : undefined;
  }
}
