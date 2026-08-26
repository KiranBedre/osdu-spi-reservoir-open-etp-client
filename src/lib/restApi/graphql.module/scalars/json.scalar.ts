import { GraphQLScalarType, Kind } from "graphql";

/**
 * Opaque JSON scalar - passes through any JSON value without schema validation.
 * Used for EML/RESQML/WITSML object bodies where the shape is domain-specific
 * and varies per object type. Avoids serialization overhead: the value is passed
 * by reference through the resolver chain (no deep copy).
 */
const GraphQLJSON = new GraphQLScalarType({
    name: "JSON",
    description: "Arbitrary JSON value (object, array, string, number, boolean, null)",
    serialize(value: unknown) {
        return value;
    },
    parseValue(value: unknown) {
        return value;
    },
    parseLiteral(ast) {
        switch (ast.kind) {
            case Kind.STRING:
                return ast.value;
            case Kind.BOOLEAN:
                return ast.value;
            case Kind.INT:
                return parseInt(ast.value, 10);
            case Kind.FLOAT:
                return parseFloat(ast.value);
            case Kind.OBJECT:
                return parseObject(ast);
            case Kind.LIST:
                return ast.values.map(parseLiteralValue);
            case Kind.NULL:
                return null;
            default:
                return undefined;
        }
    }
});

function parseLiteralValue(ast: any): unknown {
    switch (ast.kind) {
        case Kind.STRING:
            return ast.value;
        case Kind.BOOLEAN:
            return ast.value;
        case Kind.INT:
            return parseInt(ast.value, 10);
        case Kind.FLOAT:
            return parseFloat(ast.value);
        case Kind.OBJECT:
            return parseObject(ast);
        case Kind.LIST:
            return ast.values.map(parseLiteralValue);
        case Kind.NULL:
            return null;
        default:
            return undefined;
    }
}

function parseObject(ast: any): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const field of ast.fields) {
        obj[field.name.value] = parseLiteralValue(field.value);
    }
    return obj;
}

export default GraphQLJSON;
