#!/bin/sh
# Runs once, on first initialization of the data volume.
# Three logical databases in one container: real isolation between the auth
# provider and each relying app without three Postgres instances.
set -eu

for db in gapura keraton joglo; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-SQL
		CREATE DATABASE $db;
	SQL
done
