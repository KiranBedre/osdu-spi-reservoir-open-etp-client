import * as eml20 from "./xmlns/www.energistics.org/energyml/resqmlv201/commonv2";
import * as resqml20 from "./xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import * as eml23 from "./xmlns/www.energistics.org/energyml/resqmlv22/commonv2";
import * as resqml22 from "./xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import * as witsml21 from "./xmlns/www.energistics.org/energyml/witsmlv21/witsmlv2";
import * as prodml22 from "./xmlns/www.energistics.org/energyml/prodmlv22/prodmlv2";
import * as prodml23 from "./xmlns/www.energistics.org/energyml/prodmlv23/prodmlv2";
import { BadRequestException } from "@nestjs/common";

import { parseJSON } from "./XmlJsonUtil";

import { EtpQualifiedType } from "../common/EtpQualifiedType";

/*
 * Options for the XMLBuilder
 */
export interface IXMLOptions {
  /**
   * Prefix for all attributes
   *
   * @type {string}
   * @memberof IOptions
   */
  attributeNamePrefix: string;
  /**
   * Indentation string
   *
   * @type {string}
   * @memberof IOptions
   */
  indentBy: string;
  /**
   * Associate namespace shortcut to namespace path
   *
   * @type {string}
   * @memberof IOptions
   */
  namespaces: Map<string, string>;
}

export const defaultOptions: IXMLOptions = {
  attributeNamePrefix: "_",
  indentBy: "  ",
  namespaces: new Map([
    ["gts", "http://www.isotc211.org/2005/gts"],
    ["gsr", "http://www.isotc211.org/2005/gsr"],
    ["dc", "http://purl.org/dc/terms/"],
    ["gml", "http://www.opengis.net/gml/3.2"],
    ["xlink", "http://www.w3.org/1999/xlink"],
    ["gmd", "http://www.isotc211.org/2005/gmd"],
    ["gco", "http://www.isotc211.org/2005/gco"],
    ["abstract", "http://www.energistics.org/schemas/abstract"],
    ["resqml20", resqml20.document._namespace],
    ["eml20", eml20.document._namespace]
  ])
};

type EmlDocument = Record<string, any>;

/**
 * Build XML document from typescript and json information
 *
 * @export
 * @class XMLBuilder
 */
/**
 * Maximum length of an invalid date value echoed back in a BadRequestException
 * description. A valid XSD dateTime string is ~33 characters (e.g.
 * "2024-01-01T00:00:00.000Z"), so 40 leaves a small buffer while keeping error
 * payloads bounded.
 */
const MAX_INVALID_DATE_VALUE_LENGTH = 40;

export class XMLBuilder {
  private attributeNamePrefix: string;
  private indentString: string;
  private reverseNamespace: Map<string, Map<string, string>> = new Map();

  constructor(options?: IXMLOptions) {
    const rMap = new Map([
      ["http://www.isotc211.org/2005/gts", "gts"],
      ["http://www.isotc211.org/2005/gsr", "gsr"],
      ["http://purl.org/dc/terms/", "dc"],
      ["http://www.opengis.net/gml/3.2", "gml"],
      ["http://www.w3.org/1999/xlink", "xlink"],
      ["http://www.isotc211.org/2005/gmd", "gmd"],
      ["http://www.isotc211.org/2005/gco", "gco"],
      ["http://www.energistics.org/schemas/abstract", "abstract"]
    ]);
    this.reverseNamespace = new Map();
    const resqml20Map = new Map([
      [resqml20.document._namespace, "resqml20"],
      [eml20.document._namespace, "eml20"]
    ]);
    const resqml22Map = new Map([
      [resqml22.document._namespace, "resqml22"],
      [prodml22.document._namespace, "prodml22"],
      [eml23.document._namespace, "eml23"]
    ]);
    const witsml21Map = new Map([
      [eml23.document._namespace, "eml23"],
      [witsml21.document._namespace, "witsml21"]
    ]);
    this.reverseNamespace.set("2.0", new Map([...rMap, ...resqml20Map]));
    this.reverseNamespace.set("2.2", new Map([...rMap, ...resqml22Map]));
    this.reverseNamespace.set("2.1", new Map([...rMap, ...witsml21Map]));
    this.reverseNamespace.set(
      "2.3",
      new Map([...rMap, [eml23.document._namespace, "eml23"]])
    );

    this.attributeNamePrefix = options?.attributeNamePrefix ?? "_";
    this.indentString = options?.indentBy ?? "  ";
  }

  /**
   * Check if type is valid
   *
   * @private
   * @param {string} emlType
   * @return {boolean}
   * @memberof XMLBuilder
   */
  private isValidType(emlType: string): boolean {
    if (!emlType) {
      return false;
    }
    return (
      emlType.startsWith("resqml20") ||
      emlType.startsWith("resqml22") ||
      emlType.startsWith("witsml21") ||
      emlType.startsWith("prodml22") ||
      emlType.startsWith("prodml23") ||
      emlType.startsWith("eml20") ||
      emlType.startsWith("eml23")
    );
  }

  /**
   * Get the schema document corresponding to the qualified type
   *
   * @private
   * @param {EtpQualifiedType} qType
   * @return {*}
   * @memberof XMLBuilder
   */
  private emlDocument(qType: EtpQualifiedType): any {
    return qType.domainFamily === "resqml"
      ? qType.domainVersion === "2.0"
        ? resqml20
        : resqml22
      : qType.domainFamily === "witsml"
        ? witsml21
        : qType.domainFamily === "prodml"
          ? qType.domainVersion === "2.3"
            ? prodml23
            : prodml22
          : qType.domainVersion === "2.0"
            ? eml20
            : eml23;
  }

  /**
   * Convert from JSON to Energistics XML document
   *
   * @param {string} json
   * @returns {string}
   * @memberof XMLBuilder
   */
  public JSONtoEnergistics(json: string): string {
    const jObj = parseJSON(json);
    if (!this.isValidType(jObj.$type)) {
      return "";
    }

    const qType = new EtpQualifiedType(jObj.$type);
    const name = qType.dataType.startsWith("obj_")
      ? qType.dataType.slice(4)
      : qType.dataType;

    const resqmlObj: Record<string, any> = {};
    resqmlObj[name] = jObj;

    const version = qType.domainVersion as "2.0" | "2.1" | "2.2" | "2.3";

    Object.defineProperty(resqmlObj[name], "_name", {
      enumerable: false,
      value: `${jObj.$type.split(".")[0]}:${name}`
    });
    const document = this.emlDocument(qType);

    return (
      `<?xml version="1.0" encoding="utf-8"?>\n` +
      this.j2x(resqmlObj, 0, jObj.$type.split(".")[0], document).val
    );
  }

  /**
   * Extract the actual resqml properties in XML order
   *
   * @private
   * @param {Record<string, unknown>} obj
   * @returns {string[]}
   * @memberof XMLBuilder
   */
  private orderedProps(obj: Record<string, unknown>): string[] {
    let p: string[] = [];
    const p3: string[] = [];
    for (const key in obj) {
      p3.push(key);
    }
    for (; obj != null; obj = Object.getPrototypeOf(obj)) {
      const op = Object.getOwnPropertyNames(obj);
      const p1: string[] = [];
      for (const i of op) {
        if (p3.indexOf(i) !== -1 && p.indexOf(i) === -1) {
          p1.push(i);
        }
      }
      p = p1.concat(...p);
    }
    return p;
  }

  /**
   * Lookup the EML schema information
   *
   * @param ml name of the ML, e.g. resqml20, resqml22, witsml21, prodml22, prodml23, eml20, eml23
   * @returns
   */
  private findEml(
    ml: string
  ):
    | typeof resqml20
    | typeof resqml22
    | typeof witsml21
    | typeof prodml22
    | typeof prodml23
    | typeof eml20
    | typeof eml23
    | undefined {
    let proto = undefined;
    if (ml === "resqml20") {
      proto = resqml20;
    } else if (ml === "resqml22") {
      proto = resqml22;
    } else if (ml === "witsml21") {
      proto = witsml21;
    } else if (ml === "prodml22") {
      proto = prodml22;
    } else if (ml === "prodml23") {
      proto = prodml23;
    } else if (ml === "eml20") {
      return eml20;
    } else if (ml === "eml23") {
      return eml23;
    }
    return proto;
  }

  /**
   * Find the prefix for the namespace from the XSD namespace
   *
   * @param namespace in XML document
   * @param version of the EML schema
   * @returns {string} name of the ML, e.g. resqml20, resqml22, witsml21, prodml22, prodml23, eml20, eml23
   */
  private findPrefix(namespace: string, version: string): string {
    if (namespace === "http://www.energistics.org/energyml/data/resqmlv2") {
      return "resqml" + version.replace(".", "");
    } else if (
      namespace === "http://www.energistics.org/energyml/data/witsmlv2"
    ) {
      return "witsml" + version.replace(".", "");
    } else if (
      namespace === "http://www.energistics.org/energyml/data/prodmlv2"
    ) {
      return "prodml" + version.replace(".", "");
    }
    return version === "2.0" ? "eml20" : "eml23";
  }

  /**
   * Get the xsi:type for the XML node information
   *
   * @param curType XML node information
   * @param version version of the EML schema
   * @returns {string} xsi:type
   */
  private xsiType(curType: any, version: string): string {
    if (!curType) {
      return "";
    }
    if (curType.typeSpecList?.length === 1) {
      const spec = curType.typeSpecList[0];
      const namespace = spec.namespace.name;
      const typename = spec.name;
      if (namespace === "xml-primitives") {
        if (typename === "Date") {
          return "xsd:dateTime";
        } else if (typename === "number") {
          return "";
        }
        return `xsd:${typename}`;
      }
      return `${this.findPrefix(namespace, "2.0")}:${typename}`;
    }
    if (!curType.rule) {
      return "";
    }
    if (curType.rule.isPrimitive) {
      if (curType.rule.primitiveType === "Date") {
        return "xsd:dateTime";
      }
      if (curType.rule.primitiveType === "number") {
        return "";
      }
      return `xsd:${curType.rule.primitiveType}`;
    } else {
      return `${this.findPrefix(curType.rule.namespace.name, version)}:${curType.name
        }`;
    }
  }

  /**
   * Main conversion function, recursive function to convert JSON to XML
   *
   * @private
   * @param {Record<string, any>} jObj
   * @param {number} level
   * @param {string} ml identifier of the ML. e.g. resqml20, resqml22, witsml21, prodml22, prodml23, eml20, eml23
   * @param {EmlDocument} xmlType schema information
   * @returns {{ attrStr: string; val: string }}
   * @memberof XMLBuilder
   */
  private j2x(
    jObj: Record<string, any>,
    level: number,
    ml: string,
    xmlType: EmlDocument
  ): { attrStr: string; val: string } {
    let attrStr = "";
    const version = ml.slice(-2).split("").join(".");
    const rMap = this.reverseNamespace.get(version) || new Map();
    if (level === 1) {
      attrStr = ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"`;
      for (const [k, v] of rMap) {
        attrStr += ` xmlns:${v}="${k}"`;
      }
    }

    let mlTypes: Record<string, any> | undefined = this.findEml(ml);

    // If type is explicitly defined in the JSON object, because of polymorphism
    let type = jObj._type;
    if (!type && jObj["$type"]) {
      type = jObj["$type"].replace(".", ":");
    }
    if (type) {
      mlTypes = this.findEml(type?.split(":")[0]);
      if (mlTypes) {
        xmlType = mlTypes[type.split(":")[1]];
      }
      attrStr += ` xsi:type="${type}"`;
    } else {
      attrStr += ` xsi:type="${this.xsiType(xmlType, version)}"`;
    }

    const rule = xmlType?.rule;

    const valParts: string[] = [];
    const props = this.orderedProps(jObj);
    for (const key of props) {
      if (key.startsWith(this.attributeNamePrefix) || key === "$type") {
        // Skip $type attributes, that will not be explicitly defined in the XML
        continue;
      }
      if (jObj[key] && jObj[key]._exists === false) {
        continue;
      }

      // Get the node information from the XML schema
      let ruleKey = undefined;
      let child = undefined;
      let curMl = ml;
      if (rule) {
        if (rule.childTbl["1:" + key] === undefined) {
          if (rule.childTbl["2:" + key] !== undefined) {
            ruleKey = "2:" + key;
          }
        } else {
          ruleKey = "1:" + key;
        }

        if (ruleKey) {
          child = rule.childTbl[ruleKey];
        }

        // Attempt to find the namespace of the child node, need to identify the base class that provides the namespace
        let curHandler = rule.handler;
        while (curHandler?.rule && ruleKey) {
          if (
            Object.prototype.hasOwnProperty.call(
              curHandler.rule.childTbl,
              ruleKey
            )
          ) {
            curMl = this.findPrefix(curHandler.rule.namespace.name, version);
            break;
          }
          curHandler = Object.getPrototypeOf(curHandler);
        }
      }

      const curType = child ? child.member : undefined;

      const curKey = jObj[key]?._name ?? `${curMl}:${key}`;

      // Compute the xsi:type for the node
      const xsiType = this.xsiType(curType, version);
      const xsdType = xsiType === "" ? "" : ` xsi:type="${xsiType}"`;

      if (typeof jObj[key] === "undefined") {
        // suppress undefined node
      } else if (jObj[key] === null) {
        // Process null node
        valParts.push(`${this.indentBy(level)}<${curKey}/>\n`);
      } else if (typeof jObj[key] !== "object" || jObj[key] instanceof Date) {
        // Process primitive type

        // Check if it is an attribute
        const attr = this.isAttribute(key, level);
        const schemaAttr = this.schemaAttributeName(key, rule);
        if (attr) {
          let newVal = "" + jObj[key];
          newVal = this.replaceEntitiesValue(newVal);
          attrStr += ` ${attr}="${newVal}"`;
        } else if (schemaAttr) {
          let newVal = "" + jObj[key];
          newVal = this.replaceEntitiesValue(newVal);
          attrStr += ` ${schemaAttr}="${newVal}"`;
        } else {
          // Tag value
          valParts.push(this.buildTextValueNode(jObj[key], curKey, xsdType, level));
        }
      } else if (Array.isArray(jObj[key])) {
        // Repeated nodes
        if (this.isXMLList(jObj.$type, key)) {
          valParts.push(this.buildTextValueNode(
            jObj[key].join(" "),
            curKey,
            xsdType,
            level
          ));
        } else {
          const arrLen = jObj[key].length;
          for (let j = 0; j < arrLen; j++) {
            const item = jObj[key][j];
            if (typeof item === "undefined") {
              // Suppress undefined node
            } else if (item === null) {
              valParts.push(`${this.indentBy(level)}<${curKey}/>\n`);
            } else if (typeof item === "object") {
              valParts.push(this.processTextOrObjectNode(
                item,
                curKey,
                level,
                curMl,
                curType
              ));
            } else {
              valParts.push(this.buildTextValueNode(item, curKey, xsdType, level));
            }
          }
        }
      } else {
        // Nested node

        // Identify nodes corresponding to "single value + attributes" in xml
        const isAttributeGroup = jObj[key]["_"] !== undefined;
        if (isAttributeGroup) {
          let attr2 = "";
          for (const key2 of Object.keys(jObj[key])) {
            if (key2 === "_") {
              continue;
            }
            if (key2 === "$type") {
              attr2 += ` xsi:type="${jObj[key][key2].replace(".", ":")}"`;
            } else {
              attr2 += ` ${key2.charAt(0).toLowerCase() + key2.slice(1)}="${jObj[key][key2]
                }"`;
            }
          }
          valParts.push(this.buildTextValueNode(jObj[key]["_"], curKey, attr2, level));
        } else {
          // Process complex XML node (structure)
          valParts.push(this.processTextOrObjectNode(
            jObj[key],
            curKey,
            level,
            curMl,
            curType
          ));
        }
      }
    }
    return { attrStr: attrStr, val: valParts.join("") };
  }

  /**
   * Process an object or text node
   *
   * @private
   * @param {Record<string, unknown>} object
   * @param {string} key
   * @param {number} level
   * @param {string} prefix
   * @param {EmlDocument} xmlType
   * @returns {string}
   * @memberof XMLBuilder
   */
  private processTextOrObjectNode(
    object: Record<string, unknown>,
    key: string,
    level: number,
    prefix: string,
    xmlType: EmlDocument
  ): string {
    if (object["_exists"] === false) {
      return "";
    }
    const result = this.j2x(object, level + 1, prefix, xmlType);
    if (result.val === "") {
      return "";
    }
    return this.buildObjectNode(result.val, key, result.attrStr, level);
  }

  /**
   * Build an object node (complex type)
   *
   * @private
   * @param {string} value
   * @param {string} key
   * @param {string} attrStr
   * @param {number} level
   * @returns {string}
   * @memberof XMLBuilder
   */
  private buildObjectNode(
    value: string,
    key: string,
    attrStr: string,
    level: number
  ): string {
    if (attrStr && value.indexOf("<") === -1) {
      return `${this.indentBy(level)}<${key}${attrStr}>${value}
        </${key}>\n`;
    } else {
      return `${this.indentBy(
        level
      )}<${key}${attrStr}>\n${value}${this.indentBy(level)}</${key}>\n`;
    }
  }

  /**
   * Create a Date object from an XSD DateTime string
   *
   * @param xsdDateTimeString
   * @returns {Date}
   */
  private createDateFromXsdDateTime(xsdDateTimeString: string): Date {
    const dateTimeRegex =
      /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|[+-]\d{2}:\d{2})?/;
    const match = dateTimeRegex.exec(xsdDateTimeString);

    if (!match) {
      throw new Error("Invalid XSD DateTime format");
    }

    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // JavaScript months are 0-indexed
    const day = parseInt(match[3], 10);
    const hours = parseInt(match[4], 10);
    const minutes = parseInt(match[5], 10);
    const seconds = parseInt(match[6], 10);
    const milliseconds = match[7] ? parseInt(match[7], 10) : 0;
    const timezoneOffset = match[8];

    if (timezoneOffset === "Z") {
      // UTC time
      return new Date(
        Date.UTC(year, month, day, hours, minutes, seconds, milliseconds)
      );
    } else {
      // Timezone offset provided
      const offsetHours = parseInt(timezoneOffset.slice(1, 3), 10);
      const offsetMinutes = parseInt(timezoneOffset.slice(4), 10);
      const offsetMilliseconds = (offsetHours * 60 + offsetMinutes) * 60 * 1000;

      return new Date(
        Date.UTC(year, month, day, hours, minutes, seconds, milliseconds) +
        offsetMilliseconds
      );
    }
  }

  /**
   * Create an XML text node
   *
   * @private
   * @param {string} value of the node
   * @param {string} key name of the node
   * @param {string} attrStr attribute string of the node
   * @param {number} level of indentation
   * @returns {string}
   * @memberof XMLBuilder
   */
  private buildTextValueNode(
    value: string,
    key: string,
    attrStr: string,
    level: number
  ): string {
    if (
      attrStr === ' xsi:type="xsd:dateTime"' ||
      attrStr === ' xsi:type="eml20:TimeStamp"'
    ) {
      try {
        this.createDateFromXsdDateTime(value);
      } catch (e) {
        // Lenient fallback: accept any value that JavaScript's Date can parse
        // (e.g. ISO 8601 without sub-second precision). If neither the strict
        // XSD regex nor Date can parse the value, reject the request with a
        // 400 Bad Request instead of crashing with a 500 RangeError
        // (`new Date(value).toISOString()` throws "Invalid time value" for
        // unparseable inputs such as "", "0000-00-00", "not-a-date").
        const d = new Date(value);
        if (isNaN(d.getTime())) {
          const truncatedValue =
            value.length > MAX_INVALID_DATE_VALUE_LENGTH
              ? value.substring(0, MAX_INVALID_DATE_VALUE_LENGTH) + '...'
              : value;
          throw new BadRequestException({
            description:
              `Invalid date value for field '${key}': '${truncatedValue}'. ` +
              `Expected XSD dateTime format (e.g. 2024-01-01T00:00:00Z).`
          });
        }
        value = d.toISOString();
      }
    }
    const textValue = this.replaceEntitiesValue(value);

    return `${this.indentBy(level)}<${key}${attrStr}>${textValue}</${key}>\n`;
  }

  /**
   * Transform special characters into xml
   *
   * @private
   * @param {string} textValue
   * @returns {string}
   * @memberof XMLBuilder
   */
  private replaceEntitiesValue(textValue: string): string {
    const entities: { regex: RegExp; val: string }[] = [
      { regex: />/g, val: "&gt;" },
      { regex: /</g, val: "&lt;" },
      { regex: /'/g, val: "&apos;" },
      { regex: /"/g, val: "&quot;" }
    ];
    if (textValue && textValue.length > 0) {
      for (const entity of entities) {
        textValue = textValue.replace(entity.regex, entity.val);
      }
    }
    return textValue;
  }

  /**
   * Indent the XML line
   *
   * @private
   * @param {number} level of indentation
   * @returns {string}
   * @memberof XMLBuilder
   */
  private indentBy(level: number): string {
    return this.indentString.repeat(level);
  }

  /**
   * Check if a JSON field is an attribute
   *
   * @private
   * @param {string} name of the JSON field
   * @returns {string}
   * @memberof XMLBuilder
   */
  private isAttribute(name: string, level: number): string {
    if (name === "Uuid" && level === 1) {
      return "uuid";
    } else if (name === "ObjectVersion") {
      return "objectVersion";
    } else if (name === "SchemaVersion") {
      return "schemaVersion";
    } else if (name.startsWith(this.attributeNamePrefix)) {
      return name.slice(this.attributeNamePrefix.length);
    } else {
      return "";
    }
  }

  private schemaAttributeName(key: string, rule: any): string {
    if (!rule?.attributeTbl) {
      return "";
    }
    const lowerKey = key.charAt(0).toLowerCase() + key.slice(1);
    if (
      rule.attributeTbl["1:" + lowerKey] ||
      rule.attributeTbl["2:" + lowerKey]
    ) {
      return lowerKey;
    }
    return "";
  }

  /**
   * Check if a JSON field is an XML List
   *
   * @private
   * @param {string} type of the JSON Object containing the field
   * @param {string} key of the JSON field
   * @returns {boolean} true if the field derived from an XML List (xs:list)
   * @memberof XMLBuilder
   */
  private isXMLList(type: string | undefined, key: string): boolean {
    if (key !== "Values") {
      return false;
    }
    return (
      type === "eml23.FloatingPointXmlArray" ||
      type === "eml23.IntegerXmlArray" ||
      type === "eml23.StringXmlArray" ||
      type === "eml23.BooleanXmlArray"
    );
  }
}