const PostgreSQLClientPool = require("./postgre-s-q-l-client-pool").PostgreSQLClientPool;

/*


PGHOST='ep-floral-base-444193-pooler.us-west-2.aws.neon.tech'
PGDATABASE='mod'
PGUSER='postgresql'
PGPASSWORD='123456'
ENDPOINT_ID='multiplayer-shopping-mod'

// app.js
const { Pool } = require('pg');
require('dotenv').config();

const { PGHOST, PGDATABASE, PGUSER, PGPASSWORD, ENDPOINT_ID } = process.env;
const URL = `postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}/${PGDATABASE}?options=project%3D${ENDPOINT_ID}`;

const { DATABASE_URL } = process.env;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

*/



const NeonPostgreSQLClientPool = exports.NeonPostgreSQLClientPool = PostgreSQLClientPool.specialize({


    createRawClientPool: {
        value: function() {
            const URL = `postgres://${this.databaseCredentials.username}:${this.databaseCredentials.password}@${this.databaseCredentials.host}/${this.connection.database}?options=project%3D${this.databaseCredentials.endpointIdentifier}`;
            var connectionOptions = {
                connectionString: URL,
                ssl: {
                    rejectUnauthorized: false,
                  }
            };

            //console.debug("connectionOptions: ",connectionOptions);

            return new this.constructor.rawPostgreSQLClientPool(connectionOptions);
        }
    },

});
