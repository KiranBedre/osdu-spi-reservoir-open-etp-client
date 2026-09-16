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

import { Integer64 } from "../common/Etp12";

const typeOf = (schema: any) => {
  const s: string = typeof schema;
  if (s === "object") {
    if (schema) {
      return schema instanceof Array ? "union" : schema.type;
    } else {
      throw new Error(`Invalid schema type: ${s}`);
    }
  }
  switch (s) {
    case "object":
      return schema.type;
    case "string":
      return schema;
    case "array":
      return "union";
    default:
      throw new Error(`Invalid schema type: ${s}`);
  }
}; // typeOf

const keyName = (typeName: string): string => {
  return `_${typeName.split(".").pop()}`.replace("[]", "__array__");
};

/**
 * Read JS types from Avro buffer
 *
 * @export
 * @class BinaryReader
 */
export class BinaryReader {
  private buffer: Buffer;
  private idx: number;
  private readonly schemas: SchemaCache;

  /**
   * Creates an instance of BinaryReader.
   * @param {SchemaCache} schemas Avro schemas to use for serialization
   * @param {Buffer} buffer Avro buffer
   * @memberof BinaryReader
   */
  constructor(schemas: SchemaCache, buffer: Buffer) {
    this.idx = 0;
    this.schemas = schemas;
    this.buffer = buffer;
  }

  /**
   * From the buffer, read a datum corresponding to a schema
   *
   * @param {*} schema of the datum
   * @returns {*} value of the datum
   * @memberof BinaryReader
   */
  public readDatum(schema: unknown): any {
    return this.readDatumWithType(schema, typeOf(schema));
  }

  /**
   * From the buffer, read a datum corresponding to a schema
   *
   * @param {unknown} schema of the datum
   * @param {string} type of the datum schema
   * @returns {*} value of the datum
   * @memberof BinaryReader
   */
  public readDatumWithType(
    schema: unknown,
    type: string
  ):
    | number
    | string
    | boolean
    | bigint
    | null
    | unknown[]
    | Uint8Array
    | Map<string, unknown>
    | Record<string, unknown> {
    switch (type) {
      case "double":
        return this.readDouble();
      case "null":
        return null;
      case "boolean":
        return this.readBoolean();
      case "int":
        return this.readInt();
      case "long":
        return this.readInt64();
      case "float":
        return this.readFloat();
      case "bytes":
        return this.readBytes();
      case "string":
        return this.readString();
      case "enum":
        return this.readEnum();
      case "fixed":
        return this.readFixed(16);
      case "array":
        return this.readArray(schema as { items: unknown[] });
      case "record": {
        const recordResult: Record<string, unknown> = {};
        const sch = schema as { fields: Array<{ name: string; type: string }> };
        sch.fields.forEach(
          e => (recordResult[e.name] = this.readDatum(e.type))
        );
        return recordResult;
      }
      case "map": {
        const mapResult = new Map();
        const sch = schema as { values: unknown[] };
        let i = this.readMapStart();
        while (i !== 0) {
          while (i > 0) {
            mapResult.set(this.readString(), this.readDatum(sch.values));
            i--;
          }
          i = this.mapNext();
        }
        return mapResult;
      }
      case "union": {
        const idx = this.readInt();
        const sch = schema as any[];
        if (sch[idx] === "null") {
          return null;
        } else if (sch.length === 2 && sch[0] === "null" && idx === 1) {
          return this.readDatum(sch[1]);
        } else {
          const unionResult: Record<string, unknown> = {
            __keyName: keyName(sch[idx])
          };
          unionResult[keyName(sch[idx])] = this.readDatum(sch[idx]);
          return unionResult;
        }
      }
      default: {
        if (this.schemas.findSchema(type) === undefined) {
          throw new Error(`Unsupported schema type ${type}`);
        }
        return this.readDatum(this.schemas.findSchema(type));
      }
    }
  }

  private decode(schema: any, buffer: Buffer) {
    this.buffer = buffer;
    this.idx = 0;
    return this.readDatum(schema);
  }

  private readByte() {
    const buf = this.buffer[this.idx];
    this.idx++;
    return buf;
  }

  // Reads count for array and map
  private readCount() {
    let count = this.readInt();
    if (count < 0) {
      this.readInt();
      count = -count;
    }
    return count;
  }

  private readBoolean() {
    return this.readByte() === 1;
  }

  private readInt() {
    let n = 0;
    let k = 0;
    const buf = this.buffer;
    let b = 0;
    let h = 0;

    do {
      b = buf[this.idx++];
      h = b & 0x80;
      n |= (b & 0x7f) << k;
      k += 7;
    } while (h && k < 28);

    if (h) {
      // Switch to float arithmetic, otherwise we might overflow.
      let f = n;
      let fk = 268435456; // 2 ** 28.
      do {
        b = buf[this.idx++];
        f += (b & 0x7f) * fk;
        fk *= 128;
      } while (b & 0x80);
      return (f % 2 ? -(f + 1) : f) / 2;
    }

    return (n >> 1) ^ -(n & 1);
  }

  private readInt64(): Integer64 {
    let n = BigInt(0);
    let k = BigInt(0);
    const buf = this.buffer;
    let b = BigInt(0);
    let h = BigInt(0);

    do {
      b = BigInt(buf[this.idx++]);
      h = b & BigInt(0x80);
      n |= (b & BigInt(0x7f)) << k;
      k += BigInt(7);
    } while (h && k < 28);

    if (h) {
      // Switch to float arithmetic, otherwise we might overflow.
      let f = n;
      let fk = BigInt(268435456); // 2 ** 28.
      do {
        b = BigInt(buf[this.idx++]);
        f += (b & BigInt(0x7f)) * fk;
        fk *= BigInt(128);
      } while (b & BigInt(0x80));
      return (f % BigInt(2) ? -(f + BigInt(1)) : f) / BigInt(2);
    }

    return (n >> BigInt(1)) ^ -(n & BigInt(1));
  }

  private readFloat() {
    const result = this.buffer.readFloatLE(this.idx);
    this.idx += 4;
    return result;
  }

  private readDouble() {
    const result = this.buffer.readDoubleLE(this.idx);
    this.idx += 8;
    return result;
  }
  private readFixed(len: number) {
    const retVal = new Uint8Array(this.buffer.buffer, this.idx, len);
    this.idx += len;
    return retVal;
  }

  private readBytes() {
    const length = this.readInt();
    return this.readFixed(length);
  }
  private readString() {
    const len = this.readInt();
    const pos = this.idx;
    this.idx += len;
    return this.buffer.subarray(pos, pos + len).toString("utf-8");
  }
  private readEnum() {
    return this.readInt();
  }
  private readArrayStart() {
    return this.readCount();
  }
  private arrayNext() {
    return this.readCount();
  }
  private readMapStart() {
    return this.readCount();
  }
  private mapNext() {
    return this.readCount();
  }
  private readArray(schema: { items: unknown[] }): unknown[] {
    const itemsType = typeOf(schema.items);
    const result = [];
    const init = this.readArrayStart();
    if (init === undefined) {
      return [];
    }
    let i = init;
    while (i !== 0) {
      while (i-- > 0) {
        result.push(this.readDatumWithType(schema.items, itemsType));
      }
      i = this.arrayNext();
    }
    return result;
  }
}

/**
 * Write JS types to Avro
 * Created from https://github.com/apache/avro/blob/master/lang/js/lib/utils.js
 * @export
 * @class BinaryWriter
 */
export class BinaryWriter {
  private buffer: Buffer;
  private _index: number;
  private readonly schemas: any;
  // private dataView: DataView;

  /**
   * Creates an instance of BinaryWriter.
   * @param {SchemaCache} schemas Avro schemas to use for serialization
   * @param {Buffer} preallocated buffer
   * @memberof BinaryWriter
   */
  constructor(schemas: SchemaCache, buffer: Buffer | undefined) {
    this.buffer = buffer ?? Buffer.alloc(2048);
    this._index = 0;
    this.schemas = {};
    if (schemas !== undefined) {
      this.schemas = schemas;
    }
  }

  /**
   * Get the buffer containing the AVRO encoded information
   * ready to be sent
   *
   * @returns {Buffer}
   * @memberof BinaryWriter
   */
  public getBuffer(): Buffer {
    return this.buffer.subarray(0, this._index);
  }

  /**
   * Serialize a datum according to its schema and write it to buffer
   *
   * @param {unknown} schema Avro schema of the datum
   * @param {unknown} datum Datum to encode
   * @param {boolean} validate if datum needs to be validated against schema
   * @returns
   * @memberof BinaryWriter
   */
  public writeDatum(schema: unknown, datum: unknown, validate: boolean): void {
    if (validate) {
      this.schemas.validate(schema, datum);
    }
    const type = typeOf(schema);
    return this.writeDatumWithType(schema, type, datum, validate);
  }

  /**
   * Serialize a datum according to its schema and write it to buffer
   *
   * @param {*} schema Avro schema of the datum
   * @param {*} datum Datum to encode
   * @param {boolean} validate if datum needs to be validated against schema
   * @returns
   * @memberof BinaryWriter
   */
  public writeDatumWithType(
    schema: unknown,
    type: string,
    datum: unknown,
    validate: boolean
  ): void {
    if (validate) {
      this.schemas.validate(schema, datum);
    }
    switch (type) {
      // Primitive types
      case "null": {
        break;
      }
      case "boolean": {
        this.writeBoolean(datum as boolean);
        break;
      }
      case "int": {
        this.writeInt(datum as number);
        break;
      }
      case "long": {
        this.writeInt64(datum as bigint);
        break;
      }
      case "float": {
        this.writeFloat(datum as number);
        break;
      }
      case "double": {
        this.writeDouble(datum as number);
        break;
      }
      case "bytes": {
        this.writeBytes(Buffer.from(datum as any));
        return;
      }
      case "string": {
        this.writeString(datum as string);
        return;
      } // Complex types
      case "record": {
        const sch = schema as { fields: Array<{ name: string; type: string }> };
        const dat = datum as Record<string, unknown>;
        sch.fields.forEach(e => this.writeDatum(e.type, dat[e.name], false));
        return;
      }
      case "enum": {
        const sch = schema as { symbols: unknown[] };
        for (let i = 0; i < sch.symbols.length; i++) {
          if (sch.symbols[i] === datum) {
            this.writeInt(i);
            return;
          }
        }
        if (
          parseInt(datum as string, 10) >= 0 &&
          parseInt(datum as string, 10) < sch.symbols.length
        ) {
          this.writeInt(datum as number);
          return;
        }
        throw new Error(
          `Invalid enum value: ${datum} expecting: ${sch.symbols}`
        );
      }
      case "fixed": {
        if (datum) {
          const dat = datum as Array<number>;
          dat.forEach(e => this.writeByte(e));
        }
        return;
      }
      case "array": {
        const dat = datum as Array<number | bigint>;
        const sch = schema as { items: unknown[] };
        // Friendly for javascript null array === zero-length array
        if (dat && dat.length > 0) {
          this.writeInt(dat.length);
          const itemType = typeOf(sch.items);
          if (itemType === "boolean") {
            this.require(dat.length);
            for (const d of dat) {
              this.buffer[this._index] = d ? 1 : 0;
              this._index++;
            }
          } else if (itemType === "double") {
            this.require(dat.length * 8);
            if (dat instanceof Float64Array) {
              // Fast path: copy raw LE bytes directly (avoids per-element writeDoubleLE)
              Buffer.from(dat.buffer, dat.byteOffset, dat.byteLength).copy(this.buffer, this._index);
              this._index += dat.byteLength;
            } else {
              for (const d of dat) {
                this.buffer.writeDoubleLE(d as number, this._index);
                this._index += 8;
              }
            }
          } else if (itemType === "float") {
            this.require(dat.length * 4);
            if (dat instanceof Float32Array) {
              // Fast path: copy raw LE bytes directly (avoids per-element writeFloatLE)
              Buffer.from(dat.buffer, dat.byteOffset, dat.byteLength).copy(this.buffer, this._index);
              this._index += dat.byteLength;
            } else {
              for (const d of dat) {
                this.buffer.writeFloatLE(d as number, this._index);
                this._index += 4;
              }
            }
          } else if (itemType === "long") {
            this.require(dat.length * 8);
            for (const d of dat) {
              this.writeInt64(d as bigint);
            }
          } else if (itemType === "int") {
            this.require(dat.length * 4);
            for (const d of dat) {
              this.writeInt(d as number);
            }
          } else {
            for (const d of dat) {
              this.writeDatumWithType(sch.items, itemType, d, false);
            }
          }
        }
        this.writeInt(0);
        return;
      }
      case "map": {
        const dat = datum as Map<string, unknown>;
        const count = dat.size;
        const sch = schema as { values: any[] };
        if (count > 0) {
          this.writeInt(count);
          dat.forEach((value: unknown, key: string) => {
            this.writeString(key);
            this.writeDatum(sch.values, value, false);
          });
        }
        this.writeInt(0);
        break;
      }
      case "union": {
        const sch = schema as any[];
        const dat = datum as Record<string, unknown>;
        /// Special handling for nullable unions in ETP
        if (sch[0] === "null") {
          if (datum == null) {
            this.writeInt(0);
            return;
          } else if (
            sch.length === 2 &&
            !Object.prototype.hasOwnProperty.call(datum, sch[1])
          ) {
            this.writeInt(1);
            this.writeDatum(sch[1], datum, false);
            return;
          }
        }
        for (let i = 0; i < sch.length; i++) {
          if (
            datum &&
            Object.prototype.hasOwnProperty.call(datum, keyName(sch[i]))
          ) {
            this.writeInt(i);
            this.writeDatum(sch[i], dat[keyName(sch[i])], false);
            return;
          }
        }
        throw new Error(`Invalid value ${datum} for union: ${schema}`);
      }
      default: {
        if (this.schemas.findSchema(type) === undefined) {
          throw new Error(`Unsupported schema type ${type}`);
        }
        this.writeDatum(this.schemas.findSchema(type), datum, false);
      }
    }
  }

  private alloc(size: number) {
    this.buffer = Buffer.alloc(size);
  }

  private realloc(size: number) {
    const old = this.buffer;
    this.alloc(size * 1.6);
    this.buffer.set(old);
  }

  private require(bytes: number) {
    if (this.buffer.length < this._index + bytes) {
      this.realloc(this._index + bytes);
    }
  }

  private encode(schema: any, datum: any) {
    this._index = 0;
    this.writeDatum(schema, datum, true);
    return this.buffer.subarray(0, this._index);
  }

  private writeByte(b: number) {
    this.require(1);
    this.buffer[this._index] = b;
    this._index++;
  }

  private writeBoolean(value: boolean) {
    this.writeByte(value ? 1 : 0);
  }

  private writeInt(value: number) {
    this.require(4);
    if (value >= -1073741824 && value < 1073741824) {
      // Won't overflow, we can use integer arithmetic.
      let m = value >= 0 ? value << 1 : (~value << 1) | 1;
      do {
        this.buffer[this._index] = m & 0x7f;
        m >>= 7;
      } while (m && (this.buffer[this._index++] |= 0x80));
    } else {
      // We have to use slower floating arithmetic.
      let f = value >= 0 ? value * 2 : -value * 2 - 1;
      do {
        this.buffer[this._index] = f & 0x7f;
        f /= 128;
      } while (f >= 1 && (this.buffer[this._index++] |= 0x80));
    }
    this._index++;
  }

  private writeInt64(value: Integer64) {
    this.require(8);
    if (value >= BigInt(-1073741824) && value < BigInt(1073741824)) {
      // Won't overflow, we can use integer arithmetic.
      let m =
        value >= BigInt(0)
          ? value << BigInt(1)
          : (~value << BigInt(1)) | BigInt(1);
      do {
        this.buffer[this._index] = Number(m & BigInt(0x7f));
        m >>= BigInt(7);
      } while (m && (this.buffer[this._index++] |= 0x80));
    } else {
      // We have to use slower floating arithmetic.
      let f = value >= 0 ? value * BigInt(2) : -value * BigInt(2) - BigInt(1);
      do {
        this.buffer[this._index] = Number(f & BigInt(0x7f));
        f /= BigInt(128);
      } while (f >= 1 && (this.buffer[this._index++] |= 0x80));
    }
    this._index++;
  }

  private writeFloat(f: number) {
    this.require(4);
    this.buffer.writeFloatLE(f, this._index);
    this._index += 4;
  }

  private writeDouble(value: number) {
    this.require(8);
    this.buffer.writeDoubleLE(value, this._index);
    this._index += 8;
  }

  private writeBytes(bytes: Buffer) {
    this.writeInt(bytes.length);
    this.require(bytes.length);
    bytes.copy(this.buffer, this._index);
    this._index += bytes.length;
  }

  private writeString(str: string) {
    if (!str || str.length === 0) {
      this.writeInt(0);
      return;
    }
    // default encoding is utf-8
    this.writeBytes(Buffer.from(str));
  }

  private writeIndex(idx: number) {
    this.writeInt(idx);
  }

  private writeMapStart() {
    // To Be Implemented
  }
  private writeMapEnd() {
    // To Be Implemented
  }
}
export class SchemaCache {
  private protocolToSchemas = new Map<string, string>();
  private schemas = new Map<string, any>();
  /**
   * Creates an instance of SchemaCache.
   * @param {any[]} schemaArray schema to store the content from
   * @memberof SchemaCache
   */
  constructor(schemaArray: any[]) {
    schemaArray.forEach(e => this.store(e));
  }

  /**
   * Validate a datum against its schema
   *
   * @param {unknown} schema
   * @param {unknown} datum
   * @returns
   * @memberof SchemaCache
   */
  public validate(schema: unknown, datum: unknown): boolean {
    const type = typeOf(schema);
    return this.validateWithType(schema, type, datum);
  }

  /**
   * Validate a datum against its schema
   *
   * @param {unknown} schema
   * @param {string} type
   * @param {unknown} datum
   * @return {boolean}
   * @memberof SchemaCache
   */
  public validateWithType(
    schema: unknown,
    type: string,
    datum: unknown
  ): boolean {
    switch (type) {
      // Primitive types
      case "null": {
        if (datum !== null) {
          throw new Error(`Invalid null value: ${datum}`);
        }
        return true;
      }
      case "boolean": {
        if (typeof datum !== "boolean") {
          throw new Error(`Invalid boolean value: ${datum}`);
        }
        return true;
      }
      case "int": {
        if (typeof datum !== "number") {
          throw new Error(`Invalid integer value: ${datum}`);
        }
        break;
      }
      case "long": {
        if (typeof datum !== "bigint") {
          throw new Error(`Invalid bigint value: ${datum}`);
        }
        break;
      }
      case "float":
      case "double": {
        if (typeof datum !== "number" || isNaN(datum)) {
          // or isNan
          throw new Error(`Invalid floating value: ${datum}`);
        }
        break;
      }
      case "bytes":
        // check that datum is a buffer
        if (!Buffer.isBuffer(datum)) {
          throw new Error(`Invalid bytes value: ${datum}`);
        }
        break;
      case "string": {
        if (typeof datum !== "string") {
          throw new Error(`Invalid string value: ${datum}`);
        }
        return true;
      }
      // Complex types
      case "record": {
        if (!schema) {
          throw new Error(`Invalid schema use for validating ${datum}`);
        }
        const sch = schema as { fields: Array<{ name: string; type: string }> };
        const dat = datum as Record<string, unknown>;
        sch.fields.forEach((e: any) => this.validate(e.type, dat[e.name]));
        return true;
      }
      case "enum": {
        if (!schema) {
          throw new Error(`Invalid schema use for validating ${datum}`);
        }
        const sch = schema as { symbols: any[] };
        if ((datum as number) >= sch.symbols.length) {
          throw new Error(
            `Invalid enum value: ${datum} expecting an integer less than ${sch.symbols.length}`
          );
        }
        return true;
      }
      case "fixed": {
        return true;
      }
      case "array": {
        if (!schema) {
          throw new Error(`Invalid schema use for validating ${datum}`);
        }
        const dat = datum as Array<unknown>;
        const sch = schema as { items: any[] };
        if (dat.length > 0) {
          dat.forEach((e: any) => this.validate(sch.items, e));
        }
        return true;
      }
      case "map": {
        const dat = datum as Map<string, unknown>;
        const sch = schema as { values: any[] };
        let count = 0;
        for (const thisVar in dat) {
          if (Object.prototype.hasOwnProperty.call(datum, thisVar)) {
            ++count;
          }
        }
        if (count > 0) {
          for (const k in dat) {
            this.validate(sch.values, k);
          }
        }
        break;
      }
      case "union": {
        const sch = schema as Record<string, unknown>;
        if (
          Object.values(sch).find(e => {
            // Go through each individual type to see if one validate
            const t = e as string;
            let ok = true;
            try {
              this.validateWithType(this.findSchema(t), t, datum);
            } catch {
              ok = false;
            }
            return ok;
          })
        ) {
          return true;
        }
        throw new Error(`Invalid value ${datum} for union: ${schema}`);
      }
      default: {
        if (this.findSchema(type) === undefined) {
          throw new Error(`Unsupported schema type ${type}`);
        }
        this.validate(this.findSchema(type), datum);
      }
    }
    return true;
  }

  public schemaName(protocol: number, messageType: number): string | undefined {
    return this.protocolToSchemas.get(`${protocol}.${messageType}`);
  }

  public findSchema(fullName: string): any | undefined {
    return this.schemas.get(fullName);
  }

  private importSchemas() {
    // TODO
  }

  private store(schema: any) {
    const fullName = schema.namespace
      ? `${schema.namespace}.${schema.name}`
      : schema.name;
    if (fullName !== undefined) {
      this.protocolToSchemas.set(
        `${schema.protocol}.${schema.messageType}`,
        fullName
      );
      this.schemas.set(fullName, schema);
      if (schema.fields !== undefined) {
        schema.fields.forEach((e: any) => this.store(e.type));
      }
    }
  }
}
