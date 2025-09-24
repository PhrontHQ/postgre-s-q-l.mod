const RawDatabaseClientPool = require("mod/data/service/raw-database-client-pool").RawDatabaseClientPool,
    os = require('os');



var PostgreSQLClientPool = exports.PostgreSQLClientPool = RawDatabaseClientPool.specialize({
    /***************************************************************************
     * Serialization
     */

    deserializeSelf: {
        value:function (deserializer) {
            this.super(deserializer);

            var value = deserializer.getProperty("delegate");
            if (value) {
                this.delegate = value;
            }

        }
    },

    _rawClientPromise: {
        value: undefined
    },
    rawClientPromises: {
        get: function () {
            if (!this._rawClientPromise) {

                this._rawClientPromise = this.super();

                this._rawClientPromise.push(
                    require.async("pg").then((exports) => {
                        PostgreSQLClientPool.rawPostgreSQLClient = exports.Client;
                        PostgreSQLClientPool.rawPostgreSQLClientPool = exports.Pool;
                    })
                );

                if(this.delegate && this.delegate.postgreSQLClientPoolWillResolveRawClientPromises) {
                    /*
                        Gives a chance to our delegate to add to those promises.

                        First use is to keep in our PostgreSQLDataService that knows how to get the user/password from AWS's secret manager to go do that for us.
                    */
                    this.delegate.postgreSQLClientPoolWillResolveRawClientPromises(this, this._rawClientPromise);
                }

                // promises.push(
                //     this.loadDatabaseCredentialsFromSecret()
                // );

            }
            return this._rawClientPromise;

        }
    },


    createRawClientPool: {
        value: function() {

            if(!this.databaseCredentials) {
                return null;
            }

            var connectionOptions = {
                host: this.readWriteEndoint
                    ? this.readWriteEndoint.endpoint
                    : this.databaseCredentials.host,
                port: this.databaseCredentials.port,
                user: this.databaseCredentials.username,
                // database: this.databaseCredentials.value.dbClusterIdentifier,
                database: this.connection.database,
                password: this.databaseCredentials.password
            };

            /*
                If no username is set, we'll use the current user as a tentative default
            */
            if(!connectionOptions.user && connectionOptions.host.includes("local")) {
                this.databaseCredentials.username = connectionOptions.user = os.userInfo().username;
            }

            if(this.databaseCredentials.clientPrivateKey || this.databaseCredentials.clientCertificate || this.databaseCredentials.serverCertificate) {
                  // this object will be passed to the TLSSocket constructor
                let ssl = connectionOptions.ssl = {
                    rejectUnauthorized: false,
                };

                /*
                    https://node-postgres.com/features/ssl

                    ssl: {
                        rejectUnauthorized: false,
                        ca: fs.readFileSync('/path/to/server-certificates/root.crt').toString(),
                        key: fs.readFileSync('/path/to/client-key/postgresql.key').toString(),
                        cert: fs.readFileSync('/path/to/client-certificates/postgresql.crt').toString(),
                    },

                */
                if(this.databaseCredentials.serverCertificate) {
                    let serverCertificate = Buffer.from(this.databaseCredentials.serverCertificate, 'base64').toString('binary');
                    ssl.ca = serverCertificate;
                }
                
                if(this.databaseCredentials.clientPrivateKey) {
                    let clientPrivateKey = Buffer.from(this.databaseCredentials.clientPrivateKey, 'base64').toString('binary');
                    ssl.key = clientPrivateKey;
                }

                if(this.databaseCredentials.clientCertificate) {
                    let clientCertificate = Buffer.from(this.databaseCredentials.clientCertificate, 'base64').toString('binary');
                    ssl.cert = clientCertificate;
                }
            }

            //console.debug("connectionOptions: ",connectionOptions);

            return new this.constructor.rawPostgreSQLClientPool(connectionOptions);
        }
    },

    rawClientPool: {
        get: function() {
            return this._rawClientPool || (this._rawClientPool = this.createRawClientPool());
        }
    },

    connectForDataOperation: {
        value: function(dataOperation, callback) {
            return this.rawClientPool?.connect(callback);
        }
    }


}, {
    "rawPostgreSQLClient": {
        value: undefined,
        enumerable: false,
        writable: true
    },
    "rawPostgreSQLClientPool": {
        value: undefined,
        enumerable: false,
        writable: true
    }

});
