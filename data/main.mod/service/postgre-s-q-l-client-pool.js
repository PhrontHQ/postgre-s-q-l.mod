var RawDatabaseClientPool = require("mod/data/service/raw-database-client-pool").RawDatabaseClientPool;



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

    rawClientPromises: {
        get: function () {
            var promises = this.super();

            promises.push(
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
                this.delegate.postgreSQLClientPoolWillResolveRawClientPromises(this, promises);
            }

            // promises.push(
            //     this.loadDatabaseCredentialsFromSecret()
            // );

            return promises;
        }
    },


    createRawClientPool: {
        value: function() {
            var connectionOptions = {
                host: this.readWriteEndoint.endpoint,
                port: this.databaseCredentials.value.port,
                user: this.databaseCredentials.value.username,
                // database: this.databaseCredentials.value.dbClusterIdentifier,
                database: this.connection.database,
                password: this.databaseCredentials.value.password
            };

            //console.debug("connectionOptions: ",connectionOptions);

            return new this.constructor.PostgreSQLClientPool(connectionOptions);
        }
    },

    rawClientPool: {
        get: function() {
            return this._rawClientPool || (this._rawClientPool = this.createRawClientPool());
        }
    },

    connectForDataOperation: {
        value: function(dataOperation, callback) {
            return this.rawClientPool.connect(callback);
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
