exports.format = (schema, keyType, valueType) => {
    const typeName = `${keyType.split(" ").join("_")}__${valueType.split(" ").join("_")}__MapEntry`;
    return `DROP TYPE IF EXISTS "${schema}".${typeName};
    CREATE TYPE "${schema}".${typeName} AS (
        key       ${keyType},
        value    ${valueType}
    );`;
};


