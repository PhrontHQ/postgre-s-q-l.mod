PostgreSQL allows you to scale horizontally by combining Declarative Partitioning with Foreign Data Wrappers (FDW). In this architectural pattern, a coordinator node handles incoming queries and holds a partitioned parent table. Instead of pointing to local tables, the partitions point to external PostgreSQL servers (shards) via foreign tables. [1, 2, 3, 4, 5] 
When a query hits the coordinator node, it determines which shard holds the relevant rows and routes the read or write request over the network using postgres_fdw. [1, 3, 6] 
------------------------------
# Step-by-Step Architecture Implementation

## 1. Setup on Remote Shards
Deploy independent PostgreSQL instances to act as your data shards. On each remote instance (e.g., Shard Server 1), create the actual data table that will store the physical rows. [7, 8, 9] 

-- Execute this directly on Shard Server 1
CREATE TABLE customers_shard_1 (
    customer_id INT PRIMARY KEY,
    name TEXT,
    region TEXT
);

## 2. Configure the Coordinator Node
On your primary coordinator node, install the built-in PostgreSQL Foreign Data Wrapper extension. Connect it to your external shard instances. [10, 11, 12] 

-- 1. Enable the extensionCREATE EXTENSION postgres_fdw;
-- 2. Define the remote server connectionCREATE SERVER shard_1_serverFOREIGN DATA WRAPPER postgres_fdwOPTIONS (host '://yourdomain.com', port '5432', dbname 'customer_db');
-- 3. Map local coordinator user to the remote user credentialsCREATE USER MAPPING FOR current_user
SERVER shard_1_serverOPTIONS (user 'shard_db_user', password 'secure_password_here');

## 3. Create the Distributed Schema [13] 
On the coordinator node, create the parent table utilizing declarative partitioning. Next, attach the remote shard as a Foreign Table Partition linked to that parent. [1, 4, 14, 15] 

-- 1. Create the main parent table partitioned by hashCREATE TABLE customers (
    customer_id INT NOT NULL,
    name TEXT,
    region TEXT
) PARTITION BY HASH (customer_id);
-- 2. Bind the remote shard as a foreign table partitionCREATE FOREIGN TABLE customers_part_1PARTITION OF customersFOR VALUES WITH (MODULUS 2, REMAINDER 0)
SERVER shard_1_serverOPTIONS (table_name 'customers_shard_1');

(Repeat these configuration steps for additional shards using distinct modulus/remainder configurations or range values). [7] 
------------------------------
# Key Optimizations for FDW Sharding
To prevent the coordinator from becoming a bottleneck, tweak your postgresql.conf parameters:

* enable_partition_pruning = on: Mandates that the planner immediately discards partitions unrelated to the query filter, preventing unnecessary network traffic to remote shards.
* async_capable = on: Allows PostgreSQL to execute query paths concurrently across multiple foreign tables, which is critical for parallelizing append/select steps. [16] 
* postgres_fdw.use_remote_estimate = on: Forces the coordinator to ask the foreign servers for actual query execution costs, producing highly accurate execution plans.

------------------------------
# Trade-offs: Built-In FDW Sharding vs. Citus Extension
While using standard Foreign Data Wrappers is a powerful vanilla mechanism, it introduces severe operational overhead compared to specialized extensions like [Citus Data](https://www.citusdata.com/) (an open-source Postgres extension). [2, 11, 17, 18, 19] 

| Feature / Metric | Native FDW Sharding | Citus Extension |
|---|---|---|
| Complexity | Manual setups required for server mappings, schemas, and user configurations. | Automated cluster setup via specific API functions (create_distributed_table). |
| Two-Phase Commits | Challenging; requires careful handle setups for reliable multi-shard transactions. | Native, automatic distributed transaction handling built-in. |
| Rebalancing Data | Manual process involving downtime to drop tables, re-partition, and shift data. | Online, zero-downtime data rebalancing across nodes via UI/API. |
| Cross-Shard Joins | Slow; data from separate shards often gets pulled to the coordinator node to finish joins. | Performs highly optimized parallel map-reduce distributed joins across workers. |
| Foreign Keys | Highly restrictive across foreign table limits. | Co-locates related tables effortlessly to enforce true constraints. |

Recommendation: Use native FDW sharding if you have minor data footprints, strict constraints preventing third-party extensions, or basic geo-routing requirements. For massive write scalability, heavy analytical queries across shards, or zero-downtime cluster expansions, implement [Citus Data](https://github.com/citusdata/citus). [7, 11, 17, 20, 21] 


[WIP PostgreSQL Sharding](https://wiki.postgresql.org/wiki/WIP_PostgreSQL_Sharding)