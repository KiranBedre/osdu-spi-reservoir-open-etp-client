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

import path from "path";

import { sign, verify } from "jsonwebtoken";

import {
  InterfaceDeclaration,
  JSDoc,
  Project,
  PropertySignature,
  SourceFile,
  Type,
  TypeAliasDeclaration
} from "ts-morph";

import { parse } from "./FastActivityParser";

import * as cxml from "../cxml/cxml";

import { Abstract, Convert } from "./ResqmlTypes";

import * as eml20 from "./xmlns/www.energistics.org/energyml/resqmlv201/commonv2";
import * as eml23 from "./xmlns/www.energistics.org/energyml/resqmlv22/commonv2";
import * as resqml20 from "./xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import * as resqml22 from "./xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import * as prodml22 from "./xmlns/www.energistics.org/energyml/prodmlv22/prodmlv2";
import * as prodml23 from "./xmlns/www.energistics.org/energyml/prodmlv23/prodmlv2";
import * as witsml21 from "./xmlns/www.energistics.org/energyml/witsmlv21/witsmlv2";

// Create a new type where the keys of an object to their CamelCase version
type Camel<T> = T extends any[]
  ? T
  : T extends Record<string, any>
  ? {
      [P in keyof T as `${Capitalize<string & P>}`]: T[P];
    }
  : T;

// Types transformations used in OmitRecursively
type OmitDistributive<T, K extends PropertyKey> = T extends any
  ? T extends Date
    ? Date
    : T extends object
    ? Id<OmitRecursively<Camel<T>, K>>
    : T
  : never;
type Id<T> = (Record<string, unknown> | Record<string, unknown>[] | unknown[]) &
  Camel<{
    [P in keyof T]: T[P];
  }>;

// Create a new type with CamelCase keys of an object T do not contains the keys of K
export type OmitRecursively<T, K extends PropertyKey> = Omit<
  Camel<{ [P in keyof T]: OmitDistributive<T[P], K> }>,
  K
>;

// Create new type corresponding to JSON equivalent of an XML type (CamelCase and without HandlerInstance keys)
export type SimpleJson<T> = OmitRecursively<T, keyof eml20.HandlerInstance>;

const parser = new cxml.Parser();

const jwtSecret = process.env.RDMS_JWT_SECRET || "osdu-rddms";

/**
 * Represents the constraints associated with a number representation
 */
type TypeQualifier = {
  isInteger?: boolean;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
};

/**
 * Create a JWT from key and (name,password)
 *
 * @param {string} authenticationKey
 * @param {string} username
 * @param {string} password
 * @returns {string}
 */
export const createJWT = (
  authenticationKey: string,
  username: string,
  password: string
): string => {
  return sign({ username, password }, authenticationKey, {
    algorithm: "HS256",
    expiresIn: 100000,
    issuer: "http://osdu.org",
    subject: username
  });
};

/**
 * Create JWT corresponding to default server configuration
 */
export const createDefaultJWT = (): string =>
  createJWT(jwtSecret, "foo", "bar");

/**
 * Verify and decode a JWT object
 *
 * @param {string} authenticationKey
 * @param {string} token
 * @returns {(Record<string, any> | null)}
 */
export const decodeJWT = (
  authenticationKey: string,
  token: string
): Record<string, any> | null => {
  const dec = verify(token, authenticationKey);
  if (dec && typeof dec === "object") {
    return dec;
  }
  return null;
};

/**
 * Transform a bigint to string, during JSON stringify
 *
 * @param _key The key of the value to transform (unused, be required by JSON.stringify replacer parameter)
 * @param value The value to transform
 * @returns the value if it is not a BigInt, or its string representation if it exceeds Number.MAX_SAFE_INTEGER. Returns value as a number otherwise
 */
export const bigIntToString = (
  _key: string,
  value: unknown
): typeof value | number | string => {
  if (typeof value === "bigint") {
    return value > Number.MAX_SAFE_INTEGER
      ? value.toString() + "n"
      : Number(value);
  }
  return value;
};

/**
 * Transform a string to BigInt, during JSON parse
 *
 * @param _key  The key of the value to transform (unused, be required by JSON.parse reviver parameter)
 * @param value The value to transform
 * @returns the bigint representation of value, if it is a string matching /^\d+n$/, or value otherwise
 */
export const stringToBigInt = (
  _key: string,
  value: unknown
): bigint | typeof value => {
  if (typeof value === "string" && /^\d+n$/.test(value)) {
    return BigInt(value.slice(0, -1));
  }
  return value;
};

/* Compute ETP domain from xsi domain */
const etpDomainFromXsi = (xsi: string, schemaVersion: string): string => {
  if (xsi.startsWith("resqml")) {
    return schemaVersion.startsWith("2.0") ? "resqml20" : "resqml22";
  } else if (xsi.startsWith("witsml")) {
    return "witsml21";
  } else if (xsi.startsWith("prodml")) {
    return "prodml22";
  } else {
    return schemaVersion.startsWith("2.0") ? "eml20" : "eml23";
  }
};

/**
 * Replace xsi:type by $type
 *
 * @param {Record<string, any} obj
 * @returns {Record<string, any}
 */
const processXsiType = (
  obj: Record<string, any>,
  schemaVersion: string
): Record<string, any> => {
  if (!("xsi:type" in obj)) {
    return obj;
  }
  const xsiType = obj["xsi:type"] as string;
  // Convert xsi:type into $type
  const dot = xsiType.indexOf(":");
  const reOrdered: Record<string | number | symbol, any> = {};
  if (dot !== -1 && dot < xsiType.length - 1) {
    const interfaceDomain = etpDomainFromXsi(
      xsiType.substring(0, dot),
      schemaVersion
    );
    const interfaceName = xsiType.substring(dot + 1);
    reOrdered["$type"] = `${interfaceDomain}.${interfaceName}`;
  } else {
    reOrdered["$type"] = xsiType;
  }
  delete obj["xsi:type"];
  Object.keys(obj).forEach(key => {
    if (key !== "$type") {
      reOrdered[key] = obj[key as keyof typeof obj];
    }
  });
  return reOrdered;
};

/**
 * Transform camelCase to PascalCase
 *
 * @private
 * @param {string} input
 * @returns {string}
 * @memberof InterfaceTypeUtils
 */
export const toPascalCase = (input: string): string => {
  return input.charAt(0).toUpperCase() + input.slice(1);
};

/**
 * Method to extract the content of an element from a XML document
 * @param {string} xml xml document
 * @param {string} elementName name of the element to extract, does not include namespace even if it may be present
 * @returns {string} content of the element
 */
export const extractElementContent = (
  xml: string,
  elementName: string
): string => {
  const regex = RegExp(
    `<(?:[^>]+:)?${elementName}(?: xsi:type="[^>]+")?>([\\s|\\S]*)<\\/(?:(?:[^>]+):)?${elementName}>`
  );
  const match = xml.match(regex);
  return match ? match[0] : "";
};

/**
 * Process the keys of an object, creating a simpler JS Object without XML related extras
 *
 * @param {unknown} resqmlObj
 * @param {string} schemaVersion
 * @returns unknown
 */
export const simpleJson = (
  resqmlObj: unknown,
  schemaVersion: string
): unknown => {
  if (resqmlObj === null) {
    return null;
  }
  if (resqmlObj instanceof Date) {
    delete (resqmlObj as any)["cxmlTimezoneOffset"];
    return resqmlObj;
  }
  if (Array.isArray(resqmlObj)) {
    return resqmlObj.map(o => simpleJson(o, schemaVersion));
  }
  if (typeof resqmlObj !== "object") {
    return resqmlObj;
  }
  if (!schemaVersion && (resqmlObj as any)["schemaVersion"]) {
    schemaVersion = (resqmlObj as any)["schemaVersion"];
  }

  const obj: Record<string, any> = processXsiType(
    resqmlObj as Record<string, any>,
    schemaVersion
  );

  const newObj: Record<string, any> = {};

  const keys: string[] = [
    // keys of eml20.HandlerInstances
    "content",
    "_exists",
    "_namespace",
    "_parent",
    "_name",
    "_type",
    "_before",
    "_after"
  ];

  Object.getOwnPropertyNames(obj)
    .filter(key => !keys.includes(key)) // Remove optional elements
    .forEach(key => {
      const pascalKey = toPascalCase(key);
      newObj[pascalKey] = simpleJson(obj[key], schemaVersion);
    });
  return newObj;
};

/**
 * Check that an object is based on RESQML
 *
 * @param {object} resqmlObject
 * @returns {object}
 */
export const checkResqmlObject = (
  resqmlObject: Record<string, any>
): Abstract | null => {
  let result: Abstract | null = null;
  try {
    result = Convert.toAbstractResqmlDataObject(JSON.stringify(resqmlObject));
  } catch (err) {
    result = null;
  }
  return result;
};

/**
 * Return if type is based on eml20 or eml23
 *
 * @param {string} dataObjectType
 * @returns {boolean}
 */
export const isEml20 = (dataObjectType: string): boolean => {
  return (
    dataObjectType.startsWith("resqml20") || dataObjectType.startsWith("eml20")
  );
};

/**
 * Return xml document corresponding to data type
 * @param {string} dataObjectType
 */
const xmlDocument = (dataObjectType: string) => {
  return dataObjectType.startsWith("resqml20")
    ? resqml20.document
    : dataObjectType.startsWith("prodml22")
    ? prodml22.document
    : dataObjectType.startsWith("prodml23")
    ? prodml23.document
    : dataObjectType.startsWith("resqml22")
    ? resqml22.document
    : dataObjectType.startsWith("witsml21")
    ? witsml21.document
    : dataObjectType.startsWith("eml23")
    ? eml23.document
    : eml20.document;
};

/**
 * Convert a xml string into a JS object
 *
 * @param {string} xml
 * @param {string} dataObjectType
 * @returns {Promise<SimpleJson<eml20.AbstractCitedDataObject>>}
 */
export const xml2typescript = async (
  xml: string,
  dataObjectType: string,
  _usingSchema = true
): Promise<
  SimpleJson<eml20.AbstractCitedDataObject> | SimpleJson<eml23.AbstractObject>
> => {
  const eml20 = isEml20(dataObjectType);
  try {
    const res = await parser.parse(
      xml,
      xmlDocument(dataObjectType),
      cxml.context(dataObjectType.split(".")[0])
    );
    const keys = Object.keys(res).filter(r => !r.startsWith("_"));
    if (keys.length === 0) {
      return Promise.reject("Empty object");
    }
    const json = simpleJson((res as Record<string, any>)[keys[0]], "");

    const baseObj = eml20
      ? (json as SimpleJson<eml20.AbstractCitedDataObject>)
      : (json as SimpleJson<eml23.AbstractObject>);

    // Ensure $type is set on root object (WITSML/prodml objects may not have xsi:type)
    if (!baseObj["$type"]) {
      baseObj["$type"] = dataObjectType;
    }

    // Extract CustomData content
    if (
      baseObj["CustomData"] &&
      baseObj["CustomData"]["$type"] === "eml20.CustomData"
    ) {
      const customData = extractElementContent(xml, "CustomData");
      const cData = parse(customData);
      baseObj["CustomData"] = cData;
    }

    return baseObj;
  } catch (err) {
    return Promise.reject(err);
  }
};

const domainAndType = (emlType: string): [string, string] => {
  const dot = emlType.indexOf(".");
  if (dot !== -1 && dot < emlType.length - 1) {
    return [emlType.substring(0, dot), emlType.substring(dot + 1)];
  }
  return ["", emlType];
};

/**
 * Base utility class to check at runtime that an object is implementing an interface, or create GraphQL schemas
 * This validator is using the interface name.
 * This class must be derived to handle specific interfaces defined in one or several definition files.
 *
 * @export
 * @class InterfaceChecker
 */
export class InterfaceTypeUtils {
  files: Map<string, SourceFile> = new Map<string, SourceFile>();
  project = new Project();
  allowResolvedReferences: boolean;

  constructor(allowResolvedReferences: boolean) {
    this.allowResolvedReferences = allowResolvedReferences;
  }

  /**
   * List all domains
   *
   * @readonly
   * @memberof InterfaceTypeUtils
   */
  public get domains(): string[] {
    return Array.from(this.files.keys());
  }

  /**
   * Get all the interfaces for a given domain
   *
   * @param {string} domain
   * @returns {InterfaceDeclaration[]}
   * @memberof InterfaceTypeUtils
   */
  public getInterfaces(domain: string): InterfaceDeclaration[] {
    const file = this.files.get(domain);
    return file ? file.getInterfaces() : [];
  }

  /**
   * Find the definition of a typescript interface with its Name
   *
   * @param {string} interfaceName
   * @param {string} [parentTypeName]
   * @returns {(InterfaceDeclaration | undefined)}
   * @memberof InterfaceValidator
   */
  public findInterface(
    interfaceName: string,
    parentTypeName?: string
  ): [InterfaceDeclaration, string] | undefined {
    let interfaceDomain = "";
    [interfaceDomain, interfaceName] = domainAndType(interfaceName);
    if (interfaceDomain) {
      const file = this.files.get(interfaceDomain);
      const i = file?.getInterface(interfaceName);
      return i ? [i, interfaceDomain] : undefined;
    }
    if (parentTypeName) {
      [interfaceDomain, parentTypeName] = domainAndType(parentTypeName);
      if (parentTypeName) {
        const file = this.files.get(interfaceDomain);
        const i = file?.getInterface(interfaceName);
        if (i) {
          return [i, interfaceDomain];
        }
      }
    }
    for (const v of this.files.entries()) {
      const i = v[1].getInterface(interfaceName);
      if (i) {
        return [i, v[0]];
      }
    }
    return undefined;
  }

  /**
   * Find the definition of a typescript class with its Name
   *
   * @param {string} typeName
   * @param {string} [parentTypeName]
   * @returns {(ClassDeclaration | undefined)}
   * @memberof InterfaceValidator
   */
  public findTypeAlias(
    typeName: string,
    parentTypeName?: string
  ): [TypeAliasDeclaration, string] | undefined {
    let interfaceDomain = "";
    [interfaceDomain, typeName] = domainAndType(typeName);
    if (interfaceDomain) {
      const file = this.files.get(interfaceDomain);
      const i = file?.getTypeAlias(typeName);
      return i ? [i, interfaceDomain] : undefined;
    }
    if (parentTypeName) {
      [interfaceDomain, parentTypeName] = domainAndType(parentTypeName);
      if (parentTypeName) {
        const file = this.files.get(interfaceDomain);
        const i = file?.getTypeAlias(typeName);
        if (i) {
          return [i, interfaceDomain];
        }
      }
    }
    for (const v of this.files.entries()) {
      const i = v[1].getTypeAlias(typeName);
      if (i) {
        return [i, v[0]];
      }
    }
    return undefined;
  }

  /**
   * List all properties of an interface
   *
   * @param {string} interfaceName
   * @returns {string[]}
   * @memberof InterfaceChecker
   */
  public listInterfaceProperties(interfaceName: string): string[] {
    const c = this.findInterface(interfaceName);
    return c ? c[0].getProperties().map(p => p.getName()) : [];
  }

  /**
   * List all properties required to implement an interface
   *
   * @param {string} interfaceName
   * @returns {string[]}
   * @memberof InterfaceChecker
   */
  public listInterfaceRequiredProperties(interfaceName: string): string[] {
    const c = this.findInterface(interfaceName);
    return c
      ? c[0]
          .getProperties()
          .filter(p => p.getQuestionTokenNode() === undefined)
          .map(p => p.getName())
      : [];
  }

  /**
   * Check that an array is Valid
   *
   * @private
   * @param {*} value
   * @param {Type} arrayType
   * @param {string} [parentTypeName]
   * @returns
   * @memberof InterfaceValidator
   */
  private checkArray(value: any, arrayType?: Type, parentTypeName?: string) {
    if (!arrayType) {
      return false;
    }
    for (const v of value) {
      if (!this.checkValueType(v, arrayType, parentTypeName)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Convert a Typescript enum string value to a schema string value
   *
   * @private
   * @param {Type} t
   * @returns
   * @memberof InterfaceTypeUtils
   */
  private getUnionValue(t: Type) {
    const pattern = /"/g;
    return t.getText().replace(pattern, "");
  }

  /**
   * Check value against possible values of an Enum
   *
   * @private
   * @param {Type} t
   * @param {*} value
   * @returns {boolean}
   * @memberof InterfaceTypeUtils
   */
  private checkEnumType(t: Type, value: any): boolean {
    for (const u of t.getUnionTypes()) {
      if (typeof value === "boolean") {
        if (this.getUnionValue(u) === `${value}`) {
          return true;
        }
      } else {
        if (this.getUnionValue(u) === value) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check that a value is compatible with corresponding type type
   *
   * @param {*} value to test against
   * @param {Type} t type to use for test
   * @param {string} [parentTypeName] type of the parent
   * @returns
   * @memberof InterfaceValidator
   */
  private checkValueType(value: any, t: Type, parentTypeName?: string) {
    if (!value) {
      return true;
    }
    if (typeof value === "object" && "_exists" in value && !value._exists) {
      return true;
    }
    if (t.isArray()) {
      return this.checkArray(value, t.getArrayElementType(), parentTypeName);
    }
    if (t.getText() === "Date") {
      return value instanceof Date;
    }
    if (t.isClassOrInterface()) {
      const symbol = t.getSymbol();
      // When it is a reference we allow to follow the actual type or the reference
      if ("$type" in value) {
        return this.checkInterface(value, value["$type"]);
      }
      return (
        symbol && this.checkInterface(value, symbol.getName(), parentTypeName)
      );
    }
    if (t.isUnion()) {
      return this.checkEnumType(t, value);
    }
    return t.getText() === typeof value;
  }

  /**
   * Check if interface property is valid on given object
   *
   * @param {Record<string, any>} o
   * @param {PropertySignature} p
   * @param {string} interfaceName
   * @returns {boolean}
   * @memberof InterfaceChecker
   */
  private checkProperty(
    o: Record<string, any>,
    p: PropertySignature,
    interfaceName: string
  ): boolean {
    const n: string = p.getName();
    if (n.startsWith("_")) {
      return true;
    }
    const pn = toPascalCase(n);
    // Check for presence of mandatory properties
    if (!Object.keys(o).includes(n) && !Object.keys(o).includes(pn)) {
      const ok = p.getQuestionTokenNode() !== undefined;
      if (!ok) {
        return false;
      }
      return ok;
    }
    const t = p.getType();
    const val = Object.keys(o).includes(n) ? o[n] : o[pn];
    // For readability, prefer no single return statement
    /* eslint-disable-next-line */
    if (!t || !this.checkValueType(val, t, interfaceName)) {
      return false;
    }

    return true;
  }

  /**
   * Check if an object is supporting the corresponding interface
   *
   * @export
   * @param {Record<string, any>} o
   * @param {string} interfaceName
   * @returns {boolean}
   */
  public checkInterface(
    o: Record<string, any>,
    interfaceName: string,
    parentTypeName?: string
  ): boolean {
    const c = this.findInterface(interfaceName, parentTypeName);
    if (!c) {
      return false;
    }
    const baseClasses = c[0].getExtends();
    if (baseClasses) {
      for (const base of baseClasses) {
        if (
          !base.getText().endsWith("BaseType") &&
          !this.checkInterface(o, base.getText(), interfaceName)
        ) {
          for (const m of base.getType().getProperties()) {
            if (m.getName() !== "_" && m.getName().startsWith("_")) {
              continue;
            }
            const p = m.getDeclarations()[0] as PropertySignature;
            if (!this.checkProperty(o, p, interfaceName)) {
              return false;
            }
          }
        }
      }
    }
    for (const p of c[0].getProperties()) {
      if (!this.checkProperty(o, p, interfaceName)) {
        return false;
      }
    }
    if ("_data" in o) {
      const data = o["_data"];
      if ("$type" in data && !this.checkInterface(data, data["$type"])) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if an object is valid according to its $type
   *
   * @export
   * @param {Record<string, any>} o
   * @returns {boolean}
   */
  public checkValidity(o: Record<string, any>): boolean {
    return this.checkInterface(o, o.$type);
  }

  /**
   * Cleanup JSDocs to create schema comments
   *
   * @private
   * @param {JSDoc[]} docs
   * @returns
   * @memberof InterfaceValidator
   */
  private processJSDocs(docs: JSDoc[]) {
    const pattern = /\/|\*|\\|"/g;
    const whiteSpace = /\s+/g;
    const res = docs
      .map(j => j.getText().replace(pattern, "").replace(whiteSpace, " "))
      .join(" ");
    return res ? `${res.trim()}` : "";
  }

  private getQualifierFromDocs(docs: JSDoc[]): TypeQualifier {
    const tq: TypeQualifier = {};
    const maxLength = /@maxLength (?<maxLength>[0-9]+)/i;
    const minLength = /@minLength (?<minLength>[0-9]+)/i;
    const pattern = /@pattern (?<pattern>(".+"))/i;
    docs.forEach(j => {
      const text = j.getText();
      if (text.indexOf("@integer") !== -1) {
        tq.isInteger = true;
      }
      const mMax = text.match(maxLength);
      if (mMax && mMax.groups) {
        tq.maxLength = +mMax.groups.maxLength;
      }
      const mMin = text.match(minLength);
      if (mMin && mMin.groups) {
        tq.minLength = +mMin.groups.minLength;
      }
      const mPattern = text.match(pattern);
      if (mPattern && mPattern.groups) {
        tq.pattern = mPattern.groups.pattern;
      }
    });
    return tq;
  }

  /**
   * Compute the representation of an abstract type as an oneOf of its concrete type
   *
   * @private
   * @param {string} interfaceName
   * @param {Map<string, string>} dependencies
   * @returns {string}
   * @memberof InterfaceTypeUtils
   */
  private computeAbstractInterfaceType(
    interfaceName: string,
    dependencies: Map<string, string>
  ): string {
    const c = this.findInterface(interfaceName);
    if (c) {
      let derived = this.getDerived(c[0]);
      if (derived.length === 0) {
        const baseClasses = c[0].getExtends();
        for (const base of baseClasses) {
          if (base.getText() === "_" + interfaceName) {
            const c2 = this.findInterface("_" + interfaceName);
            if (c2) {
              derived = this.getDerived(c2[0]);
            }
          }
        }
      }
      derived = derived.filter(d => !d.getName().startsWith("_"));
      if (derived.length > 0) {
        const oneOf = derived.map(d => {
          const derivedName = d.getName();
          const c2 = this.findInterface(derivedName);
          if (c2 && !dependencies.get(derivedName)) {
            dependencies.set(derivedName, `Building oneOf...`);
            const jsi = this.computeJSONInterfaceSchema(
              derivedName,
              new Map<string, string>(),
              dependencies,
              new Set<string>()
            );
            dependencies.set(derivedName, jsi);
          }
          return `      { "$ref": "#/definitions/${d.getName()}" }`;
        });
        const depOneOf = `{\n    "oneOf": [\n${oneOf.join(",\n")}\n    ]\n  }`;
        dependencies.set(interfaceName, depOneOf);
        return `"$ref": "#/definitions/${interfaceName}"`;
      }
    }
    return `"type": "object"`;
  }

  /**
   * Compute the JSON type from TypeScript interface type
   *
   * @private
   * @param {Type} t
   * @param {Map<string, string>} dependencies
   * @returns {string}
   * @memberof InterfaceTypeUtils
   */
  private getInterfaceJSONType(
    t: Type,
    dependencies: Map<string, string>
  ): string {
    const symbol = t.getSymbol();
    if (!symbol) {
      return "";
    }
    const name = symbol.getName();
    if (!dependencies.get(name)) {
      if (name.startsWith("Abstract")) {
        return this.computeAbstractInterfaceType(name, dependencies);
      }

      // Avoid circular dependencies
      dependencies.set(name, "In Progress...");
      const dep = this.computeJSONInterfaceSchema(
        name,
        new Map<string, string>(),
        dependencies,
        new Set<string>()
      );
      dependencies.set(name, dep);
    }
    // When it is a reference we allow to follow the actual type or the reference
    return `"$ref": "#/definitions/${symbol.getName()}"`;
  }

  /**
   * Compute the JSON type from TypeScript type
   *
   * @private
   * @param {Type} t
   * @param {Map<string, string>} dependencies
   * @param {TypeQualifier} qualifier
   * @returns {string}
   * @memberof InterfaceTypeUtils
   */
  private getJSONType(
    t: Type,
    dependencies: Map<string, string>,
    qualifier: TypeQualifier
  ): string {
    if (t.getText() === "Date") {
      return `"type": "string",\n        "format": "date-time"`;
    }
    if (t.isBoolean()) {
      return `"type": "boolean"`;
    }
    if (t.isString()) {
      let s = `"type": "string"`;
      if (qualifier.maxLength) {
        s += `,\n        "maxLength": ${qualifier.maxLength}`;
      }
      if (qualifier.minLength) {
        s += `,\n        "minLength": ${qualifier.minLength}`;
      }
      if (qualifier.pattern) {
        s += `,\n        "pattern": ${qualifier.pattern}`;
      }
      return s;
    }
    if (t.isNumber()) {
      return qualifier.isInteger
        ? `"type": "integer"`
        : `"$ref": "#/definitions/Number"`;
    }
    if (t.isClassOrInterface()) {
      return this.getInterfaceJSONType(t, dependencies);
    }
    if (t.isArray()) {
      const tElements = t.getArrayElementType();
      if (tElements) {
        return `"type": "array",\n        "items": {\n          ${this.getJSONType(
          tElements,
          dependencies,
          qualifier
        )}\n        }`;
      }
    }
    if (t.isUnion()) {
      const name = t.getAliasSymbol()?.getName() ?? "";
      let schema = `{\n    "type": "string",\n    "enum": [`;
      schema += t
        .getUnionTypes()
        .map(e => `"${this.getUnionValue(e)}"`)
        .join(", ");
      schema += `]\n  }`;
      dependencies.set(name, schema);
      return `"$ref": "#/definitions/${name}"`;
    }
    return t.getText();
  }

  /**
   * Create JSON schema containing the interface
   *
   * @param {string} interfaceName
   * @returns {string}
   * @memberof InterfaceValidator
   */
  public createJSONSchemas(interfaceName: string): string {
    const schemas = new Map<string, string>();
    schemas.set(
      "Number",
      `{
    "oneOf": [
      {"type":"number"},
      {"enum":["NaN","+Infinity","-Infinity"]}
    ]
  }`
    );
    return this.computeJSONInterfaceSchema(
      interfaceName,
      new Map<string, string>(),
      schemas,
      new Set<string>(),
      true
    );
  }

  /**
   * Get the interfaces deriving from the current one
   *
   * @param {InterfaceDeclaration} int
   * @returns {InterfaceDeclaration[]}
   * @memberof InterfaceTypeUtils
   */
  public getDerived(int: InterfaceDeclaration): InterfaceDeclaration[] {
    const derived: InterfaceDeclaration[] = [];
    for (const v of this.files.values()) {
      v.getInterfaces().forEach(i => {
        const interfaceName = int.getName();
        const baseClasses = i.getExtends();
        for (const base of baseClasses) {
          if (base.getText() === interfaceName) {
            if (!i.getName().startsWith("Abstract")) {
              derived.push(i);
            }
            this.getDerived(i).forEach(a => derived.push(a));
          }
        }
      });
    }
    return derived;
  }

  /**
   * Get the interfaces deriving from the current one
   *
   * @param {InterfaceDeclaration} derived interface
   * @param {InterfaceDeclaration} base interface tp check against
   * @returns {boolean}
   * @memberof InterfaceTypeUtils
   */
  public isDerivingFrom(
    derived: InterfaceDeclaration,
    base: InterfaceDeclaration
  ): boolean {
    let i: InterfaceDeclaration | null = derived;
    const [, baseName] = domainAndType(base.getName());
    while (i) {
      const baseClasses = i.getExtends();
      i = null;
      for (const b of baseClasses) {
        const [, derivedName] = domainAndType(b.getText());
        if (derivedName === baseName) {
          return true;
        }
        const c = this.findInterface(baseClasses[0].getText());
        i = c ? c[0] : null;
      }
    }
    return false;
  }

  /**
   * Compute the schema for an interface and its implementation
   *
   * @private
   * @param {string} interfaceName
   * @param {Map<string, string>} propertyMap List of properties with their schema
   * @param {Map<string, string>} dependencies List of other interfaces it depends on with their type representation
   * @param {string[]} required Required properties
   * @param {boolean} [top=false]
   * @returns {string}
   * @memberof InterfaceTypeUtils
   */
  private computeJSONInterfaceSchema(
    interfaceName: string,
    propertyMap: Map<string, string>,
    dependencies: Map<string, string>,
    required: Set<string>,
    top = false
  ): string {
    const c = this.findInterface(interfaceName);
    if (!c) {
      return "";
    }

    [, interfaceName] = domainAndType(interfaceName);

    const baseClasses = c[0].getExtends();
    if (baseClasses) {
      for (const base of baseClasses) {
        if (!base.getText()?.endsWith("BaseType")) {
          if (
            top ||
            dependencies.get(interfaceName) === "Building oneOf..." ||
            dependencies.get(interfaceName) === "In Progress..."
          ) {
            propertyMap.set(
              "$type",
              `      "$type": {\n        "type": "string",\n        "pattern": "^${c[1]}.${interfaceName}$"\n      }`
            );
          }
          const i = this.computeJSONInterfaceSchema(
            base.getText() ?? "",
            propertyMap,
            dependencies,
            required
          );
          if (i === "") {
            const typeAlias = this.findTypeAlias(base.getText());
            const qualifier: TypeQualifier = typeAlias
              ? this.getQualifierFromDocs(typeAlias[0].getJsDocs())
              : {};
            const members = base.getType().getProperties();
            for (const m of members) {
              if (m.getName() !== "_" && m.getName().startsWith("_")) {
                continue;
              }

              const propertyName = toPascalCase(m.getName());

              const mn = m.getDeclarations()[0] as PropertySignature;

              const pm = `      "${propertyName}": {\n        ${this.getJSONType(
                mn.getType(),
                dependencies,
                qualifier
              )}\n      }`;

              propertyMap.set(propertyName, pm);

              const isQuestion = mn.getQuestionTokenNode() !== undefined;
              if (!isQuestion) {
                required.add(propertyName);
              }
            }
          }
        }
      }
    }

    for (const p of c[0].getProperties()) {
      if (p.getName() === "constructor" || p.getName() === "_data") {
        continue;
      }
      const propertyName = toPascalCase(p.getName());
      if (p.getQuestionTokenNode() === undefined) {
        required.add(propertyName);
      }
      const qualifier: TypeQualifier = this.getQualifierFromDocs(p.getJsDocs());
      const propertyDocs = this.processJSDocs(p.getJsDocs());

      let propertyString = `      "${propertyName}": {\n`;
      if (propertyDocs) {
        propertyString += `        "description": "${propertyDocs}",\n`;
      }

      propertyString += `        ${this.getJSONType(
        p.getType(),
        dependencies,
        qualifier
      )}`;
      propertyString += `\n      }`;
      propertyMap.set(propertyName, propertyString);
    }

    const docs = this.processJSDocs(c[0].getJsDocs());
    const start = top
      ? `\n    "$id": "https://example.com/${interfaceName}.schema.json",\n    "$schema": "http://json-schema.org/draft-07/schema#",\n`
      : "\n";
    let schema = `{${start}    "description": "${docs}",\n    "type": "object",\n    "properties": {\n${Array.from(
      propertyMap.values()
    ).join(",\n")}\n    }`;
    if (required.size > 0) {
      schema += `,\n    "required": [\n`;
      schema += Array.from(required)
        .map(r => `      "${r}"`)
        .join(",\n");
      schema += `\n    ]`;
    }
    if (top && dependencies.size > 0) {
      schema += `,\n    "definitions": {\n`;
      schema += Array.from(dependencies.entries())
        .filter(dependency => dependency[1])
        .map(dependency => {
          const s = `\n  "${dependency[0]}": ${dependency[1]}`;
          dependencies.set(dependency[0], "");
          return s;
        })
        .join(",");
      schema += `\n    }\n`;
    }
    schema += top ? `\n}` : `\n  }`;
    return schema;
  }
}

const commonFileName = "commonv2.d.ts";
const fileDirectory = path.dirname(__filename);

export const getFilePath = (
  fileName: string,
  subDir: "resqmlv201" | "resqmlv22" | "witsmlv21" | "prodmlv22" | "prodmlv23"
): string => {
  return `${fileDirectory}/xmlns/www.energistics.org/energyml/${subDir}/${fileName}`;
};

/**
 * Utility class to check at runtime that an object is implementing a Resqml interface.
 * This validator is using the interface name against the interface defined in resqmlv2.ts and commonv2.ts.
 * The class name can be provided with or without prefix ("eml.AbstractCitedDataObject" or "AbstractCitedDataObject")
 * It is recommended to create as few instances of validator as possible.
 * Example of use is to check validity before cast:
 * @example (new ResqmlTypeUtils()).checkInterface(o, "AbstractCitedDataObject") ? <eml.AbstractCitedDataObject>o : null;
 *
 * @export
 * @class ResqmlTypeUtils
 * @extends {InterfaceTypeUtils}
 */
export class ResqmlTypeUtils extends InterfaceTypeUtils {
  /**
   * Creates an instance of ResqmlInterfaceValidator.
   *
   * @param {boolean} [allowResolvedReferences=true] if true DataObjectReference can be replaced by resolved objects
   * @memberof ResqmlInterfaceValidator
   */
  constructor(allowResolvedReferences = true) {
    super(allowResolvedReferences);
    const subDir = "resqmlv201";
    this.project.addSourceFilesAtPaths([
      getFilePath("resqmlv2.d.ts", subDir),
      getFilePath(commonFileName, subDir)
    ]);
    const resqmlFile = this.project.getSourceFileOrThrow(
      getFilePath("resqmlv2.d.ts", subDir)
    );
    this.files.set("resqml20", resqmlFile);
    const emlFile = this.project.getSourceFileOrThrow(
      getFilePath(commonFileName, subDir)
    );
    this.files.set("eml20", emlFile);
  }
}

export class Resqml22TypeUtils extends InterfaceTypeUtils {
  /**
   * Creates an instance of Resqml22TypeUtils.
   *
   * @param {boolean} [allowResolvedReferences=true] if true DataObjectReference can be replaced by resolved objects
   * @memberof Resqml22TypeUtils
   */
  constructor(allowResolvedReferences = true) {
    super(allowResolvedReferences);
    const subDir = "resqmlv22";
    this.project.addSourceFilesAtPaths([
      getFilePath("resqmlv2.d.ts", subDir),
      getFilePath(commonFileName, subDir)
    ]);
    const resqmlFile = this.project.getSourceFileOrThrow(
      getFilePath("resqmlv2.d.ts", subDir)
    );
    this.files.set("resqml22", resqmlFile);
    const emlFile = this.project.getSourceFileOrThrow(
      getFilePath(commonFileName, subDir)
    );
    this.files.set("eml23", emlFile);
    this.files.set("eml", emlFile);
  }
}

export class Prodml22TypeUtils extends InterfaceTypeUtils {
  /**
   * Creates an instance of Prodml22TypeUtils.
   *
   * @param {boolean} [allowResolvedReferences=true] if true DataObjectReference can be replaced by resolved objects
   * @memberof Prodml22TypeUtils
   */
  constructor(allowResolvedReferences = true) {
    super(allowResolvedReferences);
    const subDir = "prodmlv22";
    this.project.addSourceFilesAtPaths([
      getFilePath("prodmlv2.d.ts", subDir),
      getFilePath(commonFileName, subDir)
    ]);
    const prodmlFile = this.project.getSourceFileOrThrow(
      getFilePath("prodmlv2.d.ts", subDir)
    );
    this.files.set("prodml22", prodmlFile);
    const emlFile = this.project.getSourceFileOrThrow(
      getFilePath(commonFileName, subDir)
    );
    this.files.set("eml23", emlFile);
    this.files.set("eml", emlFile);
  }
}

export class Prodml23TypeUtils extends InterfaceTypeUtils {
  /**
   * Creates an instance of Prodml23TypeUtils.
   *
   * @param {boolean} [allowResolvedReferences=true] if true DataObjectReference can be replaced by resolved objects
   * @memberof Prodml23TypeUtils
   */
  constructor(allowResolvedReferences = true) {
    super(allowResolvedReferences);
    const subDir = "prodmlv23";
    this.project.addSourceFilesAtPaths([
      getFilePath("prodmlv2.d.ts", subDir),
      getFilePath(commonFileName, subDir)
    ]);
    const prodmlFile = this.project.getSourceFileOrThrow(
      getFilePath("prodmlv2.d.ts", subDir)
    );
    this.files.set("prodml23", prodmlFile);
    const emlFile = this.project.getSourceFileOrThrow(
      getFilePath(commonFileName, subDir)
    );
    this.files.set("eml23", emlFile);
    this.files.set("eml", emlFile);
  }
}

/**
 * Utility class to check at runtime that an object is implementing a Witsml interface.
 * This validator is using the interface name against the interface defined in witsmlv2.ts and commonv2.ts.
 * The class name can be provided with or without prefix ("eml.AbstractCitedDataObject" or "AbstractCitedDataObject")
 * It is recommended to create as few instances of validator as possible.
 * Example of use is to check validity before cast:
 * @example (new WitsmlTypeUtils()).checkInterface(o, "AbstractCitedDataObject") ? <eml.AbstractCitedDataObject>o : null;
 *
 * @export
 * @class ResqmlInterfaceChecker
 * @extends {InterfaceTypeUtils}
 */
export class WitsmlTypeUtils extends InterfaceTypeUtils {
  /**
   * Creates an instance of WitsmlTypeUtils
   *
   * @param {boolean} [allowResolvedReferences=true] if true DataObjectReference can be replaced by resolved objects
   * @memberof WitsmlTypeUtils
   */
  constructor(allowResolvedReferences = true) {
    super(allowResolvedReferences);
    const subDir = "witsmlv21";
    this.project.addSourceFilesAtPaths([
      getFilePath("witsmlv2.d.ts", subDir),
      getFilePath(commonFileName, subDir)
    ]);
    const witsmlFile = this.project.getSourceFileOrThrow(
      getFilePath("witsmlv2.d.ts", subDir)
    );
    this.files.set("witsml21", witsmlFile);
    const emlFile = this.project.getSourceFileOrThrow(
      getFilePath(commonFileName, subDir)
    );
    this.files.set("eml23", emlFile);
  }
}

/**
 * Utility function for JSON parser to process DateTime in xml format
 *
 * @param {*} _
 * @param {*} value
 * @returns {*}
 */
function convertDateTime(_: any, value: any): any {
  if (typeof value === "string") {
    const a =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*)?)(?:Z|(\+|-)([\d|:]*))?$/.exec(
        value
      );
    if (a) {
      return new Date(value);
    }
  }

  return value;
}

/**
 * Convert JSON to object, also converting DateTime
 *
 * @export
 * @param {string} json
 * @returns {*}
 */
export function parseJSON(json: string): any {
  return JSON.parse(json, (key, val) =>
    convertDateTime(key, stringToBigInt(key, val))
  );
}
