/*
 * https://www.bytelion.com/enabling-posgis-postgresql-amazon-web-servicesaws-relational-database-servicerds/
 * https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.html#Appendix.PostgreSQL.CommonDBATasks.PostGIS
 */

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

alter schema tiger owner to rds_superuser;
alter schema tiger_data owner to rds_superuser;
alter schema topology owner to rds_superuser;

CREATE OR REPLACE FUNCTION exec(text) returns text language plpgsql volatile AS $f$ BEGIN EXECUTE $1; RETURN $1; END; $f$;

SELECT exec('ALTER TABLE ' || quote_ident(s.nspname) || '.' || quote_ident(s.relname) || ' OWNER TO rds_superuser;')
FROM (
    SELECT nspname, relname
    FROM pg_class c JOIN pg_namespace n ON (c.relnamespace = n.oid)
    WHERE nspname in ('tiger','topology') AND
    relkind IN ('r','S','v') ORDER BY relkind = 'S'
)
s;

/* SET search_path=public,tiger; */
/* SELECT set_config('search_path', 'tiger,'||current_setting('search_path'), false);*/
SELECT set_config('search_path', current_setting('search_path')||',tiger', false);

/*
 * Test tiger by using the following SELECT statement.
 */
/*
select na.address, na.streetname, na.streettypeabbrev, na.zip
from normalize_address('1 Devonshire Place, Boston, MA 02109') as na;
*/

/*
 * Test topology by using the following SELECT statement:
 */
/*
select topology.createtopology('my_new_topo',26986,0.5);
*/



