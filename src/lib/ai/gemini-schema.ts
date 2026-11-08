import { type Schema, Type } from "@google/genai";

/**
 * Convierte el subconjunto de JSON Schema que usa la aplicación (objetos, arrays, enums,
 * tipos anulables con `type: [x, "null"]` o `anyOf: [x, {type: "null"}]`) al formato
 * `Schema` de Gemini (subconjunto de OpenAPI 3.0 con `nullable`), que es el formato de
 * herramientas y salidas estructuradas más probado en todos los modelos Gemini.
 *
 * Se ignoran las palabras clave sin equivalente (`additionalProperties`, `$schema`, `strict`):
 * de todos modos la aplicación vuelve a validar cada dato en el servidor.
 */
type JsonSchema = Record<string, unknown>;

const TYPE_MAP: Record<string, Type> = {
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY,
  object: Type.OBJECT,
};

export interface GeminiSchemaOptions {
  /** Agrega propertyOrdering (útil en salidas estructuradas: Gemini genera los campos en ese orden). */
  ordering?: boolean;
}

export function toGeminiSchema(input: unknown, opts: GeminiSchemaOptions = {}): Schema {
  const schema = (input ?? {}) as JsonSchema;
  const description = typeof schema.description === "string" ? schema.description : undefined;

  // anyOf: [X, {type: "null"}] -> X con nullable
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const options = ((schema.anyOf ?? schema.oneOf) as JsonSchema[]).filter(Boolean);
    const nonNull = options.filter((o) => o.type !== "null");
    const hasNull = nonNull.length !== options.length;
    if (nonNull.length === 1) {
      const inner = toGeminiSchema(nonNull[0], opts);
      return withDescription({ ...inner, ...(hasNull ? { nullable: true } : {}) }, description ?? inner.description);
    }
    return withDescription(
      { anyOf: nonNull.map((o) => toGeminiSchema(o, opts)), ...(hasNull ? { nullable: true } : {}) },
      description,
    );
  }

  // type: ["string", "null"] -> STRING con nullable
  let rawType = schema.type;
  let nullable = false;
  if (Array.isArray(rawType)) {
    const types = rawType.filter((t) => t !== "null");
    nullable = types.length !== rawType.length;
    if (types.length !== 1) throw new Error(`Gemini no admite uniones de tipos: ${JSON.stringify(schema.type)}`);
    rawType = types[0];
  }
  // En un enum anulable, el null se expresa con nullable (Gemini solo admite enums de texto).
  let enumValues: string[] | undefined;
  if (Array.isArray(schema.enum)) {
    if (schema.enum.includes(null)) nullable = true;
    enumValues = schema.enum.filter((v) => v !== null).map(String);
    if (rawType === undefined) rawType = "string";
  }
  if (typeof schema.const === "string") {
    enumValues = [schema.const];
    rawType = "string";
  }

  const type = typeof rawType === "string" ? TYPE_MAP[rawType] : undefined;
  if (!type) throw new Error(`Tipo de esquema no admitido para Gemini: ${JSON.stringify(schema.type)}`);

  const out: Schema = { type };
  if (nullable) out.nullable = true;
  if (enumValues) {
    out.enum = enumValues;
    out.format = "enum";
  }
  if (type === Type.ARRAY) out.items = toGeminiSchema(schema.items ?? { type: "string" }, opts);
  if (type === Type.OBJECT) {
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    const keys = Object.keys(props);
    out.properties = Object.fromEntries(keys.map((k) => [k, toGeminiSchema(props[k], opts)]));
    if (opts.ordering && keys.length) out.propertyOrdering = keys;
    if (Array.isArray(schema.required) && schema.required.length) out.required = schema.required.map(String);
  }
  if (typeof schema.minimum === "number") out.minimum = schema.minimum;
  if (typeof schema.maximum === "number") out.maximum = schema.maximum;
  return withDescription(out, description);
}

function withDescription(schema: Schema, description: string | undefined): Schema {
  return description ? { ...schema, description } : schema;
}
