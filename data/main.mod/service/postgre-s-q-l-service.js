
var RawDataService = require("mod/data/service/raw-data-service").RawDataService,
    Montage = require("mod/core/core").Montage,
    Criteria = require("mod/core/criteria").Criteria,
    ObjectDescriptor = require("mod/core/meta/object-descriptor").ObjectDescriptor,
    RawEmbeddedValueToObjectConverter = require("mod/data/converter/raw-embedded-value-to-object-converter").RawEmbeddedValueToObjectConverter,
    KeyValueArrayToMapConverter = require("mod/core/converter/key-value-array-to-map-converter").KeyValueArrayToMapConverter,
    Range = require("mod/core/range").Range,
    WktToGeometryConverter = require("geo.mod/logic/converter/wkt-to-geometry-converter").WktToGeometryConverter,
    DataQuery = require("mod/data/model/data-query").DataQuery,
    // DataStream = (require)("mod/data/service/data-stream").DataStream,
    //Montage = (require)("mod/core/core").Montage,
    Promise = require("mod/core/promise").Promise,
    uuid = require("mod/core/uuid"),
    //DataOrdering = (require)("mod/data/model/data-ordering").DataOrdering,
    //DESCENDING = DataOrdering.DESCENDING,
    Enum = require("mod/core/enum").Enum,
    Set = require("mod/core/collections/set"),
    ObjectDescriptor = require("mod/core/meta/object-descriptor").ObjectDescriptor,
    PropertyDescriptor = require("mod/core/meta/property-descriptor").PropertyDescriptor,
    SQLJoinStatements = require("./s-q-l-join-statements").SQLJoinStatements,
    SyntaxInOrderIterator = require("mod/core/frb/syntax-iterator").SyntaxInOrderIterator,

    ObjectStoreDescriptor = require("mod/data/model/object-store.mjson").montageObject,
    ObjectPropertyStoreDescriptor = require("mod/data/model/object-property-store.mjson").montageObject,


    DataOperation = require("mod/data/service/data-operation").DataOperation,
    DataOperationErrorNames = require("mod/data/service/data-operation").DataOperationErrorNames,
    DataOperationType = require("mod/data/service/data-operation").DataOperationType,
    //PGClass = (require)("../model/p-g-class").PGClass,

    TransactionDescriptor = require("mod/data/model/transaction.mjson").montageObject,

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
    parse = require("mod/core/frb/parse"),
    syntaxProperties = require("mod/core/frb/syntax-properties"),
    path = require("path"),
    fs = require('fs'),
    Timer = require("mod/core/timer").Timer,
    SecretObjectDescriptor = require("mod/data/model/app/secret.mjson").montageObject,
    PostgreSQLClient,
    PostgreSQLClientPool,
    ReadWritePostgreSQLClientPool,
    ReadOnlyPostgreSQLClientPool,
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
const PostgreSQLService = exports.PostgreSQLService = class PostgreSQLService extends RawDataService {/** @lends PostgreSQLService */

    static {

        Montage.defineProperties(this.prototype, {
            /**
             * If true, a PostgreSQLService will automatically create a storage for an ObjectDescriptor if it's missing and causes a data operation to fail.
             * For a read, it will then return an empty array. If this happens in a transaction, it will have to re-try the transaction
             * after the table has been created.
             * 
             * @property {boolean} value
             * @default true
             */
            createsStorageForObjectDescriptorAsNeeded: { value: true}
        });
    }


    
    constructor() {
        super();

        if(this._mapResponseHandlerByOperationType.size === 0) {
            this._mapResponseHandlerByOperationType.set(DataOperationType.create, this.mapHandledCreateResponseToOperation);
            this._mapResponseHandlerByOperationType.set(DataOperationType.read, this.mapHandledReadResponseToOperation);
            this._mapResponseHandlerByOperationType.set(DataOperationType.update, this.mapHandledUpdateResponseToOperation);
            this._mapResponseHandlerByOperationType.set(DataOperationType.delete, this.mapHandledDeleteResponseToOperation);
        }

        this._columnNamesByObjectDescriptor = new Map();
        this._rawDataDescriptorByName = new Map();

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
};

// exports.PostgreSQLService = PostgreSQLService = RawDataService.specialize(/** @lends PostgreSQLService.prototype */ {

    /***************************************************************************
     * Initializing
     */

    // constructor: {
    //     value: function PostgreSQLService() {
    //         //"use strict";

    //         this.super();


    //         if(this._mapResponseHandlerByOperationType.size === 0) {
    //             this._mapResponseHandlerByOperationType.set(DataOperationType.create, this.mapHandledCreateResponseToOperation);
    //             this._mapResponseHandlerByOperationType.set(DataOperationType.read, this.mapHandledReadResponseToOperation);
    //             this._mapResponseHandlerByOperationType.set(DataOperationType.update, this.mapHandledUpdateResponseToOperation);
    //             this._mapResponseHandlerByOperationType.set(DataOperationType.delete, this.mapHandledDeleteResponseToOperation);
    //         }

    //         this._columnNamesByObjectDescriptor = new Map();
    //         this._rawDataDescriptorByObjectDescriptor = new Map();

    //         /*
    //             Shifted from listening to mainService to getting events on ourselve,
    //             as we should be in the line of propagation for the types we handle.

    //             There are going to be bugs if 2 RawDataServices handle the same type based on current implementaion, and that needs to be fixed.

    //             Either each needs to observe each types, kinda kills event delegation optimization, so we need to implement an alterative to Target.nextTarget to be able to either return an array, meaning that it could end up bifurcating, or we add an alternative called composedPath (DOM method name on Event), propagationPath (better) or targetPropagationPath, or nextTargetPath, that includes eveything till the top.
    //         */
    //         // this.addEventListener(DataOperation.Type.ReadOperation,this,false);
    //         // this.addEventListener(DataOperation.Type.UpdateOperation,this,false);
    //         // this.addEventListener(DataOperation.Type.CreateOperation,this,false);
    //         // this.addEventListener(DataOperation.Type.DeleteOperation,this,false);
    //         // this.addEventListener(DataOperation.Type.PerformTransactionOperation,this,false);
    //         // this.addEventListener(DataOperation.Type.CreateTransactionOperation,this,false);
    //         // this.addEventListener(DataOperation.Type.AppendTransactionOperation,this,false);
    //         // this.addEventListener(DataOperation.Type.CommitTransactionOperation,this,false);
    //         // this.addEventListener(DataOperation.Type.RollbackTransactionOperation,this,false);

    //         /*
    //             Kickstart loading dependencies as we always need this data service:
    //             The Promise.all() returned is cached, so it doesn't matter wether it's done or not
    //             by the time the worker's function handles the message
    //         */
    //         //this.rawClientPromises;


    //         // this._registeredConnectionsByIdentifier = new Map();
    //     }
    // },

PostgreSQLService.addClassProperties({
    canSaveData: {
        value: true
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

            //This should probably moved somehwere else now that Transaction's ObjectDescriptor is the what we listen on
            // TransactionDescriptor.addEventListener(DataOperation.Type.PerformTransactionOperation, this, false);
            // TransactionDescriptor.addEventListener(DataOperation.Type.CreateTransactionOperation, this, false);
            // TransactionDescriptor.addEventListener(DataOperation.Type.AppendTransactionOperation,this,false);
            // TransactionDescriptor.addEventListener(DataOperation.Type.CommitTransactionOperation,this,false);
            // TransactionDescriptor.addEventListener(DataOperation.Type.RollbackTransactionOperation,this,false);

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

            
            if (typeof (value = deserializer.getProperty("createsStorageForObjectDescriptorAsNeeded")) === "boolean") {
                this.createsStorageForObjectDescriptorAsNeeded = value;
            }

        
        }
    },


     //We need a mapping to go from model(schema?)/ObjectDescriptor to schema/table
     mapConnectionToRawDataOperation: {
        value: function (rawDataOperation) {
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

    _loadDatabaseCredentialsFromSecret: {
        value: function(aSecret) {
            let databaseCredentials = aSecret.value;

            this.databaseCredentials = databaseCredentials;
            if(this.clientPool) {
                //Hard-coded custom object-mapping
                this.clientPool.databaseCredentials = databaseCredentials;
            }

            return databaseCredentials;
        }
    },

    postgreSQLClientPoolWillResolveRawClientPromises: {
        value: function (clientPool, promises) {
            if(this.connection.secret) {

                let databaseCredentials = this._loadDatabaseCredentialsFromSecret(this.connection.secret);
                promises.push(Promise.resolve(databaseCredentials));

            } else {
                promises.push(new Promise( (resolve, reject) => {

                    let secretCriteria = new Criteria().initWithExpression("name == $.name", {
                            name: this.connection.secretName || `${!!this.connection.environment ? `${this.connection.environment}-` : ''}${this.currentEnvironment.stage}-${this.connection.database}-database`
                        }),
                        secretQuery = DataQuery.withTypeAndCriteria(SecretObjectDescriptor, secretCriteria);
        
                    this.mainService.fetchData(secretQuery)
                    .then((result) => {
                        if(result && result.length > 0) {
                            resolve(this._loadDatabaseCredentialsFromSecret(result[0]));
                        } else {
                            console.warn("PostgreSQLService: no secret found with name: ",secretCriteria.parameters.name);
                            resolve(null);    
                        }
                    }, (error) => {
                        //console.log("fetchData failed:",error);
                        reject(error);
                    });
        
                }));
            }
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
                ...this.connection.clientPool.rawClientPromises
            );

            return promises;
        }
    },

    // _rawClientPromise: {
    //     value: undefined
    // },

    // rawClientPromise: {
    //     get: function () {
    //         if (!this._rawClientPromise) {
    //             this._rawClientPromise = Promise.all(this.rawClientPromises).then(() => { return this.rawClient;});
    //         }
    //         return this._rawClientPromise;
    //     }
    // },

    // _rawClient: {
    //     value: undefined
    // },
    // rawClient: {
    //     get: function () {
    //         return this._rawClient;
    //     }
    // },

    connection: {
        get: function() {
            if(!this._connection) {

                /*
                    Adding a bit of logic since apparently an RDS Proxy must be in the same VPC as the database and although the database can be publicly accessible, the proxy can’t be.

                    So in working locally we need to address the database cluster directly.

                    -> https://www.stackovercloud.com/2020/06/30/amazon-rds-proxy-now-generally-available/
                */

                //If we have an connectionIdentifier, we go for it, otherwise we go for a stage-based logic
                if(this.connectionIdentifier) {
                    this.connection = this.connectionForIdentifier(this.connectionIdentifier);
                }
                else if(!this.currentEnvironment.isCloud) {
                    this.connection = this.connectionForIdentifier(this.currentEnvironment.stage);
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

            if (criteria.parameters !== undefined) {
                if (this.inlineCriteriaParameters) {
                    rawParameters = criteria.parameters;
                } else {
                    //If we could use parameters with the DataAPI (we can't because it doesn't support some types we need like uuid and uuid[]), we would need stringify to create a new set of parameters. Scope can be different objects, so instead of trying to clone whatever it is, it would be easier to modify stringify so it returns the whole new raw criteria that would contain both the expression and the new parameters bound for SQL.
                    // rawParameters = {};
                    // Object.assign(rawParameters,criteria.parameters);
                    throw new Error("postgre-s-q-l-service.js: mapCriteriaToRawCriteria doesn't handle the use of parametrized SQL query with a dictionary of parameters. If we could use parameters with the DataAPI (we can't because it doesn't support some types we need like uuid and uuid[]), we would need stringify to create a new set of parameters. Scope can be different objects, so instead of trying to clone whatever it is, it would be easier to modify stringify so it returns the whole new raw criteria that would contain both the expression and the new parameters bound for SQL. -> " + JSON.stringify(criteria) + "objectDescriptor: " + mapping.objectDescriptor.name);

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

                /*
                    TODO: having something like Device's model having "defaultExpressions": ["type.model"]
                    right now creates an infinite recursion..., which isn't too surprising, 
                    considering its self-reflecting and is intended to traverse all type relatinships
                    until it finds one. But this recursion needs to happen in SQL with a Recursive Commone Table Expression
                */
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

                                If we could rely on readExpressions being exactly what's needed, maybe we could use that: The mod client code should always include the primary key as it needs to stich things togethe when getting the data back, but in our case we would include only the column that we need, and that would tell the SQL to be just that column to be returned.

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
    /**
     * Returns the table name extracted from the passed SQL statement screen
     *
     *  ... "schema"."TableName" ...
     * 
     * @private
     * @argument {DataStream} dataStream
     */
    _tableNameFromSQLStatement: {
        value: function(rawDataOperation, error) {
            let schemaPrefix = `"${rawDataOperation.schema}"."`,
                tableNameStartIndex = rawDataOperation.sql.indexOf(schemaPrefix),
                tableNameEndIndex =  error.message.indexOf('"',tableNameStartIndex);

            return rawDataOperation.sql.substring(tableNameStartIndex+schemaPrefix.length, tableNameEndIndex-2);
        }
    },

    _objectDescriptorNameForRawDataOperationErrorExecutingDataOperation: {
        value: function(rawDataOperation, error, dataOperation) {
            let message = error.message,
                objectDescriptorName;


            if(error.name === DataOperationErrorNames.ObjectDescriptorStoreMissing) {
                objectDescriptorName = message.substring(message.indexOf(rawDataOperation.schema) + rawDataOperation.schema.length + 1, message.indexOf('" does not exist'));
            } else if(error.name === DataOperationErrorNames.PropertyDescriptorStoreMissing) {
                let tableNameStartIndex =  error.message.indexOf('relation "') + 10,
                    tableNameEndIndex =  error.message.indexOf('"',tableNameStartIndex);

                objectDescriptorName = error.message.substring(tableNameStartIndex, tableNameEndIndex);
            } else if(error.name === DataOperationErrorNames.InvalidInput) {
                //`UPDATE  "schema"."TableName" SET "status" = 'Deployed'   WHERE (...);`
                //`UPDATE  "moe_v1"."Workstation" SET "status" = 'Deployed'   WHERE ("Workstation"."id" = '01954f95-b04e-75f2-8ce2-de8927b1d407' AND "Workstation"."status" is NULL);\nUPDATE  "moe_v1"."Workstation" SET "status" = 'Deployed'   WHERE ("Workstation"."id" = '01954f95-b04f-77bf-a8d8-cb01e15dd98e' AND "Workstation"."status" is NULL);\nUPDATE  "moe_v1"."Workstation" SET "status" = 'Deployed'   WHERE ("Workstation"."id" = '01954f95-b050-7336-bdfa-275a7e0670e1' AND "Workstation"."status" is NULL);\nUPDATE  "m…L);\nUPDATE  "moe_v1"."Workstation" SET "status" = 'Configured'   WHERE ("Workstation"."id" = '01954f95-b05a-7e8d-bbb2-8a604f36c080' AND "Workstation"."status" is NULL);\nUPDATE  "moe_v1"."Workstation" SET "status" = 'Incomplete'   WHERE ("Workstation"."id" = '01954f95-b05f-75e1-92ea-5dde1a3bcdf1' AND "Workstation"."status" is NULL);\nUPDATE  "moe_v1"."Workstation" SET "status" = 'Configured'   WHERE ("Workstation"."id" = '01954f95-b060-7c5a-bf28-c3af6b9b0844' AND "Workstation"."status" is NULL);`
                objectDescriptorName = this._tableNameFromSQLStatement(rawDataOperation, error);

            } else if(error.name === DataOperationErrorNames.SyntaxError) {

                objectDescriptorName = this._tableNameFromSQLStatement(rawDataOperation, error);

            } else {
                throw "_objectDescriptorNameForRawDataOperationErrorExecutingDataOperation for unkown Error"
            }

            return objectDescriptorName;
        }
    },

    _objectDescriptorForRawDataOperationErrorExecutingDataOperation: {
        value: function(rawDataOperation, error, dataOperation) {
            let objectDescriptor;

            if(dataOperation.type.contains("Transaction")) {
                let objectDescriptorName = this._objectDescriptorNameForRawDataOperationErrorExecutingDataOperation(rawDataOperation, error, dataOperation),
                    //We could use dataOperation.data.operations if it's there to validate objectDescriptorName, but we built it in the first place
                    operationsByObjectDescriptorModuleIds = dataOperation.data.operations,
                    dataOperationModuleIds = Object.keys(operationsByObjectDescriptorModuleIds),
                    i, countI, iDataOperationModuleId, iDataOperationsByType, iDataOperationsTypes;

                for(i=0, countI = dataOperationModuleIds.length; (i<countI); i++) {
                    iDataOperationModuleId = dataOperationModuleIds[i];
                    iDataOperationsByType = operationsByObjectDescriptorModuleIds[iDataOperationModuleId];
                    iDataOperationsTypes = Object.keys(iDataOperationsByType);
                    for(let j=0, countJ = iDataOperationsTypes.length, jOperations; (j<countJ); j++) {
                        jOperations = iDataOperationsByType[iDataOperationsTypes[j]];
                        for(let k=0, countK = jOperations.length; (k < countK); k++) {
                            if(jOperations[k].target.name === objectDescriptorName) {
                                objectDescriptor = jOperations[k].target;
                                break;
                            }
                        }
                    }
                }
            } else {
                /*
                    If the rawDataOperation has speific objectDescriptor set, we use it, it's the one used for producing the SQL.
                    Otherwise we use dataOperation's target
                */
                objectDescriptor = rawDataOperation.objectDescriptor || dataOperation.target;
            }

            return objectDescriptor;
        }
    },

    mapRawDataOperationErrorToDataOperation: {
        value: function (rawDataOperation, error, dataOperation) {
            let doesNotExist = error.message.contains(" does not exist")
                isDatabaseError = error.message.contains("database "),
                isTableError = error.message.contains("relation "),
                /* error.message === 'column "identityId" of relation "WebSocketSession" does not exist'*/
                isColumnMissingError = error.message.contains("column ");

            /*
                err.message === 'invalid input syntax for type json'
                {"length":160,"name":"error","severity":"ERROR","code":"22P02","detail":"Token \\"Aitriz\\" is invalid.","position":"462","where":"JSON data, line 1: Aitriz","file":"jsonfuncs.c","line":"650","routine":"json_errsave_error"} 
            */
            if(error.code ==='42601') {
                error.name = DataOperationErrorNames.SyntaxError;
                error.cause = {
                    sql: rawDataOperation.sql
                };
                let objectDescriptor = this._objectDescriptorForRawDataOperationErrorExecutingDataOperation(rawDataOperation, error, dataOperation);
                error.objectDescriptor = objectDescriptor;

            } else if(error.code ==='22P02') {
                error.name = DataOperationErrorNames.InvalidInput;
                let objectDescriptor = this._objectDescriptorForRawDataOperationErrorExecutingDataOperation(rawDataOperation, error, dataOperation);
                error.objectDescriptor = objectDescriptor;

            } else if(error.code ==='42P01' || (doesNotExist && isTableError && !isColumnMissingError)) {
                /*
                    err.message === 'relation "mod_plum_v1.WebSocketSession" does not exist'
                */
                error.name = DataOperationErrorNames.ObjectDescriptorStoreMissing;

                let objectDescriptor = this._objectDescriptorForRawDataOperationErrorExecutingDataOperation(rawDataOperation, error, dataOperation);
                error.objectDescriptor = objectDescriptor;
            }
            else if(error.code ==='42703' || (doesNotExist && isColumnMissingError)) {
                error.name = DataOperationErrorNames.PropertyDescriptorStoreMissing;

                let rawPropertyName,
                    propertyDescriptor,
                    objectDescriptor = this._objectDescriptorForRawDataOperationErrorExecutingDataOperation(rawDataOperation, error, dataOperation),
                    mapping = this.mappingForType(objectDescriptor);

                error.objectDescriptor = objectDescriptor;

                /* 
                    error.message === 'column "identityId" of relation "WebSocketSession" does not exist'
                */
               if(error.message.contains("relation")) {
                    let rawPropertyNameStartindex = error.message.indexOf('column "') + 8,
                        rawPropertyNameEndIndex = error.message.indexOf('"', rawPropertyNameStartindex);

                    rawPropertyName = error.message.substring(rawPropertyNameStartindex, rawPropertyNameEndIndex);
               }
                /* 
                    error.message === 'column Organization.typeId does not exist' 
                */
               else if(error.message.contains(".")) {
                    let rawPropertyNameStartindex = error.message.indexOf('.') + 1,
                        rawPropertyNameEndIndex = error.message.indexOf(' ', rawPropertyNameStartindex);

                    rawPropertyName = error.message.substring(rawPropertyNameStartindex, rawPropertyNameEndIndex);
               }

                propertyDescriptor = mapping.propertyDescriptorForRawPropertyName(rawPropertyName);
                if(!propertyDescriptor && this.isObjectDescriptorStoreShared(objectDescriptor)) {
                    //We need to find objectDescriptor's descendant whose maaping will find propertyDescriptor
                    let descendantDescriptors = objectDescriptor.descendantDescriptors,
                        iDescendantMapping;
                        
                    for(let i = 0, countI = descendantDescriptors.length; (i <countI); i++) {
                        iDescendantMapping = this.mappingForType(descendantDescriptors[i]);
                        if(propertyDescriptor = iDescendantMapping.propertyDescriptorForRawPropertyName(rawPropertyName)) {
                            //Override what we set earlier
                            error.objectDescriptor = descendantDescriptors[i];
                            break;
                        }
                    }
                }

                error.rawPropertyName = rawPropertyName;
                error.propertyDescriptor = propertyDescriptor;

                console.log(objectDescriptor.name+": propertyDescriptor: ",propertyDescriptor);
            } 
            else if(doesNotExist && isDatabaseError) {
                error.name = DataOperationErrorNames.DatabaseMissing;
            }
            return error;
        }
    },

    _addMappingRawDataTypeIdentificationCriteriaPropertiesToReadExpressionsForCriteriaIfNeeded: {
        value: function(mapping, readExpressions, criteria) {
            if(mapping.isObjectStoreShared && (criteria?.name !== 'rawDataPrimaryKeyCriteria')) {
                let rawDataTypeIdentificationCriteriaProperties = mapping.rawDataTypeIdentificationCriteria.qualifiedProperties;

                for(let i = 0, countI = rawDataTypeIdentificationCriteriaProperties.length; (i < countI); i++) {
                    //Intitially,  fullModuleId has been used, we'll need to make that configurable later on
                    if(!readExpressions.includes(rawDataTypeIdentificationCriteriaProperties[i])) {
                        readExpressions.push(rawDataTypeIdentificationCriteriaProperties[i]);
                    }
                }
            }
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

            if(!rawDataOperation.dataOperation) {
                rawDataOperation.dataOperation = readOperation;
            }


            //This adds the right access key, schema, db name. etc... to the RawOperation.
            this.mapConnectionToRawDataOperation(rawDataOperation);


            var data = readOperation.data,
                // rawReadExpressionMap,

                // iRawDataOperation,
                iReadOperation,
                // iReadOperationExecutionPromise,
                // iPreviousReadOperationExecutionPromise,
                objectDescriptor = readOperation.target,
                rawDataDescriptor = this.rawDataDescriptorForObjectDescriptor(objectDescriptor),
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
                rawExpressionJoinStatements,
                isObjectDescriptorStoreShared = this.isObjectDescriptorStoreShared(readOperation.target);


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
                If we don't have instructions in the readOperation in term of what to return, we return all known objectDesscriptor's properties:
            */
            if(!readExpressions) {
                if(isObjectDescriptorStoreShared) {
                    //We need to filter out the ones that aren't mapped to the same table as objectDescriptor.
                    readExpressions = mapping.objectPropertyNamesIncludingStoredDescendants;
                } else {
                    readExpressions = objectDescriptor.propertyDescriptorNames;
                }
            } 
            /*
                Making sure that we have the right readExpression to handle object descriptors' class instances stored in the same table 
                to tell them appart. We should probably use the qualifiedProperties of 
            */
            else if(isObjectDescriptorStoreShared && (criteria?.name !== 'rawDataPrimaryKeyCriteria')) {
                let rawDataTypeIdentificationCriteriaProperties = mapping.rawDataTypeIdentificationCriteria.qualifiedProperties;

                for(let p = 0, countP = rawDataTypeIdentificationCriteriaProperties.length; (p < countP); p++) {
                    //Intitially,  fullModuleId has been used, we'll need to make that configurable later on
                    if(!readExpressions.includes(rawDataTypeIdentificationCriteriaProperties[p])) {
                        readExpressions.push(rawDataTypeIdentificationCriteriaProperties[p]);
                    }
                }

                // let mapping = this.mappingForObjectDescriptor(readOperation.target),
                //     criteria = mapping.rawDataTypeIdentificationCriteriaForDataOperation(readOperation);
                //     //Get the values we need to be sure to have in readExpressions to have what we need
                //     qualifiedProperties = criteria.qualifiedProperties,
                //     readExpressions = readOperation.data.readExpressions;

                // for(let iQualifiedProperty of qualifiedProperties) {
                //     if(!readExpressions.includes(iQualifiedProperty)) {
                //         readExpressions.push(iQualifiedProperty);
                //     }
                // }
            }


            //if (readExpressions) {
            let i, iMapping, countI, iExpression, iExpressionSyntax, isComplexExpression = false, iRawPropertyNames, iObjectRule, iPropertyDescriptor, iValueSchemaDescriptor, iValueDescriptorReference, iValueDescriptorReferenceMapping, iInversePropertyObjectRule, iRawDataMappingRules, iRawDataMappingRulesIterator,
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
                //Reset as we can now have propertyDescriptors from subclasse mixed in
                iMapping = mapping;
                iExpression = readExpressions[i];
                isComplexExpression = false;
                iRawPropertyNames = iMapping.mapObjectPropertyNameToRawPropertyNames(iExpression);
                iObjectRule = iMapping.objectMappingRuleForPropertyName(iExpression);
                iObjectRuleConverter = iObjectRule && iObjectRule.converter;
                //iPropertyDescriptor = iObjectRule && iObjectRule.propertyDescriptor;
                iPropertyDescriptor = objectDescriptor.propertyDescriptorNamed(iExpression);

                iRawDataMappingRules = iMapping.rawDataMappingRulesForObjectProperty(iExpression);  

                /* It's either a valid complex expression, if it starts by a property that exists, a property from a subtype if isObjectDescriptorStoreShared is true, or a mistake...*/
                if(!iPropertyDescriptor) {

                    if(isObjectDescriptorStoreShared && !rawDataPrimaryKeys.includes(iExpression) && (iPropertyDescriptor = objectDescriptor.descendantPropertyDescriptorNamed(iExpression))) {
                        let descendantObjectDescriptor = iPropertyDescriptor.owner,
                            descendantObjectDescriptorMapping = this.mappingForType(descendantObjectDescriptor);

                        iRawPropertyNames = descendantObjectDescriptorMapping.mapObjectPropertyNameToRawPropertyNames(iExpression);
                        iObjectRule = descendantObjectDescriptorMapping.objectMappingRuleForPropertyName(iExpression);
                        iObjectRuleConverter = iObjectRule && iObjectRule.converter;

                        //Override from above
                        iRawDataMappingRules = descendantObjectDescriptorMapping.rawDataMappingRulesForObjectProperty(iExpression);

                        //Override for the rest of the loop
                        iMapping = descendantObjectDescriptorMapping

                    } else {
                        /* 
                            we're not supporting read expressions that are more than just a property name yet but do if they're in a propertyDescriptor's defiinition.
                            So let's get closer as it will help us deal with this as well.
                        */
                        iExpressionSyntax = parse(iExpression);
                        let iExpressionSyntaxProperties = syntaxProperties(iExpressionSyntax);
                        if(!iExpressionSyntaxProperties || (iExpressionSyntaxProperties.length === 1 && iExpressionSyntaxProperties[0] === iExpression)) {
                            console.warn("Ignoring readExpressions '"+iExpression+"' as it's not a known property of "+objectDescriptor.name);
                            continue;
                        } else {
                            //We need to handle it where we do iPropertyDescriptor's definition further down here
                            isComplexExpression = true;
                        }
                    }
                }
                
                iRawDataMappingRulesIterator = iRawDataMappingRules && iRawDataMappingRules.values();

                /*
                    If a relationship is overriden in an ObjectDescriptor because the destination is different from what is inherited,
                    BUT the mapping for the subclass doesn't override as it would be the same thing, 
                    then iPropertyDescriptor and iObjectRule.propertyDescriptor are different.

                    iPropertyDescriptor's _valueDescriptorReference is the correct desstination
                    where iObjectRule.propertyDescriptor._valueDescriptorReference is the relationship destination as set in the parent object descriptor.
                */
                iValueDescriptorReference = iObjectRule && iObjectRule.propertyDescriptor._valueDescriptorReference && iObjectRule.propertyDescriptor._valueDescriptorReference === iPropertyDescriptor._valueDescriptorReference 
                    ? iObjectRule.propertyDescriptor._valueDescriptorReference 
                    : iPropertyDescriptor._valueDescriptorReference,
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
                        escapedRawReadExpressions.add(this.mapPropertyDescriptorRawReadExpressionToSelectExpression(iPropertyDescriptor,iExpression, iMapping, operationLocales, tableName));
                    }
                    //console.log("A - "+objectDescriptor+" - "+ iExpression);
                    else if(isReadOperationForSingleObject && !iIsInlineReadExpression) {
                        /*
                            we find our primaryKey on the other side, we can just use the converter since we have the primary key value:
                        */
                        iReadOperationCriteria = iObjectRuleConverter.convertCriteriaForValue(criteria.parameters.id);

                        rawDataOperation.criteria = iReadOperationCriteria;

                        //This is similar to what we do on 1709 -... need to clean up and re-factor to consolidate
                        if(readExpressionsCount === 1) {

                            rawDataOperation.target = iValueDescriptorReference;

                            let iValueDescriptorReferenceTableName = this.tableForObjectDescriptor(iValueDescriptorReference);
                            rawDataOperation.objectDescriptor = iValueDescriptorReference;
                            rawDataOperation.tableName = iValueDescriptorReferenceTableName;
                            let targetMapping = this.mappingForType(iValueDescriptorReference);
                            rawDataOperation.mapping = targetMapping;

                                                                    //Set what to fetch to be all columns of the table hosting objects at the end of the relationship
                            let iValueDescriptorReferenceColumnNames = this.columnNamesForObjectDescriptor(iValueDescriptorReference);
                            //let escapedRawReadExpressions = iValueDescriptorReferenceColumnNames.map(columnName => this.qualifiedNameForColumnInTable(columnName, iValueDescriptorReferenceTableName));
                            let targetRawDataMappingRules = rawDataOperation.mapping.rawDataMappingRules;

                            escapedRawReadExpressions = [];

                            //Adds the primaryKeys to the columns fetched
                            if(rawDataPrimaryKeys) {
                                rawDataPrimaryKeys.forEach(item => escapedRawReadExpressions.add(this.qualifiedNameForColumnInTable(item,iValueDescriptorReferenceTableName)));
                            } else if(primaryKeyPropertyDescriptors) {
                                primaryKeyPropertyDescriptors.forEach(item => escapedRawReadExpressions.add(this.qualifiedNameForColumnInTable(item.name, iValueDescriptorReferenceTableName)));
                            }

                            for(let iColumnName in targetRawDataMappingRules) {
                                let iRule = targetRawDataMappingRules[iColumnName];
                                escapedRawReadExpressions.push(
                                    this.mapPropertyDescriptorRawReadExpressionToSelectExpression(iRule.propertyDescriptor,iRule.targetPath, targetMapping, operationLocales, iValueDescriptorReferenceTableName)
                                )
                            }
                            
                            rawDataOperation.columnNames = escapedRawReadExpressions;
                            //We're not returning anything from the original objectDescriptor.
                            //REVIEW - needs to be better structured when we can make it more general
                            rawReadExpressions = null;

                        }


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

                            if(iPropertyDescriptor && (iPropertyDescriptor.definition /* UNCOMMENT ME AND FINISH THE JOB TO HANDLE: || isComplexExpression === true*/)) {

                                /*
                                    TODO / FIXME!!! : if iExpression is a complex expression, then it is similar to a propertyDescriptor's definition. So this needs to be adapted to address that as well
                                    
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
                                    aRawExpression = this.stringify(combinedCriteria.syntax, combinedCriteria.parameters, [iMapping], operationLocales, aSQLJoinStatements),
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
                            anEscapedExpression = this.mapPropertyDescriptorRawReadExpressionToSelectExpression(iPropertyDescriptor,iTargetPath, iMapping, operationLocales, tableName);




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
                                We start with readOperation criteria being

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
                                        //iReadOperation = readOperation;
                                        // iReadOperation.target = iValueDescriptorReference;
                                        // iReadOperation.data = {};

                                        rawDataOperation.target = iValueDescriptorReference;

                                        let iValueDescriptorReferenceTableName = this.tableForObjectDescriptor(iValueDescriptorReference);
                                        rawDataOperation.objectDescriptor = iValueDescriptorReference;
                                        rawDataOperation.tableName = iValueDescriptorReferenceTableName;
                                        let targetMapping = this.mappingForType(iValueDescriptorReference);
                                        rawDataOperation.mapping = targetMapping;


                                        //Set what to fetch to be all columns of the table hosting objects at the end of the relationship
                                        let iValueDescriptorReferenceColumnNames = this.columnNamesForObjectDescriptor(iValueDescriptorReference);
                                        //let escapedRawReadExpressions = iValueDescriptorReferenceColumnNames.map(columnName => this.qualifiedNameForColumnInTable(columnName, iValueDescriptorReferenceTableName));
                                        let targetRawDataMappingRules;

                                        //We need to add rawDataMappingRules of all descendants
                                        if(this.isObjectDescriptorStoreShared(rawDataOperation.objectDescriptor)/* && iTargetPath !== "hostDeviceConnections"*/) {
                                            //console.warn("?????????????? "+rawDataOperation.objectDescriptor.name + " ObjectDescriptor Store Shared - "+iTargetPath);
                                            targetRawDataMappingRules = rawDataOperation.mapping.rawDataMappingRulesIncludingStoredDescendants
                                        } else {
                                            //console.warn("?????????????? "+rawDataOperation.objectDescriptor.name + " ObjectDescriptor Store NOT Shared - "+iTargetPath);

                                            targetRawDataMappingRules = rawDataOperation.mapping.rawDataMappingRules
                                        }

                                        escapedRawReadExpressions = [];

                                        //Adds the primaryKeys to the columns fetched
                                        if(rawDataPrimaryKeys) {
                                            rawDataPrimaryKeys.forEach(item => escapedRawReadExpressions.add(this.qualifiedNameForColumnInTable(item,iValueDescriptorReferenceTableName)));
                                        } else if(primaryKeyPropertyDescriptors) {
                                            primaryKeyPropertyDescriptors.forEach(item => escapedRawReadExpressions.add(this.qualifiedNameForColumnInTable(item.name, iValueDescriptorReferenceTableName)));
                                        }

                                        for(let iColumnName in targetRawDataMappingRules) {
                                            let iRule = targetRawDataMappingRules[iColumnName];
                                            escapedRawReadExpressions.push(
                                                this.mapPropertyDescriptorRawReadExpressionToSelectExpression(iRule.propertyDescriptor,iRule.targetPath, targetMapping, operationLocales, iValueDescriptorReferenceTableName)
                                            )
                                        }
                                        
                                        rawDataOperation.columnNames = escapedRawReadExpressions;
                                        //We're not returning anything from the original objectDescriptor.
                                        //REVIEW - needs to be better structured when we can make it more general
                                        rawReadExpressions = null;


                                        // iReadOperation = new DataOperation();
                                        // iReadOperation.clientId = readOperation.clientId;
                                        // iReadOperation.referrer = readOperation;
                                        // iReadOperation.type = DataOperation.Type.ReadOperation;
                                        // iReadOperation.target = iValueDescriptorReference;
                                        // iReadOperation.data = {};
                                        // (readOperations || (readOperations = [])).push(iReadOperation);
    
                                        //                                         //We're not returning anything from the original objectDescriptor.
                                        // //REVIEW - needs to be better structured when we can make it more general
                                        // rawReadExpressions= null;

                                    }

                                    /*
                                        1/16/2025 : shortcut to test new logic in a specific case without impacting others for now
                                    */
                                    if(readOperation.hints?.snapshot) {
                                        //Use the rule.
                                        let mappingScope = iMapping._scope.nest(readOperation);
                                        mappingScope = mappingScope.nest(readOperation.hints?.snapshot);
            
                                        rawDataOperation.criteria = iRawDataMappingRule.reverter.convertCriteriaForValue(iObjectRule.expression(mappingScope));
            
        
                                    }
                                    else if(criteria.name === 'rawDataPrimaryKeyCriteria') {
                                        rawDataOperation.criteria = iRawDataMappingRuleConverter.convertCriteriaForValue(criteria.parameters.id)
                                    } else {
                                        /*
                                            we find our primaryKey on the other side, we can just use the converter since we have the primary key value:
                                        */
                                            iInversePropertyDescriptor = iValueDescriptorReference && iValueDescriptorReference.propertyDescriptorForName(iPropertyDescriptor.inversePropertyName);
                                        iInversePropertyObjectRule = iValueDescriptorReferenceMapping && iValueDescriptorReferenceMapping.objectMappingRuleForPropertyName(iPropertyDescriptor.inversePropertyName);
                                        iInversePropertyObjectRuleConverter = iInversePropertyObjectRule && iInversePropertyObjectRule.converter;
    
                                        if(iInversePropertyDescriptor) {
    
                                            //This asssumes a single-field primary/foreign key matching and should be made more robust using iInversePropertyObjectRule syntax
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
                                //(readOperations || (readOperations = [])).push(iReadOperation);


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
                    let criteriaToMap = (rawDataOperation.criteria || criteria),
                        mappingToUse = (rawDataOperation.mapping || mapping),
                        dataOperation = rawDataOperation.dataOperation;

                    if(mappingToUse.needsRawDataTypeIdentificationCriteria) {
                        if(criteriaToMap) {
                            let includesChildObjectDescriptors = readOperation.data && !readOperation.data.hasOwnProperty("includesChildObjectDescriptors"),
                                rawDataTypeIdentificationCriteria = mappingToUse.rawDataTypeIdentificationCriteriaForDataOperation(dataOperation );
                            /*
                                Needs to pass includesChildObjectDescriptors to mapping.rawDataTypeIdentificationCriteria
                                If includesChildObjectDescriptors, then if readOperation.target is the top-most object desscriptor stored in that table, 
                                then there should be no additional criteria needed
                                However, if readOperation.target is one of the sub types, then a or of the rawDataTypeIdentificationCriteria of each descendent is going to be needed
                            */
                            if(includesChildObjectDescriptors && rawDataTypeIdentificationCriteria) {
                                criteriaToMap = criteriaToMap.and(rawDataTypeIdentificationCriteria);
                            }
                        } else {
                            criteriaToMap = mappingToUse.rawDataTypeIdentificationCriteriaForDataOperation(dataOperation);
                        }
                    }

                    try {
                        //Prefering rawDataOperation.criteria if we have it, as we attempt to not override the readOperation
                        rawCriteria = this.mapCriteriaToRawCriteria(criteriaToMap, mappingToUse, operationLocales, (rawExpressionJoinStatements = new SQLJoinStatements())
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

                // if(!useDefaultExpressions && readExpressions.length === 1 && (readOperation.referrer || readOperation.referrerId)) {
                //     sql = `SELECT DISTINCT ${escapedRawReadExpressions.join()} FROM "${schemaName}"."${tableName}"`;
                // } else {
                    sql = `SELECT DISTINCT (SELECT to_jsonb(_) FROM (SELECT ${escapedRawReadExpressions.join(",")}) as _) FROM "${schemaName}"."${(rawDataOperation.tableName || tableName)}"`;
                //}

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
            console.log("------------------> rawDataOperation.sql:",rawDataOperation.sql);

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
            console.log(this.identifier+" handle readOperation id " + readOperation.id + " for "+readOperation.target.name+ (readOperation?.data?.readExpressions? (" "+readOperation?.data?.readExpressions) : "") +" like "+ readOperation.criteria);

            /*
                Until we solve more efficiently (lazily) how RawDataServices listen for and receive data operations, we have to check wether we're the one to deal with this:
            */
            if(!this.handlesType(readOperation.target)) {
                return;
            }            

            // if(readOperation.target.name === "Workstation" && readOperation.data.readExpressions[0] === "parent") {
            //     console.log(">>>>>>>>>>>>>>>>>>> handleReadOperation id " + readOperation.id);
            // }

            return this.performReadOperation(readOperation);
        }
    },
    
    _executeReadStatementForReadOperation: {
        value: function (rawDataOperation, readOperation, readOperationsCount, readOperationExecutedCount, resolve, reject) {
            let objectDescriptor = readOperation.target;

            return this.executeStatement(rawDataOperation, (err, data) => {
                let isNotLast;

                readOperationExecutedCount++;

                isNotLast = (readOperationsCount - readOperationExecutedCount + 1/*the current/main one*/) > 0;

                if(err) {
                    // console.error("handleReadOperation Error: readOperation:",readOperation, "rawDataOperation: ",rawDataOperation, "error: ",err);
                    //self.mapErrorToDataOperationErrorName(err);
                    this.mapRawDataOperationErrorToDataOperation(rawDataOperation, err, readOperation);

                    if(err.name === DataOperationErrorNames.ObjectDescriptorStoreMissing) {
                        let objectDescriptor = err.objectDescriptor;
                        return this.createTableForObjectDescriptor(objectDescriptor)
                        .then((result) => {
                            let operation = this.responseOperationForReadOperation(readOperation.referrer ? readOperation.referrer : readOperation, null, [], false, rawDataOperation.target);
                            /*
                                If we pass responseOperationForReadOperation the readOperation.referrer if there's one, we end up with the right clientId ans right referrerId, but the wrong target, so for now, reset it to what it should be:
                            */
                            operation.target = objectDescriptor;
                            operation.readOperationExecutedCount = readOperationExecutedCount;
                            resolve(operation);
                        })
                        .catch((error) => {
                            console.error('Error creating table for objectDescriptor:',objectDescriptor, error);
                            error.readOperationExecutedCount = readOperationExecutedCount;
                            reject(error);
                        });

                    } else if(err.name === DataOperationErrorNames.PropertyDescriptorStoreMissing) {
                        let propertyDescriptor = err.propertyDescriptor;
                        if(propertyDescriptor) {

                            //Instead of creating a column missing on a read, let's take it out of the statement instead:
                            // let columnStatement = `"${readOperation.target.name}"."${err.rawPropertyName}"`,
                            //     statementIndex = rawDataOperation.sql.indexOf(columnStatement),
                            //     revisedStatememt;

                            // if(rawDataOperation.sql.charAt(statementIndex+columnStatement.length) === ",") {
                            //     revisedStatememt = rawDataOperation.sql.replace(`${columnStatement},`, "")
                            //     // revisedStatememt = rawDataOperation.sql.slice(statementIndex, columnStatement.length);
                            //     rawDataOperation.sql = revisedStatememt;
                            // } else {
                            //     console.error('Unable to address error ', err);
                            //     reject(err);
                            // }
                            
                            return this.createTableColumnForPropertyDescriptor(propertyDescriptor, err.objectDescriptor)
                            .then((result) => {
                                //Now try again executing the statement
                                return this._executeReadStatementForReadOperation(rawDataOperation, readOperation, readOperationsCount, readOperationExecutedCount, resolve, reject);
                            });    
                        } else {
                            reject(err);
                        }

                    }

                    if(readOperation.criteria && readOperation.criteria.expression) {
                        console.log("------------------> readOperation.criteria.expression:",readOperation.criteria.expression);
                        console.log("------------------> rawDataOperation.sql:",rawDataOperation.sql);
                    }
                }


                if(err) {
                    // reject(operation);
                    err.readOperationExecutedCount = readOperationExecutedCount;

                    console.error("handleReadOperation Error: readOperation:", readOperation, "rawDataOperation: ", rawDataOperation, "error: ", err);

                    reject(err);
                } else {

                    /*
                        If the readOperation has a referrer, it's a readOperation created by us to fetch an object's property, so we're going to use that.
                    */

                    var operation = this.responseOperationForReadOperation(readOperation.referrer ? readOperation.referrer : readOperation, err, (data && (data.rows || data.records)), isNotLast, rawDataOperation.target);
                    /*
                        If we pass responseOperationForReadOperation the readOperation.referrer if there's one, we end up with the right clientId ans right referrerId, but the wrong target, so for now, reset it to what it should be:
                    */
                    operation.target = objectDescriptor;
                    //objectDescriptor.dispatchEvent(operation);
                    operation.readOperationExecutedCount = readOperationExecutedCount;
                    resolve(operation);
                }

            }, readOperation)

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
                readOperationsCount,
                readOperationCompletionPromiseResolvers,
                readOperationCompletionPromise, readOperationCompletionPromiseResolve, readOperationCompletionPromiseReject;


            if(this.promisesReadOperationCompletion) {
                readOperationCompletionPromiseResolvers = Promise.withResolvers();
                readOperationCompletionPromise = readOperationCompletionPromiseResolvers.promise;
                readOperationCompletionPromiseResolve = readOperationCompletionPromiseResolvers.resolve;
                readOperationCompletionPromiseReject = readOperationCompletionPromiseResolvers.reject;
            } else {
                readOperationCompletionPromise = readOperationCompletionPromiseResolve = readOperationCompletionromiseReject = undefined;
            }

            if(readOperation.rawDataOperation) {
                rawDataOperation = readOperation.rawDataOperation;
            } else {
                rawDataOperation = {};
                readOperations = this.mapReadOperationToRawReadOperation(readOperation, rawDataOperation);
            }


            if(rawDataOperation.error) {
                var errorOperation = this.responseOperationForReadOperation(rawDataOperation.dataOperation.referrer ? rawDataOperation.dataOperation.referrer : rawDataOperation.dataOperation, rawDataOperation.error, null, false, rawDataOperation.target);
                /*
                    If we pass responseOperationForReadOperation the readOperation.referrer if there's one, we end up with the right clientId ans right referrerId, but the wrong target, so for now, reset it to what it should be:
                */
                    errorOperation.target = objectDescriptor;
                objectDescriptor.dispatchEvent(errorOperation);

                //Resolve once dispatchEvent() is completed, including any pending progagationPromise.
                errorOperation.propagationPromise.then(() => {
                    readOperationCompletionPromiseResolve?.(errorOperation);
                });
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

                //console.log("readOperation "+readOperation.id+" sql: "+rawDataOperation.sql);


                if(rawDataOperation.sql) {
                    self._executeReadStatementForReadOperation(rawDataOperation, rawDataOperation.dataOperation, readOperationsCount, readOperationExecutedCount, resolve, reject)
                    .catch(error => {
                        // let operation = this.responseOperationForReadOperation(readOperation, error, null, false/*isNotLast*/);
                        // readOperation.target.dispatchEvent(operation);
                        reject(error);
                    })
                } else {
                    readOperationExecutedCount++;

                    var operation = self.responseOperationForReadOperation(rawDataOperation.dataOperation.referrer ? rawDataOperation.dataOperation.referrer : rawDataOperation.dataOperation, null, [], false, rawDataOperation.target);
                    resolve(operation);
                }

            });

                /*
                    now we loop on all the other -nested- read operations
                */
            //return 
            firstPromise.then(function(firstReadUpdateOperation) {
                readOperationExecutedCount = firstReadUpdateOperation.readOperationExecutedCount;

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

                    //Resolve once dispatchEvent() is completed, including any pending progagationPromise.
                    firstReadUpdateOperation.propagationPromise.then(() => {
                        readOperationCompletionPromiseResolve?.(firstReadUpdateOperation);
                    });

                }
                /*
                    Only if we're a root readOperation, we dispatch the result, otherwise it's handled within the logic of the root to orchestrate readUpdate/ReadCompletedOperation
                */
                else if(!readOperation.referrer) {
                    firstReadUpdateOperation.type = DataOperation.Type.ReadCompletedOperation;
                    
                    //If rawDataOperation has a target, it's going to be what we want, 
                    // like when resolving an object's property
                    (rawDataOperation.target || objectDescriptor).dispatchEvent(firstReadUpdateOperation);

                    //Resolve once dispatchEvent() is completed, including any pending progagationPromise.
                    firstReadUpdateOperation.propagationPromise.then(() => {
                        readOperationCompletionPromiseResolve?.(firstReadUpdateOperation);
                    });
                    
                }
                return firstReadUpdateOperation;
            }, function(error) {

                if(error.name === DataOperationErrorNames.ObjectDescriptorStoreMissing) {
                    //Create the missing table and resolve as a fetch with 0 result

                }

                error.sql = rawDataOperation.sql;
                let isNotLast = (readOperationsCount - readOperationExecutedCount + 1/*the current/main one*/) > 0;

                let operation = self.responseOperationForReadOperation(readOperation, error, null, isNotLast/*isNotLast*/, rawDataOperation.target);
                readOperation.target.dispatchEvent(operation);

                //Resolve once dispatchEvent() is completed, including any pending progagationPromise.
                operation.propagationPromise.then(() => {
                    readOperationCompletionPromiseResolve?.(operation);
                })

            });

            return readOperationCompletionPromise;
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
                /*
                    When fetching from PG, rawData has a to_jsonb property that actually contains what we want.
                    But when a SynchronanizationDataService is involved, it's possible we're given the rawData directly
                    if it's obtained from an origin data service, mapped to object and back to PG's mapping.
                */
                return this.super(stream, rawData.to_jsonb ? rawData.to_jsonb : rawData, context);
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
          "prototype": "mod/core/meta/property-descriptor",
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

                if(propertyDescriptor?._valueDescriptorReference instanceof Enum) {
                    return propertyDescriptor._valueDescriptorReference.intValueForMember(value);
                } else {
                    var escapedValue = escapeString(value, type, propertyDescriptor);
                    if(propertyDescriptor?.isOneWayEncrypted) {
                        if(dataOperation && (dataOperation.type === DataOperation.Type.CreateOperation || dataOperation.type === DataOperation.Type.UpdateOperation)) {
                            return `${this.connection.schema}.crypt(${escapedValue}, ${this.connection.schema}.gen_salt('${this.encryptionSaltHashingAlgorithm}'${this.encryptionSaltHashingAlgorithmIterationCount ? ','+this.encryptionSaltHashingAlgorithmIterationCount : ""}))`;
                        } else {
                            //For read, we use the name of the colum that contains the encrypted value as the salt
                            return `${this.connection.schema}.crypt(${escapedValue}, ${rawPropertyName})`;
                        }
                    } else {
                        if(propertyDescriptor && propertyDescriptor.isLocalizable) {
                            let operationLocales = dataOperation.locales;

                            //We need to put the value in the right json structure, if it's a string + operationLocales
                            //If value is an object, it means it's the full localized string structure involving multiple languages and we shouldnt do anything
                            if((operationLocales.length === 1) && (typeof value !== "object")) {
                                escapedValue = `'{"${operationLocales[0].language}":{"${operationLocales[0].region}":${escapedValue}}}'`;
                            }

                        } 
                        return escapedValue;
                    }
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
            /*
                Hard coded for now, should be derived from a mapping telling us n which databaseName that objectDescriptor is stored
            */
            return this.mappingForType(objectDescriptor)?.rawDataTypeName || objectDescriptor.name;
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
            this.mapConnectionToRawDataOperation(rawDataOperation);


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
        value: function _buildColumnString(objectDescriptor, prefix = "", columnName, columnType, propertyDescriptor, mappingRule, columnsDone, colunmnStrings, colunmnIndexStrings) {
            if(!columnsDone.has(columnName)) {

                columnsDone.add(columnName);

                // var columnSQL = `  ${escapeIdentifier(columnName)} ${columnType}`;
                // if (columnType === 'text') {
                //     columnSQL = `${columnSQL} COLLATE pg_catalog."default"`;
                // }

                var columnSQL = `  ${prefix}${escapeIdentifier(columnName)} ${columnType} ${(columnType === 'text') ? 'COLLATE pg_catalog."default"' : ''}${propertyDescriptor.isUnique ? 'UNIQUE' : ''}`;

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


    _rawDataDescriptorByName: {
        value: undefined
    },

    rawDataDescriptorForObjectDescriptor: {
        value: function(objectDescriptor) {
            /*
                Test if our mapping for objectDescriptor has a rawDataTypeName property specified.
                We may already have a rawDataDescriptor for it.
            */
            return this._rawDataDescriptorByName.get(objectDescriptor) || this.buildRawDataDescriptorForObjectDescriptor(objectDescriptor);
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
            var objectDescriptorMapping = objectDescriptor && this.mappingForType(objectDescriptor);

            /* For example for Date or Map */
            if(!objectDescriptorMapping) {
                return null;
            }

            var rawDataDescriptor,
                schemaPropertyDescriptors,
                propertyDescriptors = Array.from(objectDescriptor.propertyDescriptors),
                parentDescriptor,
                colunmns = new Set(),
                i, iSchemaPropertyDescriptor, iPropertyDescriptor, iPropertyDescriptorName, iIndexType, iPropertyDescriptorValueDescriptor, iDescendantDescriptors, iObjectRule, iRule,
                isMapPropertyDescriptor,
                mapping,
                converterforeignDescriptorMappings,
                iObjectRuleSourcePathSyntax,
                iPropertyDescriptorRawProperties,
                j, countJ,jProperty,
                columnName,
                columnType,
                keyArrayColumn,
                valueArrayColumn,
                tableName = this.tableForObjectDescriptor(objectDescriptor),
                isObjectDescriptorStoreShared = false,
                descendantPropertyDescriptorsByName,
                objectStoreName = objectDescriptorMapping.rawDataTypeName;//Should be equal to tableName...

            //mapping.rawDataDescriptor =
            rawDataDescriptor = new ObjectDescriptor();
            rawDataDescriptor.name = tableName;
            schemaPropertyDescriptors = rawDataDescriptor.propertyDescriptors;

            //Benoit 6/5/25: objectDescriptor.propertyDescriptors already contains inherited ones
            //Cummulate inherited propertyDescriptors:
            // parentDescriptor = objectDescriptor.parent;
            // while ((parentDescriptor)) {
            //     if (parentDescriptor.propertyDescriptors && propertyDescriptors.length) {
            //         propertyDescriptors.concat(parentDescriptor.propertyDescriptors);
            //     }
            //     parentDescriptor = parentDescriptor.parent;
            // }

            //If an objectDescriptor's ObjectStore hosts subclasses, we need to add their propertyDescriptors as well:
            if((isObjectDescriptorStoreShared = this.isObjectDescriptorStoreShared(objectDescriptor))) {
                /*
                    It's possible, but unfortunate, for 2 subclasses to independently have a property descriptor with the same name, but different type.
                    The only way to solve that would be to alias the columns, like `${objectDescriptorName}_${aPropertyDescriptor.name}`
                    But we would have to dynamically change the mappings... If we were creating it, then it would be fine, but as long as we, humans, do,
                    it's on us.
                */
                if(objectDescriptor.descendantPropertyDescriptors) {
                    propertyDescriptors.push(...objectDescriptor.descendantPropertyDescriptors);
                    descendantPropertyDescriptorsByName = objectDescriptor.descendantPropertyDescriptorsByName;
                }
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
                mapping = !isObjectDescriptorStoreShared ? objectDescriptorMapping : this.mappingForType(iPropertyDescriptor.owner);

                //Descendant, but stored separately, pass
                if(!mapping || (isObjectDescriptorStoreShared && (descendantPropertyDescriptorsByName.get(iPropertyDescriptor.name) === iPropertyDescriptor) && (mapping.rawDataTypeName !== objectStoreName))) {
                    continue;
                } 

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
                        var rawDataService = this.rootService.childServiceForType(iPropertyDescriptorValueDescriptor);

                        if(!rawDataService) {
                            throw new Error("No RawDataService found for ", iPropertyDescriptorValueDescriptor.module.id);
                        }

                        var iPropertyDescriptorValueDescriptorMapping = iPropertyDescriptorValueDescriptor && rawDataService.mappingForType(iPropertyDescriptorValueDescriptor),
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
                                //Let's try to see if the raw property value of that record is mapped to another property for which we have data, 
                                let rawProperty = iObjectRuleSourcePathSyntax.args[iPropertyDescriptorRawProperties[j]].args.filter((value => {
                                    return value.type === "literal";
                                }))[0].value;

                                if(rawProperty) {
                                    let mappingRulesForRawDataProperty = mapping.mappingRulesForRawDataProperty(rawProperty);
                                    if(mappingRulesForRawDataProperty?.length) {
                                        let r=0, rRule, noColumnNeeded = false;
                                        while ((rRule = mappingRulesForRawDataProperty[r++])) {
                                            if(rRule.sourcePath === rawProperty && iObjectRule.converter) {
                                                /*
                                                    That property in the record matches a property on the rawData side, so it's likely a construction
                                                    to get convert that record to a foreign key.
                                                */
                                                    noColumnNeeded = true;
                                                    break;
                                            }
                                        }

                                        if(noColumnNeeded) continue;
                                    }
                                }

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

                    if(iPropertyDescriptor.isUnique === true) {
                        iSchemaPropertyDescriptor.isUnique = iPropertyDescriptor.isUnique;
                    }

                }
            }

            this._rawDataDescriptorByName.set(objectDescriptor,rawDataDescriptor);
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
        id uuid NOT NULL,
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

                this.mapConnectionToRawDataOperation(rawDataOperation);

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
                    this._buildObjectDescriptorColumnAndIndexString(objectDescriptor, "", iPropertyDescriptor.name, columnType, iPropertyDescriptor, iRule, colunmns, colunmnStrings, colunmnIndexStrings);

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


    mapObjectPropertyStoreCreateOperationToRawOperation: {
        value: function (dataOperation, rawDataOperation = {}) {

                var propertyDescriptor = dataOperation.data.propertyDescriptor,
                    objectDescriptor = dataOperation.data.objectDescriptor,
                    mapping = objectDescriptor && this.mappingForType(objectDescriptor),
                    tableName = this.tableForObjectDescriptor(objectDescriptor),
                    rawDataDescriptor = this.rawDataDescriptorForObjectDescriptor(objectDescriptor),
                    rawPropertyDescriptors = Array.from(rawDataDescriptor.propertyDescriptors),
                    addColumnPrefix = "ADD COLUMN ",
                    objectRule, objectRuleSource, rawDataMappingRule, rawPropertyDescriptor,
                    schemaName = this.connection.schema,
                    continueAfterTimeout = false,
                    includeResultMetadata = true,
                    columnName,
                    colunmns = new Set(),
                    colunmnStrings = [],
                    colunmnIndexStrings = [],
                    columnType,
                    owner = this.connection.owner,
                    semiColumnLineBreak = ";\n",
                    semiColumn = ";",

                    /*
                        ALTER TABLE table_name
                        ADD COLUMN column_name1 data_type constraint,
                        ADD COLUMN column_name2 data_type constraint,
                        ...
                        ADD COLUMN column_namen data_type constraint;
                    */

                    alterTableTemplatePrefix = `ALTER TABLE "${schemaName}"."${tableName}"\n`;

                this.mapConnectionToRawDataOperation(rawDataOperation);

                objectRule = mapping.objectMappingRuleForPropertyName(propertyDescriptor.name);
                objectRuleSource = objectRule.sourcePath;
                rawPropertyDescriptor = rawDataDescriptor.propertyDescriptorForName(objectRuleSource);
                rawDataMappingRule = objectRule && mapping.rawDataMappingRuleForPropertyName(objectRuleSource);

                columnType = rawPropertyDescriptor.valueType;

                this._buildObjectDescriptorColumnAndIndexString(objectDescriptor, addColumnPrefix, rawPropertyDescriptor.name, columnType, rawPropertyDescriptor, rawDataMappingRule, colunmns, colunmnStrings, colunmnIndexStrings);

                sql = `${alterTableTemplatePrefix}${(colunmnStrings.length > 0) ? colunmnStrings.join(',\n') : ""}${(colunmnStrings.length > 0) ? semiColumnLineBreak : ""}${(colunmnIndexStrings.length > 0) ? colunmnIndexStrings.join(',\n') : ""}${(colunmnIndexStrings.length > 0) ? semiColumn : ""}`;

                rawDataOperation.sql = sql;
                rawDataOperation.continueAfterTimeout = continueAfterTimeout;
                rawDataOperation.includeResultMetadata = includeResultMetadata;
                //rawDataOperation.parameters = parameters;

                return rawDataOperation;

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

//             this.mapConnectionToRawDataOperation(rawDataOperation);

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

    createSchema: {
        value: function () {
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

                    self.mapConnectionToRawDataOperation(rawDataOperation);
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



                this.mapConnectionToRawDataOperation(rawDataOperation);
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
                                self.createSchema()
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
                    }, dataOperation);

                });

                this._verifySchemaPromise.set(schemaName, verifySchemaPromise);
            }

            return verifySchemaPromise;

        }
    },

    performRawDataOperation: {
        value: function (rawDataOperation, callback, dataOperation) {
            return this.executeStatement(rawDataOperation, callback, dataOperation);
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
    handleObjectStoreCreateOperation: {
        value: function (createOperation) {
            var self = this;

            var operation = new DataOperation();

            operation.target = createOperation.target;
            operation.referrerId = createOperation.id;
            operation.clientId = createOperation.clientId;
            operation.rawDataService = this;

            this.createObjectDescriptorTableForCreateOperation(createOperation)
            .then((data)=> {
                // successful response
                operation.type = DataOperation.Type.CreateCompletedOperation;
                operation.data = createOperation.data;
            })
            .catch((error) => {
                // an error occurred
                console.log(error, error.stack, rawDataOperation);
                operation.type = DataOperation.Type.CreateFailedOperation;
                error.objectDescriptor = createOperation.data;
                //Should the data be the error?
                operation.data = error;
            })
            .finally(() => {
                operation.target.dispatchEvent(operation);
            });

            // return this.mapToRawCreateObjectDescriptorOperation(createOperation)
            // .then((rawDataOperation) => {
            //     //console.log("rawDataOperation: ",rawDataOperation);
            //     self.performRawDataOperation(rawDataOperation, function (err, data) {
            //         var operation = new DataOperation();
            //         operation.target = createOperation.target;
            //         operation.referrerId = createOperation.id;
            //         operation.clientId = createOperation.clientId;

            //         if (err) {
            //             // an error occurred
            //             console.log(err, err.stack, rawDataOperation);
            //             operation.type = DataOperation.Type.CreateFailedOperation;
            //             //Should the data be the error?
            //             operation.data = err;
            //         }
            //         else {
            //             // successful response
            //             //console.log(data);
            //             operation.type = DataOperation.Type.CreateCompletedOperation;
            //             //Not sure there's much we can provide as data?
            //             operation.data = operation;
            //         }

            //         operation.target.dispatchEvent(operation);

            //     }, createOperation);
            // });
        }
    },

    createTableForObjectDescriptor: {
        value: function(objectDescriptor) {
            //Inherited from DataService
            var createOperation = this.objectStoreCreateOperationForObjectDescriptor(objectDescriptor);
            return this.createObjectDescriptorTableForCreateOperation(createOperation);
        }
    },

    /**
     * Handles the mapping and execution of a DataOperation to create a column for 
     * an ObjectDescriptor's propertyDescriptor.
     *
     * @method
     * @argument {DataOperation} dataOperation - The dataOperation to execute
  `  * @returns {Promise} - The Promise for the execution of the operation
     */
    handleObjectPropertyStoreCreateOperation: {
        value: function (createOperation) {
            var self = this;

            var operation = new DataOperation();

            operation.target = createOperation.target;
            operation.referrerId = createOperation.id;
            operation.clientId = createOperation.clientId;
            operation.rawDataService = this;

            this.createObjectPropertyColumnForCreateOperation(createOperation)
            .then((data)=> {
                // successful response
                operation.type = DataOperation.Type.CreateCompletedOperation;
                operation.data = createOperation.data;
            })
            .catch((error) => {
                // an error occurred
                console.log(error, error.stack, rawDataOperation);
                operation.type = DataOperation.Type.CreateFailedOperation;
                error.objectDescriptor = createOperation.data;
                //Should the data be the error?
                operation.data = error;
            })
            .finally(() => {
                operation.target.dispatchEvent(operation);
            });

        }
    },

    /**
     * If an table is missing a column for a proeperty that's inherited, defined on a parent object descriptor,
     * then propertyDescriptor.owner will be that object descriptor, but the table where it's missing will be
     * objectDescriptor's assigned table.
     *
     * @method
     * @argument {DataOperation} dataOperation - The dataOperation to execute
  `  * @returns {Promise} - The Promise for the execution of the operation
     */
    createTableColumnForPropertyDescriptor: {
        value: function(propertyDescriptor, objectDescriptor) {
            //Inherited from DataService
            return this.createObjectPropertyDescriptorColumnForCreateOperation(propertyDescriptor, objectDescriptor);
        }
    },

    __createObjectStorePromiseByObject: {
        value: undefined
    },
    _createObjectStorePromiseByObject: {
        get: function() {
            return this.__createObjectStorePromiseByObject || (this.__createObjectStorePromiseByObject = new Map());
        }
    },


    createObjectDescriptorTableForCreateOperation: {
        value: function(createOperation) {
            let promise = this._createObjectStorePromiseByObject.get(createOperation.data);

            if(promise) {
                return promise;
            } else {

                promise = this.mapToRawCreateObjectDescriptorOperation(createOperation)
                .then((rawDataOperation) => {
    
                    return new Promise((resolve, reject) => {
                        console.log("createObjectDescriptorTable rawDataOperation: ",rawDataOperation.sql);
                        this.performRawDataOperation(rawDataOperation, function (err, data) {
    
                            err
                            ? reject(err)
                            : resolve(data);
    
                        }, createOperation);
    
                    });
    
                });

                this._createObjectStorePromiseByObject.set(createOperation.data, promise);
                return promise;
            }
        }
    },

    createObjectPropertyDescriptorColumnForCreateOperation: {
        value: function(propertyDescriptor, objectDescriptor = propertyDescriptor.owner) {
            let promise = this._createObjectStorePromiseByObject.get(`${objectDescriptor.name}.${propertyDescriptor.name}`);

            if(promise) {
                return promise;
            } else {

                let rawOperation = {},
                    createOperation = this.objectPropertyStoreCreateOperationForPropertyDescriptor(propertyDescriptor, objectDescriptor);
                    rawDataOperation = this.mapObjectPropertyStoreCreateOperationToRawOperation(createOperation, rawOperation);
    
                promise = new Promise((resolve, reject) => {
                    //console.log("rawDataOperation: ",rawDataOperation);
                    this.performRawDataOperation(rawDataOperation, function (err, data) {

                        err
                        ? reject(err)
                        : resolve(data);

                    }, createOperation);

                });

                this._createObjectStorePromiseByObject.set(`${createOperation.data.objectDescriptor.name}.${createOperation.data.propertyDescriptor.name}`, promise);
                return promise;
            }
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
     * https://www.dbvis.com/thetable/postgresql-upsert-insert-on-conflict-guide/
     *
     * @method
     * @argument  {DataOperation} dataOperation - The dataOperation to map to sql
     * @argument  {DataOperation} record - The object where mapping is done
  `  * @returns   {String} - The SQL to perform that operation
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
                    uniquePropertyDescriptors = objectDescriptor.uniquePropertyDescriptors,
                    rawDataDescriptor = self.rawDataDescriptorForObjectDescriptor(objectDescriptor),
                    tableName = self.tableForObjectDescriptor(objectDescriptor),
                    schemaName = rawDataOperation.schema,
                    recordKeys = Object.keys(record),
                    escapedRecordKeys = recordKeys.map(key => escapeIdentifier(key)),
                    recordKeysValues = Array(recordKeys.length),
                    mapping = objectDescriptor && self.mappingForType(objectDescriptor),
                    // sqlColumns = recordKeys.join(","),
                    i, countI, iKey, iValue, iMappedValue, iRule, iPropertyName, iPropertyDescriptor, iRawType, isPrimaryKey,
                    uniqueKeys,
                    escapedPrimaryKeys = [],
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

                    /*
                        Do we need to ckeck that the value is not null?
                        Is it needed to have a unique constraint on the column involved?
                    */
                    if((isPrimaryKey = rawDataPrimaryKeys.includes(iKey)) || (iPropertyDescriptor && iPropertyDescriptor.isUnique)) {
                        //console.log("Insert Unique key: ", iKey);
                        (uniqueKeys || (uniqueKeys = [])).push(escapedRecordKeys[i]);
                        if(isPrimaryKey) {
                            escapedPrimaryKeys.push(escapedRecordKeys[i]);
                        }
                    }

                    //In that case we need to produce json to be stored in jsonb
                    // if(iPropertyDescriptor && iPropertyDescriptor.isLocalizable) {
                    //     //We need to put the value in the right json structure.
                    //     if(operationLocales.length === 1) {

                    //         // iMappedValue = {};
                    //         // language = operationLocales[0].language;
                    //         // region = operationLocales[0].region;
                    //         // iMappedValue[language] = {}
                    //         // iMappedValue[language][region] = iValue;
                    //         // iMappedValue = JSON.stringify(iMappedValue);

                    //         iMappedValue = self.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(iPropertyDescriptor, iValue, iKey, iRawType, createOperation);
                    //         if(typeof iValue !== "object") {
                    //             language = operationLocales[0].language;
                    //             region = operationLocales[0].region;

                    //             iMappedValue = `'{"${language}":{"${region}":${iMappedValue}}}'`;
                    //         }
                    //     }
                    //     else if(operationLocales.length > 1) {
                    //         //if more than one locales, then it's a multi-locale structure
                    //         //We should already have a json
                    //         iMappedValue = self.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(iPropertyDescriptor, iValue, iKey, iRawType, createOperation);
                    //     }

                    // } else {
                        iMappedValue = self.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(iPropertyDescriptor, iValue, iKey, iRawType, createOperation);
                    // }

                    
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

                if(!uniqueKeys) {
                    /*
                        INSERT INTO table (column1, column2, …)
                        VALUES
                        (value1, value2, …),
                        (value1, value2, …) ,...;
                    */
                    sql = `INSERT INTO ${schemaName}."${tableName}" (${escapedRecordKeys.join(",")}) VALUES (${recordKeysValues.join(",")}) RETURNING id`;
                } else {

                    /*

                        In case we may need it, this is how we can get a json object back from each row inserted if needed, if for example some values
                        were to be generated by the database, we could return it that way, I think.

                        INSERT INTO moe_v1."ManufacturingPlan" ("id","modificationDate","creationDate","originId","name","operationTimeRange","planScope","historicalFlag","launchFlag","databasePlanType","originDataSnapshot","factoryId") 
                        VALUES ('31952ca3cd7c74cb87a669c2e893e0b7','2025-02-22T07:51:27.356Z','2025-02-22T07:51:27.356Z','{"aptPlanNodeId":2,"aptPlanSeq":23184}','MLP Oakville','[2025-02-22T00:00:00.000Z,infinity]','R','N','Y','P','{"gspas":{"id":{"aptPlanNodeId":2,"aptPlanSeq":23184},"planName":"MLP Oakville","plantNodeId":2,"plantSeq":1306,"targetDate":"2025-02-22","planScope":"R","productionFlag":"N","historicalFlag":"N","launchFlag":"Y","planType":"PLANT","plantKey":{"plantNodeId":2,"plantSeq":1306},"databasePlanType":"P"}}','01952ca3cb127867af33d44991701d9a') 
                        ON CONFLICT("id") DO NOTHING RETURNING (SELECT to_jsonb(_) FROM (SELECT "id","creationDate","originId","name","operationTimeRange","planScope","historicalFlag","launchFlag","databasePlanType","originDataSnapshot","factoryId") as _)


                    */



                    //If there's only a primary key inserted and nothing else...
                    if(escapedRecordKeys.equals(escapedRecordKeys)) {
                        //By leaving ON CONFLICT() empty / unspecified, we let PostgreSQL figure out the constraints to use instead. Lazy... but until we better specify the combination of what is supposed to be unique...
                        //sql = `INSERT INTO ${schemaName}."${tableName}" (${escapedRecordKeys.join(",")}) VALUES (${recordKeysValues.join(",")}) ON CONFLICT(${uniqueKeys.join(",")}) DO NOTHING RETURNING id`;
                        sql = `INSERT INTO ${schemaName}."${tableName}" (${escapedRecordKeys.join(",")}) VALUES (${recordKeysValues.join(",")}) ON CONFLICT DO NOTHING RETURNING id`;
                    } else {
                        let setRecordKeysValues = recordKeysValues.map((value, index) => {
                            if(escapedPrimaryKeys.contains(value)) {
                                return "";
                            } else {
                                return `${escapedRecordKeys[index]} = ${value}`;
                            }
                        });
                        /*
                            INSERT INTO table(name, surname, email)
                            VALUES('John', 'Smith', 'john.smith@example.com')
                            ON CONFLICT(email)
                            DO UPDATE SET name = 'John', surname = EXCLUDED.surname;
                        */
                            //sql = `INSERT INTO ${schemaName}."${tableName}" (${escapedRecordKeys.join(",")}) VALUES (${recordKeysValues.join(",")}) ON CONFLICT(${uniqueKeys.join(",")}) DO UPDATE SET ${setRecordKeysValues.join(",")} RETURNING id`;
                           //By leaving ON CONFLICT() empty / unspecified, we let PostgreSQL figure out the constraints to use instead. Lazy... but until we better specify the combination of what is supposed to be unique...
                            sql = `INSERT INTO ${schemaName}."${tableName}" (${escapedRecordKeys.join(",")}) VALUES (${recordKeysValues.join(",")}) ON CONFLICT DO UPDATE SET ${setRecordKeysValues.join(",")} RETURNING id`;
    
                    }

                }

                console.log("_mapCreateOperationToSQL: sql: "+sql)
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

            // if (createOperation.target === ObjectStoreDescriptor) {
            //     return this.handleCreateObjectDescriptorOperation(createOperation);
            // } else if(createOperation.target === ObjectPropertyStoreDescriptor) {
            //     return this.handleObjectPropertyStoreCreateOperation(createOperation);
            // } else {
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
                    this.mapConnectionToRawDataOperation(rawDataOperation);


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
                    var promise = Promise.is(rawDataOperation.sql) ? rawDataOperation.sql : Promise.resolve(rawDataOperation.sql);
                    //console.log(sql);
                    promise.then((sql) => {
                        rawDataOperation.sql = sql;
                        self.executeStatement(rawDataOperation, function (err, data) {
                            if(err) {
                                console.error("handleCreateOperation Error",createOperation,rawDataOperation,err);
                            }
                            var operation = self.mapHandledCreateResponseToOperation(createOperation, err, data, record);
    
                            operation.target.dispatchEvent(operation);
                        }, createOperation);    
                    })
                }

            // }

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
                console.log(err, err.stack, createOperation);
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

                    //This code generates the conditions for selection that are in the postgres WHERE clause.
                    // e.g.: SELECT "foo" FROM bar WHERE (THIS CLAUSE)
                    // Important note: postgres does not treat 'IS' and '=' the same.
                    // In the WHERE clause, when we are comparing with NULL, we need to use 'IS', not '='.
                    //Therefore, any time we are going to be doing a "WHERE BAZ IS NULL", it is importantthat we do "WHERE BAZ IS NULL", and not "WHERE BAZ = NULL"
                    
                    // The reason we check for the empty string '' here, is because our implementation in postgres uses NULL to indicate that a value has not been set.
                    // If a user deletes the value in the UI, we are asked to update the value to an empty string - however, we really want it to be 'not set', as the user is not supplying a value.
                    // TODO: Should this empty string-<->null logic happen here? IMO The iValue should probably be set to null before being passed in here, which would make this === '' check unnescessary.
                    if(iValue === undefined || iValue === null || iValue === '' )  {
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


                // This is in the ASSIGNMENT section of a postgres query, e.g, before WHERE
                // e.g.: SELECT "foo" FROM bar WHERE (conditions)
                //         ^^^^^^^^^^^^^^^^^^ this part
                // because postgres treats 'IS' and '=' differently, we need to use '=' in this section to get desired behavior.
                if (iValue == null) {
                    iAssignment = `${iKeyEscaped} = NULL`;
                } else {
                    iHasAddedValue = iValue.hasOwnProperty("addedValues")
                    iHasRemovedValues = iValue.hasOwnProperty("removedValues")
                    if ((iHasAddedValue) && (iHasRemovedValues)) {
                        let addMappedValue = this.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(iPropertyDescriptor, iValue.addedValues, iKeyEscaped, iRawType, updateOperation);
                        let removeMappedValue = this.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(iPropertyDescriptor, iValue.removedValues, iKeyEscaped, iRawType, updateOperation);

                        iAssignment = `${iKeyEscaped} = ${schemaName}.anyarray_remove( ${schemaName}.anyarray_concat_uniq(${iKeyEscaped}, ${addMappedValue}),${removeMappedValue})`;
                    }
                    else if (iHasAddedValue) {
                        iMappedValue = this.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(iPropertyDescriptor, iValue.addedValues, iKeyEscaped, iRawType, updateOperation);
                        iAssignment = `${iKeyEscaped} = ${schemaName}.anyarray_concat_uniq(${iKeyEscaped}, ${iMappedValue})`;
                    }
                    else if (iHasRemovedValues) {
                        iMappedValue = this.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(iPropertyDescriptor, iValue.removedValues, iKeyEscaped, iRawType, updateOperation);
                        iAssignment = `${iKeyEscaped} = ${schemaName}.anyarray_remove(${iKeyEscaped}, ${iMappedValue})`;
                    }
                    else if (!iHasAddedValue && !iHasRemovedValues) {
                        iMappedValue = this.mapPropertyDescriptorValueToRawPropertyNameWithTypeExpression(iPropertyDescriptor, iValue, iKeyEscaped, iRawType, updateOperation);
                    //iAssignment = `${iKey} = '${iValue}'`;
                        iAssignment = `${iKeyEscaped} ${"="} ${iMappedValue}`;
                    }
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
            
            console.log("_mapUpdateOperationToSQL: sql: "+sql);

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
                    this.mapConnectionToRawDataOperation(rawDataOperation);

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
                this.mapConnectionToRawDataOperation(rawDataOperation);

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
                operation.referrer = createTransactionOperation;
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
            this.mapConnectionToRawDataOperation(rawDataOperation);

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
                this.mapConnectionToRawDataOperation((dataOperation._rawDataOperation = {}));
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
                    rawTransaction,
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
                            rawTransaction = {};
                            Object.assign(rawTransaction,rawDataOperation);
                            //console.log("iBatch:",iBatch);
                            rawTransaction.sql = iBatch;

                            //Right now _executeBatchStatement will create symetric response operations if we pass responseOperations as an argument. This is implemented by using the data of the original create/update operations to eventually send it back. We can do without that, but we need to re-test that when we do batch of fetches and re-activate it.
                            batchPromises.push(self._executeBatchStatement(appendTransactionOperation, startIndex, endIndex, batchedOperations, rawTransaction, rawOperationRecords, responseOperations));

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

                /*
                    With PostgreSQL data service nested under a SynchronizationDataService
                    mainService.objectDescriptorWithModuleId(iObjectDescriptorModuleId) returns undefined,
                    somehow the PostgreSQL's type don't make it up to mainService. THIS NEEDS TO BE FIXED

                    But, Why should PostgreSQL care about the mainService knowing it if it's not one of his?
                    I would't be able to do anything with it anyway, which we ensure right bellow with:
                        if(this.handlesType(iObjectDescriptor)) {...}
                */
                //iObjectDescriptor = mainService.objectDescriptorWithModuleId(iObjectDescriptorModuleId);
                iObjectDescriptor = this.objectDescriptorWithModuleId(iObjectDescriptorModuleId);

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

            // this.mapConnectionToRawDataOperation(rawDataOperation);


            this.mapConnectionToRawDataOperation(rawDataOperation);


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
            //         rawTransaction,
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
            //                 rawTransaction = {};
            //                 Object.assign(rawTransaction,rawDataOperation);
            //                 rawTransaction.sql = iBatch;

            //                 //Right now _executeBatchStatement will create symetric response operations if we pass responseOperations as an argument. This is implemented by using the data of the original create/update operations to eventually send it back. We can do without that, but we need to re-test that when we do batch of fetches and re-activate it.
            //                 batchPromises.push(self._executeBatchStatement(appendTransactionOperation, startIndex, endIndex, batchedOperations, rawTransaction, rawOperationRecords, responseOperations));

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

            this.mapConnectionToRawDataOperation(rawDataOperation);

            //_rdsDataClient.commitTransaction & _rdsDataClient.rollbackTransaction make sure the param
            //don't have a database nor schema field, so we delete it.
            //TODO, try to find a way to instruct this.mapConnectionToRawDataOperation not to put them in if we don't want them
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
            console.debug(this.identifier+" handleCommitTransactionOperation: id: ",commitTransactionOperation.id+ ", referrer "+ (commitTransactionOperation.referrer?.id || commitTransactionOperation.referrerId));

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

                this.mapConnectionToRawDataOperation(rawDataOperation);

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

    _rollbackPromiseByOperationsByTransactionOperation: {
        value: new Map()
    },
    rollbackRawTransactionWithClientForDataOperation: {
        value: function (client, transactionOperation) {
            let rollbackPromise = this._rollbackPromiseByOperationsByTransactionOperation.get(transactionOperation);

            if(!rollbackPromise) {
                rollbackPromise = new Promise((resolve, reject) => {

                    client.query('ROLLBACK', err => {
                        //Remove wether it worked out or not
                        this._rollbackPromiseByOperationsByTransactionOperation.delete(transactionOperation);

                    
                        if (err) {
                            console.error('Error rolling back client', err.stack);
                            reject(err);
                            // operation.type = transactionOperation.type ===  DataOperation.Type.CommitTransactionOperation 
                            //     ? DataOperation.Type.CommitTransactionFailedOperation 
                            //     : DataOperation.Type.PerformTransactionFailedOperation;
                            // operation.data = err;
                            // operation.target.dispatchEvent(operation);
                            // // // release the client back to the pool
                            // // done();
                        } else {
                            resolve(true);
                        }
                    });
    
                });    
                this._rollbackPromiseByOperationsByTransactionOperation.set(transactionOperation, rollbackPromise);
            }

            return rollbackPromise;

        }
    },

    beginRawTransactionWithClient: {
        value: function (client) {
            return new Promise((resolve, reject) => {
                client.query('BEGIN', (err, res) => {
                    if(err) {
                        reject(err);
                    } else {
                        resolve(res);
                    }
                });
            });
        }
    },

    sendRawTransactionSqlWithClient: {
        value: function (rawTransactionSql, client) {
            return new Promise((resolve, reject) => {
                client.query(rawTransactionSql, undefined, (err, res) => {
                    if(err) {
                        reject(err);
                    } else {
                        resolve(res);
                    }
                });
            });
        }
    },

    commitRawTransactionWithClient: {
        value: function (client) {
            return new Promise((resolve, reject) => {
                client.query('COMMIT', (err, res) => {
                    if(err) {
                        reject(err);
                    } else {
                        resolve(res);
                    }
                });
            });
        }
    },

    abortRawTransactionWithClient: {
        value: function (client) {
            return new Promise((resolve, reject) => {
                client.query('ABORT', (err, res) => {
                    if(err) {
                        reject(err);
                    } else {
                        resolve(res);
                    }
                });
            });
        }
    },

    _tryPerformRawTransactionForDataOperationWithClient: {
        value: function (rawTransaction, transactionOperation, client, done, responseOperation) {
            let shouldRetry = false; 

            if(ProcessEnv.TIME_PG === "true") {
                var queryTimer = new Timer(`${transactionOperation.id}-${transactionOperation.type}`);
            }

            this.beginRawTransactionWithClient(client)
            .then((resul) => {
                return this.sendRawTransactionSqlWithClient(rawTransaction.sql, client);
            })
            .then((resul) => {
                return this.commitRawTransactionWithClient(client);
            })
            .then((resul) => {

                if(ProcessEnv.TIME_PG === "true") {
                    console.debug(queryTimer.runtimeMsStr());
                }

                responseOperation.type = transactionOperation.type ===  DataOperation.Type.CommitTransactionOperation 
                    ? DataOperation.Type.CommitTransactionCompletedOperation 
                    : DataOperation.Type.PerformTransactionCompletedOperation
                // responseOperation.type = _actAsHandleCommitTransactionOperation ? DataOperation.Type.CommitTransactionCompletedOperation: DataOperation.Type.PerformTransactionCompletedOperation;
                
                //Not sure what we could return here.
                responseOperation.data = true;

                // release the client back to the pool
                done();

                responseOperation.target.dispatchEvent(responseOperation);
            })
            .catch((error) => {

                this.abortRawTransactionWithClient(client)
                .then((abortResult) => {
                    if(ProcessEnv.TIME_PG === "true") {
                        console.debug("abortRawTransactionWithClient: "+queryTimer.runtimeMsStr());
                    }
    
                    this.mapRawDataOperationErrorToDataOperation(rawTransaction, error, transactionOperation);
                    return this.rollbackRawTransactionWithClientForDataOperation(client, transactionOperation);
                })
                .then((resolvedValue) => {

                    if(error.name === DataOperationErrorNames.ObjectDescriptorStoreMissing) {
                        let objectDescriptor = error.objectDescriptor;
                        return this.createTableForObjectDescriptor(objectDescriptor)
                        .then((result) => {
                            this._tryPerformRawTransactionForDataOperationWithClient(rawTransaction, transactionOperation, client, done, responseOperation);
                        })
                        .catch((error) => {
                            shouldRetry = false;
                            console.error('Error creating table for objectDescriptor:',objectDescriptor, error);
    
                            //Repeat block from bellow, neeed to have something like responseOperationForReadOperation() to do it once there
                            responseOperation.type = transactionOperation.type ===  DataOperation.Type.CommitTransactionOperation 
                            ? DataOperation.Type.CommitTransactionFailedOperation 
                            : DataOperation.Type.PerformTransactionFailedOperation
                            responseOperation.data = error;
    
                            // release the client back to the pool
                            done();
    
                            responseOperation.target.dispatchEvent(responseOperation);
    
                        });
    
                    } else if(error.name === DataOperationErrorNames.PropertyDescriptorStoreMissing) {
                        let objectDescriptor = error.objectDescriptor,
                            propertyDescriptor = error.propertyDescriptor;
    
                            return this.createTableColumnForPropertyDescriptor(propertyDescriptor, objectDescriptor)
                            .then((result) => {
                                this._tryPerformRawTransactionForDataOperationWithClient(rawTransaction, transactionOperation, client, done, responseOperation);
                            })
                            .catch((error) => {
                                shouldRetry = false;
                                console.error('Error creating table for objectDescriptor:',objectDescriptor, error);
        
                                //Repeat block from bellow, neeed to have something like responseOperationForReadOperation() to do it once there
                                responseOperation.type = transactionOperation.type ===  DataOperation.Type.CommitTransactionOperation 
                                ? DataOperation.Type.CommitTransactionFailedOperation 
                                : DataOperation.Type.PerformTransactionFailedOperation
                                responseOperation.data = error;
        
                                // release the client back to the pool
                                done();
        
                                responseOperation.target.dispatchEvent(responseOperation);
        
                            });
        
                    } else {
                        shouldRetry = false;
    
                        console.error('Error committing transaction', error, transactionOperation, rawTransaction)
                        //responseOperation.type = _actAsHandleCommitTransactionOperation ? DataOperation.Type.CommitTransactionFailedOperation: DataOperation.Type.PerformTransactionFailedOperation;
                        
                        responseOperation.type = transactionOperation.type ===  DataOperation.Type.CommitTransactionOperation 
                        ? DataOperation.Type.CommitTransactionFailedOperation 
                        : DataOperation.Type.PerformTransactionFailedOperation
                        responseOperation.data = error;
    
                        // release the client back to the pool
                        done();
    
                        responseOperation.target.dispatchEvent(responseOperation);
                    }
    
                });
                
            });
        }
    },

    performRawTransactionForDataOperation: {
        value: function (rawTransaction, transactionOperation, responseOperation) {

            // callback - checkout a client
            this.clientPool.connectForDataOperation(transactionOperation,(err, client, done) => {
                
                /*
                    If connection fails, there's not much more we can do, we report the error 
                */
                if (err) {
                    // responseOperation.type = DataOperation.Type.PerformTransactionFailedOperation;
                    responseOperation.type = transactionOperation.type ===  DataOperation.Type.CommitTransactionOperation 
                            ? DataOperation.Type.CommitTransactionFailedOperation 
                            : DataOperation.Type.PerformTransactionFailedOperation
                            responseOperation.data = err;
                            responseOperation.target.dispatchEvent(responseOperation);

                    // release the client back to the pool
                    done();
                    return responseOperation;
                }

                /*
                    Now we're going to handle errors that are caused by tables missing, create them
                    and try again. If it's something else, it's over.
                */


                this._tryPerformRawTransactionForDataOperationWithClient(rawTransaction, transactionOperation, client, done, responseOperation);

            });

        }
    },

    /*
        To get to this ASAP, we're going to pass a flag for now
        When we have properly added the PerformTransactionOperation flow as a full-class citizen
        in the design, we won't need it anymore, the event manager doesn't dispatch a second argument anyway so it will be undefined.
    */
    handlePerformTransactionOperation: {
        value: function (performTransactionOperation) {
            console.debug(this.identifier+" handlePerformTransactionOperation: ",performTransactionOperation.id);

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

            
            /*
                NoOp, we bail
            */
            if(Object.keys(performTransactionOperation.data.operations).length === 0) {
                var operation = new DataOperation();
                operation.referrerId = performTransactionOperation.id;
                operation.target = performTransactionOperation.target;
                //Carry on the details needed by the coordinator to dispatch back to client
                operation.clientId = performTransactionOperation.clientId;

                operation.type = performTransactionOperation.type ===  DataOperation.Type.CommitTransactionOperation 
                    ? DataOperation.Type.CommitTransactionCompletedOperation 
                    : DataOperation.Type.PerformTransactionCompletedOperation
                
                //Not sure what we could return here.
                operation.data = [];
                operation.rawDataService = this;
                operation.target.dispatchEvent(operation);
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



                this.mapConnectionToRawDataOperation(rawDataOperation);


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
                        rawTransaction,
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
                                rawTransaction = {};
                                Object.assign(rawTransaction,rawDataOperation);
                                //console.log("iBatch:",iBatch);
                                rawTransaction.sql = iBatch;

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

                        return rawTransaction;
                    })
                    .then((rawTransaction) => {

                        this.performRawTransactionForDataOperation(rawTransaction, performTransactionOperation, operation);
                    
                    })
                    .catch(function (error) {
                        operation.type = DataOperation.Type.PerformTransactionFailedOperation;
                        operation.data = error;
                        operation.target.dispatchEvent(operation);
                        return operation;
                    });


            })
            .catch(function (error) {
                error.message = "rawClientPromise failed: "+error.message;
                console.error(error);
                var operation = new DataOperation();
                operation.referrerId = performTransactionOperation.id;
                operation.target = performTransactionOperation.target;
                //Carry on the details needed by the coordinator to dispatch back to client
                operation.clientId = performTransactionOperation.clientId;
                operation.type = DataOperation.Type.PerformTransactionFailedOperation;
                operation.data = error;
                operation.target.dispatchEvent(operation);
                return operation;
            });

        }
    },


    handleRollbackTransactionOperation: {
        value: function (rollbackTransactionOperation) {
            /*return */this._handleTransactionEndOperation(rollbackTransactionOperation);
        }
    },

    // Export promisified versions of the RDSDataService methods
    batchExecuteStatement: {
        value: function (rawDataOperation, callback) {
            //this.rawClient.batchExecuteStatement(rawDataOperation, callback);
            return this.rawClientPromise.then(() => {
                this.rawClient.send(new BatchExecuteStatementCommand(rawDataOperation), callback);
            });
        }
    },

    beginTransaction: {
        value: function (rawDataOperation, callback) {
            if(this.useDataAPI) {
                    //this.rawClient.beginTransaction(rawDataOperation, callback);
                return this.rawClientPromise.then(() => {
                    this.rawClient.send(new BeginTransactionCommand(rawDataOperation), callback);
                });
            } else {

                rawDataOperation.sql = "BEGIN";
                return this.sendDirectStatement(rawDataOperation, callback);
            }
        }
    },

    commitTransaction: {
        value: function (rawDataOperation, callback) {
            if(this.useDataAPI) {
                // this.rawClient.commitTransaction(rawDataOperation, callback);
                return this.rawClientPromise.then(() => {
                    this.rawClient.send(new CommitTransactionCommand(rawDataOperation), callback);
                });
            } else {
                rawDataOperation.sql = "COMMIT";
                return this.sendDirectStatement(rawDataOperation, callback);
            }
        }
    },

    _createDatabaseWithClientForRawDataOperation: {
        value: function(client, rawDataOperation, callback, done) {
            if(!client) return;

            client.query(rawDataOperation.sql, undefined, (err, res) => {
                //Returns the client to  the pool I assume
                done();

                if (err) {
                    callback(err);    
                } else {
                    callback(null, res);
                }
            })

        }
    },

    connectForRawDataOperation: {
        value: function (rawDataOperation, callback, dataOperation) {
            this.clientPool.connectForDataOperation(rawDataOperation, (err, client, done) => {
                if (err) {
                    this.mapRawDataOperationErrorToDataOperation(rawDataOperation, err, dataOperation);

                    if(err.name === DataOperationErrorNames.DatabaseMissing) {
                        let createDatabaseOperation = { ...rawDataOperation },
                            databaseName = createDatabaseOperation.database;

                        delete createDatabaseOperation.database;
                        delete createDatabaseOperation.schema;
                        delete createDatabaseOperation.sql;


                        //Remove it temporarily from this.clientPool's connection and we'll add it back after it's created:
                        delete this.clientPool.connection.database;
                        delete this.clientPool.rawClientPool.options.database;

                        this.clientPool.connectForDataOperation(createDatabaseOperation, (err, client, done) => {
                            createDatabaseOperation.sql = `CREATE DATABASE ${databaseName};`;

                            this._createDatabaseWithClientForRawDataOperation(client, createDatabaseOperation, (err, result) => {

                                if(!err) {
                                    this.clientPool.connection.database = this.clientPool.rawClientPool.options.database = databaseName;
                                    this.clientPool.connectForDataOperation(rawDataOperation, (err, client, done) => {                    
                                        callback(err, client, done);
                                    });    
                                } else {
                                    callback(err, client, done);
                                }
                            }, done);
                        });
                    }

                } else {
                    callback(err, client, done);
                }
            });
        }
    },

    sendDirectStatement: {
        value: function (rawDataOperation, callback, dataOperation) {
            return this.rawClientPromise.then(() => {
                // callback - checkout a client
                this.connectForRawDataOperation(rawDataOperation, (err, client, done) => {
                  if (err) {
                    console.error("sendDirectStatement() readWriteClientPool.connect error: ",err);
                    //call `done()` to release the client back to the pool
                    done();

                    callback(err);
                  } else if(client) {

                    if(ProcessEnv.TIME_PG === "true") {
                        var queryTimer = new Timer(rawDataOperation.sql);
                        //var queryTimer = new Timer(`${dataOperation.id}-${dataOperation.type}`);
                    }
                    client.query(rawDataOperation.sql, undefined, (err, res) => {
                        if(ProcessEnv.TIME_PG === "true") {
                            // console.debug("dataOperation:",dataOperation);
                            // console.debug(queryTimer.runtimeMsStr());
                        }

                        //Returns the client to  the pool I assume
                        done()
                        if (err) {
                            if(err.message.includes("already exists") && dataOperation.type === DataOperation.Type.CreateOperation && rawDataOperation.sql.startsWith("CREATE TABLE")) {
                                callback(null, res);
                            } else {
                                //console.error("sendDirectStatement() client.query error: ",err);
                                callback(err);    
                            }
                        } else {
                            callback(null, res);
                        }
                      })
                  }

                }, dataOperation);
            }).catch(error => {
                // let operation = this.responseOperationForReadOperation(dataOperation, error, null, false/*isNotLast*/);
                // dataOperation.target.dispatchEvent(operation);
                throw error;
            })
        }
    },

    executeStatement: {
        value: function executeStatement(rawDataOperation, callback, dataOperation) {
            if(this.useDataAPI) {
                //this.rawClient.executeStatement(rawDataOperation, callback);
                return this.rawClientPromise.then(() => {
                    this.rawClient.send(new ExecuteStatementCommand(rawDataOperation), callback);
                });
            } else {
                return this.sendDirectStatement(rawDataOperation, callback, dataOperation);
            }
        }
    },
    rollbackTransaction: {
        value: function rollbackTransaction(rawDataOperation, callback) {
            if(this.useDataAPI) {
                //this.rawClient.rollbackTransaction(rawDataOperation, callback);
                return this.rawClientPromise.then(() => {
                    this.rawClient.send(new RollbackTransactionCommand(rawDataOperation), callback);
                });
            } else {
                rawDataOperation.sql = "ROLLBACK";
                return this.sendDirectStatement(rawDataOperation, callback);
            }
        }
    }

});


Object.assign(PostgreSQLService.prototype, pgstringify);

