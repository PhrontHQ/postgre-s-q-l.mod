
//var AWSRawDataService = require("./aws/a-w-s-raw-data-service").AWSRawDataService,
var RawDataService = require("montage/data/service/raw-data-service").RawDataService,

    Criteria = require("montage/core/criteria").Criteria,
    ObjectDescriptor = require("montage/core/meta/object-descriptor").ObjectDescriptor,
    RawEmbeddedValueToObjectConverter = require("montage/data/converter/raw-embedded-value-to-object-converter").RawEmbeddedValueToObjectConverter,
    KeyValueArrayToMapConverter = require("montage/core/converter/key-value-array-to-map-converter").KeyValueArrayToMapConverter,
    Range = require("montage/core/range").Range,
    WktToGeometryConverter = require("montage-geo/logic/converter/wkt-to-geometry-converter").WktToGeometryConverter,
    // DataQuery = (require)("montage/data/model/data-query").DataQuery,
    // DataStream = (require)("montage/data/service/data-stream").DataStream,
    //Montage = (require)("montage/core/core").Montage,
    Promise = require("montage/core/promise").Promise,
    uuid = require("montage/core/uuid"),
    //DataOrdering = (require)("montage/data/model/data-ordering").DataOrdering,
    //DESCENDING = DataOrdering.DESCENDING,
    Enum = require("montage/core/enum").Enum,
    Set = require("montage/core/collections/set"),
    ObjectDescriptor = require("montage/core/meta/object-descriptor").ObjectDescriptor,
    PropertyDescriptor = require("montage/core/meta/property-descriptor").PropertyDescriptor,
    SQLJoinStatements = require("./s-q-l-join-statements").SQLJoinStatements,
    SyntaxInOrderIterator = require("montage/core/frb/syntax-iterator").SyntaxInOrderIterator,


    DataOperation = require("montage/data/service/data-operation").DataOperation,
    DataOperationErrorNames = require("montage/data/service/data-operation").DataOperationErrorNames,
    DataOperationType = require("montage/data/service/data-operation").DataOperationType,
    //PGClass = (require)("../model/p-g-class").PGClass,

    fromIni,
    RDSDataClient,
    BatchExecuteStatementCommand,
    BeginTransactionCommand,
    CommitTransactionCommand,
    ExecuteStatementCommand,
    RollbackTransactionCommand,

    pgutils = require('./pg-utils'),
    prepareValue = pgutils.prepareValue,
    escapeIdentifier = pgutils.escapeIdentifier,
    escapeLiteral = pgutils.escapeLiteral,
    literal = pgutils.literal,
    escapeString = pgutils.escapeString,
    pgstringify = require('./pgstringify'),
    parse = require("montage/core/frb/parse"),
    path = require("path"),
    fs = require('fs'),
    Timer = require("montage/core/timer").Timer,
    SecretObjectDescriptor = require("../model/aws/secret.mjson").montageObject,
    PostgreSQLClient,
    PostgreSQLClientPool,
    ReadWritePostgreSQLClientPool,
    ReadOnlyPostgreSQLClientPool,
    PostgreSQLService,
    ProcessEnv = process.env;



// assume a role using the sourceCreds
// async function assume(sourceCreds, params) {
//     console.log("assume:",sourceCreds, params);
// 	const sts = new STS({credentials: sourceCreds});
// 	const result = await sts.assumeRole(params);
// 	if(!result.Credentials) {
// 		throw new Error("unable to assume credentials - empty credential object");
// 	}
//     console.log("accessKeyId:"+String(result.Credentials.AccessKeyId));
//     console.log("secretAccessKey:"+String(result.Credentials.SecretAccessKey));
//     console.log("sessionToken:"+String(result.Credentials.SessionToken));

// 	return {
// 		accessKeyId: String(result.Credentials.AccessKeyId),
// 		secretAccessKey: String(result.Credentials.SecretAccessKey),
// 		sessionToken: result.Credentials.SessionToken
// 	};
// }

/*
    var params = {
      resourceArn: "arn:aws:rds:us-west-2:537014313177:cluster:storephront-database", // required
      secretArn: "arn:aws:secretsmanager:us-west-2:537014313177:secret:storephront-database-postgres-user-access-QU2fSB", // required
      sql: "select * from phront.\"Collection\"", // required
      continueAfterTimeout: false,
      database: 'postgres',
      includeResultMetadata: true,
      schema: 'phront'
    };

    rdsdataservice.executeStatement(params, function(err, data) {
      if (err) {
          console.log(err, err.stack); // an error occurred
      }
      else {
      }    console.log(data);           // successful response
    });
*/

var createPrimaryKayColumnTemplate = ``;


var createTableTemplatePrefix = `CREATE TABLE :schema.":table"
    (
      id uuid NOT NULL DEFAULT phront.gen_random_uuid(),
      CONSTRAINT ":table_pkey" PRIMARY KEY (id)

      `,
    createTableColumnTextTemplate = `      :column :type COLLATE pg_catalog."default",`,
    createTableColumnTemplate = `      :column :type,`,


    createTableTemplateSuffix = `
    )
    WITH (
        OIDS = FALSE
    )
    TABLESPACE pg_default;

    ALTER TABLE :schema.":table"
        OWNER to :owner;
    `;





/**
* TODO: Document
*
* @class
* @extends RawDataService
*/
exports.PostgreSQLService = PostgreSQLService = RawDataService.specialize(/** @lends PostgreSQLService.prototype */ {

    /***************************************************************************
     * Initializing
     */

    constructor: {
        value: function PostgreSQLService() {
            //"use strict";

            this.super();


            if(this._mapResponseHandlerByOperationType.size === 0) {
                this._mapResponseHandlerByOperationType.set(DataOperationType.create, this.mapHandledCreateResponseToOperation);
                this._mapResponseHandlerByOperationType.set(DataOperationType.read, this.mapHandledReadResponseToOperation);
                this._mapResponseHandlerByOperationType.set(DataOperationType.update, this.mapHandledUpdateResponseToOperation);
                this._mapResponseHandlerByOperationType.set(DataOperationType.delete, this.mapHandledDeleteResponseToOperation);
            }

            this._columnNamesByObjectDescriptor = new Map();
            this._rawDataDescriptorByObjectDescriptor = new Map();

            /*
                Shifted from listening to mainService to getting events on ourselve,
                as we should be in the line of propagation for the types we handle.

                There are going to be bugs if 2 RawDataServices handle the same type based on current implementaion, and that needs to be fixed.

                Either each needs to observe each types, kinda kills event delegation optimization, so we need to implement an alterative to Target.nextTarget to be able to either return an array, meaning that it could end up bifurcating, or we add an alternative called composedPath (DOM method name on Event), propagationPath (better) or targetPropagationPath, or nextTargetPath, that includes eveything till the top.
            */
            // this.addEventListener(DataOperation.Type.ReadOperation,this,false);
            // this.addEventListener(DataOperation.Type.UpdateOperation,this,false);
            // this.addEventListener(DataOperation.Type.CreateOperation,this,false);
            // this.addEventListener(DataOperation.Type.DeleteOperation,this,false);
            // this.addEventListener(DataOperation.Type.PerformTransactionOperation,this,false);
            // this.addEventListener(DataOperation.Type.CreateTransactionOperation,this,false);
            // this.addEventListener(DataOperation.Type.AppendTransactionOperation,this,false);
            // this.addEventListener(DataOperation.Type.CommitTransactionOperation,this,false);
            // this.addEventListener(DataOperation.Type.RollbackTransactionOperation,this,false);

            /*
                Kickstart loading dependencies as we always need this data service:
                The Promise.all() returned is cached, so it doesn't matter wether it's done or not
                by the time the worker's function handles the message
            */
            //this.rawClientPromises;


            // this._registeredConnectionsByIdentifier = new Map();
        }
    },

    usePerformTransaction: {
        value: true
    },

    useDataAPI: {
        value: false
    },

    // _useDataAPI: {
    //     value: undefined
    // },

    /*
        for now the decsion is to have the endpoints property in the connection info for an environment.
    */
    // useDataAPI: {
    //     get: function() {
    //         return this._useDataAPI !== undefined
    //             ? this._useDataAPI
    //             : (this._useDataAPI = this.connection.hasOwnProperty("endpoints"));
    //     }
    // },

    supportsTransaction: {
        value: true
    },

    addMainServiceEventListeners: {
        value: function() {
            this.super();
            this.mainService.addEventListener(DataOperation.Type.PerformTransactionOperation, this, false);
            this.mainService.addEventListener(DataOperation.Type.CreateTransactionOperation, this, false);
            this.mainService.addEventListener(DataOperation.Type.AppendTransactionOperation,this,false);
            this.mainService.addEventListener(DataOperation.Type.CommitTransactionOperation,this,false);
            this.mainService.addEventListener(DataOperation.Type.RollbackTransactionOperation,this,false);

        }

    },

    apiVersion: {
        value: "2018-08-01"
    },

    /***************************************************************************
     * Serialization
     */

    deserializeSelf: {
        value:function (deserializer) {
            this.super(deserializer);

            var value = deserializer.getProperty("clientPool");
            if (value) {
                this.clientPool = value;
            }

        }
    },


     //We need a mapping to go from model(schema?)/ObjectDescriptor to schema/table
     mapOperationToRawOperationConnection: {
        value: function (operation, rawDataOperation) {
            //Use the stage from the operation:
            //Object.assign(rawDataOperation,this.connectionForIdentifier(operation.context.requestContext.stage));
            Object.assign(rawDataOperation,this.connection);

            return rawDataOperation;
        }
    },

    // databaseClusterAuthorization: {
    //     value: {
    //         resourceArn: "arn:aws:rds:us-west-2:537014313177:cluster:storephront-database", /* required */
    //         secretArn: "arn:aws:secretsmanager:us-west-2:537014313177:secret:storephront-database-postgres-user-access-QU2fSB" /* required */
    //     }
    // },

    // __databaseAuthorizationBySchema: {
    //     value: undefined
    // },

    // _databaseAuthorizationBySchema: {
    //     get: function () {
    //         if (!this.__databaseAuthorizationBySchema) {
    //             this.__databaseAuthorizationBySchema = new Map();
    //         }
    //         return this.__databaseAuthorizationBySchema;
    //     }
    // },

    // _databaseAuthorizationsForSchema: {
    //     value: function (schemaName) {
    //         var dbAuthorizations = this._databaseAuthorizationBySchema.get(schemaName);
    //         if (!dbAuthorizations) {
    //             this._databaseAuthorizationBySchema.set(schemaName, dbAuthorizations = new Map());
    //         }
    //         return dbAuthorizations;
    //     }
    // },

    // authorizationForDatabaseInSchema: {
    //     value: function (databaseName, schemaName) {
    //         var schemaDBAuthorizations = this._databaseAuthorizationsForSchema(schemaName);
    //         var dbAuthorization = schemaDBAuthorizations.get(databaseName);

    //         if (!dbAuthorization) {
    //             var databaseClusterAuthorization = this.databaseClusterAuthorization;
    //             dbAuthorization = {};
    //             for (var key in databaseClusterAuthorization) {
    //                 dbAuthorization[key] = databaseClusterAuthorization[key];
    //             }
    //             dbAuthorization.database = databaseName;
    //             dbAuthorization.schema = schemaName;
    //             schemaDBAuthorizations.set(databaseName, dbAuthorization);
    //         }
    //         return dbAuthorization;
    //     }
    // },

    // rawDataOperationForDatabaseSchema: {
    //     value: function (databaseName, schemaName) {
    //         var rawDataOperation = {},
    //             dbAuthorization = this.authorizationForDatabaseInSchema(databaseName, schemaName);

    //         for (var key in dbAuthorization) {
    //             rawDataOperation[key] = dbAuthorization[key];
    //         }

    //         return rawDataOperation;
    //     }
    // },



    instantiateAWSClientWithOptions: {
        value: function (awsClientOptions) {
            if(this.useDataAPI) {
                return new RDSDataClient(awsClientOptions);
            } else {

            }
        }
    },

    /*
        {
            "name":"databaseName",
            "value": {
                "username":"aUsername",
                "password":"aUsernamePassword",
                "engine":"postgres",
                "host":"hostName",
                "port":1234,
                "dbClusterIdentifier":"dbClusterIdentifierName"
            }
        }
    */
    databaseCredentials: {
        value: null
    },

    /*
        From: https://node-postgres.com/features/connecting

        An alternative to loading the credentials ourselves using our DataService is to use the capability from pg and RDS.signer:

        const signerOptions = {
            credentials: {
                accessKeyId: 'YOUR-ACCESS-KEY',
                secretAccessKey: 'YOUR-SECRET-ACCESS-KEY',
            },
            region: 'us-east-1',
            hostname: 'example.aslfdewrlk.us-east-1.rds.amazonaws.com',
            port: 5432,
            username: 'api-user'
        }
        const signer = new RDS.Signer()
        const getPassword = () => signer.getAuthToken(signerOptions)
        const pool = new Pool({
            host: signerOptions.hostname,
            port: signerOptions.port,
            user: signerOptions.username,
            database: 'my-db',
            password: getPassword
        })

    */

        postgreSQLClientPoolWillResolveRawClientPromises: {
        value: function (clientPool, promises) {
            promises.push(new Promise( (resolve, reject) => {

                //TODO later: replace this with a proper DataService fetchData()
                var readOperation = new DataOperation();
                readOperation.type = DataOperation.Type.ReadOperation;
                readOperation.target = SecretObjectDescriptor;
                readOperation.criteria = new Criteria().initWithExpression("name == $.name", {
                    name: `${!!this.connection.environment ? `${this.connection.environment}-` : ''}${this.currentEnvironment.stage}-${this.connection.database}-database`
                });

                SecretObjectDescriptor.addEventListener(DataOperation.Type.ReadCompletedOperation, (readCompletedOperation) => {
                    readCompletedOperation.stopImmediatePropagation();

                     /*
                        TODO: clean up who gets to know / holds databaseCredentials. It sounds that like now belongs on the client side.
                     */
                    const databaseCredentials = readCompletedOperation.data[0];
                    if(this.clientPool) {
                        this.clientPool.databaseCredentials = databaseCredentials;
                    }
                    resolve((this.databaseCredentials = databaseCredentials));
                }, {
                    capture: true,
                    once: true
                });

                SecretObjectDescriptor.addEventListener(DataOperation.Type.ReadFailedOperation, function(readFailedOperation) {
                    readFailedOperation.stopImmediatePropagation();
                    reject(readFailedOperation.data);
                }, {
                    capture: true,
                    once: true
                });

                SecretObjectDescriptor.dispatchEvent(readOperation);

            }));

        }
    },

    rawClientPromises: {
        get: function () {
            var promises = this.super();

            // promises.push(
            //     require.async("pg").then(function(exports) {
            //         PostgreSQLClient = exports.Client;
            //         PostgreSQLClientPool = exports.Pool;
            //     })
            // );
            promises.push(
                ...this.clientPool.rawClientPromises
            );

            return promises;
        }
    },

    _rawClientPromise: {
        value: undefined
    },

    rawClientPromise: {
        get: function () {
            if (!this._rawClientPromise) {
                this._rawClientPromise = Promise.all(this.rawClientPromises).then(() => { return this.rawClient;});
            }
            return this._rawClientPromise;
        }
    },

    _rawClient: {
        value: undefined
    },
    rawClient: {
        get: function () {
            return this._rawClient;
        }
    },


    _connection: {
        value: undefined
    },

    connection: {
        get: function() {
            if(!this._connection) {

                /*
                    Adding a bit of logic since apparently an RDS Proxy must be in the same VPC as the database and although the database can be publicly accessible, the proxy can’t be.

                    So in working locally we need to address the database cluster directly.

                    -> https://www.stackovercloud.com/2020/06/30/amazon-rds-proxy-now-generally-available/
                */
                if(!this.currentEnvironment.isAWS) {
                    this.connection = this.connectionForIdentifier(`local-${this.currentEnvironment.stage}`);
                } else {
                    this.connection = this.connectionForIdentifier(this.currentEnvironment.stage);
                }
            }
            return this._connection;
        },
        set: function(value) {

            if(value !== this._connection) {
                this._connection = value;

                if(value) {

                    /*
                        Temporary workaround, the responsibilities need to be clarified and cleanup further.
                    */

                    if(value.clientPool) {
                        this.clientPool = value.clientPool;
                        this.clientPool.connection = value;
                    }

                    var region = value.resourceArn
                    ? value.resourceArn.split(":")[3]
                    : value.endPoint
                        ? value.endpoint.split(".")[2]
                        : null,
                    profile, owner,
                    RDSDataServiceOptions =  {
                        apiVersion: '2018-08-01',
                        region: region
                    };

                    if((profile = value.profile)) {
                        delete value.profile;
                        Object.defineProperty(value,"profile",{
                            value: profile,
                            enumerable: false,
                            configurable: true,
                            writable: true
                        });
                    }

                    if((owner = value.owner)) {
                        delete value.owner;
                        Object.defineProperty(value,"owner",{
                            value: owner,
                            enumerable: false,
                            configurable: true,
                            writable: true
                        });
                    }
                }

            }

        }
    },


    /*
        _googleDataService: {
            value: undefined
        },

        googleDataService: {
            get: function() {
                if(!this._googleDataService) {
                    this._googleDataService = this.childServices.values().next().value;
                }
                return this._googleDataService;
            }
        },
    */
    // fetchData: {
    //     value: function (query, stream) {
    //         var self = this,
    //             objectDescriptor = this.objectDescriptorForType(query.type),
    //             readOperation = new DataOperation();

    //         stream = stream || new DataStream();
    //         stream.query = query;

    //         //We need to turn this into a Read Operation. Difficulty is to turn the query's criteria into
    //         //one that doesn't rely on objects. What we need to do before handing an operation over to another context
    //         //bieng a worker on the client side or a worker on the server side, is to remove references to live objects.
    //         //One way to do this is to replace every object in a criteria's parameters by it's data identifier.
    //         //Another is to serialize the criteria.
    //         readOperation.type = DataOperation.Type.ReadOperation;
    //         readOperation.target = objectDescriptor;
    //         readOperation.criteria = query.criteria;
    //         readOperation.data = query.readExpressions;

    //         //Where do we put the "select part" ? The list of properties, default + specific ones asked by developer and
    //         //eventually collected by the framework through triggers?
    //         // - readExpressions is a list like that on the query object.
    //         // - selectBindings s another.


    //         // return new Promise(function(resolve,reject) {

    //         self.handleReadOperation(readOperation)
    //             .then(function (readUpdatedOperation) {
    //                 var records = readUpdatedOperation.data;

    //                 if (records && records.length > 0) {

    //                     //We pass the map key->index as context so we can leverage it to do record[index] to find key's values as returned by RDS Data API
    //                     self.addRawData(stream, records, readOperation._rawReadExpressionIndexMap);
    //                 }

    //                 self.rawDataDone(stream);

    //             }, function (readFailedOperation) {
    //                 console.error(readFailedOperation);
    //                 self.rawDataDone(stream);

    //             });
    //         // });

    //         return stream;
    //     }
    // },

    inlineCriteriaParameters: {
        value: true
    },

    /*
        https://www.postgresql.org/docs/10/queries-order.html
        SELECT select_list
            FROM table_expression
            ORDER BY sort_expression1 [ASC | DESC] [NULLS { FIRST | LAST }]
                    [, sort_expression2 [ASC | DESC] [NULLS { FIRST | LAST }] ...]
    */
    mapOrderingsToRawOrderings: {
        value: function (orderings, mapping) {
            throw new Error("mapOrderingsToRawOrderings is not implemented");
        }
    },
    /*
        as we move into being able to handle the traversal of relationships, we'll need to map that to joins,
        which means that mapping the criteria will have to introduce new tables, most likely with aliases, into the FROM section
        which is still handled outside of this, but it has to unified so we can dynamically add the tables/attributes we need to join

        we might need to rename the method, or create a larger scope one, such as:
        mapDataQueryToRawDataQuery

    */

    mapCriteriaToRawCriteria: {
        value: function (criteria, mapping, locales, rawExpressionJoinStatements) {
            var rawCriteria,
                rawExpression,
                rawParameters;

            if (!criteria) return undefined;

            if (criteria.parameters) {
                if (this.inlineCriteriaParameters) {
                    rawParameters = criteria.parameters;
                } else {
                    //If we could use parameters with the DataAPI (we can't because it doesn't support some types we need like uuid and uuid[]), we would need stringify to create a new set of parameters. Scope can be different objects, so instead of trying to clone whatever it is, it would be easier to modify stringify so it returns the whole new raw criteria that would contain both the expression and the new parameters bound for SQL.
                    // rawParameters = {};
                    // Object.assign(rawParameters,criteria.parameters);
                    throw new Error("phron-service.js: mapCriteriaToRawCriteria doesn't handle the use of parametrized SQL query with a dictionary of parameters. If we could use parameters with the DataAPI (we can't because it doesn't support some types we need like uuid and uuid[]), we would need stringify to create a new set of parameters. Scope can be different objects, so instead of trying to clone whatever it is, it would be easier to modify stringify so it returns the whole new raw criteria that would contain both the expression and the new parameters bound for SQL. -> " + JSON.stringify(criteria) + "objectDescriptor: " + mapping.objectDescriptor.name);

                }

            }

            //console.debug("stringify: "+criteria.expression);
            rawExpression = this.stringify(criteria.syntax, rawParameters, [mapping], locales, rawExpressionJoinStatements);
            //console.log("rawExpression: ",rawExpression);
            if(rawExpression && rawExpression.length > 0) {
                rawCriteria = new Criteria().initWithExpression(rawExpression, this.inlineCriteriaParameters ? null : rawParameters);
            }
            return rawCriteria;
        }

    },

    HAS_DATA_API_UUID_ARRAY_BUG: {
        value: false
    },

    mapPropertyDescriptorRawReadExpressionToSelectExpression: {
        value: function (aPropertyDescriptor, anExpression, mapping, operationLocales, tableName) {
            "use strict";
            //If anExpression isn't a Property, aPropertyDescriptor should be null/undefined and we'll need to walk anExpression syntactic tree to transform it into valid SQL in select statement.
            var result,
                syntax = typeof anExpression === "string" ? parse(anExpression) : anExpression,
                defaultExpressions = aPropertyDescriptor && aPropertyDescriptor.defaultExpressions,
                defaultExpressionsSyntaxes = aPropertyDescriptor && aPropertyDescriptor.defaultExpressionsSyntaxes,
                escapedExpression = escapeIdentifier(anExpression);


            if((!aPropertyDescriptor && anExpression !== "id") || !(syntax.type === "property" && syntax.args[1].value === anExpression)) {


            /*

                Client side:
                When we fetch roles, the information related to locale has to be provided, the most generic way would be as an objectExpression that would replace

                Instead of the phront Service fillin the blanks in - mapReadOperationToRawStatement() with:
                    if (readExpressions) {
                        rawReadExpressions = new Set(readExpressions.map(expression => mapping.mapObjectPropertyNameToRawPropertyName(expression)));
                    } else {
                        rawReadExpressions = new Set(mapping.rawRequisitePropertyNames)
                    }

                PhrontClientService should build the readExpressions it wants as it's hard to just put a few in readExpressions and expect PostgreSQLService to fill-in the rest? Especially since the UI should drive what we get back. So even if PhrontClientService were to build
                itself readExpressions as new Set(mapping.rawRequisitePropertyNames), we need to go
                    from: ["name","description","tags"]
                    to something like: ["name.fr.CA","description.fr.CA","tags.fr.CA"]

                which are now expressions more complex than just property names, so PhronService is going to need somethingf like
                    this.mapReadExpressionToRawReadExpression();

                    in which we should really walk the expression and transform into a SQL equivalent. But the decision to use coalesce for this is really custom, so if the first is a property that isLocalizable true, then we can return the Coalesce() structure, or we would need a similar function in the expression already, like:

                    ["name.fr.CA" or "name.fr.*","description.fr.CA or description.fr.*","tags.fr.CA or tags.fr.*"], where it's more natural/less hard coded to implement as a coalesce(), and there's also nothing to know about locale.

                So PhrontClientService needs to transform property names to object Expressions. Today, we only transform string to string for criteria.
                ["name","description","tags"] -> ["name.fr.CA" or "name.fr.*","description.fr.CA or description.fr.*","tags.fr.CA or tags.fr.*"]

                we'll have a mapping for name with a LocalizedStringConverter.
                LocalizedStringConverter:
                    convert: create a LocalizedString with rawData["name"]. Could be a string, or an object with some or all the json.
                                at this point, we know both the role, and the LocalizedString instance we create. So that's where we can keep them tied to each others for when we may need to access the json.
                    revert: if the value changes, if it's a new string, it has to be transformed as json so it can patch the json server side.
                            if LocalizedString has json changes mode, noth

                aRole.name.localization
                    -> aRole.name doesn't have localization property,
                        -> should create a trigger to end up:
                            -> fetchObjectProperty(aLocalizedString, "localization")
                                -> propertyNameQuery.readExpressions = ["localization"];
                                    -> fetchData: readOperation.data = query.readExpressions;

                                    The problem there is that by the time we get there, we don't know where we'd go to find the table of thaft LocalizedString that can be stored anywhere. So when we have embedded object descriptors, we need to be able to keep track per instance where they were fetched from, so we can go back to get more data as needed. Today we just lose that info when fetched. So we either have to embed that into each instance, use a map somewhere, or create a subclass on the fly so the data is more shared, so LocalizedRoleName. we'd do that like we extend the types we create.


                The request coming on would be like:
                Roles:
                Criteria: name.locale = "en_GB" which we break down into (name.locale = "en_GB" or name.locale = "en_*"

                We need to generate something like this to return the value matching the user's locale as expressed in the readExpression... which we don't have here...

                1) Get the locale first
                2) build the cascade logic
                3) make the string

                SELECT (SELECT row_to_json(_) FROM (SELECT "id",COALESCE("Role"."tags"::jsonb #>> '{en,FR}',"Role"."tags"::jsonb #>> '{en,*}') as "tags", COALESCE("Role"."description"::jsonb #>> '{en,FR}',"Role"."description"::jsonb #>> '{en,*}') as "description",COALESCE("Role"."name"::jsonb #>> '{en,FR}',"Role"."name"::jsonb #>> '{en,*}') as "name") as _) FROM phront."Role"

                -> {"id":"2c68ebd9-4ade-477d-a591-68b99272742a","tags":"[\"event\"]","description":"The person organizing something like an event.","name":"organizer"}

            */

                // var syntax = typeof anExpression === "string" ? parse(anExpression) : anExpressions,
                var rawParameters = null,
                    rawExpression = this.stringify(syntax, rawParameters, [mapping]);

                return rawExpression;

            } else {
                if(operationLocales && operationLocales.length && aPropertyDescriptor && aPropertyDescriptor.isLocalizable) {
                    var language,
                        region;

                    if( operationLocales.length === 1) {

                        /*
                            WARNING: This is assuming the inlined representation of localized values. If it doesn't work for certain types that json can't represent, like a tstzrange, we might need to use a different construction, or the localized value would be a unique id of the value stored in a different table
                        */
                        language = operationLocales[0].language;
                        region = operationLocales[0].region;
                        /*
                            Should build something like:
                            COALESCE("Role"."tags"::jsonb #>> '{en,FR}', "Role"."tags"::jsonb #>> '{en,*}') as "tags"
                        */
                        result = (language !== "en")
                            ? `COALESCE("${tableName}".${escapedExpression}::jsonb #>> '{${language},${region}}', "${tableName}".${escapedExpression}::jsonb #>> '{${language},*}', "${tableName}".${escapedExpression}::jsonb #>> '{en,*}') as ${escapedExpression}`
                            : `COALESCE("${tableName}".${escapedExpression}::jsonb #>> '{${language},${region}}', "${tableName}".${escapedExpression}::jsonb #>> '{${language},*}') as ${escapedExpression}`;

                    } else {
                        /*
                            we should return an json object with only the keys matching
                            the locales asked, with :

                            jsonb_build_object('fr',column->'fr','en',column->'en')
                        */
                        result = 'jsonb_build_object(';
                        for(let i=0, countI = operationLocales.length;(i<countI);i++) {
                                language = operationLocales[i].language;
                                result = `${result}'${language}',"${tableName}".${escapedExpression}::jsonb->'${language}'`;
                                if(i+2 < countI) result = `${result},`;

                        }
                        result = `${result}) as "${tableName}".${escapedExpression}`;
                    }

                } else {
                    if(aPropertyDescriptor) {
                        var rawDataMappingRule = mapping.rawDataMappingRuleForPropertyName(aPropertyDescriptor.name),
                        reverter = rawDataMappingRule ? rawDataMappingRule.reverter : null;
                        /*
                            We really need to use some kind of mapping/converter to go SQL, rather than inlining things like that...
                        */
                        if (reverter && reverter instanceof WktToGeometryConverter) {
                            result = `ST_AsEWKT("${tableName}".${escapeIdentifier(anExpression)}) as ${escapeIdentifier(anExpression)}`;
                        }

                    }
                    if(!result) {
                        //result = `"${tableName}".${escapeIdentifier(anExpression)}`;
                        result = this.qualifiedNameForColumnInTable(anExpression, tableName);
                    }
                }

                if(defaultExpressionsSyntaxes && defaultExpressionsSyntaxes.length > 0) {
                    //We're introducing the coalesce structure, starting by the column itself:
                    var defaultCoalesceStatements = [result],
                        i = 0, countI = defaultExpressionsSyntaxes.length,
                        iDefaultSyntax,
                        iDefaultObjectPropertyToSelect,
                        iReadOperation,
                        iRawDataOperation,
                        iCriteria,
                        iSQL;

                    for(;(i < countI); i++) {
                        iDefaultSyntax = defaultExpressionsSyntaxes[i];

                        /*
                            For a default, we need the expression/syntax to end by the property of the object at the "end" of the evaluation to be the value that we're going to use as default. In the parsed tree, this should be how we figure out what it is.
                        */
                        if(iDefaultSyntax.type === "property" && iDefaultSyntax?.args[1]?.type === "literal") {
                            iDefaultObjectPropertyToSelect = iDefaultSyntax?.args[1].value;
                        }

                        if(iDefaultObjectPropertyToSelect) {
                            /*
                                Since we have a whole method exisintg to build statements, we're going to use that, however, we need a way to:
                                Bypass the ususal

                                        sql = `SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT ${escapedRawReadExpressionsArray.join(",")}) as _) FROM ${schemaName}."${tableName}"`;

                                because in this case we want something like:
                                (SELECT "Table"."iDefaultObjectPropertyToSelect_id" FROM phront."Table" WHERE (....some-criteria...),

                                If we could rely on readExpressions being exactly what's needed, maybe we could use that: The montage client code should always include the primary key as it needs to stich things togethe when getting the data back, but in our case we would include only the column that we need, and that would tell the SQL to be just that column to be returned.

                            */
                            var defaultCriteria = new Criteria().initWithSyntax(iDefaultSyntax.args[0]),
                                aSQLJoinStatements = new SQLJoinStatements(),
                                aRawExpression = this.stringify(defaultCriteria.syntax, defaultCriteria.parameters, [mapping], operationLocales, aSQLJoinStatements),
                                aSQLJoinStatementsOrderedJoins = aSQLJoinStatements.orderedJoins(),
                                lastJoin = aSQLJoinStatementsOrderedJoins && aSQLJoinStatementsOrderedJoins[aSQLJoinStatementsOrderedJoins.length-1],
                                firstJoin = aSQLJoinStatementsOrderedJoins && aSQLJoinStatementsOrderedJoins[0],
                                lastJoinRightDataSet = lastJoin.rightDataSet,
                                lastJoinRightDataSetAlias = lastJoin.rightDataSetAlias,
                                lastJoinRightDataSetObjecDescriptor = lastJoin.rightDataSetObjecDescriptor,
                                destinationColumnNames,
                                firstJoinLeftDataSet,
                                firstJoinLeftDataSetAlias,
                                firstJoinLeftDataSetObjecDescriptor;


                            if(lastJoinRightDataSetObjecDescriptor) {


                                iReadOperation = new DataOperation();
                                // iReadOperation.clientId = readOperation.clientId;
                                // iReadOperation.referrer = readOperation;
                                iReadOperation.type = DataOperation.Type.ReadOperation;
                                iReadOperation.target = lastJoinRightDataSetObjecDescriptor;
                                iReadOperation.criteria = new Criteria().initWithSyntax(iDefaultSyntax.args[0]);
                                /*
                                    I think we cache expressions when parsed, but it might be better to direcly pass a syntax in data as
                                    "readExpressionsSyntaxes since we have it, instead of parsing everything"
                                */
                                iReadOperation.data = {
                                    readExpressions:[iDefaultObjectPropertyToSelect]
                                };

                                this.mapReadOperationToRawReadOperation(iReadOperation, (iRawDataOperation = {}));
                                if(iRawDataOperation.sql) {
                                    //This is not working YET, so don't do it!
                                    // defaultCoalesceStatements.push(iRawDataOperation.sql);
                                }
                            }
                        }

                        //console.log("iDefaultSyntax: ",iDefaultSyntax);
                    }
                    result = `COALESCE(${defaultCoalesceStatements.join(",")}) as ${escapedExpression}`;

                }

                return result;

            }


        }
    },

    qualifiedNameForColumnInTable: {
        value: function(columnName, tableName) {
            return `"${tableName}".${escapeIdentifier(columnName)}`;
        }
    },

    localesFromCriteria: {
        value: function (criteria) {
            //First we look for useLocales added by phront client data service
            //under the DataServiceUserLocales criteria parameters entry:
            if(criteria && (typeof criteria.parameters === "object")) {
                if("DataServiceUserLocales" in criteria.parameters) {
                    return criteria.parameters.DataServiceUserLocales;
                } else {
                    return null;
                    /*
                        No high level clues, which means we'd have to walk
                        the syntaxtic tree to look for a property expression on
                        "locales"
                    */
                    // console.warn("localesFromCriteria missing crawling syntactic tree to find locales information in criteria: "+JSON.stringify(criteria));
                }
            } else {
                return null;
            }

        }
    },

    _criteriaByRemovingDataServiceUserLocalesFromCriteria: {
        value: function (criteria) {
            if(criteria.parameters.DataServiceUserLocales) {
                delete criteria.parameters.DataServiceUserLocales;

                if(criteria.syntax.type === "and") {


                    var iterator = new SyntaxInOrderIterator(criteria.syntax, "and"),
                        parentSyntax, currentSyntax, firstArgSyntax, secondArgSyntax,
                        localeSyntax;

                        // while (!(currentSyntax = iterator.next()).done) {
                        //     console.log(currentSyntax);
                        //   }
                    while ((currentSyntax = iterator.next("and").value)) {
                        firstArgSyntax = currentSyntax.args[0];
                        secondArgSyntax = currentSyntax.args[1];

                        if(firstArgSyntax.type === "equals" && firstArgSyntax.args[1] && firstArgSyntax.args[1].args[1].value === "DataServiceUserLocales") {
                            localeSyntax = firstArgSyntax;

                            //We need to stich
                            parentSyntax = iterator.parent(currentSyntax);
                            if(parentSyntax === null) {
                                //The simplest case, one root and criteria
                                /*
                                    We remove the "and", the current root of the syntax, and the left side (args[0])
                                    that is the syntax for "locales == $DataServiceUserLocales"
                                */
                                criteria.syntax = secondArgSyntax;
                            } else {
                                //We need to replace currentSyntax in it's own parent, by secondArgSyntax
                                var parentSyntaxArgIndex = parentSyntax.args.indexOf(currentSyntax);

                                parentSyntax.args[parentSyntaxArgIndex] = secondArgSyntax;

                            }

                            //Delete the expression as it would be out of sync:
                            // criteria.expression = "";

                            break;
                        }

                    }


                    //criteria.syntax = criteria.syntax.args[1];
                    //Delete the expression as it would be out of sync:
                    //criteria.expression = "";
                    return criteria;
                } else {
                    //If there's only the locale expression, we remove it
                    // criteria.syntax = null;
                    return null;
                }

            }

        }
    },

    /**
     * REMOVED: mapReadOperationToRawStatement - Transforms a read operation in a select statement
     *
     *  - Processes readOperation's readExpressions to:
     *      - select the columns required
     *      - trigger new readOperations to return the value of more complex read expressions
     *      - eventually embbed first-level relationships in rows as nested json in the same select using selects in the from clause
     *
     * - Processes defaultExpressions of property descriptors to create COALESCE(select, select, ...) structure in from clause.
     *
     * - returns an array of read operations if any are created.
     *
     * @returns {Array <DataOperations>} readOperations <optional>
     */


    _handleReadCount: {
        value: 0
    },


    /**
     * Returns true as default so data are sorted according to a query's
     * orderings. Subclasses can override this if they cam delegate sorting
     * to another system, like a database for example, or an API, entirely,
     * or selectively, using the aDataStream passed as an argument, wbich can
     * help conditionally decide what to do based on the query's objectDescriptor
     * or the query's orderings themselves.
     *
     * TODO: overrides to false as we should have that done by SQL
     * when correct mapping from orderings to ORDER BY clause is done
     *
     * @public
     * @argument {DataStream} dataStream
     */

    shouldSortDataStream: {
        value: function (dataStream) {
            return true;
        }
    },


    mapReadOperationToRawReadOperation: {

        value: function mapReadOperationToRawReadOperation(readOperation, rawDataOperation) {

            /*
                Until we solve more efficiently (lazily) how RawDataServices listen for and receive data operations, we have to check wether we're the one to deal with this:
            */
            if(!this.handlesType(readOperation.target)) {
                return;
            }


            //This adds the right access key, schema, db name. etc... to the RawOperation.
            this.mapOperationToRawOperationConnection(readOperation, rawDataOperation);


            var data = readOperation.data,
                // rawReadExpressionMap,

                // iRawDataOperation,
                iReadOperation,
                // iReadOperationExecutionPromise,
                // iPreviousReadOperationExecutionPromise,
                objectDescriptor = readOperation.target,
                mapping = this.mappingForType(objectDescriptor),
                readExpressions = readOperation.data?.readExpressions,
                readExpressionsCount = (readExpressions && readExpressions.length) || 0,
                rawDataPrimaryKeys = mapping.rawDataPrimaryKeys,
                primaryKeyPropertyDescriptors = mapping.primaryKeyPropertyDescriptors,
                criteria = readOperation.criteria,
                criteriaSyntax,
                criteriaQualifiedProperties = criteria && criteria.qualifiedProperties,
                rawReadExpressions,
                // dataChanges = data,
                // changesIterator,
                // aProperty, aValue, addedValues, removedValues, aPropertyDescriptor,
                // self = this,
                isReadOperationForSingleObject = false,
                // readOperationExecutedCount = 0,
                readOperations,
                // firstPromise,
                //Take care of locales
                operationLocales = readOperation.locales,
                columnNames = this.columnNamesForObjectDescriptor(objectDescriptor),
                schemaName = rawDataOperation.schema,
                tableName = this.tableForObjectDescriptor(objectDescriptor),
                escapedRawReadExpressions = new Set(),
                // readOperationsCount,
                orderings = readOperation.data?.orderings,
                rawOrderings,
                readLimit = readOperation.data?.readLimit,
                readOffset = readOperation.data?.readOffset,
                useDefaultExpressions = readOperation.data?.readExpressions ? false : true,
                rawCriteria,
                rawExpressionJoinStatements;


            /*
                If the readOperation specifies only one readExpression, we'll respect that. Otherwise, we'd return a json construct, so we need to make sure we include the primary keys.
            */

            if(useDefaultExpressions || (readExpressions && readExpressions.length > 1)) {

                //Adds the primaryKeys to the columns fetched
                if(rawDataPrimaryKeys) {
                    rawDataPrimaryKeys.forEach(item => escapedRawReadExpressions.add(this.qualifiedNameForColumnInTable(item,tableName)));
                } else if(primaryKeyPropertyDescriptors) {
                    primaryKeyPropertyDescriptors.forEach(item => escapedRawReadExpressions.add(this.qualifiedNameForColumnInTable(item.name, tableName)));
                }
            }



            //fast eliminating test to get started
            if(criteriaQualifiedProperties && (rawDataPrimaryKeys.length === criteriaQualifiedProperties.length)) {
                isReadOperationForSingleObject = rawDataPrimaryKeys.every((aPrimaryKeyProperty) => {
                    return (criteriaQualifiedProperties.indexOf(aPrimaryKeyProperty) !== -1);
                });
            }

            /*
                If we don't have instructions in the readOperation in term of what o retur, we return all known objectDesscriptor's proeprties:
            */
            if(!readExpressions) {
                readExpressions = objectDescriptor.propertyDescriptorNames;
            }

            //if (readExpressions) {
            let i, countI, iExpression, iRawPropertyNames, iObjectRule, iPropertyDescriptor, iValueSchemaDescriptor, iValueDescriptorReference, iValueDescriptorReferenceMapping, iInversePropertyObjectRule, iRawDataMappingRules, iRawDataMappingRulesIterator,
            iRawDataMappingRule,
            iRawDataMappingRuleConverter,
            iIsInlineReadExpression, iSourceJoinKey, iInversePropertyDescriptor, iObjectRuleConverter,
            // userLocaleCriteria, iKey, iValue, iAssignment, iPrimaryKey, iPrimaryKeyValue, iInversePropertyObjectRuleConverter, iRawDataMappingRuleConverterForeignDescriptorMappings, iDestinationJoinKey,
            iReadOperationCriteria;

            // if(criteria && criteria.parameters.DataServiceUserLocales) {
            //     userLocaleCriteria = new Criteria().initWithExpression("locales == $DataServiceUserLocales", {
            //         DataServiceUserLocales: criteria.parameters.DataServiceUserLocales
            //     });
            // }

            /*
                if there's only one readExpression for a relationship and the criteria is about one object only —it's only ualifiedProperties is "id"/primaryKey, then we can safely execute one query only and shift the object descriptor to the destination.

                If the join for that readExpression relationship is the id, we can get the fetch right away, but for others, we'll need to add a join to the expression.

                We should be able to re-use some logic from the converter, if we replace the scope by the foreignKey itself and not the value
            */
            // if(objectDescriptor.name === "Service") {
            //     console.log("handleRead for "+objectDescriptor.name+" with readExpressions: "+JSON.stringify(readExpressions));
            // }


            /*

                Simplifying and streamlining in one loop.

                For each iExpression, we need to assess what it is:

                - iExpression can be a column:
                    - a property of the objectDesscriptor
                    - an instance of another type stored inlined.
                    - any of these 2 kind of propertyDescriptor could have defaultExpressions that needs to be turned into a COALESCE(select-for-default-expression-1, select-for-default-expression-2, ... )
                - iExpression can be a relationship to an object stored in another table
                - iExpression can be anything involving a complex expression, involving tarversing a graph with a logical operators expressing a criteria, while retreiving a subset of the the identified properties, including down to a single one.

                - unless an expression involving an external result is inlined via a select in the from as an ad-hoc column name, (for expressions that are properties of the objectDescriptor, the obvious name is the one of the proeprty)which we can do because to return results as json, new readOperations would be needed to push those results to the client.

                - TODO!!!!: If some part of an expression were to lead to a type not handled by this RawDataService, multiple readOperations would be needed, so each RawDataService involved can do it's part, returning partial results that needs further processing to continue evaluating the rest of the expression. The best solution is to implement this in RawDataService's - handleRead() method as a shared capability, so the type being retrieved starts the process and orchestrate the hand-off(s) to others via derived readOperations. In order to do so, a first wal through of all readExpressions' syntax will need to be performed in order to triage.


                    - so this should mean that by the time we're here, a readOperation's iExpression are all handled by this rawDataService.
            */



            rawReadExpressions = new Set();
            for(i=0, countI = readExpressions.length;(i<countI); i++) {
                iExpression = readExpressions[i];
                iRawPropertyNames = mapping.mapObjectPropertyNameToRawPropertyNames(iExpression);
                iObjectRule = mapping.objectMappingRuleForPropertyName(iExpression);
                iObjectRuleConverter = iObjectRule && iObjectRule.converter;
                //iPropertyDescriptor = iObjectRule && iObjectRule.propertyDescriptor;
                iPropertyDescriptor = objectDescriptor.propertyDescriptorNamed(iExpression);

                iRawDataMappingRules = mapping.rawDataMappingRulesForObjectProperty(iExpression);
                iRawDataMappingRulesIterator = iRawDataMappingRules && iRawDataMappingRules.values();
                iValueDescriptorReference = iObjectRule && iObjectRule.propertyDescriptor._valueDescriptorReference,
                iValueDescriptorReferenceMapping = iValueDescriptorReference && this.mappingForType(iValueDescriptorReference);

                if(iValueDescriptorReference) {
                    iValueSchemaDescriptor = this.rawDataDescriptorForObjectDescriptor(iValueDescriptorReference);
                }

                iIsInlineReadExpression = (
                    !iObjectRule ||
                    !iValueSchemaDescriptor ||
                    !iObjectRuleConverter ||
                    (
                        iObjectRuleConverter &&
                        (
                            iObjectRuleConverter instanceof RawEmbeddedValueToObjectConverter ||
                            iObjectRuleConverter instanceof KeyValueArrayToMapConverter
                        )
                    )
                );


                /*
                    Let's not go the extra mile of fetching relationships if we're not asked to explicitely by the readOperation having readExpressions spcified.

                    So we test for useDefaultExpressions first.
                */
                if(!useDefaultExpressions && (!iRawDataMappingRules || iRawDataMappingRules.size === 0)) {

                    //Take care of single raw expressions typically sent by service itself for builing nested select statement, like for the from clause for defaults
                    if(countI === 1 && columnNames.has(iExpression)) {
                        escapedRawReadExpressions.add(this.mapPropertyDescriptorRawReadExpressionToSelectExpression(iPropertyDescriptor,iExpression, mapping, operationLocales, tableName));
                    }
                    //console.log("A - "+objectDescriptor+" - "+ iExpression);
                    else if(isReadOperationForSingleObject && !iIsInlineReadExpression) {
                        /*
                            we find our primaryKey on the other side, we can just use the converter since we have the primary key value:
                        */
                        iReadOperationCriteria = iObjectRuleConverter.convertCriteriaForValue(criteria.parameters.id);

                    } else {
                        /*
                            This is the case where we have an arbitrary criteria on objectDescriptor. The best we can do might be to combine that criteria with the criteria to fetch iExpression, which will return all possibles, make sure we add the foreign key if it's not id in rawReadExpressions, and once we've pushed the results client side, since the foreignKey converter now look in memory first, it will find  what it needs.

                            Our stringification to SQL has been coded so far to work with object-level semantics. So we're going to stick to that for now.

                        */

                        iSourceJoinKey = iObjectRule && iObjectRule.sourcePath;
                        //    iConverterExpression = iObjectRuleConverter && iObjectRuleConverter.convertExpression;
                        //    iConverterSyntax = iObjectRuleConverter && iObjectRuleConverter.convertSyntax;
                        if(iSourceJoinKey && rawDataPrimaryKeys.indexOf(iSourceJoinKey) === -1) {
                            /* we host the foreign key, we add it to rawReadExpressions so the client can stich things together, or issue a new fetch as needed */
                            rawReadExpressions.add(iSourceJoinKey);
                        }


                        iInversePropertyDescriptor = iValueDescriptorReference && iValueDescriptorReference.propertyDescriptorForName(iPropertyDescriptor.inversePropertyName);

                        if(iInversePropertyDescriptor) {
                            /*
                                we need to start with iInversePropertyDescriptor.name and combine the left side(s) of readOperation.criteria with it. If a left side is a toOne or inline property it means

                                ${iInversePropertyoDescriptor.name}.someToOneProperty {operator} -right side-

                                and if it's a to-many:

                                ${iInversePropertyoDescriptor.name}{someToOneProperty {operator} -right side-}

                                We need a property iterator on frb syntax...

                                We basically need to do something simmila to EOF

                                qualifierMigratedFromEntityRelationshipPath
                            */
                            if(criteria) {
                                //console.log("ReadExpression:"+ objectDescriptor.name + "-" + iPropertyDescriptor.name+"Implementation missing to support prefetching relationship read expressions combined with arbitrary criteria");
                                if(iInversePropertyDescriptor.cardinality === 1) {

                                } else {

                                }


                                if(iReadOperationCriteria) {

                                    if(!iIsInlineReadExpression && !iReadOperation) {

                                        iReadOperation = new DataOperation();
                                        iReadOperation.clientId = readOperation.clientId;
                                        iReadOperation.referrer = readOperation;
                                        iReadOperation.type = DataOperation.Type.ReadOperation;
                                        iReadOperation.target = iValueDescriptorReference;
                                        iReadOperation.data = {};
                                        (readOperations || (readOperations = [])).push(iReadOperation);

                                    }
                                }

                            }

                        } else {
                            /*
                            TODO: If it's missing, we can proabably create it with the mapping info we have on eiher side.
                            remove the else and test first and once created proceed;
                            */
                            //console.error("Can't fulfill fetching read expression '"+iExpression+"'. No inverse property descriptor was found for '"+objectDescriptor.name+"', '"+iExpression+"' with inversePropertyName '"+iPropertyDescriptor.inversePropertyName+"'");

                            if(iPropertyDescriptor && iPropertyDescriptor.definition) {

                                /*
                                    We land here for an read expression that's a propertyDescriptor, but has a definition.
                                    There may also be a criteria involved if we're resolving the property of an object.

                                    But because it's a propertyDescriptor with a definition, we may not have the type it points to. That information is discoverable, and would be stored in the propertyDescriptor at runtime, increasing speed the next time we're asked the same thing.

                                    With a bit of luck (not sure about aliases if the same table is traversed mutiple times, we haven't used aliases so far) creating the joins for the current expression from objectDescriptor.iExpression -> wherever it goes, involves the same join logic back. So if we can descover at the end of he discovery the type it goes to, we might just be able to swap the from tableName to the table storing the new type.
                                */
                                /*
                                    Combine definition and criteria.
                                */
                                var definitionCriteria = new Criteria().initWithExpression(iPropertyDescriptor.definition),
                                    combinedCriteria = definitionCriteria.and(criteria);


                                var aSQLJoinStatements = new SQLJoinStatements(),
                                    aRawExpression = this.stringify(combinedCriteria.syntax, combinedCriteria.parameters, [mapping], operationLocales, aSQLJoinStatements),
                                    aSQLJoinStatementsOrderedJoins = aSQLJoinStatements.orderedJoins(),
                                    lastJoin = aSQLJoinStatementsOrderedJoins && aSQLJoinStatementsOrderedJoins[aSQLJoinStatementsOrderedJoins.length-1],
                                    firstJoin = aSQLJoinStatementsOrderedJoins && aSQLJoinStatementsOrderedJoins[0],
                                    lastJoinRightDataSet = lastJoin.rightDataSet,
                                    lastJoinRightDataSetAlias = lastJoin.rightDataSetAlias,
                                    lastJoinRightDataSetObjecDescriptor = lastJoin.rightDataSetObjecDescriptor,
                                    destinationColumnNames,
                                    firstJoinLeftDataSet,
                                    firstJoinLeftDataSetAlias,
                                    firstJoinLeftDataSetObjecDescriptor;

                                /*
                                    We're hijacking the main query if there's only one readExpressions,
                                    so we're overriding the variables that were set for the original query.
                                */
                                if(lastJoinRightDataSetObjecDescriptor && readExpressions.length === 1) {
                                    /*
                                        part of inverting the statement
                                    */
                                    tableName = this.tableForObjectDescriptor(lastJoinRightDataSetObjecDescriptor);
                                    firstJoinLeftDataSet = firstJoin.leftDataSet;
                                    firstJoin.leftDataSet = tableName;

                                    firstJoinLeftDataSetObjecDescriptor = firstJoin.leftDataSetObjecDescriptor;
                                    firstJoin.leftDataSetObjecDescriptor = lastJoinRightDataSetObjecDescriptor;

                                    firstJoinLeftDataSetAlias = firstJoin.leftDataSetAlias;
                                    firstJoin.leftDataSetAlias = lastJoinRightDataSetAlias;

                                    lastJoin.rightDataSet = firstJoinLeftDataSet;
                                    lastJoin.rightDataSetObjecDescriptor  = firstJoinLeftDataSetObjecDescriptor;
                                    lastJoin.rightDataSetAlias = firstJoinLeftDataSetAlias;

                                    schemaName = lastJoin.rightDataSetSchema || schemaName;

                                    rawCriteria = new Criteria().initWithExpression(aRawExpression);

                                    rawExpressionJoinStatements = aSQLJoinStatements;

                                    destinationColumnNames = this.columnNamesForObjectDescriptor(lastJoinRightDataSetObjecDescriptor);

                                    escapedRawReadExpressions = destinationColumnNames.map(columnName => this.qualifiedNameForColumnInTable(columnName, tableName));

                                    useDefaultExpressions = true;



                                    /*
                                        Version with sub-query:
                                    */
                                    iReadOperation = new DataOperation();
                                    iReadOperation.clientId = readOperation.clientId;
                                    iReadOperation.referrer = readOperation;
                                    iReadOperation.referrerId = readOperation.id;
                                    iReadOperation.type = DataOperation.Type.ReadOperation;
                                    iReadOperation.target = lastJoinRightDataSetObjecDescriptor;
                                    iReadOperation.data = {};
                                    (readOperations || (readOperations = [])).push(iReadOperation);

                                    //We hijack the rawDataOperation variable that was passed on to us, so it won't have sql on it.
                                    rawDataOperation = Object.clone(rawDataOperation);

                                    /*
                                        This is dirty and will need to be re-factored, but here that will allow us to use the work done here until we actually do it while processing a regular iReadOperation, which would likely mean having inversed the expression.

                                        In the mean time, will set the ready-to-use rawDataOperation on the iReadOperation
                                    */
                                    iReadOperation.rawDataOperation = rawDataOperation;

                                }

                            }

                            iReadOperation = null;
                        }

                    }

                } else {
                    //console.log("B - "+objectDescriptor+" - "+ iExpression);
                    var iTargetPath, anEscapedExpression;
                    while((iRawDataMappingRule = iRawDataMappingRulesIterator.next().value)) {
                        iReadOperationCriteria = null;

                        //if(iIsInlineReadExpression) {
                        //We want foreign keys as well regardless so client can at least re-issue a query
                        iTargetPath = iRawDataMappingRule.targetPath;

                        iRawDataMappingRuleConverter = iRawDataMappingRule.reverter;
                        // iRawDataMappingRuleConverterForeignDescriptorMappings = iRawDataMappingRuleConverter && iRawDataMappingRuleConverter.foreignDescriptorMappings;
                        iRawDataMappingRuleConverterForeignDescriptorMapping = iRawDataMappingRuleConverter && iRawDataMappingRuleConverter.foreignDescriptorMatchingRawProperty && iRawDataMappingRuleConverter.foreignDescriptorMatchingRawProperty(iTargetPath);

                        if(columnNames.has(iTargetPath)) {
                            //anEscapedExpression = this.mapRawReadExpressionToSelectExpression(iTargetPath, iRawDataMappingRule.propertyDescriptor, mapping, operationLocales, tableName);
                            anEscapedExpression = this.mapPropertyDescriptorRawReadExpressionToSelectExpression(iPropertyDescriptor,iTargetPath, mapping, operationLocales, tableName);




                            // rawReadExpressions.add(anEscapedExpression);
                            escapedRawReadExpressions.add(`${anEscapedExpression}`);
                        }
                        // rawReadExpressions.add(iRawDataMappingRule.targetPath);
                        //}
                        /*
                            for now, we're only going to support getting relationships of one object.

                            In the future we'll need to add a second phase following a general fetch, where we'll have to parse the json results and do for each rawData what we're doing here, trying to be smart about grouping the fetch of the same readExpression for different instances with an in/or, as long as we can tell them apart when we get them back.
                        */
                        if(!useDefaultExpressions && !iIsInlineReadExpression && criteria) {
                            /*
                                If we have a value descriptor with a schema that's not embedded, then we're going to create a new read operation to fetch it, so we keep it in readExpressions for further processing, otherwise it's an internal property and we remove it.
                            */

                            //We need to buil the criteria for the readOperation on iValueDescriptorReference / iValueSchemaDescriptor

                                                            /*
                                We start with readOperatio criteria being

                                _expression:'id == $id'
                                _parameters:{id: 'cb3383a0-6bb5-45bb-9ed9-437d6a8c4dfa'}

                                We need to create a criteria tha goes back from iValueDescriptorReference to objectDescriptor.

                                The mapping expression and eventual converters contains the property involved:

                                for example, Service has:
                                "variants": {
                                    "<->": "variantIds",
                                    "converter": {"@": "variantsConverter"},
                                    "debug":true
                                },

                                and variantsConverter has:
                                    "convertExpression": "$.has(id)"
                            */
                            /*
                                Simplified first pass to support key == value


                                !!!!!WARNING:
                                - this was only tested when readExpressions are specified, not when we use the defaults.

                                - The code seems wrong for to-many:

                                    iReadOperationCriteriaExpression = `${iInversePropertyDescriptor.name}.filter{${criteria.expression}}`;
                                    It doesn't find what it should.

                                - There's another problem, apparently only for the cases where the destination of a relationship is the same as the source, or if more than one readExpression is used at a time, the results of both readOperations get combined on the client side, with one or more readUpdate followed by a readCompleted.
                            */
                            criteriaSyntax = criteria.syntax;
                            if(criteriaSyntax.type === "equals") {

                                if(iRawDataMappingRuleConverterForeignDescriptorMapping) {
                                    iValueDescriptorReference = iRawDataMappingRuleConverterForeignDescriptorMapping.type;
                                    iValueDescriptorReferenceMapping = iValueDescriptorReference && this.mappingForType(iValueDescriptorReference);
                                }

                                //Special case easier to handle, when we fulfill readExpression for 1 object only:
                                if(isReadOperationForSingleObject) {

                                    if(readExpressionsCount === 1) {
                                        //We can re-use the current operation to do what we want
                                        iReadOperation = readOperation;
                                        iReadOperation.target = iValueDescriptorReference;
                                        iReadOperation.data = {};

                                        //We're not returning anything from the original objectDescriptor.
                                        //REVIEW - needs to be better structured when we can make it more general
                                        rawReadExpressions= null;
                                    }

                                    /*
                                        we find our primaryKey on the other side, we can just use the converter since we have the primary key value:
                                    */
                                    iInversePropertyDescriptor = iValueDescriptorReference && iValueDescriptorReference.propertyDescriptorForName(iPropertyDescriptor.inversePropertyName);
                                    iInversePropertyObjectRule = iValueDescriptorReferenceMapping && iValueDescriptorReferenceMapping.objectMappingRuleForPropertyName(iPropertyDescriptor.inversePropertyName);
                                    iInversePropertyObjectRuleConverter = iInversePropertyObjectRule && iInversePropertyObjectRule.converter;

                                    if(iInversePropertyDescriptor) {

                                        if(iInversePropertyDescriptor.cardinality === 1) {
                                            iReadOperationCriteriaExpression = `${iInversePropertyDescriptor.name}.${criteria.expression}`;

                                        } else {
                                            iReadOperationCriteriaExpression = `${iInversePropertyDescriptor.name}.filter{${criteria.expression}}`;
                                        }
                                        iReadOperationCriteria = new Criteria().initWithExpression(iReadOperationCriteriaExpression, criteria.parameters);
                                        // iReadOperationCriteria = iInversePropertyObjectRuleConverter.convertCriteriaForValue(criteria.parameters.id);
                                    }
                                    else {
                                        //console.error("Can't fulfill fetching read expression '"+iExpression+"'. No inverse property descriptor was found for '"+objectDescriptor.name+"', '"+iExpression+"' with inversePropertyName '"+iPropertyDescriptor.inversePropertyName+"'");
                                    }

                                } else {
                                    /*
                                        More general case where we need to combine the criteria with rebasing the criteria.

                                    */
                                    iInversePropertyDescriptor = iValueDescriptorReference && iValueDescriptorReference.propertyDescriptorForName(iPropertyDescriptor.inversePropertyName);

                                    if(iInversePropertyDescriptor) {
                                        var iReadOperationCriteriaExpression;
                                        if(iInversePropertyDescriptor.cardinality === 1) {
                                            iReadOperationCriteriaExpression = `${iInversePropertyDescriptor.name}.${criteria.expression}`;

                                        } else {
                                            iReadOperationCriteriaExpression = `${iInversePropertyDescriptor.name}.filter{${criteria.expression}}`;
                                        }

                                        /*
                                            Un-comment the next line to finish testing and immplementing. The filter block needs work to properly create the right joins primarily.
                                        */

                                        // iReadOperationCriteria = new Criteria().initWithExpression(iReadOperationCriteriaExpression, criteria.parameters);
                                    }
                                    else {
                                        //console.error("Can't fulfill fetching read expression '"+iExpression+"'. No inverse property descriptor was found for '"+objectDescriptor.name+"', '"+iExpression+"' with inversePropertyName '"+iPropertyDescriptor.inversePropertyName+"'");
                                    }

                                }


                                if(iReadOperationCriteria && !iReadOperation) {
                                    iReadOperation = new DataOperation();
                                    iReadOperation.clientId = readOperation.clientId;
                                    iReadOperation.referrer = readOperation;
                                    iReadOperation.type = DataOperation.Type.ReadOperation;
                                    iReadOperation.target = iValueDescriptorReference;
                                    iReadOperation.data = {};
                                    (readOperations || (readOperations = [])).push(iReadOperation);
                                }

                            } else {
                                //console.log("No implementation yet for external read expressions with a non equal criteria");
                            }
                        //    iReadOperationCriteria = iObjectRuleConverter.convertCriteriaForValue(criteria.parameters.id);

                            /*
                            iInversePropertyDescriptor = iValueDescriptorReference.propertyDescriptorForName(iPropertyDescriptor.inversePropertyName);

                            if(iInversePropertyDescriptor) {
                                //Let's try to

                            } else {

                                // TODO: If it's missing, we can proabably create it with the mapping info we have on eiher side.
                                // remove the else and test first and once created proceed;

                                console.error("Can't fulfill fetching read expression '"+iExpression+"'. No inverse property descriptor was found for '"+objectDescriptor.name+"', '"+iExpression+"' with inversePropertyName '"+iPropertyDescriptor.inversePropertyName+"'");
                                iReadOperation = null;
                            }
                            */
                        }
                    }
                }


                if(iReadOperation && iPropertyDescriptor.isLocalizable) {
                    iReadOperation.locales = operationLocales;
                }
                // if(iReadOperationCriteria && iPropertyDescriptor.isLocalizable) {
                //     iReadOperationCriteria = userLocaleCriteria.and(iReadOperationCriteria);
                // }

                if(iReadOperation && iReadOperationCriteria) {
                    iReadOperation.criteria = iReadOperationCriteria;
                }

                // if(iReadOperation && (readExpressionsCount > 1) && (i>0)) {
                //     readOperations.push(iReadOperation);
                // }
            }

            //if(readExpressions.length && objectDescriptor.name === "Service") console.warn(objectDescriptor.name+" Read expressions \""+JSON.stringify(readExpressions)+"\" left are most likely a relationship which isn't supported yet.");

            // rawReadExpressions = new Set(readExpressions.map(expression => mapping.mapObjectPropertyNameToRawPropertyName(expression)));
            //}

            /*
                if we have rawReadExpressions and several readOperations, it means we need to return data for an object itself as well as more from the other reads. If the object didn't already exists, we're going to make sure that we return it first before adding details, to simplify the client side graph-stiching logic.
            */


            if(escapedRawReadExpressions.length) {

                /*
                SELECT f.title, f.did, d.name, f.date_prod, f.kind
                    FROM distributors d, films f
                    WHERE f.did = d.did
                */

                if(!rawCriteria) {
                    try {
                        rawCriteria = this.mapCriteriaToRawCriteria(criteria, mapping, operationLocales, (rawExpressionJoinStatements = new SQLJoinStatements())
                        );

                    } catch (error) {
                        rawDataOperation.error = error;
                        return;
                    }
                }
                condition = rawCriteria ? rawCriteria.expression : undefined;

                if(orderings) {
                    rawOrderings = this.mapOrderingsToRawOrderings(orderings, mapping);
                }
                //     console.log(" new condition: ",condition);
                //condition = this.mapCriteriaToRawStatement(criteria, mapping);
                // console.log(" old condition: ",condition);
                /*
                SELECT select_list
                FROM table_expression
                WHERE ...
                ORDER BY sort_expression1 [ASC | DESC] [NULLS { FIRST | LAST }]
                        [, sort_expression2 [ASC | DESC] [NULLS { FIRST | LAST }] ...]
                [LIMIT { number | ALL }] [OFFSET number]

                */

                /*
                    We're now going to trust that if there's only one readExpression actually speficied, that's all you get. Otherwise we return a json structure
                */

                if(!useDefaultExpressions && readExpressions.length === 1 && (readOperation.referrer || readOperation.referrerId)) {
                    sql = `SELECT DISTINCT ${escapedRawReadExpressions.join()} FROM "${schemaName}"."${tableName}"`;
                } else {
                    sql = `SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT ${escapedRawReadExpressions.join(",")}) as _) FROM "${schemaName}"."${tableName}"`;
                }

                //Adding the join expressions if any
                if(rawExpressionJoinStatements.size) {
                    sql = `${sql} ${rawExpressionJoinStatements.toString()}`;
                }

                if (condition) {
                    //Let's try if it doestn't start by a JOIN before going for not containing one at all
                    if(condition.indexOf("JOIN") !== 0) {
                        sql = `${sql}  WHERE (${condition})`;
                    } else {
                        sql = `${sql}  ${condition}`;
                    }
                }
                //sql = `SELECT ${escapedRawReadExpressionsArray.join(",")} FROM ${schemaName}."${tableName}" WHERE (${condition})`;

                if(rawOrderings) {
                    sql = `${sql}  ORDER BY ${rawOrderings}`;

                }

                if(readLimit) {
                    sql = `${sql}  LIMIT ${readLimit}`;
                    if(readOffset) {
                        sql = `${sql}  OFFSET ${readOffset}`;
                    }
                }

                //console.log("handleRead sql: ",sql);
                rawDataOperation.sql = sql;
                if (rawCriteria && rawCriteria.parameters) {
                    rawDataOperation.parameters = rawCriteria.parameters;
                }
            }

            // if(readOperation.target.name === "Event") {
            //     console.log("------------------> readOperation.criteria.expression:",readOperation.criteria.expression);
            //console.log("------------------> rawDataOperation.sql:",rawDataOperation.sql);

            return readOperations;

        }
    },

    /*

        Notes about dealing with advanced readExpressions

        if(iObjectRule && iValueSchemaDescriptor && !(iObjectRule.converter && (iObjectRule.converter instanceof RawEmbeddedValueToObjectConverter)))  {}

        11/18/2020
        We need to build up support for more than inline properties. A read expression that is a relationship is asking to fetch another type objects that's associated with the source.
        We're already using:
                objectCriteria = new Criteria().initWithExpression("id == $id", {id: object.dataIdentifier.primaryKey});
        on the client side to do so, id here is on the table fetched, for gettin more inline values.

        From an sql stand point, unless we build a composite result, which can be relatively simple with each rows containg to-one from left to right separated by chatacter like ":", but would likely lead to duplicate cells if there were to many involved, the simplest way to resolve to-many or to-one relationships is to make multiple queries. So should we do that here, amd allow complex readExpressions sent by the client? Or should the client take that on?

        When we do dataService.getObjectProperties(), it is, meant to be that. And it gets turned into as many fetchObjectProperties as needed and as much queries, (until we group for the same fetchObjectProperties required for an array of similar objects.). The API is not called getObjectExpressions(). BUT - that is exactly what we do in bindings. And we need to find an efficient way to solve that.

        When a DataComponent combines it's type and criteria, we should already know by leveraging defineBinding(), what properties/relations are going to be epected through the entire graph. Starting from the root type of the DataComponent, we can analyze all the propertie needed on that across all bindings used in that component, and hopefully nested components, as we can trace the properties up to the root DataComponent. Once we know all that, which is client-side, it has to be passed on to be efficently executed, from the backend.

        At which point, the root query gets it's initial result via read update, but if we don't build client-side queries for the rest, by hand, then data will arrive, as readupdate operation, giving us criteria so we know what obects they belong to. But operations have been "raw" data so far. So pushing the equivallent of a fetchObjectProperty, the data would be the raw data of the content of that relationship, the target, the object descriptor, but what tells us which object it needs to be attached to?
            - the criteria could be the inverse from type fetched to the object on which we want that array to end-up on?
            - we don't do anythinn, as we are now capable of finding these objects in memory if someone asks them?
            - should move to return a seriaalization of fullly-formed objects instead of exchanging rawData? because then we can directly assign values on the right objects leveraging
                    "a":  {
                        data: "dataIdentifierValue",
                        "values": {
                            prop1: ["@b","@f","@cc"]
                        }

        11/19/2020
        If we handle read expressions as subqueries, we're going to create here as many new read operations as needed, and it might make sense to send them to other workers from inside to create parallelism?
        In any case, these read operations would have:
            - as referrer this initial read that triggered them in cascade.
            - do we need to keep track of "source" + property it will need to be mapped to? If it's a derived read, the root read onthe client side should still have info about what to do with it, but for a pure push, it would have no idea.
            - for a push to happen, a client would have first stated what it cares about, and that's because we know that, that we would push something to it. So the backend responds to an addEventListener(someInstance/ObjectDescriptor, "property-change", {criteria in options}
            and when something passes through that match that, we tell them. Let's say an object want to know if one of it's proeprty changes, then if the target is an instance client side, it could still have a criteria that qualifies the list of properties changes, or expressions, that the listener is interested in. These expressions apply to the event sent or the object itself?
            server side, this would have to add an additional criteria for that object's primary key + whatever else was there. Lots of work there to finalize the design, but the point is, no data operation should show up that isn't expected. It's more turning the current steps we have for fetching an object property we have today but get disconstructed when that single request is complete, and kind of leaving something there, where instead of looking up a promise associated with the query, we dispatch the read update arriving and based on what was registered, it should find it's way to the listeners that will put things where they belong to. Which means that between the listener's listening instructions registered and the content of the read-update, we have enough to get it done. I think the operation is just on the type itself, and the listener's has the state to funnel it in the right place in the object graph. DataTriggers have all of it, as they are essemtially object's property controllers. So if a dataTrigger where to call addEventListener("property-change"), then that first step should trigger an inital read to acquire the first value, whatever comes next would be happenig triggered by someone else.



        The matching readUpdate would be sent back to the client as they come, where they will be mapped, except that today, the mapped objects are added to the main stream of the propery query, but sub-fetches are meant to fill data object proprties/arrays, and we don't have streams for that. So unless the client keep driving the queries as it does now with fetchObject properties and we have a a logic flow in olace to handle what comes back, if we want to do real push, which we needs to do for:
                        - preemptve fetching for increased performance
                        - true collaboration where parallel users see each others updates. By definition that means adding objects to a local graph that were not asked for or expected.

        From a data operation stand point, only when the intial read operation -plus- all derived readupdate have been sent to the client, send a read-completed referring the inital one. We could return a bunch as batches as well. At which point teh initial query is fulfilled along with the whole subgraph that was requested with it.

        12/26:

        We should be using converters to create a query that has all the logic to use their expressions. But. Converters are meant to go from Raw Data to Object and vice-versa. When we get here, we're squarely in RawData plane, we don't have objects, though we could, but that would be a waste of energy and resources. We still should use the converter's expressions as they're telling us what to join on.

        So we need a mapObjectDescriptorRawDataReadExpressionToReadOperation


    */

    handleReadOperation: {
        value: function (readOperation) {

            /*
                Until we solve more efficiently (lazily) how RawDataServices listen for and receive data operations, we have to check wether we're the one to deal with this:
            */
            if(!this.handlesType(readOperation.target)) {
                return;
            }

            this.performReadOperation(readOperation);
        }
    },

    performReadOperation: {
        value: function performReadOperation(readOperation) {

            var rawDataOperation,
                iReadOperation,
                objectDescriptor = readOperation.target,
                self = this,
                readOperationExecutedCount = 0,
                readOperations,
                firstPromise,
                readOperationsCount;

            if(readOperation.rawDataOperation) {
                rawDataOperation = readOperation.rawDataOperation;
            } else {
                rawDataOperation = {};
                readOperations = this.mapReadOperationToRawReadOperation(readOperation, rawDataOperation);
            }


            if(rawDataOperation.error) {
                var errorOperation = this.responseOperationForReadOperation(readOperation.referrer ? readOperation.referrer : readOperation, rawDataOperation.error, null, false);
                /*
                    If we pass responseOperationForReadOperation the readOperation.referrer if there's one, we end up with the right clientId ans right referrerId, but the wrong target, so for now, reset it to what it should be:
                */
                    errorOperation.target = objectDescriptor;
                objectDescriptor.dispatchEvent(errorOperation);
                return;
            }

            readOperationsCount = readOperations?.length || 0;

            // if(readOperation.target.name === "ServiceEngagement") {
            //     if(readOperation.criteria && readOperation.criteria.expression) {
            //         console.log("------------------> readOperation.criteria.expression:",readOperation.criteria.expression);
            //     }
            //   console.log("------------------> rawDataOperation.sql:",rawDataOperation.sql);
            // }

            //console.debug("------------------> rawDataOperation:",rawDataOperation);

            firstPromise = new Promise(function (resolve, reject) {

                if(rawDataOperation.sql) {
                    self.executeStatement(rawDataOperation, function (err, data) {
                        var isNotLast;

                        readOperationExecutedCount++;

                        isNotLast = (readOperationsCount - readOperationExecutedCount + 1/*the current/main one*/) > 0;


                        if(err) {
                            console.error("handleReadOperation Error: readOperation:",readOperation, "rawDataOperation: ",rawDataOperation, "error: ",err);

                            if(err.name === "BadRequestException") {

                                if(err.message.startsWith("ERROR: relation ")
                                && (err.message.indexOf(" does not exist") !== -1)) {
                                    err.name = DataOperationErrorNames.ObjectStoreMissing;
                                }

                                if(readOperation.criteria && readOperation.criteria.expression) {
                                    console.log("------------------> readOperation.criteria.expression:",readOperation.criteria.expression);
                                    console.log("------------------> rawDataOperation.sql:",rawDataOperation.sql);
                                }
                            }
                        }


                        /*
                            If the readOperation has a referrer, it's a readOperation created by us to fetch an object's property, so we're going to use that.
                        */

                        var operation = self.responseOperationForReadOperation(readOperation.referrer ? readOperation.referrer : readOperation, err, (data && (data.rows || data.records)), isNotLast);
                        /*
                            If we pass responseOperationForReadOperation the readOperation.referrer if there's one, we end up with the right clientId ans right referrerId, but the wrong target, so for now, reset it to what it should be:
                        */
                        operation.target = objectDescriptor;
                        //objectDescriptor.dispatchEvent(operation);
                        if(err) {
                            reject(operation);
                        } else {
                            resolve(operation);
                        }

                    }, readOperation);
                } else {
                    readOperationExecutedCount++;

                    var operation = self.responseOperationForReadOperation(readOperation.referrer ? readOperation.referrer : readOperation, null, [], undefined);
                    resolve(operation);
                }

            });

                /*
                    now we loop on all the other -nested- read operations
                */
            return firstPromise.then(function(firstReadUpdateOperation) {
                if(readOperationsCount > 0) {

                    for(i=0, countI = readOperationsCount;(i<countI); i++) {
                        iReadOperation = readOperations[i];

                        if(iReadOperation.target !== readOperation.target) {
                            console.log("A");
                        }

                        self.performReadOperation(iReadOperation)
                        .then(function(responseOperation) {
                            var isNotLast;

                            readOperationExecutedCount++;
                            isNotLast = (readOperationsCount - readOperationExecutedCount +1) > 0;

                            if (isNotLast) {
                                responseOperation.type = DataOperation.Type.ReadUpdateOperation;
                            } else {
                                responseOperation.type = DataOperation.Type.ReadCompletedOperation;
                            }
                            responseOperation.target.dispatchEvent(responseOperation);

                        });

                    }

                    firstReadUpdateOperation.type = DataOperation.Type.ReadUpdateOperation;
                    objectDescriptor.dispatchEvent(firstReadUpdateOperation);
                }
                /*
                    Only if we're a root readOperation, we dispatch the result, otherwise it's handled within the logic of the root to orchestrate readUpdate/ReadCompletedOperation
                */
                else if(!readOperation.referrer) {
                    firstReadUpdateOperation.type = DataOperation.Type.ReadCompletedOperation;
                    objectDescriptor.dispatchEvent(firstReadUpdateOperation);
                }
                return firstReadUpdateOperation;
            }, function(errorOperation) {
                objectDescriptor.dispatchEvent(errorOperation);
            });

            //});
            //}
        }
    },

    _performAndDisPatchRawReadOperation: {
        value: function() {

        }
    },

    mapHandledReadResponseToOperation: {
        value: function(readOperation, err, data, isNotLast) {
            var operation = new DataOperation();

            operation.referrerId = readOperation.id;
            operation.target = readOperation.target;

            //Carry on the details needed by the coordinator to dispatch back to client
            // operation.connection = readOperation.connection;
            operation.clientId = readOperation.clientId;
            //console.log("executed Statement err:",err, "data:",data);

            if (err) {
                // an error occurred
                //console.log("!!! handleRead FAILED:", err, err.stack, rawDataOperation.sql);
                operation.type = DataOperation.Type.ReadFailedOperation;
                //Should the data be the error?
                operation.data = err;
            }
            else {
                // successful response

                //If we need to take care of readExpressions, we can't send a ReadCompleted until we have returnes everything that we asked for.
                if(isNotLast) {
                    operation.type = DataOperation.Type.ReadUpdateOperation;
                } else {
                    operation.type = DataOperation.Type.ReadCompletedOperation;
                }

                //We provide the inserted record as the operation's payload
                operation.data = data.records;
            }
            return operation;
        }
    },


    /*
        handleEventRead: {
            value: function(readOperation) {
                var operation = new DataOperation(),
                objectDescriptor = this.objectDescriptorWithModuleId(readOperation.dataDescriptor);
                ;

                operation.referrerId = readOperation.id;
                operation.dataDescriptor = readOperation.dataDescriptor;

                //Carry on the details needed by the coordinator to dispatch back to client
                // operation.connection = readOperation.connection;
                operation.clientId = readOperation.clientId;

                return this.googleDataService.handleEventRead(readOperation).
                then(function(rawEvents) {
                    operation.type = DataOperation.Type.ReadCompletedOperation;
                    //We provide the inserted record as the operation's payload
                    operation.data = rawEvents;

                    //Not needed anymore as we request data as json
                    //operation._rawReadExpressionIndexMap = rawReadExpressionMap;
                    objectDescriptor.dispatchEvent(operation);
                },function(error) {
                    operation.type = DataOperation.Type.ReadFailedOperation;
                    //Should the data be the error?
                    operation.data = err;
                    objectDescriptor.dispatchEvent(operation);

                });

                return this.handleRead(readOperation);
            }
        },
    */

    /*
      overriden to efficently counters the data structure
      returned by AWS RDS DataAPI efficently
    */
    addOneRawData: {
        value: function (stream, rawData, context) {
            if(!this.useDataAPI) {
                return this.super(stream, rawData.to_jsonb, context);
            } else {
                return this.super(stream, JSON.parse(rawData[0].stringValue), context);
            }
        }
    },


    persistObjectDescriptors: {
        value: function (objectDescriptors) {
            return this;
        }
    },


    /**
     * Public method invoked by the framework during the conversion from
     * an operation to a raw operation.
     * Designed to be overriden by concrete RawDataServices to allow fine-graine control
     * when needed, beyond transformations offered by an _ObjectDescriptorDataMapping_ or
     * an _ExpressionDataMapping_
     *
     * @method
     * @argument {DataOperation} object - An object whose properties must be set or
     *                             modified to represent the raw data oepration.
     * @argument {?} context     - The value that was passed in to the
     *                             [addRawData()]{@link RawDataService#addRawData}
     *                             call that invoked this method.
     */
    mapToRawOperation: {
        value: function (dataOperation) {
        }
    },

    _createPrimaryKeyColumnTemplate: {
        value: `id uuid NOT NULL DEFAULT :schema.gen_random_uuid()`
    },

    primaryKeyColumnDeclaration: {
        value: function () {

        }
    },

    mapObjectDescriptorRawPropertyToRawType: {
        value: function (objectDescriptor, rawProperty, _mapping, _propertyDescriptor, _rawDataMappingRule) {
            var mapping = _mapping || (objectDescriptor && this.mappingForType(objectDescriptor)),
                propertyDescriptor = _propertyDescriptor,
                mappingRule,
                propertyName;

            if(mapping.rawDataPrimaryKeys.includes(rawProperty)) {
                return "uuid";
            } else {
                var rawDataDescriptor = this.rawDataDescriptorForObjectDescriptor(objectDescriptor),
                    schemaPropertyDescriptor = rawDataDescriptor && rawDataDescriptor.propertyDescriptorForName(rawProperty);

                if(schemaPropertyDescriptor) {
                    return schemaPropertyDescriptor.valueType;
                } else {
                    /*
                        @marchant: Now that we've built the rawDataDescriptor, we shouldn't need to do this anymore, keeping in case I'm wrong
                    */
                    if(!propertyDescriptor) {
                        mappingRule = mapping.objectMappingRuleForPropertyName(rawProperty);
                        // propertyName = mappingRule ? mappingRule.sourcePath : rawProperty;
                        // propertyDescriptor = objectDescriptor.propertyDescriptorForName(propertyName);
                        propertyDescriptor = mapping.propertyDescriptorForRawPropertyName(rawProperty);
                    }
                    return this.mapPropertyDescriptorToRawType(propertyDescriptor, mappingRule);

                }

            }
        }
    },


/*

{
    "Point": {
        1:`geometry(pointz,${reverter.projection})`,
        -1:`geometry(pointz,${reverter.projection})`

    }
}




*/
















    /*
    Mapping dates:
    https://www.postgresql.org/docs/9.5/datatype-datetime.html
    https://www.postgresql.org/docs/9.5/functions-datetime.html

    The Date.prototype.getTime() method returns the number of milliseconds* since the Unix Epoch.

    * JavaScript uses milliseconds as the unit of measurement, whereas Unix Time is in seconds.


    Use the to_timestamp() postgres function:

    `insert into times (time) values (to_timestamp(${Date.now()} / 1000.0))`
    shareimprove this answer
    edited Mar 19 '17 at 11:06
    answered Mar 19 '17 at 9:12

    Udi
    19.7k55 gold badges7272 silver badges100100 bronze badges
    4
    By way of explanation for this answer, JavaScript Date.now() returns the number of milliseconds since the Unix Epoch (1 Jan 1970). PostgreSQL to_timestamp(…) converts a single argument, interpreted as the number of seconds since the Unix Epoch into a PosgtreSQL timestamp. At some point, the JavaScript value needs to be divided by 1000. You could also write to_timestamp(${Date.now()/1000}). – Manngo Mar 19 '17 at 9:36
    Thanks didn't knew that PostgreSQL uses seconds instead of milliseconds, so sadly there will be a data loss... – Alexey Petrushin Mar 19 '17 at 10:49
    1
    To keep milliseconds, use / 1000.0 instead. I have fixed my answer above. – Udi Mar 19 '17 at 11:07
    2
    Why is the ${ } syntax needed? – Edward Oct 4 '17 at 17:50
    It is string injection. You can write 'INSERT INTO times (time) VALUES (to_timestamp(' + Date.now() /1000.0 + '))' too. @Edward – Capan Oct 8 at 15:25

    */

    mapPropertyDescriptorToRawType: {
        value: function (propertyDescriptor, rawDataMappingRule, valueType, valueDescriptor) {
            var propertyDescriptorValueType = valueType ? valueType : propertyDescriptor.valueType,
                propertyDescriptorCollectionValueType = propertyDescriptor.collectionValueType,
                reverter = rawDataMappingRule ? rawDataMappingRule.reverter : null,
                //For backward compatibility, propertyDescriptor.valueDescriptor still returns a Promise....
                //propertyValueDescriptor = propertyDescriptor.valueDescriptor;
                //So until we fix this, tap into the private instance variable that contains what we want:
                propertyValueDescriptor = valueDescriptor ? valueDescriptor : propertyDescriptor._valueDescriptorReference,
                cardinality = propertyDescriptor.cardinality,
                rawType;

            //No exception to worry about so far
            if(propertyDescriptor.isLocalizable) {
                return "jsonb";
            }
            else if (propertyValueDescriptor) {
                if(propertyValueDescriptor.object === Date) {
                    rawType = "timestamp with time zone";//Defaults to UTC which is what we want
                    if (cardinality === 1) {
                        //We probably need to restrict uuid to cases where propertyDescriptorValueType is "object"
                        return rawType;
                    } else {
                        return (rawType+"[]");
                    }
                }
                else if (propertyValueDescriptor.object === Range) {

                    if(propertyDescriptorValueType === "date") {
                        rawType = "tstzrange";
                    }
                    else if(propertyDescriptorValueType === "number") {
                        rawType = "numrange";
                    } else if(propertyDescriptorValueType === "duration") {
                        rawType = `${this.connection.schema}.intervalrange`;
                    } else {
                        throw new Error("Unable to mapPropertyDescriptorToRawType",propertyDescriptor,rawDataMappingRule);
                    }

                    if (cardinality === 1) {
                        //We probably need to restrict uuid to cases where propertyDescriptorValueType is "object"
                        return rawType;
                    } else {
                        return (rawType+"[]");
                    }

                } else if (reverter && reverter instanceof RawEmbeddedValueToObjectConverter) {
                    // if(propertyDescriptorValueType === "array") {
                    //     return "jsonb[]"
                    // } else {
                        return "jsonb";
                    //}
                } else if (reverter && reverter instanceof WktToGeometryConverter) {
                    /*
                        https://www.pgcasts.com/episodes/geolocations-using-postgis

                        . The geography type can receive up to two arguments.

                        The first argument is an optional type modifier, which can be used to restrict the kinds of shapes and dimensions allowed for the column. Since we are going to be using latitude and longitude coordinates, we can pass point as our type modifier.

                        The second argument is an optional spatial resource identifier, or SRID. If the SRID option is omitted, the geography column will default to a value of 4326, which is the SRID for WGS 84, the World Geodetic System of 1984, and the standard for the Global Positioning System.

                        http://postgis.net/workshops/postgis-intro/geometries.html
                    */
                   var  geometryLayout = (reverter.convertingGeometryLayout || "XYZ").substring(2),
                        arraySuffix = (cardinality === 1) ? "" : "[]";

                        return `geometry(GEOMETRY${geometryLayout},${(reverter.convertingSRID || "4326")})${arraySuffix}`;

                } else if (propertyValueDescriptor instanceof Enum) {
                    //Test propertyValueDescriptor values:
                    var aMember = propertyValueDescriptor.members[0],
                        aMemberValue = propertyValueDescriptor[aMember];
                    if(typeof aMemberValue === "number") {
                        rawType = "smallint";
                    } else {
                        rawType = this.mapPropertyDescriptorValueTypeToRawType(propertyDescriptorValueType);
                    }

                    if (cardinality === 1) {
                        //We probably need to restrict uuid to cases where propertyDescriptorValueType is "object"
                        return rawType;
                    } else {
                        return (rawType+"[]");
                    }

                } else {
                    //Let's check if we have info on the type of the promary key:
                    var propertyValueDescriptorMapping =  this.rootService.mappingForType(propertyValueDescriptor),
                        primaryKeyPropertyDescriptors = propertyValueDescriptorMapping && propertyValueDescriptorMapping.primaryKeyPropertyDescriptors,
                        primaryKeyType;

                    if(primaryKeyPropertyDescriptors) {
                        if(primaryKeyPropertyDescriptors.length > 1) {
                            throw "Phront Service doesn't support multi-part primary keys";
                        } else {
                            primaryKeyType = this.mapPropertyDescriptorValueTypeToRawType(primaryKeyPropertyDescriptors[0].valueType);
                        }
                    } else {
                        primaryKeyType = "uuid";
                    }


                    if (cardinality === 1) {
                        //We probably need to restrict uuid to cases where propertyDescriptorValueType is "object"
                        return primaryKeyType;
                    } else {
                        return (primaryKeyType+"[]");
                    }
                }
            }
            else {
                if (propertyDescriptorCollectionValueType === "range") {
                    if(propertyDescriptorValueType === "date") {
                        rawType = "tstzrange";
                    }
                    else if(propertyDescriptorValueType === "number") {
                        rawType = "numrange";
                    } else if(propertyDescriptorValueType === "duration") {
                        /*
                            this is  a custom type defined in data/main.mod/raw-model/intervalrange.sql

                            We need to find a way in mappings to be able to execute that kind of sql when we create the storage for an ObjectDescriptor.
                        */
                        rawType = `${this.connection.schema}.intervalrange`;
                    } else {
                        throw new Error("Unable to mapPropertyDescriptorToRawType",propertyDescriptor,rawDataMappingRule);
                    }

                    if (cardinality === 1) {
                        //We probably need to restrict uuid to cases where propertyDescriptorValueType is "object"
                        return rawType;
                    } else {
                        return (rawType+"[]");
                    }

                }
                else if (propertyDescriptor.cardinality === 1) {
                    return this.mapPropertyDescriptorValueTypeToRawType(propertyDescriptorValueType);
                } else {
                    //We have a cardinality of n. The propertyDescriptor.collectionValueType should tell us if it's a list or a map
                    //But if we don't have a propertyValueDescriptor and propertyDescriptorValueType is an array, we don't know what
                    //kind of type would be in the array...
                    //We also don't know wether these objects should be stored inlined as JSONB for example. A valueDescriptor just
                    //tells what structured object is expected as value in JS, not how it is stored. That is a SQL Mapping's job.
                    //How much of expression data mapping could be leveraged for that?

                    //If it's to-many and objets, we go for jsonb
                    if (propertyDescriptorValueType === "object") {
                        return "jsonb";
                    }
                    else return this.mapPropertyDescriptorValueTypeToRawType(propertyDescriptorValueType) + "[]";
                }

            }
        }
    },


    indexTypeForPropertyDescriptorWithRawDataMappingRule: {
        value: function (propertyDescriptor, rawDataMappingRule, valueDescriptor) {

            //Add support for propertyDescriptor of schemaObjectDescriptor
            if(propertyDescriptor.hasOwnProperty("indexType")) {
                return propertyDescriptor.indexType;
            } else {

                var indexType = null,
                    reverter = rawDataMappingRule ? rawDataMappingRule.reverter : null,
                    //For backward compatibility, propertyDescriptor.valueDescriptor still returns a Promise....
                    //propertyValueDescriptor = propertyDescriptor.valueDescriptor;
                    //So until we fix this, tap into the private instance variable that contains what we want:
                    propertyValueDescriptor = valueDescriptor ? valueDescriptor : propertyDescriptor._valueDescriptorReference;

                if (propertyValueDescriptor) {
                    if ((propertyValueDescriptor.name === "Range") || (reverter && reverter instanceof WktToGeometryConverter)) {
                        indexType = "GIST";
                    } else if (reverter && (
                            reverter instanceof RawEmbeddedValueToObjectConverter ||
                            reverter instanceof KeyValueArrayToMapConverter
                            )
                        ) {
                        indexType = "GIN";
                    } else if (propertyDescriptor.cardinality === 1) {
                        indexType = "HASH";
                    }
                    else {
                        indexType = "GIN";
                    }
                }
                //If propertyValueDescriptor isn't a relationship then we only index of specifically
                //asked for it.
                else if (propertyDescriptor.isSearchable) {
                    if (propertyDescriptor.cardinality === 1) {
                        indexType = "BTREE";
                    } else {
                        //for jsonb or arrays
                        indexType = "GIN";
                    }
                }
                return indexType;
            }
        }
    },
    mapSearchablePropertyDescriptorToRawIndex: {
        value: function (objectDescriptor, propertyDescriptor, rawDataMappingRule, columnName) {

            var tableName = this.tableForObjectDescriptor(objectDescriptor),
                rawPropertyName = columnName ? columnName : (rawDataMappingRule ? rawDataMappingRule.targetPath : propertyDescriptor.name),
                indexType = this.indexTypeForPropertyDescriptorWithRawDataMappingRule(propertyDescriptor, rawDataMappingRule),
                propertyDescriptorType = propertyDescriptor.valueType,
                reverter = rawDataMappingRule ? rawDataMappingRule.reverter : null,
                schemaName = this.connection.schema;

            if(indexType) {
                return `CREATE INDEX "${tableName}_${rawPropertyName}_idx" ON "${schemaName}"."${tableName}" USING ${indexType} ("${rawPropertyName}");`;
            }
            return null;
        }
    },

    /*

       "timeRange": {
          "prototype": "montage/core/meta/property-descriptor",
          "values": {
              "name": "timeRange",
              "valueType": "date",
              "collectionValueType": "range",
              "valueDescriptor": {"@": "range"}
          }
      },

      needs to be saved as TSTZRANGE

    */

    mapPropertyDescriptorValueTypeToRawType: {
        value: function (propertyDescriptorType) {

            if (propertyDescriptorType === "string" || propertyDescriptorType === "URL") {
                return "text";
            }
            //This needs moore informtion from a property descriptor regarding precision, sign, etc..
            else if (propertyDescriptorType === "number") {
                return "decimal";
            }
            else if (propertyDescriptorType === "boolean") {
                return "boolean";
            }
            else if (propertyDescriptorType === "date") {
                return "timestamp with time zone";//Defaults to UTC which is what we want
            }
            else if (propertyDescriptorType === "array" || propertyDescriptorType === "list") {
                //FIXME THIS IS WRONG and needs to be TENPORARY
                return "text[]";
            }
            else if (propertyDescriptorType === "object") {
                // if() {

                // } else {
                return "jsonb";
                //}
            }
            else {
                console.warn("mapPropertyDescriptorToRawType: unable to map " + propertyDescriptorType + " to RawType - using 'text'");
                return "text";
            }
        }
    },


    /**
     * see:
     * https://www.postgresql.org/docs/10/pgcrypto.html
     *
     * The accepted types are: des, xdes, md5 and bf.
     *
     * @type {string}
     * @default "bf"
     */

    encryptionSaltHashingAlgorithm: {
        value: "bf" //Blowfish
    },

    /**
     * see:
     * https://www.postgresql.org/docs/10/pgcrypto.html
     *
     * For the algorithms that have one: bf and xdes
     *
     * @type {number}
     * @default 10
     */
    encryptionSaltHashingAlgorithmIterationCount: {
        value: 10
    },

    mapPropertyDescriptorValueToRawValue: {
        value: function (propertyDescriptor, value, rawPropertyName, type, dataOperation) {
            if (value === null || value === "" || value === undefined) {
                return "NULL";
            }
            else if (typeof value === "string") {
                /*
                    Modeled after:
                    https://www.postgresql.fastware.com/blog/further-protect-your-data-with-pgcrypto

                    and many similar examples
                */

                var escapedValue = escapeString(value, type, propertyDescriptor);
                if(propertyDescriptor?.isOneWayEncrypted) {
                    if(dataOperation && (dataOperation.type === DataOperation.Type.CreateOperation || dataOperation.type === DataOperation.Type.UpdateOperation)) {
                        return `${this.connection.schema}.crypt(${escapedValue}, ${this.connection.schema}.gen_salt('${this.encryptionSaltHashingAlgorithm}'${this.encryptionSaltHashingAlgorithmIterationCount ? ','+this.encryptionSaltHashingAlgorithmIterationCount : ""}))`;
                    } else {
                        //For read, we use the name of the colum that contains the encrypted value as the salt
                        return `${this.connection.schema}.crypt(${escapedValue}, ${rawPropertyName})`;
                    }
                } else {
                    return escapedValue;
                }
            }
            else {
                return prepareValue(value, type, propertyDescriptor);
            }
        }
    },
    mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression: {
        value: function (propertyDescriptor, value, rawPropertyName, type, dataOperation) {
            var mappedValue = this.mapPropertyDescriptorValueToRawValue(propertyDescriptor, value, rawPropertyName, type, dataOperation);
            // if(mappedValue !== "NULL" && (Array.isArray(value) || typeof value === "string")) {
            //   return `'${mappedValue}'`;
            // }
            return mappedValue;
        }
    },
    // mapPropertyDescriptorValueToRawValue: {
    //     value: function (propertyDescriptor, value, type) {
    //         if (value == null || value == "") {
    //             return "NULL";
    //         }
    //         else if (typeof value === "string") {
    //             return escapeString(value);
    //         }
    //         else {
    //             return prepareValue(value, type);
    //         }
    //     }
    // },


    /*
    CREATE TABLE phront."_Collection"
      (
          id uuid NOT NULL DEFAULT phront.gen_random_uuid(),
          title character varying COLLATE pg_catalog."default",
          description character varying COLLATE pg_catalog."default",
          "descriptionHtml" text COLLATE pg_catalog."default",
          "productsArray" uuid[],
          CONSTRAINT "Collection_pkey" PRIMARY KEY (id)
      )
      WITH (
          OIDS = FALSE
      )
      TABLESPACE pg_default;

      ALTER TABLE phront."_Collection"
          OWNER to postgres;
    */



    /**
     * Called by a mapping before doing it's mapping work, giving the data service.
     * an opportunity to intervene.
     *
     * Subclasses should override this method to influence how are properties of
     * the raw mapped data to data objects:
     *
     * @method
     * @argument {Object} mapping - A DataMapping object handing the mapping.
     * @argument {Object} rawData - An object whose properties' values hold
     *                             the raw data.
     * @argument {Object} object - An object whose properties must be set or
     *                             modified to represent the raw data.
     * @argument {?} context     - The value that was passed in to the
     *                             [addRawData()]{@link RawDataService#addRawData}
     *                             call that invoked this method.
     */
    willMapRawDataToObject: {
        value: function (mapping, rawData, object, context) {
            //Amazon RDS Data API returns records as an array of each result for
            //a property in an index matching the order used in the select.
            //rawReadExpressionIndexMap contains the map from propertyName to that index
            //when it was constructed. We need to leverage this to make it look like
            //it's a usual key/value record.
            var rawReadExpressionIndexMap = context;
            //
            return rawData;
        }
    },

    tableForObjectDescriptor: {
        value: function (objectDescriptor) {
            //Hard coded for now, should be derived from a mapping telling us n which databaseName that objectDescriptor is stored
            return objectDescriptor.name;
        }
    },

    /*

    SELECT (SELECT row_to_json(_) FROM (SELECT pg_class.oid, pg_class.relname) as _) FROM pg_class
    JOIN pg_catalog.pg_namespace n ON n.oid = pg_class.relnamespace
    WHERE pg_class.relkind = 'r' and n.nspname = 'phront'

    returns

    {"oid":"74136","relname":"spatial_ref_sys"}
    {"oid":"165366","relname":"Object"}
    {"oid":"165397","relname":"Service"}
    */

    /**
     * Adds a mapping to the service for the specified
     * type.
     *
     * Overrides to build the list of types to fetch to get their
     * OID:
     *
     * @param {DataMapping} mapping.  The mapping to use.
     * @param {ObjectDescriptor} type.  The object type.
     */
    addMappingForType: {
        value: function (mapping, type) {
            this.super(mapping, type);

            (this._rawTypesToFetch || (this._rawTypesToFetch = [])).push(mapping.rawDataTypeName);
        }
    },

    _rawTypesToFetch: {
        value: null
    },


    /**
     * Reads Type's OIDs (unique IDs) from PostgreSQL schema.
     *
     * @method
     * @argument {DataOperation} dataOperation - The dataOperation to execute
  `  * @returns {Promise} - The Promise for the execution of the operation
     */
    handleRawTypeOIDRead: {
        value: function (createOperation) {
            var data = createOperation.data;

            var rawDataOperation = {},
                objectDescriptor = createOperation.target;

            //This adds the right access key, db name. etc... to the RawOperation.
            this.mapOperationToRawOperationConnection(createOperation, rawDataOperation);


            var self = this,
                record = {};

            /*
                SELECT (SELECT row_to_json(_) FROM (SELECT pg_class.oid, pg_class.relname) as _) FROM pg_class
                JOIN pg_catalog.pg_namespace n ON n.oid = pg_class.relnamespace
                WHERE pg_class.relkind = 'r' and n.nspname = 'phront'
            */
            rawDataOperation.sql = this._mapCreateOperationToSQL(createOperation, rawDataOperation, record);
            //console.log(sql);
            return new Promise(function (resolve, reject) {
                self.executeStatement(rawDataOperation, function (err, data) {
                    var operation = self.mapHandledCreateResponseToOperation(createOperation, err, data, record);
                    resolve(operation);
                });
            });
    }
    },


    /**
     * Adds child Services to the receiving service.
     *
     * Overrides to build the list of types to fetch to get their
     * OID:
     *
     * @param {Array.<DataServices>} childServices. childServices to add.
     */
    addChildServices: {
        value: function (childServices) {
            this.super(childServices);

            //Now trigger the fetch for oid

        }
    },

    // _columnSQLForColumnName: {
    //     value: function(columnName, columnType) {

    //     }
    // }

    _buildObjectDescriptorColumnAndIndexString : {
        value: function _buildColumnString(objectDescriptor, columnName, columnType, propertyDescriptor, mappingRule, columnsDone, colunmnStrings, colunmnIndexStrings) {
            if(!columnsDone.has(columnName)) {

                columnsDone.add(columnName);

                var columnSQL = `  ${escapeIdentifier(columnName)} ${columnType}`;
                if (columnType === 'text') {
                    columnSQL = `${columnSQL} COLLATE pg_catalog."default"`;
                }

                // if (colunmnStrings.length > 0) {
                //     columnSQL += ',\n';
                // }
                colunmnStrings.push(columnSQL);


                var iIndex = this.mapSearchablePropertyDescriptorToRawIndex(objectDescriptor, propertyDescriptor, mappingRule, columnName);
                if(iIndex) {
                    // if (colunmnIndexStrings.length) {
                    //     indexSQL += "\n";
                    // }
                    colunmnIndexStrings.push(iIndex);
                }
            }
        }
    },

    _columnNamesByObjectDescriptor: {
        value: undefined
    },


    _rawDataDescriptorByObjectDescriptor: {
        value: undefined
    },

    rawDataDescriptorForObjectDescriptor: {
        value: function(objectDescriptor) {
            return this._rawDataDescriptorByObjectDescriptor.get(objectDescriptor) || this.buildRawDataDescriptorForObjectDescriptor(objectDescriptor);
        }
    },

    _buildColumnNamesForObjectDescriptor:  {
        value: function(objectDescriptor) {
            var rawDataDescriptor = this.rawDataDescriptorForObjectDescriptor(objectDescriptor),
                colunmns = new Set(rawDataDescriptor.propertyDescriptorNamesIterator);

            this._columnNamesByObjectDescriptor.set(objectDescriptor,colunmns);

            return colunmns;
        }
    },

    buildRawDataDescriptorForObjectDescriptor: {
        value: function(objectDescriptor) {
            var mapping = objectDescriptor && this.mappingForType(objectDescriptor);

            /* For example for Date or Map */
            if(!mapping) {
                return null;
            }

            var rawDataDescriptor,
                schemaPropertyDescriptors,
                propertyDescriptors = Array.from(objectDescriptor.propertyDescriptors),
                parentDescriptor,
                colunmns = new Set(),
                i, iSchemaPropertyDescriptor, iPropertyDescriptor, iPropertyDescriptorName, iIndexType, iPropertyDescriptorValueDescriptor, iDescendantDescriptors, iObjectRule, iRule,
                isMapPropertyDescriptor,
                converterforeignDescriptorMappings,
                iObjectRuleSourcePathSyntax,
                iPropertyDescriptorRawProperties,
                j, countJ,jProperty,
                columnName,
                columnType,
                keyArrayColumn,
                valueArrayColumn;


            //mapping.rawDataDescriptor =
            rawDataDescriptor = new ObjectDescriptor();
            rawDataDescriptor.name = this.tableForObjectDescriptor(objectDescriptor);
            schemaPropertyDescriptors = rawDataDescriptor.propertyDescriptors;

            //Cummulate inherited propertyDescriptors:
            parentDescriptor = objectDescriptor.parent;
            while ((parentDescriptor)) {
                if (parentDescriptor.propertyDescriptors && propertyDescriptors.length) {
                    propertyDescriptors.concat(parentDescriptor.propertyDescriptors);
                }
                parentDescriptor = parentDescriptor.parent;
            }

            //Before we start the loop, we add the primaryKey:
            iSchemaPropertyDescriptor = new PropertyDescriptor().initWithNameObjectDescriptorAndCardinality("id",rawDataDescriptor,1);
            iSchemaPropertyDescriptor.valueType = "uuid";
            rawDataDescriptor.addPropertyDescriptor(iSchemaPropertyDescriptor);
            // iSchemaPropertyDescriptor.owner = rawDataDescriptor;
            // schemaPropertyDescriptors.push(iSchemaPropertyDescriptor);
            colunmns.add(iSchemaPropertyDescriptor.name);

            for (i = propertyDescriptors.length - 1; (i > -1); i--) {
                iPropertyDescriptor = propertyDescriptors[i];

                //If iPropertyDescriptor isDerived, it has an expresssion
                //that make it dynamic based on other properties, it doesn't
                //need a materialized/concrete storage in a column.
                if(iPropertyDescriptor.isDerived) continue;

                //.valueDescriptor still returns a promise
                isMapPropertyDescriptor = (iPropertyDescriptor._keyDescriptorReference != null || iPropertyDescriptor.keyType != null);
                iPropertyDescriptorValueDescriptor = iPropertyDescriptor._valueDescriptorReference;
                iDescendantDescriptors = iPropertyDescriptorValueDescriptor ? iPropertyDescriptorValueDescriptor.descendantDescriptors : null;
                iObjectRule = mapping.objectMappingRuleForPropertyName(iPropertyDescriptor.name);
                iRule = iObjectRule && mapping.rawDataMappingRuleForPropertyName(iObjectRule.sourcePath);
                converterforeignDescriptorMappings = iObjectRule && iObjectRule.converter && iObjectRule.converter.foreignDescriptorMappings;
                iObjectRuleSourcePathSyntax = iObjectRule && iObjectRule.sourcePathSyntax;

                /*
                    If it's a property points to an object descriptor with descendants,
                    we need to implement the support for a polymorphic Associations implementation
                    with the Exclusive Belongs To (AKA Exclusive Arc) strategy.

                    Details at:
                    https://hashrocket.com/blog/posts/modeling-polymorphic-associations-in-a-relational-database#exclusive-belongs-to-aka-exclusive-arc-

                    many resources about this, another one:
                    https://www.slideshare.net/billkarwin/practical-object-oriented-models-in-sql/30-Polymorphic_Assocations_Exclusive_ArcsCREATE_TABLE

                    this means creating a column/foreignKEy for each possible destination in descendants


                */

                //if(iPropertyDescriptorValueDescriptor && iDescendantDescriptors && iObjectRuleSourcePathSyntax && iObjectRuleSourcePathSyntax.type === "record") {
                if(converterforeignDescriptorMappings) {
                    columnType = this.mapPropertyDescriptorToRawType(iPropertyDescriptor, iRule);

                    //If cardinality is 1, we need to create a uuid columne, if > 1 a uuid[]
                    var cardinality = iPropertyDescriptor.cardinality,
                        jRawProperty,
                        k, countK, kPropertyDescriptor;

                    for(j=0, countJ = converterforeignDescriptorMappings.length;(j<countJ);j++) {
                        jRawProperty = converterforeignDescriptorMappings[j].rawDataProperty;

                        iSchemaPropertyDescriptor = new PropertyDescriptor().initWithNameObjectDescriptorAndCardinality(jRawProperty,rawDataDescriptor,iPropertyDescriptor.cardinality);
                        iSchemaPropertyDescriptor.valueType = columnType;
                        rawDataDescriptor.addPropertyDescriptor(iSchemaPropertyDescriptor);
                        // iSchemaPropertyDescriptor.owner = rawDataDescriptor;
                        // schemaPropertyDescriptors.push(iSchemaPropertyDescriptor);

                        iIndexType = this.indexTypeForPropertyDescriptorWithRawDataMappingRule(iPropertyDescriptor, iRule);
                        if(iIndexType) {
                            iSchemaPropertyDescriptor.indexType = iIndexType;
                        }

                        colunmns.add(iSchemaPropertyDescriptor.name);

                    }

                } else if(isMapPropertyDescriptor) {
                    if(iObjectRuleSourcePathSyntax && iObjectRuleSourcePathSyntax.type !== "record") {
                        /*
                            The map is stored as 1 array of a custom postgres type for an entry built for the type of teh key and the type  of the value, with a convention on names,
                                see  ../raw-model/create-postgresql-map-entry-type-sql-format.js
                            so it can be reused throughout the model/schema.
                        */

                        throw "Can't create key and column array columns with expression '"+iObjectRule.sourcePath+"'";
                    } else {
                        /*
                            The map is stored as two arrays, 1 for keys and one for values, where the same index builds the key-value entry
                        */
                        iIndexType = this.indexTypeForPropertyDescriptorWithRawDataMappingRule(iPropertyDescriptor, iRule);

                        //The keys
                        keyArrayColumn = iObjectRuleSourcePathSyntax.args.keys.args[1].value;
                        columnType = this.mapPropertyDescriptorToRawType(iPropertyDescriptor, iRule, iPropertyDescriptor.keyType, iPropertyDescriptor._keyDescriptorReference);

                        iSchemaPropertyDescriptor = new PropertyDescriptor().initWithNameObjectDescriptorAndCardinality(keyArrayColumn,rawDataDescriptor,iPropertyDescriptor.cardinality);
                        iSchemaPropertyDescriptor.valueType = columnType;
                        rawDataDescriptor.addPropertyDescriptor(iSchemaPropertyDescriptor);
                        // iSchemaPropertyDescriptor.owner = rawDataDescriptor;
                        // schemaPropertyDescriptors.push(iSchemaPropertyDescriptor);

                        if(iIndexType) {
                            iSchemaPropertyDescriptor.indexType = iIndexType;
                        }

                        colunmns.add(iSchemaPropertyDescriptor.name);


                         //The values
                        valueArrayColumn = iObjectRuleSourcePathSyntax.args.values.args[1].value;
                        columnType = this.mapPropertyDescriptorToRawType(iPropertyDescriptor, iRule, iPropertyDescriptor.valueType, iPropertyDescriptor._valueDescriptorReference);

                        iSchemaPropertyDescriptor = new PropertyDescriptor().initWithNameObjectDescriptorAndCardinality(valueArrayColumn,rawDataDescriptor,iPropertyDescriptor.cardinality);
                        iSchemaPropertyDescriptor.valueType = columnType;
                        rawDataDescriptor.addPropertyDescriptor(iSchemaPropertyDescriptor);
                        // iSchemaPropertyDescriptor.owner = rawDataDescriptor;
                        // schemaPropertyDescriptors.push(iSchemaPropertyDescriptor);

                        if(iIndexType) {
                            iSchemaPropertyDescriptor.indexType = iIndexType;
                        }

                        colunmns.add(iSchemaPropertyDescriptor.name);
                    }


                } else {
                    //If the source syntax is a record and we have a converter, it can't become a column and has to be using a combination of other raw proeprties that have to be in propertyDescriptors
                    if(iObjectRuleSourcePathSyntax && iObjectRuleSourcePathSyntax.type === "record") {
                        var rawDataService = this.rootService.childServiceForType(iPropertyDescriptorValueDescriptor),
                            iPropertyDescriptorValueDescriptorMapping = iPropertyDescriptorValueDescriptor && rawDataService.mappingForType(iPropertyDescriptorValueDescriptor),
                        iPropertyDescriptorValueDescriptorMappingPrimaryKeyPropertyDescriptors = iPropertyDescriptorValueDescriptorMapping && iPropertyDescriptorValueDescriptorMapping.primaryKeyPropertyDescriptors;

                        //Check wether we he have these properties defined
                        iPropertyDescriptorRawProperties = Object.keys(iObjectRuleSourcePathSyntax.args);
                        for(j=0, countJ=iPropertyDescriptorRawProperties.length;(j<countJ); j++) {

                            /*
                                If we have a property defined that happens to be used as a foreign key, we'll create the properyDescriptor for that column when we loop on it
                            */
                            if(objectDescriptor.propertyDescriptorForName(iPropertyDescriptorRawProperties[j])) {
                                continue;
                            }

                            if(iPropertyDescriptorRawProperties[j] === "id") {
                                columnType = "uuid";
                            } else if(iPropertyDescriptorValueDescriptorMappingPrimaryKeyPropertyDescriptors) {
                                /*
                                    We can now only try to see if we find that property name on the other side...
                                    iPropertyDescriptor.inversePropertyDescriptor (which returns a promise) could give us a clue. Punting for now as we don't have that use-case.
                                */
                                for(k=0, countK = iPropertyDescriptorValueDescriptorMappingPrimaryKeyPropertyDescriptors.length; (k<countJ); k++) {
                                    if(iPropertyDescriptorValueDescriptorMappingPrimaryKeyPropertyDescriptors[k].name === iPropertyDescriptorRawProperties[j]) {
                                        columnType = this.mapPropertyDescriptorToRawType(iPropertyDescriptorValueDescriptorMappingPrimaryKeyPropertyDescriptors[k]);
                                    }
                                }
                            } else {
                                throw "Implementation missing for dynamically discovering the column type of raw property ' "+iPropertyDescriptorRawProperties[j]+"' in mapping of property '"+iPropertyDescriptor.name+"' of ObjectDescriptor '"+objectDescriptor.name+"'";
                            }

                            iSchemaPropertyDescriptor = new PropertyDescriptor().initWithNameObjectDescriptorAndCardinality(columnName,rawDataDescriptor,iPropertyDescriptor.cardinality);
                            iSchemaPropertyDescriptor.valueType = columnType;
                            rawDataDescriptor.addPropertyDescriptor(iSchemaPropertyDescriptor);
                            // iSchemaPropertyDescriptor.owner = rawDataDescriptor;
                            // schemaPropertyDescriptors.push(iSchemaPropertyDescriptor);

                            iIndexType = this.indexTypeForPropertyDescriptorWithRawDataMappingRule(iPropertyDescriptor, iRule);
                            if(iIndexType) {
                                iSchemaPropertyDescriptor.indexType = iIndexType;
                            }

                            colunmns.add(iSchemaPropertyDescriptor.name);


                        }
                    } else if (iRule) {
                        //In another place we used the object Rule and therefore it's sourcePath
                        //Should streamline at some point
                        columnName = iRule.targetPath;
                        //We check that we didn't already create an column with that name, faster than looking up in schemaPropertyDescriptors
                        if(!colunmns.has(columnName)) {
                            columnType = this.mapPropertyDescriptorToRawType(iPropertyDescriptor, iRule);

                            iSchemaPropertyDescriptor = new PropertyDescriptor().initWithNameObjectDescriptorAndCardinality(columnName,rawDataDescriptor,iPropertyDescriptor.cardinality);
                            iSchemaPropertyDescriptor.valueType = columnType;
                            rawDataDescriptor.addPropertyDescriptor(iSchemaPropertyDescriptor);
                            // iSchemaPropertyDescriptor.owner = rawDataDescriptor;
                            // schemaPropertyDescriptors.push(iSchemaPropertyDescriptor);

                            iIndexType = this.indexTypeForPropertyDescriptorWithRawDataMappingRule(iPropertyDescriptor, iRule);
                            if(iIndexType) {
                                iSchemaPropertyDescriptor.indexType = iIndexType;
                            }

                            colunmns.add(iSchemaPropertyDescriptor.name);
                        }

                    } else {
                        columnName = iPropertyDescriptor.name;
                        columnType = this.mapPropertyDescriptorToRawType(iPropertyDescriptor, iRule);

                        iSchemaPropertyDescriptor = new PropertyDescriptor().initWithNameObjectDescriptorAndCardinality(columnName,rawDataDescriptor,iPropertyDescriptor.cardinality);
                        iSchemaPropertyDescriptor.valueType = columnType;
                        rawDataDescriptor.addPropertyDescriptor(iSchemaPropertyDescriptor);
                        // iSchemaPropertyDescriptor.owner = rawDataDescriptor;
                        // schemaPropertyDescriptors.push(iSchemaPropertyDescriptor);

                        iIndexType = this.indexTypeForPropertyDescriptorWithRawDataMappingRule(iPropertyDescriptor, iRule);
                        if(iIndexType) {
                            iSchemaPropertyDescriptor.indexType = iIndexType;
                        }

                        colunmns.add(iSchemaPropertyDescriptor.name);

                    }

                }
            }

            this._rawDataDescriptorByObjectDescriptor.set(objectDescriptor,rawDataDescriptor);
            return rawDataDescriptor;
        }
    },

    columnNamesForObjectDescriptor: {
        value: function(objectDescriptor) {
            return this._columnNamesByObjectDescriptor.get(objectDescriptor) || this._buildColumnNamesForObjectDescriptor(objectDescriptor);
        }
    },


    //We need a mapping to go from model(schema?)/ObjectDescriptor to schema/table
    mapToRawCreateObjectDescriptorOperation: {
        value: function (dataOperation) {

            return this.createSchemaIfNeededForCreateObjectDescriptorOperation(dataOperation)
            .then(() => {

                var objectDescriptor = dataOperation.data,
                    mapping = objectDescriptor && this.mappingForType(objectDescriptor),
                    parentDescriptor,
                    tableName = this.tableForObjectDescriptor(objectDescriptor),
                    rawDataDescriptor = this.rawDataDescriptorForObjectDescriptor(objectDescriptor),
                    propertyDescriptors = Array.from(rawDataDescriptor.propertyDescriptors),
                    i, countI, iPropertyDescriptor, iPropertyDescriptorValueDescriptor, iDescendantDescriptors, iObjectRule, iRule, iIndex,
                    iObjectRules,
                    //Hard coded for now, should be derived from a mapping telling us n which databaseName that objectDescriptor is stored
                    databaseName = this.connection.database,
                    schemaName = this.connection.schema,
                    rawDataOperation = {},
                    sql = "",
                    indexSQL = "",
                    columnSQL = ',\n',
                    /*
                            parameters: [
                        {
                            name: "id",
                            value: {
                                "stringValue": 1
                            }
                        }
                    ]
                    */
                    parameters = null,
                    continueAfterTimeout = false,
                    includeResultMetadata = true,
                    columnName,
                    colunmns = new Set(),
                    colunmnStrings = [],
                    colunmnIndexStrings = [],
                    propertyValueDescriptor,
                    columnType,
                    converterforeignDescriptorMappings,
                    iObjectRuleSourcePathSyntax,
                    owner = this.connection.owner,
                    // createSchema = `CREATE SCHEMA IF NOT EXISTS "${schemaName}";`,
                    // createExtensionPgcryptoSchema = `CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA "${schemaName}";   `,
                    createTableTemplatePrefix = `CREATE TABLE IF NOT EXISTS "${schemaName}"."${tableName}"
    (
        id uuid NOT NULL DEFAULT "${schemaName}".gen_random_uuid(),
        CONSTRAINT "${tableName}_pkey" PRIMARY KEY (id)`,
                    createTableTemplateSuffix = `
    )
    WITH (
        OIDS = FALSE
    )
    TABLESPACE pg_default;

    /*ALTER TABLE ${schemaName}."${tableName}" OWNER to ${owner};*/
    CREATE UNIQUE INDEX "${tableName}_id_idx" ON "${schemaName}"."${tableName}" (id);
    `;

                this.mapOperationToRawOperationConnection(dataOperation, rawDataOperation);

                for (i = propertyDescriptors.length - 1; (i > -1); i--) {
                    iPropertyDescriptor = propertyDescriptors[i];

                    //Handled already
                    if(iPropertyDescriptor.name === "id") {
                        continue;
                    }

                    //.valueDescriptor still returns a promise
                    iPropertyDescriptorValueDescriptor = iPropertyDescriptor._valueDescriptorReference;
                    iDescendantDescriptors = iPropertyDescriptorValueDescriptor ? iPropertyDescriptorValueDescriptor.descendantDescriptors : null;
                    // iObjectRule = mapping.objectMappingRuleForPropertyName(iPropertyDescriptor.name);
                    iObjectRules = mapping.mappingRulesForRawDataProperty(iPropertyDescriptor.name);
                    for(var j=0, countJ = iObjectRules.length; (j < countJ); j++) {
                        iObjectRule = iObjectRules[j];
                        if(iObjectRule.requirements.length === 1 && iObjectRule.requirements[0] === iPropertyDescriptor.name) {
                            break;
                        }
                    }
                    iRule = iObjectRule && mapping.rawDataMappingRuleForPropertyName(iObjectRule.sourcePath);
                    converterforeignDescriptorMappings = iObjectRule && iObjectRule.converter && iObjectRule.converter.foreignDescriptorMappings;
                    iObjectRuleSourcePathSyntax = iObjectRule && iObjectRule.sourcePathSyntax;

                    columnType = iPropertyDescriptor.valueType;

                    /*
                        iPropertyDescriptor is now raw data level, we'll need to clean up
                    */
                    this._buildObjectDescriptorColumnAndIndexString(objectDescriptor, iPropertyDescriptor.name, columnType, iPropertyDescriptor, iRule, colunmns, colunmnStrings, colunmnIndexStrings);

                    /*
                        We may have to add some specical constructions for supporting map and enforcing unique arrays:
                        See:
                            https://stackoverflow.com/questions/64982146/postgresql-optimal-way-to-store-and-index-unique-array-field

                            https://stackoverflow.com/questions/8443716/postgres-unique-constraint-for-array

                    */

                }


                // sql += createSchema;
                /*
                    Creating tables isn't frequent, but we'll need to refactor this so it's one when we programmatically create the database.

                    That said, some ObjectDescriptor mappings expect some extensions to be there, like PostGIS, so we'll need to add these dependencies somewhere in teh mapping so we can include them in create extensions here.
                */
                // sql += createExtensionPgcryptoSchema;
                sql = `${sql}${createTableTemplatePrefix}`;

                if (colunmnStrings.length > 0) {
                    sql = `${sql},\n${colunmnStrings.join(',\n')}`;
                }
                sql = `${sql}${createTableTemplateSuffix}`;

                //Now add indexes:
                if(colunmnIndexStrings.length > 0) {
                    sql = `${sql}${colunmnIndexStrings.join('\n')}`;
                }

                rawDataOperation.sql = sql;
                rawDataOperation.continueAfterTimeout = continueAfterTimeout;
                rawDataOperation.includeResultMetadata = includeResultMetadata;
                //rawDataOperation.parameters = parameters;

                return rawDataOperation;
            });

        }
    },

    //We need a mapping to go from model(schema?)/ObjectDescriptor to schema/table
//     mapToRawCreateObjectDescriptorOperation_old: {
//         value: function (dataOperation) {
//             var objectDescriptor = dataOperation.data,
//                 mapping = objectDescriptor && this.mappingForType(objectDescriptor),
//                 parentDescriptor,
//                 tableName = this.tableForObjectDescriptor(objectDescriptor),
//                 propertyDescriptors = Array.from(objectDescriptor.propertyDescriptors),
//                 columnNames = this.columnNamesForObjectDescriptor(objectDescriptor),/* triggers the creation of mapping.rawDataDescriptor for now*/
//                 i, countI, iPropertyDescriptor, iPropertyDescriptorValueDescriptor, iDescendantDescriptors, iObjectRule, iRule, iIndex,
//                 //Hard coded for now, should be derived from a mapping telling us n which databaseName that objectDescriptor is stored
//                 databaseName = this.connection.database,
//                 //Hard coded for now, should be derived from a mapping telling us n which schemaName that objectDescriptor is stored
//                 schemaName = this.connection.schema,
//                 rawDataOperation = {},
//                 sql = "",
//                 indexSQL = "",
//                 columnSQL = ',\n',
//                 /*
//                         parameters: [
//                     {
//                         name: "id",
//                         value: {
//                             "stringValue": 1
//                         }
//                     }
//                 ]
//               */
//                 parameters = null,
//                 continueAfterTimeout = false,
//                 includeResultMetadata = true,
//                 columnName,
//                 colunmns = new Set(),
//                 colunmnStrings = [],
//                 colunmnIndexStrings = [],
//                 propertyValueDescriptor,
//                 columnType,
//                 owner = this.connection.owner,
//                 createSchema = `CREATE SCHEMA IF NOT EXISTS "${schemaName}";`,
//                 createExtensionPgcryptoSchema = `CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA "${schemaName}";   `,
//                 createTableTemplatePrefix = `CREATE TABLE "${schemaName}"."${tableName}"
// (
//     id uuid NOT NULL DEFAULT phront.gen_random_uuid(),
//     CONSTRAINT "${tableName}_pkey" PRIMARY KEY (id)`,
//                 createTableTemplateSuffix = `
// )
// WITH (
//     OIDS = FALSE
// )
// TABLESPACE pg_default;

// ALTER TABLE ${schemaName}."${tableName}"
//     OWNER to ${owner};
// CREATE UNIQUE INDEX "${tableName}_id_idx" ON "${schemaName}"."${tableName}" (id);
// `;

//             this.mapOperationToRawOperationConnection(dataOperation, rawDataOperation);

//             // parameters.push({
//             //   name:"schema",
//             //   value: {
//             //     "stringValue": schemaName
//             // }
//             // });
//             // parameters.push({
//             //   name:"table",
//             //   value: {
//             //     "stringValue": tableName
//             // }
//             // });
//             // parameters.push({
//             //   name:"owner",
//             //   value: {
//             //     "stringValue": "postgres"
//             // }
//             // });

//             //Cummulate inherited propertyDescriptors:
//             parentDescriptor = objectDescriptor.parent;
//             while ((parentDescriptor)) {
//                 if (parentDescriptor.propertyDescriptors && propertyDescriptors.length) {
//                     propertyDescriptors.concat(parentDescriptor.propertyDescriptors);
//                 }
//                 parentDescriptor = parentDescriptor.parent;
//             }

//             //Before we start the loop, we add the primaryKey:
//             colunmns.add("id");


//             for (i = propertyDescriptors.length - 1; (i > -1); i--) {
//                 iPropertyDescriptor = propertyDescriptors[i];

//                 //If iPropertyDescriptor isDerived, it has an expresssion
//                 //that make it dynamic based on other properties, it doesn't
//                 //need a materialized/concrete storage in a column.
//                 if(iPropertyDescriptor.isDerived) continue;

//                 //.valueDescriptor still returns a promise
//                 iPropertyDescriptorValueDescriptor = iPropertyDescriptor._valueDescriptorReference;
//                 iDescendantDescriptors = iPropertyDescriptorValueDescriptor ? iPropertyDescriptorValueDescriptor.descendantDescriptors : null;
//                 iObjectRule = mapping.objectMappingRuleForPropertyName(iPropertyDescriptor.name);
//                 iRule = iObjectRule && mapping.objectMappingRuleForPropertyName(iObjectRule.sourcePath);
//                 converterforeignDescriptorMappings = iObjectRule && iObjectRule.converter && iObjectRule.converter.foreignDescriptorMappings;
//                 iObjectRuleSourcePathSyntax = iObjectRule && iObjectRule.sourcePathSyntax;

//                 /*
//                     If it's a property points to an object descriptor with descendants,
//                     we need to implement the support for a polymorphic Associations implementation
//                     with the Exclusive Belongs To (AKA Exclusive Arc) strategy.

//                     Details at:
//                     https://hashrocket.com/blog/posts/modeling-polymorphic-associations-in-a-relational-database#exclusive-belongs-to-aka-exclusive-arc-

//                     many resources about this, another one:
//                     https://www.slideshare.net/billkarwin/practical-object-oriented-models-in-sql/30-Polymorphic_Assocations_Exclusive_ArcsCREATE_TABLE

//                     this means creating a column/foreignKEy for each possible destination in descendants


//                 */

//                 columnType = this.mapPropertyDescriptorToRawType(iPropertyDescriptor, iRule);


//                 //if(iPropertyDescriptorValueDescriptor && iDescendantDescriptors && iObjectRuleSourcePathSyntax && iObjectRuleSourcePathSyntax.type === "record") {
//                 if(converterforeignDescriptorMappings) {

//                     //If cardinality is 1, we need to create a uuid columne, if > 1 a uuid[]
//                     var cardinality = iPropertyDescriptor.cardinality,
//                         j, countJ, jRawProperty;

//                     for(j=0, countJ = converterforeignDescriptorMappings.length;(j<countJ);j++) {
//                         jRawProperty = converterforeignDescriptorMappings[j].rawDataProperty;
//                         this._buildObjectDescriptorColumnAndIndexString(objectDescriptor, jRawProperty, columnType, iPropertyDescriptor, iRule, colunmns, colunmnStrings, colunmnIndexStrings);
//                     }

//                 } else {

//                     if (iRule) {
//                         //In another place we used the object Rule and therefore it's sourcePath
//                         //Should streamline at some point
//                         columnName = iRule.targetPath;
//                     } else {
//                         columnName = iPropertyDescriptor.name;
//                     }

//                     if(!columnNames.has(columnName)) {
//                         continue;
//                     }

//                     this._buildObjectDescriptorColumnAndIndexString(objectDescriptor, columnName, columnType, iPropertyDescriptor, iRule, colunmns, colunmnStrings, colunmnIndexStrings);

//                 }

//                 /*
//                     Some many-to-many use the primary key as a way
//                     to find other rows in other table that have either an embedded foreign key (1-n), or an array of them (n-n). In which case the id is used in the right side, with a converter. So if
//                     we're in that situation, let's move on and avoid
//                     re-creating another column "id".

//                     We've been stretching the use of expression-data-mapping, we might need
//                     another mapping for the sake of storage, with a bunch of default, but can be overriden.

//                     So as a better check, once we created a column, we track it so if somehow multiple mappings use it,
//                     we won't create it multiple times.
//                 */
//                 // if(!colunmns.has(columnName)) {

//                 //     colunmns.add(columnName);


//                 //     columnSQL += this._buildColumnString(columnName, columnType);

//                 //     if (i > 0) {
//                 //         columnSQL += ',\n';
//                 //     }


//                 //     iIndex = this.mapSearchablePropertyDescriptorToRawIndex(iPropertyDescriptor, iRule);
//                 //     if(iIndex) {
//                 //         if (indexSQL.length) {
//                 //             indexSQL += "\n";
//                 //         }
//                 //         indexSQL += iIndex;
//                 //     }
//                 // }

//             }


//             sql += createSchema;
//             /*
//                 Creating tables isn't frequent, but we'll need to refactor this so it's one when we programmatically create the database.

//                 That said, some ObjectDescriptor mappings expect some extensions to be there, like PostGIS, so we'll need to add these dependencies somewhere in teh mapping so we can include them in create extensions here.
//             */
//             sql += createExtensionPgcryptoSchema;
//             sql += createTableTemplatePrefix;

//             if (colunmnStrings.length > 0) {
//                 sql += ',\n';
//                 sql += colunmnStrings.join(',\n');
//             }
//             sql += createTableTemplateSuffix;

//             //Now add indexes:
//             if(colunmnIndexStrings.length > 0) {
//                 sql += colunmnIndexStrings.join('\n');
//             }

//             rawDataOperation.sql = sql;
//             rawDataOperation.continueAfterTimeout = continueAfterTimeout;
//             rawDataOperation.includeResultMetadata = includeResultMetadata;
//             //rawDataOperation.parameters = parameters;

//             return rawDataOperation;
//         }
//     },

    _createSchemaPromise: {
        value: new Map()
    },

    createSchemaForCreateObjectDescriptorOperation: {
        value: function (dataOperation) {
            var self = this,
                databaseName = this.connection.database,
                schemaName = this.connection.schema,
                createSchemaPromise = this._createSchemaPromise.get(schemaName);

            if(!createSchemaPromise) {
                var createSchema = `CREATE SCHEMA IF NOT EXISTS "${schemaName}";`,
                createExtensionPgcryptoSchema = `CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA "${schemaName}";`,
                // instalPostGISSQL = fs.readFileSync(path.resolve(__dirname, "../raw-model/install-postGIS.sql"), 'utf8');

                createSchemaPromise = Promise.all([
                    require.async("../raw-model/install-postGIS-sql-format"),
                    require.async("../raw-model/install-postgresql-anyarray_remove-sql-format"),
                    require.async("../raw-model/install-postgresql-anyarray_concat_uniq-sql-format"),
                    require.async("../raw-model/install-postgresql-intervalrange-sql-format"),
                    require.async("../raw-model/create-postgresql-map-entry-type-sql-format")
                ])
                .then(function(resolvedValues) {
                    var rawDataOperation = {},
                        sql = `${createSchema}
                    ${createExtensionPgcryptoSchema}
                    ${resolvedValues[0].format("public")}
                    ${resolvedValues[1].format(schemaName)}
                    ${resolvedValues[2].format(schemaName)}
                    ${resolvedValues[3].format(schemaName)}`;

                    self.mapOperationToRawOperationConnection(dataOperation, rawDataOperation);
                    rawDataOperation.sql = sql;

                    return new Promise(function(resolve, reject) {
                        self.performRawDataOperation(rawDataOperation, function (err, data) {
                            if (err) {
                                // an error occurred
                                console.log(err, err.stack, rawDataOperation);
                                reject(err);
                            }
                            else {
                                resolve(true);
                            }

                        });
                    });
                });

                this._createSchemaPromise.set(schemaName,createSchemaPromise);
            }

            return createSchemaPromise;

        }
    },

    _verifySchemaPromise: {
        value: new Map()
    },
    createSchemaIfNeededForCreateObjectDescriptorOperation: {
        value: function (dataOperation) {
            var self = this,
                databaseName = this.connection.database,
                schemaName = this.connection.schema,
                verifySchemaPromise = this._verifySchemaPromise.get(schemaName);


            if(!verifySchemaPromise) {
                var rawDataOperation = {},
                    checkIfSchemaExistStatement = `SELECT schema_name FROM information_schema.schemata WHERE schema_name = '${schemaName}'`;



                this.mapOperationToRawOperationConnection(dataOperation, rawDataOperation);
                rawDataOperation.sql = checkIfSchemaExistStatement;
                verifySchemaPromise = new Promise(function(resolve, reject) {
                    self.performRawDataOperation(rawDataOperation, function (err, data) {
                        if (err) {
                            // an error occurred
                            console.log(err, err.stack, rawDataOperation);
                            reject(err);
                        }
                        else {
                            // successful response
                            console.log(data);
                            var result = self.useDataAPI ? data.records : data.rows,
                                hasSchema = (result.length === 1);

                            if(!hasSchema) {
                                self.createSchemaForCreateObjectDescriptorOperation(dataOperation)
                                .then(() => {
                                    resolve(true);
                                })
                                .catch((error) => {
                                    reject(error);
                                });
                            } else {
                                resolve(true);
                            }
                        }
                    });

                });

                this._verifySchemaPromise.set(schemaName, verifySchemaPromise);
            }

            return verifySchemaPromise;

        }
    },

    performRawDataOperation: {
        value: function (rawDataOperation, callback) {
            return this.executeStatement(rawDataOperation, callback);
        }
    },

    /**
     * Handles the mapping and execution of a DataOperation to create.
     * an ObjectDescriptor.
     *
     * @method
     * @argument {DataOperation} dataOperation - The dataOperation to execute
  `  * @returns {Promise} - The Promise for the execution of the operation
     */
    handleCreateObjectDescriptorOperation: {
        value: function (createOperation) {
            var self = this;

            this.mapToRawCreateObjectDescriptorOperation(createOperation)
            .then((rawDataOperation) => {
                //console.log("rawDataOperation: ",rawDataOperation);
                self.performRawDataOperation(rawDataOperation, function (err, data) {
                    var operation = new DataOperation();
                    operation.target = createOperation.target;
                    operation.referrerId = createOperation.id;
                    operation.clientId = createOperation.clientId;

                    if (err) {
                        // an error occurred
                        console.log(err, err.stack, rawDataOperation);
                        operation.type = DataOperation.Type.CreateFailedOperation;
                        //Should the data be the error?
                        operation.data = err;
                    }
                    else {
                        // successful response
                        //console.log(data);
                        operation.type = DataOperation.Type.CreateCompletedOperation;
                        //Not sure there's much we can provide as data?
                        operation.data = operation;
                    }

                    operation.target.dispatchEvent(operation);

                });
            });
        }
    },


    /*
        Modifying a table, when adding a property descriptor to an objectdescriptor
        ALTER TABLE table_name
        ADD COLUMN new_column_name data_type;


        //Query to get all tables:
        SELECT * FROM information_schema.tables where table_schema = 'phront';

        //Query to get a table's columns:
        SELECT * FROM information_schema.columns WHERE table_schema = 'phront' AND table_name = 'Event'

        Tables: Postgres table information can be retrieved either from the information_schema.tables view, or from the pg_catalog.pg_tables view. Below are example queries:

        select * from information_schema.tables;

        select * from pg_catalog.pg_tables;


        Schemas: This query will get the user's currently selected schema:

        select current_schema();

        These queries will return all schemas in the database:

        select * from information_schema.schemata;

        select * from pg_catalog.pg_namespace


        Databases: This query will get the user's currently selected database:

        select current_database();

        This query will return all databases for the server:

        select * from pg_catalog.pg_database


        Views: These queries will return all views across all schemas in the database:

        select * from information_schema.views

        select * from pg_catalog.pg_views;

        Columns for Tables

        This query will return column information for a table named employee:


        SELECT
            *
        FROM
            information_schema.columns
        WHERE
            table_name = 'employee'
        ORDER BY
            ordinal_position;

        Indexes

        This query will return all index information in the database:


        select * from pg_catalog.pg_indexes;

        Functions

        This query will return all functions in the database. For user-defined functions, the routine_definition column will have the function body:


        select * from information_schema.routines where routine_type = 'FUNCTION';

        Triggers

        This query will return all triggers in the database. The action_statement column contains the trigger body:


        select * from information_schema.triggers;

    */

    /**
     * Handles the mapping of a create operation to SQL.
     *
     * @method
     * @argument  {DataOperation} dataOperation - The dataOperation to map to sql
     * @argument  {DataOperation} record - The object where mapping is done
  `  * @returns   {Steing} - The SQL to perform that operation
     * @private
     */

    _mapCreateOperationToSQL: {
        value: function (createOperation, rawDataOperation, recordArgument) {
            var data = createOperation.data,
                self = this,
                mappingPromise,
                record = recordArgument || {},
                criteria = createOperation.criteria,
                operationLocales, language, region,
                sql;

            //Take care of locales
            operationLocales = createOperation.locales;
            // if(operationLocales = this.localesFromCriteria(criteria)) {
            //     //Now we got what we want, we strip it out to get back to the basic.
            //     criteria = this._criteriaByRemovingDataServiceUserLocalesFromCriteria(criteria);
            // }


            mappingPromise = this._mapObjectToRawData(data, record);
            if (!mappingPromise) {
                mappingPromise = this.nullPromise;
            }
            return mappingPromise.then(function () {

                //If the client hasn't provided one, we do:
                if (!record.id) {
                    record.id = uuid.generate();
                }

                var objectDescriptor = createOperation.target,
                    rawDataDescriptor = self.rawDataDescriptorForObjectDescriptor(objectDescriptor),
                    tableName = self.tableForObjectDescriptor(objectDescriptor),
                    schemaName = rawDataOperation.schema,
                    recordKeys = Object.keys(record),
                    escapedRecordKeys = recordKeys.map(key => escapeIdentifier(key)),
                    recordKeysValues = Array(recordKeys.length),
                    mapping = objectDescriptor && self.mappingForType(objectDescriptor),
                    // sqlColumns = recordKeys.join(","),
                    i, countI, iKey, iValue, iMappedValue, iRule, iPropertyName, iPropertyDescriptor, iRawType,
                    rawDataPrimaryKeys = mapping.rawDataPrimaryKeys,
                    sql;


                for (i = 0, countI = recordKeys.length; i < countI; i++) {
                    iKey = recordKeys[i];
                    iValue = record[iKey];

                    /*
                        In Asset mapping, the rawDataMapping rule:

                        "s3BucketName": {"<-": "s3BucketName.defined() ? s3BucketName : (s3Bucket.defined() ? s3Bucket.name : null)"},

                        involves multiple properties and mapping.propertyDescriptorForRawPropertyName() isn't sophisticated enough to sort it out.

                        It all comes down to the fact that s3BucketName is a foreignKey to a bucket and has been exposed as an object property.

                        So in that case, we're going to try to get our answer using the newer rawDataDescriptor:
                    */
                    iPropertyDescriptor = mapping.propertyDescriptorForRawPropertyName(iKey);

                    if(!iPropertyDescriptor) {
                        iPropertyDescriptor = rawDataDescriptor.propertyDescriptorForName(iKey);
                        if(iPropertyDescriptor) {
                            iRawType = iPropertyDescriptor.valueType;
                        }

                    } else {
                        iRawType = self.mapObjectDescriptorRawPropertyToRawType(objectDescriptor, iKey, mapping, iPropertyDescriptor);
                    }

                    //In that case we need to produce json to be stored in jsonb
                    if(iPropertyDescriptor && iPropertyDescriptor.isLocalizable) {
                        //We need to put the value in the right json structure.
                        if(operationLocales.length === 1) {

                            // iMappedValue = {};
                            // language = operationLocales[0].language;
                            // region = operationLocales[0].region;
                            // iMappedValue[language] = {}
                            // iMappedValue[language][region] = iValue;
                            // iMappedValue = JSON.stringify(iMappedValue);

                            iMappedValue = self.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(iPropertyDescriptor, iValue, iKey, iRawType, createOperation);
                            if(typeof iValue !== "object") {
                                language = operationLocales[0].language;
                                region = operationLocales[0].region;

                                iMappedValue = `'{"${language}":{"${region}":${iMappedValue}}}'`;
                            }
                        }
                        else if(operationLocales.length > 1) {
                            //if more than one locales, then it's a multi-locale structure
                            //We should already have a json
                            iMappedValue = self.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(iPropertyDescriptor, iValue, iKey, iRawType, createOperation);
                        }

                    } else {
                        iMappedValue = self.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(iPropertyDescriptor, iValue, iKey, iRawType, createOperation);
                    }
                    // if(iValue == null || iValue == "") {
                    //   iValue = 'NULL';
                    // }
                    // else if(typeof iValue === "string") {
                    //   iValue = escapeString(iValue);
                    //   iValue = `${iValue}`;
                    //   // iValue = escapeString(iValue);
                    //   // iValue = `'${iValue}'`;
                    // }
                    // else {
                    //   iValue = prepareValue(iValue);
                    // }
                    recordKeysValues[i] = iMappedValue;
                }

                /*
                    INSERT INTO table (column1, column2, …)
                    VALUES
                    (value1, value2, …),
                    (value1, value2, …) ,...;
                */


                sql = `INSERT INTO ${schemaName}."${tableName}" (${escapedRecordKeys.join(",")}) VALUES (${recordKeysValues.join(",")}) RETURNING id`;

                return sql;
            });
        }
    },

    /**
     * Handles the mapping and execution of a Create DataOperation.
     *
     * @method
     * @argument {DataOperation} dataOperation - The dataOperation to execute
  `  * @returns {Promise} - The Promise for the execution of the operation
     */
    handleCreateOperation: {
        value: function (createOperation) {

            /*
                Surprise... On the "client" side, I've introduced DataEvents and there's one of type "create" which is used by listeners to set a creationDate on all objects.

                Because DataEvent.create === DataOperation DataOperationType.create as strings, we end up here and we shouldn't be. Growth problem to deal with later.
            */
            if(!(createOperation instanceof DataOperation)) {
                return;
            }

            if(!this.handlesType(createOperation.target)) {
                return;
            }


            var data = createOperation.data;

            if (createOperation.data === createOperation.target._montage_metadata.moduleId.removeSuffix(".mjson")) {
                createOperation.data = createOperation.target;
                return this.handleCreateObjectDescriptorOperation(createOperation);
            } else {
                var referrer = createOperation.referrer;

                if(referrer) {

                    /*

                        WIP to process an operation part of a batch, but we'll need to come back to that.

                        Punting for now
                    */
                    return;

                    var referrerSqlMapPromises = referrer.data.sqlMapPromises || (referrer.data.sqlMapPromises = []),
                        rawOperationRecords = referrer.data.rawOperationRecords || (referrer.data.rawOperationRecords = []);

                    sqlMapPromises.push(this._mapCreateOperationToSQL(iOperation, rawDataOperation, iRecord));


                } else {
                    var rawDataOperation = {},
                    objectDescriptor = createOperation.target;

                    //This adds the right access key, db name. etc... to the RawOperation.
                    this.mapOperationToRawOperationConnection(createOperation, rawDataOperation);


                    var self = this,
                        record = {};

                    /*
                    Pointers to INSERT
                    https://www.postgresql.org/docs/8.2/sql-insert.html

                    Smarts:

                    1/ INSERT INTO public."Item" ("Id", name)
                        VALUES  ('1', 'name1'),
                                ('2', 'name2'),
                                ('3','name3')

                    ` 2/How do I insert multiple values into a postgres table at once?
                        https://stackoverflow.com/questions/20815028/how-do-i-insert-multiple-values-into-a-postgres-table-at-once
                        INSERT INTO user_subservices(user_id, subservice_id)
                        SELECT 1 id, x
                        FROM    unnest(ARRAY[1,2,3,4,5,6,7,8,22,33]) x

                    3/ To get the created ID, use the RETURNING clause
                        https://www.postgresql.org/docs/9.4/dml-returning.html
                        INSERT INTO users (firstname, lastname) VALUES ('Joe', 'Cool') RETURNING id;
                    */
                    rawDataOperation.sql = this._mapCreateOperationToSQL(createOperation, rawDataOperation, record);
                    //console.log(sql);
                    self.executeStatement(rawDataOperation, function (err, data) {
                        if(err) {
                            console.error("handleCreateOperation Error",createOperation,rawDataOperation,err);
                        }
                        var operation = self.mapHandledCreateResponseToOperation(createOperation, err, data, record);

                        operation.target.dispatchEvent(operation);
                    });
                }

            }

        }
    },

    mapHandledCreateResponseToOperation: {
        value: function(createOperation, err, data, record) {
            var operation = new DataOperation();
            operation.referrerId = createOperation.id;
            operation.clientId = createOperation.clientId;

            operation.target = createOperation.target;
            if (err) {
                // an error occurred
                console.log(err, err.stack, rawDataOperation);
                operation.type = DataOperation.Type.CreateFailedOperation;
                //Should the data be the error?
                operation.data = err;
            }
            else {
                // successful response
                operation.type = DataOperation.Type.CreateCompletedOperation;
                //We provide the inserted record as the operation's payload
                operation.data = record;
            }
            return operation;
        }
    },

    _mapResponseHandlerByOperationType: {
        value: new Map()
    },

    mapResponseHandlerForOperation: {
        value: function(operation) {
            return this._mapResponseHandlerByOperationType.get(operation.type);
        }
    },

    mapOperationResponseToOperation: {
        value: function(operation, err, data, record) {
            return this.mapResponseHandlerForOperation(operation).apply(this, arguments);
        }
    },


    /*
        Postgresql Array:
        https://www.postgresql.org/docs/9.2/functions-array.html#ARRAY-FUNCTIONS-TABLE
        https://heap.io/blog/engineering/dont-iterate-over-a-postgres-array-with-a-loop
        https://stackoverflow.com/questions/3994556/eliminate-duplicate-array-values-in-postgres

        @>	contains	ARRAY[1,4,3] @> ARRAY[3,1]

    */

    /*

        UPDATE table
            SET column1 = value1,
                column2 = value2 ,...
            WHERE
            condition;

    */




    /**
     * Handles the mapping of an update operation to SQL.
     *
     * @method
     * @argument  {DataOperation} dataOperation - The dataOperation to map to sql
     * @argument  {DataOperation} record - The object where mapping is done
  `  * @returns   {Steing} - The SQL to perform that operation
     * @private
     */

    _mapUpdateOperationToSQL: {
        value: function (updateOperation, rawDataOperation, record) {
            var data = updateOperation.data,
                self = this,
                mappingPromise,
                sql,
                objectDescriptor = updateOperation.target,
                mapping = objectDescriptor && self.mappingForType(objectDescriptor),
                criteria = updateOperation.criteria,
                rawCriteria,
                dataChanges = data,
                changesIterator,
                aProperty, aValue, addedValues, removedValues, aPropertyDescriptor,
                //Now we need to transform the operation into SQL:
                tableName = this.tableForObjectDescriptor(objectDescriptor),
                schemaName = rawDataOperation.schema,
                recordKeys = Object.keys(dataChanges),
                setRecordKeys = Array(recordKeys.length),
                // sqlColumns = recordKeys.join(","),
                i, countI, iKey, iKeyEscaped, iValue, iMappedValue, iAssignment, iRawType, iPropertyDescriptor, iPrimaryKey,
                iHasAddedValue, iHasRemovedValues, iPrimaryKeyValue,
                iKeyValue,
                dataSnapshot = updateOperation.snapshot,
                dataSnapshotKeys = dataSnapshot ? Object.keys(dataSnapshot) : null,
                condition,
                operationLocales = updateOperation.locales,
                rawExpressionJoinStatements,
                hasRawExpressionJoinStatements;


            //We need to transform the criteria into a SQL equivalent. Hard-coded for a single object for now
            //if (Object.keys(criteria.parameters).length === 1) {
                // if (criteria.parameters.hasOwnProperty("identifier")) {
                //     condition = `id = '${criteria.parameters.dataIdentifier.primaryKey}'::uuid`;
                // }
                // else if (criteria.parameters.hasOwnProperty("id")) {
                //     condition = `id = '${criteria.parameters.id}'::uuid`;
                // }
            //}

            rawCriteria = this.mapCriteriaToRawCriteria(criteria, mapping, operationLocales, (rawExpressionJoinStatements = new SQLJoinStatements()));
            condition = rawCriteria ? rawCriteria.expression : undefined;
            hasRawExpressionJoinStatements = (rawExpressionJoinStatements.size > 0);

            if (dataSnapshotKeys) {
                for (i = 0, countI = dataSnapshotKeys.length; i < countI; i++) {
                    if (condition && condition.length) {
                        //condition += " AND ";
                        condition = `${condition} AND `;
                    }
                    else {
                        condition = "";
                    }

                    iKey = dataSnapshotKeys[i];
                    iValue = dataSnapshot[iKey];
                    iPropertyDescriptor = mapping.propertyDescriptorForRawPropertyName(iKey);
                    iRawType = this.mapObjectDescriptorRawPropertyToRawType(objectDescriptor, iKey, mapping, iPropertyDescriptor);

                    if(iValue === undefined || iValue === null) {
                        //TODO: this needs to be taken care of in pgstringify as well for criteria. The problem is the operator changes based on value...
                        condition = `${condition}"${tableName}".${escapeIdentifier(iKey)} is ${this.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(iPropertyDescriptor, iValue, iKey, iRawType, updateOperation)}`;
                    } else {
                        condition = `${condition}"${tableName}".${escapeIdentifier(iKey)} = ${this.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(iPropertyDescriptor, iValue, iKey, iRawType, updateOperation)}`;
                    }
                }
            }

            /*
            this adds a value if it's not there
              UPDATE "user"
              SET    topics = topics || topicId
              WHERE  uuid = id
              AND    NOT (topics @> ARRAY[topicId]);

              //Apparenly array_agg is more performant
              //Add:
              update tabl1
              set    arr_str = (select array_agg(distinct e) from unnest(arr_str || '{b,c,d}') e)
              where  not arr_str @> '{b,c,d}';

              //Remove:
              update tabl1
              set    arr_str = arr_str || array(select unnest('{b,c,d}'::text[]) except select unnest(arr_str))
              where  not arr_str @> '{b,c,d}';


            */

            for (i = 0, countI = recordKeys.length; i < countI; i++) {
                iKey = recordKeys[i];
                iKeyEscaped = escapeIdentifier(iKey);
                iValue = dataChanges[iKey];
                iPropertyDescriptor = mapping.propertyDescriptorForRawPropertyName(iKey);
                iRawType = this.mapObjectDescriptorRawPropertyToRawType(objectDescriptor, iKey, mapping, iPropertyDescriptor);

                if (iValue == null) {
                    iAssignment = `${iKeyEscaped} = NULL`;
                } else if((iHasAddedValue = iValue.hasOwnProperty("addedValues")) || (iHasRemovedValues = iValue.hasOwnProperty("removedValues")) ) {

                    if (iHasAddedValue) {
                        iMappedValue = this.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(iPropertyDescriptor, iValue.addedValues, iKeyEscaped, iRawType, updateOperation);
                        iAssignment = `${iKeyEscaped} = ${schemaName}.anyarray_concat_uniq(${iKeyEscaped}, ${iMappedValue})`;
                    }
                    if (iHasRemovedValues) {
                        iMappedValue = this.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(iPropertyDescriptor, iValue.removedValues, iKeyEscaped, iRawType, updateOperation);
                        iAssignment = `${iKeyEscaped} = ${schemaName}.anyarray_remove(${iKeyEscaped}, ${iMappedValue})`;
                    }

                } else {

                    iMappedValue = this.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(iPropertyDescriptor, iValue, iKeyEscaped, iRawType, updateOperation);
                    //iAssignment = `${iKey} = '${iValue}'`;
                    iAssignment = `${iKeyEscaped} = ${iMappedValue}`;
                }

                setRecordKeys[i] = iAssignment;
            }

            if (!setRecordKeys || setRecordKeys.length === 0) {
                return Promise.resolve(null);
            }

            /*
                Now we need to support

                UPDATE table1
                SET table1.col1 = expression
                FROM table2
                WHERE table1.col2 = table2.col2;



            */


            sql = `UPDATE  "${schemaName}"."${tableName}" SET ${setRecordKeys.join(",")} ${hasRawExpressionJoinStatements ? "FROM" : ""} ${hasRawExpressionJoinStatements ? rawExpressionJoinStatements.fromClauseQualifiedRightDataSetsString : ""} WHERE (${condition})${hasRawExpressionJoinStatements ? " AND (" : ""}${hasRawExpressionJoinStatements ? rawExpressionJoinStatements.joinAndConditionString : ""}${hasRawExpressionJoinStatements ? ")" : ""}`;


            return Promise.resolve(sql);
        }
    },


    handleUpdateOperation: {
        value: function (updateOperation) {
            var data = updateOperation.data;

            //As target should be the ObjectDescriptor in both cases, whether the
            //operation is an instance or ObjectDescriptor operation
            //I might be better to rely on the presence of a criteria or not:
            //No criteria means it's really an operation on the ObjectDescriptor itself
            //and not on an instance
            if (data instanceof ObjectDescriptor) {
                return this.handleUpdateObjectDescriptorOperation(updateOperation);
            } else {

                /*
                    If the operation is part of a group like a batch / transaction, we punt for now
                */
                if(updateOperation.referrer) {
                    return;

                } else {

                    var rawDataOperation = {},
                        criteria = updateOperation.criteria,
                        dataChanges = data,
                        changesIterator,
                        objectDescriptor = updateOperation.target,
                        aProperty, aValue, addedValues, removedValues, aPropertyDescriptor,
                        record = {};

                    //This adds the right access key, db name. etc... to the RawOperation.
                    this.mapOperationToRawOperationConnection(updateOperation, rawDataOperation);

                    this._mapUpdateOperationToSQL(updateOperation, rawDataOperation, record)
                    .then(function(SQL) {
                        rawDataOperation.sql = SQL;

                        //console.log(sql);
                        self.executeStatement(rawDataOperation, function (err, data) {
                            if(err) {
                                console.error("handleUpdateOperation Error",updateOperation,rawDataOperation,err);
                            }
                            var operation = self.mapHandledUpdateResponseToOperation(updateOperation, err, data, record);
                            operation.target.dispatchEvent(operation);
                        });

                    }, function(error) {
                        console.error("handleUpdateOperation Error",updateOperation,rawDataOperation,err);
                        var operation = self.mapHandledUpdateResponseToOperation(updateOperation, error, null, record);
                        operation.target.dispatchEvent(operation);
                    });
                }

            }
        }
    },

    mapHandledUpdateResponseToOperation: {
        value: function(updateOperation, err, data, record) {
            var operation = new DataOperation();
            operation.referrerId = updateOperation.id;
            operation.clientId = updateOperation.clientId;
            operation.target = objectDescriptor;
            if (err) {
                // an error occurred
                console.log(err, err.stack, rawDataOperation);
                operation.type = DataOperation.Type.UpdateFailedOperation;
                //Should the data be the error?
                operation.data = err;
            }
            else {
                // successful response
                operation.type = DataOperation.Type.UpdateCompletedOperation;
                //We provide the inserted record as the operation's payload
                operation.data = record;

            }
            return operation;
        }
    },


    /**
     * Handles the mapping of a delete operation to SQL.
     *
     * @method
     * @argument  {DataOperation} dataOperation - The dataOperation to map to sql
     * @argument  {DataOperation} record - The object where mapping is done
  `  * @returns   {Steing} - The SQL to perform that operation
     * @private
     */

    _mapDeleteOperationToSQL: {
        value: function (deleteOperation, rawDataOperation, record) {
            var data = deleteOperation.data,
                self = this,
                mappingPromise,
                sql,
                criteria = deleteOperation.criteria,
                dataChanges = data,
                objectDescriptor = deleteOperation.target,
                mapping = objectDescriptor && self.mappingForType(objectDescriptor),
                aProperty, aValue, addedValues, removedValues, aPropertyDescriptor,
                //Now we need to transform the operation into SQL:
                tableName = this.tableForObjectDescriptor(objectDescriptor),
                schemaName = rawDataOperation.schema,
                i, countI, iKey, iKeyEscaped, iValue, iRawType, iPropertyDescriptor, iMappedValue, iAssignment, iPrimaryKey, iPrimaryKeyValue,
                iKeyValue,
                dataSnapshot = deleteOperation.snapshot,
                dataSnapshotKeys = dataSnapshot ? Object.keys(dataSnapshot) : null,
                condition;


            //We need to transform the criteria into a SQL equivalent. Hard-coded for a single object for now
            if (Object.keys(criteria.parameters).length === 1) {
                if (criteria.parameters.hasOwnProperty("identifier")) {
                    condition = `id = '${criteria.parameters.dataIdentifier.primaryKey}'::uuid`;
                }
                else if (criteria.parameters.hasOwnProperty("id")) {
                    condition = `id = '${criteria.parameters.id}'::uuid`;
                }
            }

            if (dataSnapshotKeys) {
                for (i = 0, countI = dataSnapshotKeys.length; i < countI; i++) {
                    if (condition && condition.length) {
                        condition = `${condition} AND `;
                    }
                    else {
                        condition = "";
                    }

                    iKey = dataSnapshotKeys[i];
                    iValue = dataSnapshot[iKey];

                    iPropertyDescriptor = mapping.propertyDescriptorForRawPropertyName(iKey);
                    iRawType = this.mapObjectDescriptorRawPropertyToRawType(objectDescriptor, iKey, mapping, iPropertyDescriptor);

                    condition = `${condition}${escapeIdentifier(iKey)} = ${this.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(iPropertyDescriptor, iValue, iKey, iRawType, deleteOperation)}`;
                }
            }

            sql = `DELETE FROM "${schemaName}"."${tableName}"
        WHERE (${condition})`;
            return Promise.resolve(sql);
        }
    },

    handleDeleteOperation: {
        value: function (deleteOperation) {

            /*
                If the operation is part of a group like a batch / transaction, we punt for now
            */
            if(deleteOperation.referrer) {
                return;
            } else {

                var data = deleteOperation.data,
                    rawDataOperation = {},
                    criteria = deleteOperation.criteria,
                    dataChanges = data,
                    objectDescriptor = deleteOperation.target,
                    aProperty, aValue, addedValues, removedValues, aPropertyDescriptor,
                    record = {};

                //This adds the right access key, db name. etc... to the RawOperation.
                this.mapOperationToRawOperationConnection(deleteOperation, rawDataOperation);

                rawDataOperation.sql = this._mapDeleteOperationToSQL(deleteOperation, rawDataOperation, record);
                //console.log(sql);
                self.executeStatement(rawDataOperation, function (err, data) {
                    var operation = self.mapHandledDeleteResponseToOperation(deleteOperation, err, data, record);
                    operation.target.dispatchEvent(operation);
                });
            }
        }
    },

    mapHandledDeleteResponseToOperation: {
        value: function(deleteOperation, err, data, record) {
            var operation = new DataOperation();
            operation.referrerId = deleteOperation.id;
            operation.clientId = deleteOperation.clientId;
            operation.target = objectDescriptor;
            if (err) {
                // an error occurred
                console.log(err, err.stack, rawDataOperation);
                operation.type = DataOperation.Type.DeleteFailedOperation;
                //Should the data be the error?
                operation.data = err;
            }
            else {
                // successful response
                operation.type = DataOperation.Type.DeleteCompletedOperation;
                //We provide the inserted record as the operation's payload
                operation.data = record;
            }
            return operation;
        }
    },

    handleCreateTransactionOperation: {
        value: function (createTransactionOperation) {

            /*
                Transition, we punt in that case, make it work right away
            */
            if(this.usePerformTransaction) {
                var operation = new DataOperation();
                operation.referrerId = createTransactionOperation.id;
                operation.clientId = createTransactionOperation.clientId;
                //We keep the same
                operation.target = createTransactionOperation.target;
                //if we punt, we don't use the dataAPI and we don't have a transactionId provided by it, so we punt
                // operation.id = data.transactionId;

                operation.type = DataOperation.Type.CreateTransactionCompletedOperation;
                //What should be the operation's payload ? The Raw Transaction Id?
                operation.data = {};
                operation.data[this.identifier] = operation.id;

                operation.target.dispatchEvent(operation);
                return;
            }

            var self = this,
                rawDataOperation = {},
                // firstObjectDescriptor,

                //For a transaction, .data holds an array of objectdescriptors that will be involved in the trabsaction
                transactionObjectDescriptors = createTransactionOperation.data.objectDescriptors;

            if (!transactionObjectDescriptors || !transactionObjectDescriptors.length) {
                throw new Error("Phront Service handleCreateTransaction doesn't have ObjectDescriptor info");
            }

            // firstObjectDescriptor = transactionObjectDescriptors[0];


            //This adds the right access key, db name. etc... to the RawOperation.
            //Right now we assume that all ObjectDescriptors in the transaction goes to the same DB
            //If not, it needs to be handled before reaching us with an in-memory transaction,
            //or leveraging some other kind of storage for long-running cases.
            this.mapOperationToRawOperationConnection(createTransactionOperation, rawDataOperation);

            createTransactionOperation.createCompletionPromiseForParticipant(this);
            // return new Promise(function (resolve, reject) {
            try {

                self.beginTransaction(rawDataOperation, function (err, data) {
                    var operation = new DataOperation();
                    operation.referrerId = createTransactionOperation.id;
                    operation.clientId = createTransactionOperation.clientId;
                    //We keep the same
                    operation.target = createTransactionOperation.target;


                    if (err) {
                        // an error occurred
                        console.log(err, err.stack, rawDataOperation);
                        operation.type = DataOperation.Type.CreateTransactionFailedOperation;
                        //Should the data be the error?
                        operation.data = err;
                        //reject(operation);
                    }
                    else {
                        // successful response
                        //For CreateTreansactionCompleted, we're going to use the id provided by the backend
                        operation.id = data.transactionId;

                        operation.type = DataOperation.Type.CreateTransactionCompletedOperation;
                        //What should be the operation's payload ? The Raw Transaction Id?
                        operation.data = {};
                        operation.data[self.identifier] = data.transactionId;

                        //console.log("+++++++ handleCreateTransactionOperation: transactionId is "+data.transactionId);
                        //resolve(operation);
                    }

                    operation.target.dispatchEvent(operation);
                    createTransactionOperation.resolveCompletionPromiseForParticipant(self);

                    //console.debug("handleAppendTransactionOperation done");

                });
            } catch(error) {
                createTransactionOperation.rejectCompletionPromiseForParticipantWithError(this,error);
            }
            // });
        }
    },

    _isAsync: {
        value: function (object) {
            return object && object.then && typeof object.then === "function";
        }
    },

    MaxSQLStatementLength: {
        value: 65536
    },

    _executeBatchStatement: {
        value: function(appendTransactionOperation, startIndex, endIndex, batchedOperations, rawDataOperation, rawOperationRecords, responseOperations) {
            var self = this;
            //Time to execute
            return new Promise(function (resolve, reject) {
                //rawDataOperation.parameterSets = [[]]; //as a work-around for batch...
                self.executeStatement(rawDataOperation, function (err, data) {
                    //var response = this;

                    if (err) {
                        console.error("_executeBatchStatement Error:",err, appendTransactionOperation, startIndex, endIndex, batchedOperations, rawDataOperation, rawOperationRecords, responseOperations);
                        console.error("_executeBatchStatement Error SQL:", rawDataOperation.sql);
                        reject(err);
                    }
                    else {
                        var i, countI, iData, iOperation, readType = DataOperation.Type.ReadOperation, iFetchesults;

                        for(i=startIndex, countI = endIndex; (i<countI); i++) {
                            iRecord = rawOperationRecords[i];
                            iOperation = batchedOperations[i];

                            //Only map back for read results, if we get it from _rdsDataClient.executeStatement ...
                            if(iOperation.type === readType) {
                                iFetchesults = data.records[i];
                                if(iFetchesults) {
                                    responseOperations[i] = self.mapOperationResponseToOperation(iOperation,err, data, iFetchesults);
                                }

                            }
                        }

                        if(batchedOperations.length > 1) {
                            var percentCompletion,
                                progressOperation = new DataOperation();

                            progressOperation.referrerId = appendTransactionOperation.referrerId;
                            progressOperation.clientId = appendTransactionOperation.clientId;
                            //progressOperation.target = transactionObjectDescriptors;
                            progressOperation.target = appendTransactionOperation.target;
                            progressOperation.type = DataOperation.Type.CommitTransactionProgressOperation;
                            if(startIndex === 0 && endIndex === 0 && batchedOperations.length === 1) {
                                percentCompletion = 1;
                            } else {
                                // percentCompletion = ((startIndex + (endIndex - startIndex)) / batchedOperations.length);
                                percentCompletion = ((endIndex + 1) / batchedOperations.length);
                            }
                            progressOperation.data = percentCompletion;
                            progressOperation.target.dispatchEvent(progressOperation);
                        }



                        // if(response.hasNextPage()) {
                        //     response.nextPage(arguments.callee);
                        // }
                        // else {
                            //Nothing more to do, we resolve
                            resolve(true);
                        //}

                        // executeStatementData.push(data);
                        // successful response
                        // operation.type = DataOperation.Type.AppendTransactionCompletedOperation;
                        // //What should be the operation's payload ? The Raw Transaction Id?
                        // operation.data = data;

                        // resolve(operation);
                    }
                });
            });
        }
    },

    rawDataOperationForOperation: {
        value: function (dataOperation) {
            if(!dataOperation._rawDataOperation) {
                this.mapOperationToRawOperationConnection(appendTransactionOperation, (dataOperation._rawDataOperation = {}));
            }
            return dataOperation._rawDataOperation;
        }
    },


    _performOperationGroupBatchedOperations: {
        value: function(appendTransactionOperation, batchedOperations, rawDataOperation, responseOperations) {
            var self = this,
                rawDataOperationHeaderLength = JSON.stringify(rawDataOperation).length,
                readOperationType = DataOperation.Type.ReadOperation,
                createOperationType = DataOperation.Type.CreateOperation,
                updateOperationType = DataOperation.Type.UpdateOperation,
                deleteOperationType = DataOperation.Type.DeleteOperation,
                sqlMapPromises = [],
                rawOperationRecords = [],
                i, countI, iOperation, iRecord, createdCount = 0;



            /*
                We're starting to dispatch a batch's operations individually, so if that's the case, we've aleady done the equivalent of that loop before we arrive here.
            */
            //Now loop on operations and create the matching sql:
            for (i = 0, countI = batchedOperations && batchedOperations.length; (i < countI); i++) {
                iOperation = batchedOperations[i];
                iRecord = {};
                rawOperationRecords[i] = iRecord;
                // if (iOperation.type === readOperationType) {
                //     this.handleRead(iOperation);
                //     // sqlMapPromises.push(Promise.resolve(this.mapReadOperationToRawStatement(iOperation, rawDataOperation)));
                // } else
                if (iOperation.type === updateOperationType) {
                    sqlMapPromises.push(this._mapUpdateOperationToSQL(iOperation, rawDataOperation,iRecord ));
                } else if (iOperation.type === createOperationType) {
                    sqlMapPromises.push(this._mapCreateOperationToSQL(iOperation, rawDataOperation, iRecord));
                    createdCount++;
                } else if (iOperation.type === deleteOperationType) {
                    sqlMapPromises.push(this._mapDeleteOperationToSQL(iOperation, rawDataOperation, iRecord));
                } else {
                    console.error("-handleAppendTransactionOperation: Operation With Unknown Type: ", iOperation);
                }
            }

            return Promise.all(sqlMapPromises)
                .then(function (operationSQL) {
                    var i, countI, iBatch = "", iStatement,
                    MaxSQLStatementLength = self.MaxSQLStatementLength,
                    batchPromises = [],
                    operationData = "",
                    executeStatementErrors = [],
                    executeStatementData = [],
                    iBatchRawDataOperation,
                    startIndex,
                    endIndex,
                    lastIndex;

                    for(i=0, startIndex=0, countI = operationSQL.length, lastIndex = countI-1;(i<countI); i++) {

                        iStatement = operationSQL[i];

                        if(!iStatement || iStatement === "") continue;

                        if( ((rawDataOperationHeaderLength+iStatement.length+iBatch.length) > MaxSQLStatementLength) || (i === lastIndex) ) {

                            if(i === lastIndex) {
                                if(iBatch.length) {
                                    iBatch = `${iBatch};\n`;
                                }
                                iBatch = `${iBatch}${iStatement};`;
                                endIndex = i;
                            } else {
                                endIndex = i-1;
                            }
                            //Time to execute what we have before it becomes too big:
                            iBatchRawDataOperation = {};
                            Object.assign(iBatchRawDataOperation,rawDataOperation);
                            //console.log("iBatch:",iBatch);
                            iBatchRawDataOperation.sql = iBatch;

                            //Right now _executeBatchStatement will create symetric response operations if we pass responseOperations as an argument. This is implemented by using the data of the original create/update operations to eventually send it back. We can do without that, but we need to re-test that when we do batch of fetches and re-activate it.
                            batchPromises.push(self._executeBatchStatement(appendTransactionOperation, startIndex, endIndex, batchedOperations, iBatchRawDataOperation, rawOperationRecords, responseOperations));

                            //Now we continue:
                            iBatch = iStatement;
                            startIndex = i;
                        } else {
                            if(iBatch.length) {
                                iBatch = `${iBatch};\n`;
                            }
                            iBatch = `${iBatch}${iStatement}`;
                        }
                    }

                    return Promise.all(batchPromises);
                })
                .catch(function (error) {
                    console.error("Error _performOperationGroupBatchedOperations:",appendTransactionOperation, batchedOperations, rawDataOperation, responseOperations );

                    throw error;

                });

        }
    },

    /*
        We listen on the mainService now. If we see our identifier in the appendTransactionOperation data, we take care of it.
    */
    _orderedTransactionOperations: {
        value: function (operations) {
            if(!Array.isArray(operations)) {
                return this._orderedTransactionOperationsByModuleId(operations);
            } else {
                return this._orderedTransactionOperationsArray(operations);
            }
        }
    },

    _orderedTransactionOperationsArray: {
        value: function (operations) {
            var i, countI,
                iOperation,
                push = Array.prototype.push,
                createOperationType = DataOperation.Type.CreateOperation,
                updateOperationType = DataOperation.Type.UpdateOperation,
                deleteOperationType = DataOperation.Type.DeleteOperation,
                createOperations,
                updateOperations,
                deleteOperations,
                orderedOperations = [];

            for(i=0, countI = operations.length; (i<countI); i++) {
                iOperation = operations[i];

                if(this.handlesType(iOperation.target)) {

                    if(iOperation.type === createOperationType) {
                        (createOperations || (createOperations = [])).push(iOperation);
                    }
                    else if(iOperation.type === updateOperationType) {
                        (updateOperations || (updateOperations = [])).push(iOperation);
                    }
                    else if(iOperation.type === deleteOperationType) {
                        (deleteOperations || (deleteOperations = [])).push(iOperation);
                    }
                }
            }

            if(createOperations?.length) {
                push.apply(orderedOperations,createOperations);
            }
            if(updateOperations?.length) {
                push.apply(orderedOperations,updateOperations);
            }
            if(deleteOperations?.length) {
                push.apply(orderedOperations,deleteOperations);
            }

            return orderedOperations;

        }
    },
   _orderedTransactionOperationsByModuleId: {
        value: function (operations) {
            var objectDescriptorModuleIds = Object.keys(operations),
                mainService = this.mainService,
                i, countI, iObjectDescriptorModuleId, iObjectDescriptor,
                iOperationsByType,
                iOperations,
                iObjectDescriptorDataService, iObjectDescriptors,
                push = Array.prototype.push,
                createOperations = [],
                updateOperations = [],
                deleteOperations = [],
                orderedOperations = [];

            for(i=0, countI = objectDescriptorModuleIds.length; (i<countI); i++) {
                iObjectDescriptorModuleId = objectDescriptorModuleIds[i];
                iObjectDescriptor = mainService.objectDescriptorWithModuleId(iObjectDescriptorModuleId);

                if(!iObjectDescriptor) {
                    console.warn("Could not find an ObjecDescriptor with moduleId "+iObjectDescriptorModuleId);
                    continue;
                } else if(this.handlesType(iObjectDescriptor)) {
                    iOperationsByType = operations[iObjectDescriptorModuleId];

                    if(iOperationsByType.createOperations) {
                        push.apply((createOperations || (createOperations = [])), iOperationsByType.createOperations);
                    }
                    if(iOperationsByType.updateOperations) {
                        push.apply((updateOperations || (updateOperations = [])), iOperationsByType.updateOperations);
                    }
                    if(iOperationsByType.deleteOperations) {
                        push.apply((deleteOperations || (deleteOperations = [])), iOperationsByType.deleteOperations);
                    }
                }
            }

            if(createOperations.length) {
                push.apply(orderedOperations,createOperations);
            }
            if(updateOperations.length) {
                push.apply(orderedOperations,updateOperations);
            }
            if(deleteOperations.length) {
                push.apply(orderedOperations,deleteOperations);
            }

            return orderedOperations;
        }
   },



    handleAppendTransactionOperation: {
        value: function (appendTransactionOperation) {

            /*
                Transition, we punt in that case
            */
            if(this.usePerformTransaction) {
                var operation = new DataOperation();
                operation.referrerId = appendTransactionOperation.id;
                operation.clientId = appendTransactionOperation.clientId;
                operation.target = appendTransactionOperation.target;
                operation.type = DataOperation.Type.AppendTransactionCompletedOperation;
                operation.data = {};
                operation.data.transactionId = appendTransactionOperation.referrerId;

                operation.target.dispatchEvent(operation);
                return;
            }

            /*
                Right now we're receiving this twice for saveChanges happening from inside the Worker.

                1. From Observing ourselves as participant in handling mainService transactions events,
                2. From that same event bubbling to the mainService which we listen to as well when handling handleAppendTransactionOperation that are sent by a client of the DataWorker.

                This needs to be cleaned up, one possibility is with our Liaison RawDataService on the client dispatching the transaction events directly in the worker, which would eliminate for RawDataServiced in the DataWorker differences between the transaction being initiated from outside vs from inside of it.

                In the meantime, if the target is ourselves and the currentTarget is not, then it means we've already done the job.
            */
            if(appendTransactionOperation.target === this && appendTransactionOperation.currentTarget !== this) {
                return;
            }


            var transactionId = appendTransactionOperation.data.rawTransactions[this.identifier];
            if(!transactionId) {
                return;
            }

            console.log("handleAppendTransactionOperation: "+appendTransactionOperation.referrerId);

            var self = this,
                operations = appendTransactionOperation.data.operations,
                batchedOperations,
                iOperation, iSQL,
                batchSQL = "",
                rawDataOperation = {},
                // firstObjectDescriptor,
                rawOperationRecords = appendTransactionOperation.data.rawOperationRecords || [],
                i, countI,
                sqlMapPromises = appendTransactionOperation.data.sqlMapPromises || [],
                iRecord,
                createdCount = 0,
                //For a transaction, .target holds an array vs a single one.
                transactionObjectDescriptors = appendTransactionOperation.target,
                rawDataOperationHeaderLength,
                responseOperations = [];

            /*
                TODO: using firstObjectDescriptor was a workaround for finding which database we should talk to.
                we need another way anyway
            */
            // if (!transactionObjectDescriptors || !transactionObjectDescriptors.length) {
            //     throw new Error("Phront Service handleCreateTransaction doesn't have ObjectDescriptor info");
            // }

            // if(transactionObjectDescriptors) {
            //     firstObjectDescriptor = this.objectDescriptorWithModuleId(transactionObjectDescriptors[0]);
            // }


            //This adds the right access key, db name. etc... to the RawOperation.
            //Right now we assume that all ObjectDescriptors in the transaction goes to the same DB
            //If not, it needs to be handled before reaching us with an in-memory transaction,
            //or leveraging some other kind of storage for long-running cases.
            if (transactionId) {
                rawDataOperation.transactionId = transactionId;
            }

            // this.mapOperationToRawOperationConnection(appendTransactionOperation, rawDataOperation);


            this.mapOperationToRawOperationConnection(appendTransactionOperation, rawDataOperation);


            /*
                operations is now an object where keys are objectDescriptor moduleIds, and value of keys are an object with the structure:
                {
                    createOperations: [op1,op2,op3,...],
                    updateOperations: [op1,op2,op3,...],
                    deleteOperations: [op1,op2,op3,...]
                }

                We might want later to make processin this generic in RawDataService.

                We were going so far for all creates, then all updates and then all deletes.

                So we need one loop to build batchedOperations that way.

                If we have a delegate, we'll give him the opportunity:

                !!!! This order only applies to the current transaction, as we append to the PG transaction and forget about everyrthing.
                If there's more than one AppendTransactionOperation event happening with partial content on each,
                today it is on the sender to enforce a global order.

                Another aspect: In order to get more immediately actionable data, in the createTransactionComplete operation, besides providing the transactionId per RawDataService's identifier, a RawDataService  could send the list of ObjectDescriptor it cares about, and in the follow up appendTransaction operations, the client could prepare diretly operations for each participating RaaDataService. We'd just have to make sure, as different RawDataServices could be interested  by the same DataOperations, that when we serialize, they are shared accross the different collections.
            */

            batchedOperations = this.callDelegateMethod("rawDataServiceWillOrderTransactionOperations", this, operations);
            if(!batchedOperations) {
                batchedOperations = this._orderedTransactionOperations(operations);
            }

            this._performOperationGroupBatchedOperations(appendTransactionOperation,batchedOperations,rawDataOperation, responseOperations)

            // rawDataOperationHeaderLength = JSON.stringify(rawDataOperation).length;


            // /*
            //     We're starting to dispatch a batch's operations individually, so if that's the case, we've aleady done the equivalent of that loop before we arrive here.
            // */
            // if(sqlMapPromises.length === 0) {
            //     //Now loop on operations and create the matching sql:
            //     for (i = 0, countI = batchedOperations && batchedOperations.length; (i < countI); i++) {
            //         iOperation = batchedOperations[i];
            //         iRecord = {};
            //         rawOperationRecords[i] = iRecord;
            //         // if (iOperation.type === readOperationType) {
            //         //     this.handleRead(iOperation);
            //         //     // sqlMapPromises.push(Promise.resolve(this.mapReadOperationToRawStatement(iOperation, rawDataOperation)));
            //         // } else
            //         if (iOperation.type === updateOperationType) {
            //             sqlMapPromises.push(this._mapUpdateOperationToSQL(iOperation, rawDataOperation,iRecord ));
            //         } else if (iOperation.type === createOperationType) {
            //             sqlMapPromises.push(this._mapCreateOperationToSQL(iOperation, rawDataOperation, iRecord));
            //             createdCount++;
            //         } else if (iOperation.type === deleteOperationType) {
            //             sqlMapPromises.push(this._mapDeleteOperationToSQL(iOperation, rawDataOperation, iRecord));
            //         } else {
            //             console.error("-handleAppendTransactionOperation: Operation With Unknown Type: ", iOperation);
            //         }
            //     }
            // }

            // /*return */Promise.all(sqlMapPromises)
            //     .then(function (operationSQL) {
            //         var i, countI, iBatch = "", iStatement,
            //         MaxSQLStatementLength = self.MaxSQLStatementLength,
            //         batchPromises = [],
            //         operationData = "",
            //         executeStatementErrors = [],
            //         executeStatementData = [],
            //         responseOperations = [],
            //         iBatchRawDataOperation,
            //         startIndex,
            //         endIndex,
            //         lastIndex;

            //         for(i=0, startIndex=0, countI = operationSQL.length, lastIndex = countI-1;(i<countI); i++) {

            //             iStatement = operationSQL[i];

            //             if(!iStatement || iStatement === "") continue;

            //             if( ((rawDataOperationHeaderLength+iStatement.length+iBatch.length) > MaxSQLStatementLength) || (i === lastIndex) ) {

            //                 if(i === lastIndex) {
            //                     if(iBatch.length) {
            //                         iBatch += ";\n";
            //                     }
            //                     iBatch += iStatement;
            //                     iBatch += ";";
            //                     endIndex = i;
            //                 } else {
            //                     endIndex = i-1;
            //                 }
            //                 //Time to execute what we have before it becomes too big:
            //                 iBatchRawDataOperation = {};
            //                 Object.assign(iBatchRawDataOperation,rawDataOperation);
            //                 iBatchRawDataOperation.sql = iBatch;

            //                 //Right now _executeBatchStatement will create symetric response operations if we pass responseOperations as an argument. This is implemented by using the data of the original create/update operations to eventually send it back. We can do without that, but we need to re-test that when we do batch of fetches and re-activate it.
            //                 batchPromises.push(self._executeBatchStatement(appendTransactionOperation, startIndex, endIndex, batchedOperations, iBatchRawDataOperation, rawOperationRecords, responseOperations));

            //                 //Now we continue:
            //                 iBatch = iStatement;
            //                 startIndex = i;
            //             } else {
            //                 if(iBatch.length) {
            //                     iBatch += ";\n";
            //                 }
            //                 iBatch += iStatement;
            //             }
            //         }

            //         return Promise.all(batchPromises)
                    .then(function() {
                        // if(executeStatementErrors.length) {
                        //     operation.type = DataOperation.Type.AppendTransactionFailedOperation;
                        //     //Should the data be the error?
                        //     if(!data) {
                        //         data = {
                        //             transactionId: transactionId
                        //         };
                        //         data.error = executeStatementErrors;
                        //     }
                        //     operation.data = data;

                        // }
                        // else {
                            // successful response
                            var operation = new DataOperation();
                            operation.referrerId = appendTransactionOperation.id;
                            //operation.referrer = appendTransactionOperation.referrer;
                            operation.clientId = appendTransactionOperation.clientId;
                            //operation.target = transactionObjectDescriptors;
                            operation.target = appendTransactionOperation.target;
                            operation.type = DataOperation.Type.AppendTransactionCompletedOperation;

                            /*
                                Aurora DataAPI doesn't really return much when it comes to a
                                updates and inserts, not that we need it to. When a batch operation is part of a saveChanges, the client has what it needs already, in which case, we don't need to send back much, except the transactionId. Which is better anyway, but it's also
                                a problem if we did as we run into the AWS API Gateway websocket payload limits. And so far we've worked around the pbm for a ReadCompleted by creating ReadUpdate in-between, ending by a read completed.

                                We can do the same with a batch, but we don't have for a batch the kind of object like a DataStream that we have for a fetch/read.

                                However, if we can execute a batch of reads/fetch, so the client sends  all the fetch at once, which will spare spawning too much lambda functions, we'll run into the same problem on the way back, unless we send back the individual reponses as read update/completed themselves, only using the batchCompleted
                                as away to know we're done. Because on the client side, they are individual reqquests created by triggers for example and client code rely on getting a response to these specifically.

                                for now, if we have a transactionId, it means a "saveChanges" we only send that back as this is the cue that we are in a saveChanges.
                            */
                            //responseOperations should be empty except for batched readcompleted operations
                            operation.data = responseOperations;
                            if (transactionId) {
                                operation.data.transactionId = transactionId;
                            }

                        //}

                        // console.log("handleAppendTransactionOperation: "+appendTransactionOperation.referrerId+".dispatchEvent",operation);

                        operation.target.dispatchEvent(operation);
                        //console.debug("handleAppendTransactionOperation done");

                        //return operation;

                    })

                .catch(function (error) {
                    var operation = new DataOperation();
                    operation.referrerId = appendTransactionOperation.id;
                    operation.clientId = appendTransactionOperation.clientId;
                    operation.target = appendTransactionOperation.target;
                        // an error occurred
                    console.log(error, error.stack, appendTransactionOperation);
                    operation.type = DataOperation.Type.AppendTransactionFailedOperation;
                    //Should the data be the error?
                    // data = {
                    //     transactionId: appendTransactionOperation.data.transactionId
                    // };
                    // data.error = error;
                    operation.data = error;

                    operation.target.dispatchEvent(operation);

                    //return Promise.reject(sqlMapError);
                });
        }
    },

    _handleTransactionEndOperation: {
        value: function (transactionEndOperation, transactionId) {
            var self = this,
                rawDataOperation = {};
                // firstObjectDescriptor,

            transactionId = transactionId
                ? transactionId
                : transactionEndOperation.data.rawTransactions
                    ? transactionEndOperation.data.rawTransactions[this.identifier]
                    : null;

            //This adds the right access key, db name. etc... to the RawOperation.
            //Right now we assume that all ObjectDescriptors in the transaction goes to the same DB
            //If not, it needs to be handled before reaching us with an in-memory transaction,
            //or leveraging some other kind of storage for long-running cases.
            if (transactionId) {
                rawDataOperation.transactionId = transactionId;
            } else {
                //No transactionId found, nothing for us to do.
                return;
            }

            this.mapOperationToRawOperationConnection(transactionEndOperation, rawDataOperation);

            //_rdsDataClient.commitTransaction & _rdsDataClient.rollbackTransaction make sure the param
            //don't have a database nor schema field, so we delete it.
            //TODO, try to find a way to instruct this.mapOperationToRawOperationConnection not to put them in if we don't want them
            delete rawDataOperation.database;
            delete rawDataOperation.schema;

            /* return new Promise(function (resolve, reject) {*/
            var method = transactionEndOperation.type === DataOperation.Type.CommitTransactionOperation
                    ? "commitTransaction"
                    : "rollbackTransaction";


            /*
                FOR DEBUG ONLY:
            */
            //method = "rollbackTransaction";

            self[method](rawDataOperation, function (err, data) {
                var operation = new DataOperation();
                operation.referrerId = transactionEndOperation.id;
                operation.clientId = transactionEndOperation.clientId;
                operation.target = transactionEndOperation.target;
                if (data && transactionId) {
                    data.rawTransactions = {};
                    data.rawTransactions[self.identifier] = transactionId;
                }
                if (err) {
                    // an error occurred
                    console.log(err, err.stack, rawDataOperation);
                    operation.type = transactionEndOperation.type === DataOperation.Type.CommitTransactionOperation ? DataOperation.Type.CommitTransactionFailedOperation : DataOperation.Type.RollbackTransactionFailedOperation;
                    //Should the data be the error?
                    operation.data = err;
                    //resolve(operation);
                }
                else {
                    // successful response
                    operation.type = transactionEndOperation.type === DataOperation.Type.CommitTransactionOperation ? DataOperation.Type.CommitTransactionCompletedOperation : DataOperation.Type.RollbackTransactionCompletedOperation;
                    //What should be the operation's payload ? The Raw Transaction Id?
                    operation.data = data;

                    //resolve(operation);
                }

                operation.target.dispatchEvent(operation);

                //console.debug("_handleTransactionEndOperation done");

            });

            /*});*/
        }
    },

    handleCommitTransactionOperation: {
        value: function (commitTransactionOperation) {

            /*
                Right now we're receiving this twice for saveChanges happening from inside the Worker.

                1. From Observing ourselves as participant in handling mainService transactions events,
                2. From that same event bubbling to the mainService which we listen to as well when handling handleAppendTransactionOperation that are sent by a client of the DataWorker.

                This needs to be cleaned up, one possibility is with our Liaison RawDataService on the client dispatching the transaction events directly in the worker, which would eliminate for RawDataServiced in the DataWorker differences between the transaction being initiated from outside vs from inside of it.

                In the meantime, if the target is ourselves and the currentTarget is not, then it means we've already done the job.
            */
            if(commitTransactionOperation.target === this && commitTransactionOperation.currentTarget !== this) {
                return;
            }

                        /*
                Transition, we punt in that case
            */
                if(this.usePerformTransaction) {
                    this.handlePerformTransactionOperation(commitTransactionOperation, true);
                    return;
                }


            //New addition: a 1 shot transaction
            if(!commitTransactionOperation.referrerId) {
                var self = this,
                rawDataOperation = {},
                batchedOperations = commitTransactionOperation.data.operations,
                responseOperations = [];

                this.mapOperationToRawOperationConnection(commitTransactionOperation, rawDataOperation);

                self.beginTransaction(rawDataOperation, function (err, data) {
                    var operation = new DataOperation();
                    operation.referrerId = commitTransactionOperation.id;
                    operation.clientId = commitTransactionOperation.clientId;

                    //We keep the same
                    operation.target = commitTransactionOperation.target;


                    if (err) {
                        // an error occurred
                        console.log(err, err.stack, rawDataOperation);
                        operation.type = DataOperation.Type.CommitTransactionFailedOperation;
                        //Should the data be the error?
                        operation.data = err;
                        operation.target.dispatchEvent(operation);
                    }
                    else {
                        // successful response
                        rawDataOperation.transactionId = data.transactionId;

                        self._performOperationGroupBatchedOperations(commitTransactionOperation, batchedOperations, rawDataOperation, responseOperations)
                        .then(function() {

                            self._handleTransactionEndOperation(commitTransactionOperation, data.transactionId);
                        });

                        //resolve(operation);
                    }


                });


            } else {
                var transactionId = commitTransactionOperation.data.rawTransactions?.[this.identifier];

                if(!transactionId) {
                    return;
                }

                /*return */this._handleTransactionEndOperation(commitTransactionOperation, transactionId);
            }
        }
    },

    /*
        To get to this ASAP, we're going to pass a flag for now
        When we have properly added the PerformTransactionOperation flow as a full-class citizen
        in the design, we won't need it anymore, the event manager doesn't dispatch a second argument anyway so it will be undefined.
    */
    handlePerformTransactionOperation: {
        value: function (performTransactionOperation, _actAsHandleCommitTransactionOperation) {
            // console.debug("handlePerformTransactionOperation: ",performTransactionOperation, _actAsHandleCommitTransactionOperation);

            /*
                Right now we're receiving this twice for saveChanges happening from inside the Worker.

                1. From Observing ourselves as participant in handling mainService transactions events,
                2. From that same event bubbling to the mainService which we listen to as well when handling handleAppendTransactionOperation that are sent by a client of the DataWorker.

                This needs to be cleaned up, one possibility is with our Liaison RawDataService on the client dispatching the transaction events directly in the worker, which would eliminate for RawDataServiced in the DataWorker differences between the transaction being initiated from outside vs from inside of it.

                In the meantime, if the target is ourselves and the currentTarget is not, then it means we've already done the job.

                Unfortunately, because OperationCoordinator right now does the triage of data operations going to each raw data service,
            */
                if(!performTransactionOperation.clientId && performTransactionOperation.target === this && performTransactionOperation.currentTarget !== this) {
                    return;
                }

            var self = this;
            this.rawClientPromise.then(() => {



                //New addition: a 1 shot transaction
                var self = this,
                    rawDataOperation = {},
                    operations = performTransactionOperation.data.operations,
                    batchedOperations,
                    responseOperations = [];

                batchedOperations = this.callDelegateMethod("rawDataServiceWillOrderTransactionOperations", this, operations);
                if(!batchedOperations) {
                    batchedOperations = this._orderedTransactionOperations(operations);
                }



                this.mapOperationToRawOperationConnection(performTransactionOperation, rawDataOperation);


                var self = this,
                //rawDataOperationHeaderLength = JSON.stringify(rawDataOperation).length,
                readOperationType = DataOperation.Type.ReadOperation,
                createOperationType = DataOperation.Type.CreateOperation,
                updateOperationType = DataOperation.Type.UpdateOperation,
                deleteOperationType = DataOperation.Type.DeleteOperation,
                sqlMapPromises = [],
                rawOperationRecords = [],
                i, countI, iOperation, iRecord, createdCount = 0;



                /*
                    We're starting to dispatch a batch's operations individually, so if that's the case, we've aleady done the equivalent of that loop before we arrive here.
                */
                //Now loop on operations and create the matching sql:
                for (i = 0, countI = batchedOperations && batchedOperations.length; (i < countI); i++) {
                    iOperation = batchedOperations[i];
                    iRecord = {};
                    rawOperationRecords[i] = iRecord;
                    // if (iOperation.type === readOperationType) {
                    //     this.handleRead(iOperation);
                    //     // sqlMapPromises.push(Promise.resolve(this.mapReadOperationToRawStatement(iOperation, rawDataOperation)));
                    // } else
                    if (iOperation.type === updateOperationType) {
                        sqlMapPromises.push(this._mapUpdateOperationToSQL(iOperation, rawDataOperation,iRecord ));
                    } else if (iOperation.type === createOperationType) {
                        sqlMapPromises.push(this._mapCreateOperationToSQL(iOperation, rawDataOperation, iRecord));
                        createdCount++;
                    } else if (iOperation.type === deleteOperationType) {
                        sqlMapPromises.push(this._mapDeleteOperationToSQL(iOperation, rawDataOperation, iRecord));
                    } else {
                        console.error("-handleAppendTransactionOperation: Operation With Unknown Type: ", iOperation);
                    }
                }

                var operation = new DataOperation();
                operation.referrerId = performTransactionOperation.id;
                operation.target = performTransactionOperation.target;
                //Carry on the details needed by the coordinator to dispatch back to client
                operation.clientId = performTransactionOperation.clientId;


                return Promise.all(sqlMapPromises)
                    .then(function (operationSQL) {
                        var i, countI, iBatch = "", iStatement,
                        MaxSQLStatementLength = Infinity,
                        batchPromises = [],
                        operationData = "",
                        executeStatementErrors = [],
                        executeStatementData = [],
                        iBatchRawDataOperation,
                        startIndex,
                        endIndex,
                        lastIndex;


                        /*
                            Looks like we're getting some handlePerformTransactionOperation/handleCommitTransactionOperation from intake raw model from the PlummingIntakeDataService, for objectDescriptors we don't handle.
                            We shouldn't
                            Until that's sorted out, if operationSQL is not an array or an empty one, because mapping realized we had no business dealing with that, we're going to punt, we shouldn't be part of it:
                        */
                       if(!operationSQL || (operationSQL && operationSQL.length === 0)) {
                           return;
                       }

                        for(i=0, startIndex=0, countI = operationSQL.length, lastIndex = countI-1;(i<countI); i++) {

                            iStatement = operationSQL[i];

                            if(!iStatement || iStatement === "") continue;

                            if( (i === lastIndex) ) {

                                if(i === lastIndex) {
                                    if(iBatch.length) {
                                        iBatch = `${iBatch};\n`;
                                    }
                                    iBatch = `${iBatch}${iStatement};`;
                                    endIndex = i;
                                } else {
                                    endIndex = i-1;
                                }
                                //Time to execute what we have before it becomes too big:
                                iBatchRawDataOperation = {};
                                Object.assign(iBatchRawDataOperation,rawDataOperation);
                                //console.log("iBatch:",iBatch);
                                iBatchRawDataOperation.sql = iBatch;

                                //Right now _executeBatchStatement will create symetric response operations if we pass responseOperations as an argument. This is implemented by using the data of the original create/update operations to eventually send it back. We can do without that, but we need to re-test that when we do batch of fetches and re-activate it.
                                //Now we continue:
                                iBatch = iStatement;
                                startIndex = i;
                            } else {
                                if(iBatch.length) {
                                    iBatch = `${iBatch};\n`;
                                }
                                iBatch = `${iBatch}${iStatement}`;
                            }
                        }



                        // callback - checkout a client
                        self.clientPool.connectForDataOperation(performTransactionOperation,(err, client, done) => {
                            if (err) {
                                operation.type = DataOperation.Type.PerformTransactionFailedOperation;
                                operation.data = err;
                                operation.target.dispatchEvent(operation);
                                return operation;
                            }

                            const shouldAbort = err => {
                                if (err) {
                                  console.error('Error in transaction', err.stack)
                                  client.query('ROLLBACK', err => {
                                    if (err) {
                                      console.error('Error rolling back client', err.stack)
                                      operation.type = _actAsHandleCommitTransactionOperation ? DataOperation.Type.CommitTransactionFailedOperation: DataOperation.Type.PerformTransactionFailedOperation;
                                      operation.data = err;
                                      operation.target.dispatchEvent(operation);
                                    }
                                    // release the client back to the pool
                                    done()
                                  })
                                }
                                return !!err
                              }

                            if(ProcessEnv.TIME_PG === "true") {
                                //var queryTimer = new Timer(iBatchRawDataOperation.sql);
                                var queryTimer = new Timer(`${performTransactionOperation.id}-${performTransactionOperation.type}`);
                            }
                            client.query('BEGIN', (err, res) => {

                                if (shouldAbort(err)) return
                                //const queryText = 'INSERT INTO users(name) VALUES($1) RETURNING id'
                                client.query(iBatchRawDataOperation.sql, undefined, (err, res) => {
                                    if (shouldAbort(err)) return
                                    client.query('COMMIT', (err, res) => {

                                        if(ProcessEnv.TIME_PG === "true") {
                                            console.debug(queryTimer.runtimeMsStr());
                                        }

                                        if (err) {
                                            console.error('Error committing transaction', err.stack)
                                            operation.type = _actAsHandleCommitTransactionOperation ? DataOperation.Type.CommitTransactionFailedOperation: DataOperation.Type.PerformTransactionFailedOperation;
                                            operation.data = err;
                                            operation.target.dispatchEvent(operation);
                                            return operation;
                                        } else {
                                            operation.type = _actAsHandleCommitTransactionOperation ? DataOperation.Type.CommitTransactionCompletedOperation: DataOperation.Type.PerformTransactionCompletedOperation;
                                            //Not sure what we could return here.
                                            operation.data = true;
                                            operation.target.dispatchEvent(operation);
                                        }
                                        done()
                                    })
                                })
                            })
                        });



                    })
                    .catch(function (error) {
                        operation.type = DataOperation.Type.PerformTransactionFailedOperation;
                        operation.data = err;
                        operation.target.dispatchEvent(operation);
                        return operation;
                    });


            })
        }
    },


    handleRollbackTransactionOperation: {
        value: function (rollbackTransactionOperation) {
            /*return */this._handleTransactionEndOperation(rollbackTransactionOperation);
        }
    },

    // Export promisified versions of the RDSDataService methods
    batchExecuteStatement: {
        value: function (params, callback) {
            //this.rawClient.batchExecuteStatement(params, callback);
            this.rawClientPromise.then(() => {
                this.rawClient.send(new BatchExecuteStatementCommand(params), callback);
            });
        }
    },

    beginTransaction: {
        value: function (params, callback) {
            if(this.useDataAPI) {
                    //this.rawClient.beginTransaction(params, callback);
                this.rawClientPromise.then(() => {
                    this.rawClient.send(new BeginTransactionCommand(params), callback);
                });
            } else {

                params.sql = "BEGIN";
                this.sendDirectStatement(params, callback);
            }
        }
    },

    commitTransaction: {
        value: function (params, callback) {
            if(this.useDataAPI) {
                // this.rawClient.commitTransaction(params, callback);
                this.rawClientPromise.then(() => {
                    this.rawClient.send(new CommitTransactionCommand(params), callback);
                });
            } else {
                params.sql = "COMMIT";
                this.sendDirectStatement(params, callback);
            }
        }
    },

    sendDirectStatement: {
        value: function (params, callback, dataOperation) {
            this.rawClientPromise.then(() => {
                // callback - checkout a client
                this.clientPool.connectForDataOperation(dataOperation, (err, client, done) => {
                  if (err) {
                    console.error("sendDirectStatement() readWriteClientPool.connect error: ",err);
                    //call `done()` to release the client back to the pool
                    done();

                    callback(err);
                  } else if(client) {

                    if(ProcessEnv.TIME_PG === "true") {
                        var queryTimer = new Timer(params.sql);
                        //var queryTimer = new Timer(`${dataOperation.id}-${dataOperation.type}`);
                    }
                    client.query(params.sql, undefined, (err, res) => {
                        if(ProcessEnv.TIME_PG === "true") {
                            console.debug("dataOperation:",dataOperation);
                            console.debug(queryTimer.runtimeMsStr());
                        }

                        //Returns the client to  the pool I assume
                        done()
                        if (err) {
                            console.error("sendDirectStatement() client.query error: ",err);
                            callback(err);
                        } else {
                            callback(null, res);
                        }
                      })
                  }

                });
            });
        }
    },

    executeStatement: {
        value: function executeStatement(params, callback, dataOperation) {
            if(this.useDataAPI) {
                //this.rawClient.executeStatement(params, callback);
                this.rawClientPromise.then(() => {
                    this.rawClient.send(new ExecuteStatementCommand(params), callback);
                });
            } else {
                this.sendDirectStatement(params, callback, dataOperation);
            }
        }
    },
    rollbackTransaction: {
        value: function rollbackTransaction(params, callback) {
            if(this.useDataAPI) {
                //this.rawClient.rollbackTransaction(params, callback);
                this.rawClientPromise.then(() => {
                    this.rawClient.send(new RollbackTransactionCommand(params), callback);
                });
            } else {
                params.sql = "ROLLBACK";
                this.sendDirectStatement(params, callback);
            }
        }
    }

});


Object.assign(PostgreSQLService.prototype, pgstringify);

